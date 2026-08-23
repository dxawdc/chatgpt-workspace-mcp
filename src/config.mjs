import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

const TaskSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  timeoutSeconds: z.number().int().min(1).max(1800).default(120),
  env: z.record(z.string(), z.string()).optional(),
});

const ProjectGitSchema = z.object({
  allowCommit: z.boolean().default(false),
  allowPush: z.boolean().default(false),
  allowedRemotes: z.array(z.string().regex(/^[A-Za-z0-9._-]+$/)).default(["origin"]),
  allowedBranches: z.array(z.string().min(1).max(255)).default([]),
});

const ProjectSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
  label: z.string().min(1).max(120).optional(),
  root: z.string().min(1),
  projectType: z.enum(["git", "non-git"]).optional(),
  writable: z.boolean().default(false),
  ignoreNames: z.array(z.string().min(1)).default([
    "node_modules",
    ".git",
    "dist",
    "build",
    "coverage",
  ]),
  tasks: z.record(z.string(), TaskSchema).default({}),
  git: ProjectGitSchema.default({
    allowCommit: false,
    allowPush: false,
    allowedRemotes: ["origin"],
    allowedBranches: [],
  }),
});

const DEFAULT_LIMITS = {
  maxReadBytes: 1024 * 1024,
  maxReadLines: 1200,
  maxSearchFileBytes: 1024 * 1024,
  maxSearchFiles: 5000,
  maxSearchResults: 200,
  maxWriteBytes: 1024 * 1024,
  maxCommandOutputBytes: 256 * 1024,
};

const LimitsSchema = z.object({
  maxReadBytes: z.number().int().min(1024).max(10 * 1024 * 1024).default(DEFAULT_LIMITS.maxReadBytes),
  maxReadLines: z.number().int().min(1).max(5000).default(DEFAULT_LIMITS.maxReadLines),
  maxSearchFileBytes: z.number().int().min(1024).max(10 * 1024 * 1024).default(DEFAULT_LIMITS.maxSearchFileBytes),
  maxSearchFiles: z.number().int().min(1).max(100000).default(DEFAULT_LIMITS.maxSearchFiles),
  maxSearchResults: z.number().int().min(1).max(2000).default(DEFAULT_LIMITS.maxSearchResults),
  maxWriteBytes: z.number().int().min(1).max(10 * 1024 * 1024).default(DEFAULT_LIMITS.maxWriteBytes),
  maxCommandOutputBytes: z.number().int().min(1024).max(10 * 1024 * 1024).default(DEFAULT_LIMITS.maxCommandOutputBytes),
});

const ConfigSchema = z.object({
  projects: z.array(ProjectSchema).default([]),
  discoveryRoots: z.array(z.string().min(1)).default([]),
  limits: LimitsSchema.default(DEFAULT_LIMITS),
});

export function defaultConfigPath() {
  if (process.env.LOCAL_PROJECT_WORKSPACE_CONFIG) {
    return path.resolve(process.env.LOCAL_PROJECT_WORKSPACE_CONFIG);
  }
  const preferred = path.join(os.homedir(), ".secure-local-workspace-mcp", "config.json");
  const legacy = path.join(os.homedir(), ".local-project-workspace", "config.json");
  return path.resolve(existsSync(preferred) || !existsSync(legacy) ? preferred : legacy);
}

export async function loadConfig(configPath = defaultConfigPath()) {
  let raw;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { ...ConfigSchema.parse({}), configPath };
    }
    throw error;
  }

  let input;
  try {
    input = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in ${configPath}: ${error.message}`);
  }

  const config = ConfigSchema.parse(input);
  const seen = new Set();
  for (const project of config.projects) {
    if (seen.has(project.id)) {
      throw new Error(`Duplicate project id: ${project.id}`);
    }
    seen.add(project.id);
    project.root = path.resolve(project.root);
  }
  config.discoveryRoots = config.discoveryRoots.map((root) => path.resolve(root));
  return { ...config, configPath };
}

export async function saveConfig(config, configPath = config.configPath || defaultConfigPath()) {
  const parsed = ConfigSchema.parse({
    projects: config.projects,
    discoveryRoots: config.discoveryRoots,
    limits: config.limits,
  });
  const resolvedPath = path.resolve(configPath);
  await mkdir(path.dirname(resolvedPath), { recursive: true });
  const temporaryPath = `${resolvedPath}.${process.pid}.${Date.now()}.tmp`;
  const payload = `${JSON.stringify(parsed, null, 2)}\n`;
  await writeFile(temporaryPath, payload, { encoding: "utf8", flag: "wx" });
  try {
    await rename(temporaryPath, resolvedPath);
  } catch (error) {
    try {
      await rm(temporaryPath, { force: true });
    } catch {
      // Preserve the original write error.
    }
    throw error;
  }
  return resolvedPath;
}

export { ConfigSchema, ProjectGitSchema, ProjectSchema };
