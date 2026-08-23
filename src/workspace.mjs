import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { applyPatch as applyUnifiedPatch } from "diff";
import { runProcess } from "./process.mjs";

const TEXT_PREVIEW_LIMIT = 500;

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
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

export function createWorkspaceService(config) {
  const projects = new Map(config.projects.map((project) => [project.id, project]));

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
        arbitraryShell: false,
        deleteTool: false,
        commitTool: false,
        pushTool: false,
      };
    },

    listProjects() {
      return {
        projects: config.projects.map((project) => ({
          id: project.id,
          label: project.label || project.id,
          writable: project.writable,
          tasks: Object.keys(project.tasks),
        })),
      };
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

    async gitStatus({ projectId }) {
      const project = getProject(projectId);
      const root = await getRoot(project);
      return runProcess({
        command: "git",
        args: ["status", "--short", "--branch"],
        cwd: root,
        timeoutSeconds: 30,
        maxOutputBytes: config.limits.maxCommandOutputBytes,
      });
    },

    async gitDiff({ projectId, staged = false }) {
      const project = getProject(projectId);
      const root = await getRoot(project);
      const args = ["diff", "--no-ext-diff", "--no-color"];
      if (staged) args.push("--cached");
      return runProcess({
        command: "git",
        args,
        cwd: root,
        timeoutSeconds: 60,
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
