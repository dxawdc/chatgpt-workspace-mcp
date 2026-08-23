import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { applyPatch as applyUnifiedPatch } from "diff";
import {
  gitCommit,
  gitDiffSnapshot,
  gitPush,
  gitStatusSnapshot,
  gitUnstage,
  isGitProjectRoot,
} from "./git.mjs";
import { runProcess } from "./process.mjs";

const TEXT_PREVIEW_LIMIT = 500;
const DEFAULT_IGNORE_NAMES = ["node_modules", ".git", "dist", "build", "coverage", ".next", ".cache"];
const DISCOVERY_IGNORE_NAMES = new Set([".git", "node_modules", "dist", "build", "coverage", ".next", ".cache"]);
const PROJECT_MARKER_NAMES = new Set([
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "setup.py",
  "setup.cfg",
  "Pipfile",
  "poetry.lock",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "settings.gradle",
  "settings.gradle.kts",
  "composer.json",
  "Gemfile",
  "mix.exs",
  "Package.swift",
  "Makefile",
  "CMakeLists.txt",
]);
const PROJECT_MARKER_EXTENSIONS = [".sln", ".csproj", ".fsproj", ".vbproj", ".xcodeproj"];

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function pathKey(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function validateRelativePath(relativePath, { allowRoot = false } = {}) {
  if (typeof relativePath !== "string" || relativePath.includes("\0")) {
    throw new Error("Path must be a string without NUL characters.");
  }
  const normalized = relativePath.trim() || ".";
  if (path.isAbsolute(normalized)) throw new Error("Absolute paths are not allowed.");
  if (!allowRoot && (normalized === "." || normalized === "")) {
    throw new Error("A file path is required.");
  }
  return normalized;
}

function looksBinary(buffer) {
  return buffer.subarray(0, Math.min(buffer.length, 8192)).includes(0);
}

function normalizeExtensions(extensions) {
  if (!extensions?.length) return null;
  return new Set(extensions.map((value) => (value.startsWith(".") ? value : `.${value}`).toLowerCase()));
}

function projectIdFromPath(root) {
  const normalized = path
    .basename(root)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return normalized || "project";
}

function detectedProjectMarkers(entries) {
  return entries
    .map((entry) => entry.name)
    .filter(
      (name) =>
        PROJECT_MARKER_NAMES.has(name) ||
        PROJECT_MARKER_EXTENSIONS.some((extension) => name.toLowerCase().endsWith(extension)),
    )
    .sort((a, b) => a.localeCompare(b));
}

async function detectedProjectTasks(root) {
  try {
    const packageJson = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
    const command = process.platform === "win32" ? "npm.cmd" : "npm";
    const tasks = {};
    for (const taskName of ["test", "lint", "build", "typecheck"]) {
      if (!packageJson.scripts?.[taskName]) continue;
      tasks[taskName] = {
        command,
        args: taskName === "test" ? ["test"] : ["run", taskName],
        timeoutSeconds: taskName === "build" ? 600 : 300,
      };
    }
    return tasks;
  } catch {
    return {};
  }
}

export function createWorkspaceService(config, { persistConfig } = {}) {
  const projects = new Map(config.projects.map((project) => [project.id, project]));

  async function persist() {
    if (!persistConfig) throw new Error("Configuration updates are unavailable in this runtime.");
    await persistConfig(config);
  }

  function getProject(projectId) {
    const project = projects.get(projectId);
    if (!project) throw new Error(`Unknown project id: ${projectId}`);
    return project;
  }

  async function getRoot(project) {
    const root = await fs.realpath(project.root);
    const stat = await fs.stat(root);
    if (!stat.isDirectory()) throw new Error(`Configured root is not a directory: ${project.id}`);
    return root;
  }

  async function getGitRoot(project) {
    const root = await getRoot(project);
    if (!(await isGitProjectRoot(root))) {
      throw new Error(`Project ${project.id} is not a Git repository; Git tools are unavailable.`);
    }
    return root;
  }

  async function resolveExisting(project, relativePath, options = {}) {
    const normalized = validateRelativePath(relativePath, options);
    const root = await getRoot(project);
    const lexical = path.resolve(root, normalized);
    if (!isInside(root, lexical)) throw new Error("Path escapes the configured project root.");
    const real = await fs.realpath(lexical);
    if (!isInside(root, real)) throw new Error("Resolved path escapes the configured project root.");
    return { root, absolute: real, relative: path.relative(root, real) || "." };
  }

  async function resolveForCreate(project, relativePath) {
    const normalized = validateRelativePath(relativePath);
    const root = await getRoot(project);
    const lexical = path.resolve(root, normalized);
    if (!isInside(root, lexical)) throw new Error("Path escapes the configured project root.");
    const parent = await fs.realpath(path.dirname(lexical));
    if (!isInside(root, parent)) throw new Error("Parent directory escapes the configured project root.");
    return { root, absolute: lexical, relative: path.relative(root, lexical) };
  }

  function assertWritable(project) {
    if (!project.writable) throw new Error(`Project ${project.id} is configured as read-only.`);
  }

  function assertCommitAllowed(project) {
    assertWritable(project);
    if (!project.git.allowCommit) throw new Error(`Git commits are not enabled for project ${project.id}.`);
  }

  function assertPushAllowed(project) {
    if (!project.git.allowPush) throw new Error(`Git push is not enabled for project ${project.id}.`);
  }

  async function discoveryRootPaths() {
    const roots = [];
    for (const configuredRoot of config.discoveryRoots) {
      const real = await fs.realpath(configuredRoot);
      const stat = await fs.stat(real);
      if (!stat.isDirectory()) throw new Error(`Discovery root is not a directory: ${configuredRoot}`);
      roots.push(real);
    }
    return roots;
  }

  async function resolveDiscoverableProject(candidate) {
    if (!path.isAbsolute(candidate)) throw new Error("Project discovery paths must be absolute.");
    const real = await fs.realpath(candidate);
    const roots = await discoveryRootPaths();
    if (!roots.some((root) => isInside(root, real))) {
      throw new Error("Project is outside the locally approved discovery roots. Add its parent with quick-setup first.");
    }
    const stat = await fs.stat(real);
    if (!stat.isDirectory()) throw new Error("Project path must be an existing directory.");
    return { root: real, projectType: (await isGitProjectRoot(real)) ? "git" : "non-git" };
  }

  async function assertGitIdentity(root) {
    const [name, email] = await Promise.all([
      runProcess({
        command: "git",
        args: ["config", "user.name"],
        cwd: root,
        timeoutSeconds: 15,
        maxOutputBytes: 4096,
      }),
      runProcess({
        command: "git",
        args: ["config", "user.email"],
        cwd: root,
        timeoutSeconds: 15,
        maxOutputBytes: 4096,
      }),
    ]);
    if (name.exitCode !== 0 || email.exitCode !== 0 || !name.stdout.trim() || !email.stdout.trim()) {
      throw new Error("Git user.name and user.email must be configured locally before enabling commit.");
    }
  }

  async function readText(project, relativePath) {
    const resolved = await resolveExisting(project, relativePath);
    const stat = await fs.stat(resolved.absolute);
    if (!stat.isFile()) throw new Error("Path is not a regular file.");
    if (stat.size > config.limits.maxReadBytes) {
      throw new Error(`File is larger than maxReadBytes (${config.limits.maxReadBytes}).`);
    }
    const buffer = await fs.readFile(resolved.absolute);
    if (looksBinary(buffer)) throw new Error("Binary files are not supported.");
    return { ...resolved, buffer, text: buffer.toString("utf8"), stat, hash: sha256(buffer) };
  }

  async function walkFiles(project, startPath, maxDepth = 20) {
    const start = await resolveExisting(project, startPath || ".", { allowRoot: true });
    const startStat = await fs.stat(start.absolute);
    if (!startStat.isDirectory()) throw new Error("Search/list start path must be a directory.");
    const ignored = new Set(project.ignoreNames);
    const entries = [];
    const queue = [{ absolute: start.absolute, depth: 0 }];
    while (queue.length) {
      const current = queue.shift();
      const children = await fs.readdir(current.absolute, { withFileTypes: true });
      children.sort((a, b) => a.name.localeCompare(b.name));
      for (const child of children) {
        if (ignored.has(child.name)) continue;
        const absolute = path.join(current.absolute, child.name);
        const relative = path.relative(start.root, absolute);
        if (child.isSymbolicLink()) {
          entries.push({ absolute, relative, type: "symlink", depth: current.depth + 1 });
          continue;
        }
        if (child.isDirectory()) {
          entries.push({ absolute, relative, type: "directory", depth: current.depth + 1 });
          if (current.depth < maxDepth) queue.push({ absolute, depth: current.depth + 1 });
        } else if (child.isFile()) {
          entries.push({ absolute, relative, type: "file", depth: current.depth + 1 });
        }
      }
    }
    return entries;
  }

  return {
    diagnostics() {
      return {
        configPath: config.configPath,
        authorizedProjects: config.projects.length,
        writableProjects: config.projects.filter((project) => project.writable).length,
        discoveryRoots: config.discoveryRoots.length,
        arbitraryShell: false,
        guardedDeleteTool: true,
        gitProjects: config.projects.filter(
          (project) => project.projectType === "git" || (!project.projectType && (project.git.allowCommit || project.git.allowPush)),
        ).length,
        nonGitProjects: config.projects.filter((project) => project.projectType === "non-git").length,
        commitProjects: config.projects.filter((project) => project.git.allowCommit).length,
        pushProjects: config.projects.filter((project) => project.git.allowPush).length,
      };
    },

    listProjects() {
      return {
        projects: config.projects.map((project) => ({
          id: project.id,
          label: project.label || project.id,
          root: project.root,
          projectType:
            project.projectType || (project.git.allowCommit || project.git.allowPush ? "git" : "unknown"),
          writable: project.writable,
          tasks: Object.keys(project.tasks),
          git: project.git,
        })),
      };
    },

    async discoverProjects({ includeNonGit = true, maxDepth = 4, maxProjects = 100, maxDirectories = 5000 } = {}) {
      const roots = await discoveryRootPaths();
      const authorizedRoots = new Map(config.projects.map((project) => [pathKey(project.root), project.id]));
      const discovered = [];
      let scannedDirectories = 0;
      let truncated = false;
      for (const discoveryRoot of roots) {
        const queue = [{ absolute: discoveryRoot, depth: 0 }];
        while (queue.length && discovered.length < maxProjects && scannedDirectories < maxDirectories) {
          const current = queue.shift();
          scannedDirectories += 1;
          const children = await fs.readdir(current.absolute, { withFileTypes: true });
          const hasGitMarker = children.some((child) => child.name === ".git");
          const gitRoot = hasGitMarker && (await isGitProjectRoot(current.absolute));
          const markers = gitRoot ? [] : detectedProjectMarkers(children);
          const authorizedProjectId = authorizedRoots.get(pathKey(current.absolute)) || null;
          if (gitRoot || (includeNonGit && (markers.length > 0 || authorizedProjectId))) {
            discovered.push({
              path: current.absolute,
              suggestedId: projectIdFromPath(current.absolute),
              projectType: gitRoot ? "git" : "non-git",
              markers,
              authorizedProjectId,
            });
          }
          if (current.depth >= maxDepth) continue;
          for (const child of children) {
            if (!child.isDirectory() || child.isSymbolicLink() || DISCOVERY_IGNORE_NAMES.has(child.name)) continue;
            queue.push({ absolute: path.join(current.absolute, child.name), depth: current.depth + 1 });
          }
        }
        if (queue.length || discovered.length >= maxProjects || scannedDirectories >= maxDirectories) truncated = true;
      }
      return {
        discoveryRoots: roots,
        projects: discovered,
        scannedDirectories,
        includesNonGit: includeNonGit,
        truncated,
      };
    },

    async connectProject({ projectPath, projectId, label, writable = true, allowCommit = true }) {
      const { root, projectType } = await resolveDiscoverableProject(projectPath);
      const effectiveAllowCommit = projectType === "git" && writable && allowCommit;
      if (effectiveAllowCommit) await assertGitIdentity(root);
      const existing = config.projects.find((project) => pathKey(project.root) === pathKey(root));
      if (existing) {
        const previousProjectType = existing.projectType;
        const previousAllowCommit = existing.git.allowCommit;
        const previousAllowPush = existing.git.allowPush;
        let changed = false;
        if (existing.projectType !== projectType) {
          existing.projectType = projectType;
          changed = true;
        }
        if (projectType === "non-git" && (existing.git.allowCommit || existing.git.allowPush)) {
          existing.git.allowCommit = false;
          existing.git.allowPush = false;
          changed = true;
        }
        if (changed) {
          try {
            await persist();
          } catch (error) {
            existing.projectType = previousProjectType;
            existing.git.allowCommit = previousAllowCommit;
            existing.git.allowPush = previousAllowPush;
            throw error;
          }
        }
        return {
          connected: false,
          alreadyAuthorized: true,
          project: existing,
          gitPermissionsDisabled: projectType === "non-git",
        };
      }
      const baseId = projectId || projectIdFromPath(root);
      let id = baseId;
      let suffix = 2;
      while (projects.has(id)) {
        const suffixText = `-${suffix}`;
        id = `${baseId.slice(0, 64 - suffixText.length)}${suffixText}`;
        suffix += 1;
      }
      const project = {
        id,
        label: label || path.basename(root),
        root,
        projectType,
        writable,
        ignoreNames: [...DEFAULT_IGNORE_NAMES],
        tasks: await detectedProjectTasks(root),
        git: {
          allowCommit: effectiveAllowCommit,
          allowPush: false,
          allowedRemotes: ["origin"],
          allowedBranches: [],
        },
      };
      config.projects.push(project);
      projects.set(id, project);
      try {
        await persist();
      } catch (error) {
        projects.delete(id);
        config.projects.splice(config.projects.indexOf(project), 1);
        throw error;
      }
      return {
        connected: true,
        alreadyAuthorized: false,
        project,
        gitPermissionsDisabled: projectType === "non-git",
      };
    },

    async disconnectProject({ projectId }) {
      const project = getProject(projectId);
      const index = config.projects.indexOf(project);
      config.projects.splice(index, 1);
      projects.delete(projectId);
      try {
        await persist();
      } catch (error) {
        config.projects.splice(index, 0, project);
        projects.set(projectId, project);
        throw error;
      }
      return { disconnected: true, projectId, filesDeleted: false };
    },

    async listFiles({ projectId, pathPrefix = ".", maxDepth = 4, maxEntries = 500 }) {
      const project = getProject(projectId);
      const entries = await walkFiles(project, pathPrefix, Math.min(maxDepth, 20));
      return {
        projectId,
        pathPrefix,
        entries: entries.slice(0, maxEntries).map(({ relative, type }) => ({ path: relative, type })),
        truncated: entries.length > maxEntries,
      };
    },

    async readFile({ projectId, path: relativePath, startLine = 1, endLine }) {
      const project = getProject(projectId);
      const file = await readText(project, relativePath);
      const lines = file.text.split(/\r?\n/);
      const safeStart = Math.max(1, startLine);
      const requestedEnd = endLine ?? safeStart + config.limits.maxReadLines - 1;
      const safeEnd = Math.min(lines.length, requestedEnd, safeStart + config.limits.maxReadLines - 1);
      return {
        projectId,
        path: file.relative,
        sha256: file.hash,
        sizeBytes: file.stat.size,
        totalLines: lines.length,
        startLine: safeStart,
        endLine: safeEnd,
        text: lines.slice(safeStart - 1, safeEnd).join("\n"),
      };
    },

    async searchText({ projectId, query, pathPrefix = ".", caseSensitive = false, extensions, maxResults }) {
      if (!query) throw new Error("Search query cannot be empty.");
      const project = getProject(projectId);
      const files = (await walkFiles(project, pathPrefix, 20)).filter((entry) => entry.type === "file");
      const extensionSet = normalizeExtensions(extensions);
      const cap = Math.min(maxResults || config.limits.maxSearchResults, config.limits.maxSearchResults);
      const needle = caseSensitive ? query : query.toLowerCase();
      const matches = [];
      let scannedFiles = 0;
      for (const file of files) {
        if (scannedFiles >= config.limits.maxSearchFiles || matches.length >= cap) break;
        if (extensionSet && !extensionSet.has(path.extname(file.relative).toLowerCase())) continue;
        const stat = await fs.stat(file.absolute);
        if (stat.size > config.limits.maxSearchFileBytes) continue;
        const buffer = await fs.readFile(file.absolute);
        scannedFiles += 1;
        if (looksBinary(buffer)) continue;
        const lines = buffer.toString("utf8").split(/\r?\n/);
        for (let index = 0; index < lines.length && matches.length < cap; index += 1) {
          const haystack = caseSensitive ? lines[index] : lines[index].toLowerCase();
          if (haystack.includes(needle)) {
            matches.push({
              path: file.relative,
              line: index + 1,
              text: lines[index].slice(0, TEXT_PREVIEW_LIMIT),
            });
          }
        }
      }
      return {
        projectId,
        query,
        matches,
        scannedFiles,
        truncated: matches.length >= cap || scannedFiles >= config.limits.maxSearchFiles,
      };
    },

    async applyPatch({ projectId, path: relativePath, patch, expectedSha256 }) {
      const project = getProject(projectId);
      assertWritable(project);
      if (!expectedSha256) throw new Error("expectedSha256 is required for existing-file edits.");
      const file = await readText(project, relativePath);
      if (file.hash !== expectedSha256) {
        throw new Error(`File changed since it was read. Expected ${expectedSha256}, current ${file.hash}.`);
      }
      const updated = applyUnifiedPatch(file.text, patch, { fuzzFactor: 0 });
      if (updated === false) throw new Error("Patch did not apply cleanly. Re-read the file and generate a fresh patch.");
      if (Buffer.byteLength(updated, "utf8") > config.limits.maxWriteBytes) {
        throw new Error(`Updated file is larger than maxWriteBytes (${config.limits.maxWriteBytes}).`);
      }
      const current = await fs.readFile(file.absolute);
      if (sha256(current) !== expectedSha256) throw new Error("File changed during the edit; no write was performed.");
      await fs.writeFile(file.absolute, updated, "utf8");
      return {
        projectId,
        path: file.relative,
        previousSha256: expectedSha256,
        sha256: sha256(Buffer.from(updated, "utf8")),
        sizeBytes: Buffer.byteLength(updated, "utf8"),
      };
    },

    async createTextFile({ projectId, path: relativePath, content }) {
      const project = getProject(projectId);
      assertWritable(project);
      if (Buffer.byteLength(content, "utf8") > config.limits.maxWriteBytes) {
        throw new Error(`New file is larger than maxWriteBytes (${config.limits.maxWriteBytes}).`);
      }
      const resolved = await resolveForCreate(project, relativePath);
      await fs.writeFile(resolved.absolute, content, { encoding: "utf8", flag: "wx" });
      return {
        projectId,
        path: resolved.relative,
        sha256: sha256(Buffer.from(content, "utf8")),
        sizeBytes: Buffer.byteLength(content, "utf8"),
      };
    },

    async deleteTextFile({ projectId, path: relativePath, expectedSha256 }) {
      const project = getProject(projectId);
      assertWritable(project);
      const file = await readText(project, relativePath);
      if (file.hash !== expectedSha256) {
        throw new Error(`File changed since it was read. Expected ${expectedSha256}, current ${file.hash}.`);
      }
      const current = await fs.readFile(file.absolute);
      if (sha256(current) !== expectedSha256) throw new Error("File changed during delete validation; nothing was deleted.");
      await fs.unlink(file.absolute);
      return { projectId, path: file.relative, deleted: true, previousSha256: expectedSha256 };
    },

    async gitStatus({ projectId }) {
      const project = getProject(projectId);
      const root = await getGitRoot(project);
      return gitStatusSnapshot(root, config.limits.maxCommandOutputBytes);
    },

    async gitDiff({ projectId, staged = false }) {
      const project = getProject(projectId);
      const root = await getGitRoot(project);
      return gitDiffSnapshot(root, staged, config.limits.maxCommandOutputBytes);
    },

    async gitUnstage({ projectId, paths, expectedStatusSha256 }) {
      const project = getProject(projectId);
      assertCommitAllowed(project);
      const root = await getGitRoot(project);
      return gitUnstage({
        root,
        paths,
        expectedStatusSha256,
        maxOutputBytes: config.limits.maxCommandOutputBytes,
      });
    },

    async gitCommit({ projectId, paths, message, expectedStatusSha256 }) {
      const project = getProject(projectId);
      assertCommitAllowed(project);
      const root = await getGitRoot(project);
      return gitCommit({
        root,
        paths,
        message,
        expectedStatusSha256,
        maxOutputBytes: config.limits.maxCommandOutputBytes,
      });
    },

    async gitPush({ projectId, remote = "origin", expectedCommitSha }) {
      const project = getProject(projectId);
      assertPushAllowed(project);
      const root = await getGitRoot(project);
      return gitPush({
        root,
        remote,
        expectedCommitSha,
        allowedRemotes: project.git.allowedRemotes,
        allowedBranches: project.git.allowedBranches,
        maxOutputBytes: config.limits.maxCommandOutputBytes,
      });
    },

    async runTask({ projectId, taskName }) {
      const project = getProject(projectId);
      const task = project.tasks[taskName];
      if (!task) throw new Error(`Task ${taskName} is not allowlisted for project ${projectId}.`);
      const root = await getRoot(project);
      return runProcess({
        command: task.command,
        args: task.args,
        cwd: root,
        timeoutSeconds: task.timeoutSeconds,
        maxOutputBytes: config.limits.maxCommandOutputBytes,
        env: task.env,
      });
    },
  };
}
