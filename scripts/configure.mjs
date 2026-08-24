import fs from "node:fs/promises";
import path from "node:path";
import { defaultConfigPath, loadConfig, saveConfig } from "../src/config.mjs";
import { isGitProjectRoot } from "../src/git.mjs";

const DEFAULT_IGNORES = ["node_modules", ".git", "dist", "build", "coverage", ".next", ".cache"];

function valuesFor(args, name) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
      values.push(value);
      index += 1;
    }
  }
  return values;
}

function valueFor(args, name) {
  return valuesFor(args, name).at(-1);
}

function has(args, name) {
  return args.includes(name);
}

function deriveId(root) {
  return (
    path
      .basename(root)
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "project"
  );
}

function uniqueId(config, requested, existing) {
  if (existing || !config.projects.some((project) => project.id === requested)) return requested;
  let suffix = 2;
  while (true) {
    const suffixText = `-${suffix}`;
    const candidate = `${requested.slice(0, 64 - suffixText.length)}${suffixText}`;
    if (!config.projects.some((project) => project.id === candidate)) return candidate;
    suffix += 1;
  }
}

async function detectedTasks(root) {
  try {
    const packageJson = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
    const command = process.platform === "win32" ? "npm.cmd" : "npm";
    const tasks = {};
    for (const taskName of ["test", "lint", "build", "typecheck"]) {
      if (packageJson.scripts?.[taskName]) {
        tasks[taskName] = {
          command,
          args: taskName === "test" ? ["test"] : ["run", taskName],
          timeoutSeconds: taskName === "build" ? 600 : 300,
        };
      }
    }
    return tasks;
  } catch {
    return {};
  }
}

async function resolveDirectory(input, label) {
  if (!input) throw new Error(`${label} is required.`);
  const resolved = path.resolve(input);
  const real = await fs.realpath(resolved);
  const stat = await fs.stat(real);
  if (!stat.isDirectory()) throw new Error(`${label} must be an existing directory.`);
  return real;
}

async function addDiscoveryRoot(config, args) {
  const root = await resolveDirectory(valueFor(args, "--root"), "--root");
  const exists = config.discoveryRoots.some((entry) => path.resolve(entry) === path.resolve(root));
  if (!exists) config.discoveryRoots.push(root);
  await saveConfig(config);
  return { changed: !exists, discoveryRoot: root, configPath: config.configPath };
}

async function addProject(config, args) {
  const root = await resolveDirectory(valueFor(args, "--root"), "--root");
  const requestedId = valueFor(args, "--id") || deriveId(root);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(requestedId)) throw new Error("--id is invalid.");
  const existing = config.projects.find(
    (project) => project.id === requestedId || path.resolve(project.root) === path.resolve(root),
  );
  const id = uniqueId(config, requestedId, existing);
  const gitRoot = await isGitProjectRoot(root);
  const projectType = gitRoot ? "git" : "non-git";
  if (!gitRoot && (has(args, "--allow-commit") || has(args, "--allow-push"))) {
    throw new Error("Commit or push was requested, but --root is not a Git project root.");
  }
  const project = existing || {
    id,
    label: valueFor(args, "--label") || path.basename(root),
    root,
    projectType,
    writable: false,
    ignoreNames: [...DEFAULT_IGNORES],
    tasks: await detectedTasks(root),
    git: { allowCommit: false, allowPush: false, allowedRemotes: ["origin"], allowedBranches: [] },
  };

  project.projectType = projectType;

  if (existing && Object.keys(project.tasks).length === 0) {
    project.tasks = await detectedTasks(root);
  }

  if (existing && valueFor(args, "--label")) project.label = valueFor(args, "--label");
  if (has(args, "--writable")) project.writable = true;
  if (has(args, "--read-only")) project.writable = false;
  if (has(args, "--allow-commit")) project.git.allowCommit = true;
  if (has(args, "--no-commit")) project.git.allowCommit = false;
  if (has(args, "--allow-push")) project.git.allowPush = true;
  if (has(args, "--no-push")) project.git.allowPush = false;
  const remotes = valuesFor(args, "--remote");
  const branches = valuesFor(args, "--branch");
  const ignoreNames = valuesFor(args, "--ignore");
  if (remotes.length) project.git.allowedRemotes = [...new Set(remotes)];
  if (branches.length) project.git.allowedBranches = [...new Set(branches)];
  if (ignoreNames.length) project.ignoreNames = [...new Set(ignoreNames)];

  if (!gitRoot) {
    project.git.allowCommit = false;
    project.git.allowPush = false;
  }
  if (project.git.allowCommit && !project.writable) {
    throw new Error("Commit requires a writable project. Add --writable or disable commit.");
  }
  if (project.git.allowPush && !project.git.allowCommit) {
    throw new Error("Push requires commit permission for the project.");
  }

  if (!existing) config.projects.push(project);
  await saveConfig(config);
  return { changed: true, project, configPath: config.configPath, detectedGitRoot: gitRoot, projectType };
}

function usage() {
  return `ChatGPT Workspace MCP configuration

Commands:
  node scripts/configure.mjs add-discovery-root --root <folder>
  node scripts/configure.mjs add-project --root <folder> [--id <id>] [--label <label>]
       [--writable|--read-only] [--allow-commit|--no-commit]
       [--allow-push|--no-push] [--remote <name>] [--branch <name>]
       [--ignore <directory-name>]
  node scripts/configure.mjs list

Set LOCAL_PROJECT_WORKSPACE_CONFIG to select a non-default config file.`;
}

const [command, ...args] = process.argv.slice(2);
if (!command || has(args, "--help") || command === "help") {
  console.log(usage());
  process.exit(0);
}

const configPath = defaultConfigPath();
const config = await loadConfig(configPath);
let output;
if (command === "add-discovery-root") output = await addDiscoveryRoot(config, args);
else if (command === "add-project") output = await addProject(config, args);
else if (command === "list") {
  output = {
    configPath: config.configPath,
    discoveryRoots: config.discoveryRoots,
    projects: config.projects.map(({ id, label, root, projectType, writable, git, tasks }) => ({
      id,
      label,
      root,
      projectType: projectType || "unknown",
      writable,
      git,
      tasks: Object.keys(tasks),
    })),
  };
} else {
  throw new Error(`Unknown command: ${command}\n\n${usage()}`);
}

console.log(JSON.stringify(output, null, 2));
