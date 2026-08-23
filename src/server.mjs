import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig, saveConfig } from "./config.mjs";
import { createWorkspaceService } from "./workspace.mjs";

function result(data, summary) {
  return {
    structuredContent: data,
    content: [{ type: "text", text: summary || JSON.stringify(data, null, 2) }],
  };
}

function failure(error) {
  return {
    isError: true,
    content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
  };
}

function register(server, name, definition, handler) {
  server.registerTool(name, definition, async (input) => {
    try {
      return await handler(input);
    } catch (error) {
      return failure(error);
    }
  });
}

const config = await loadConfig();
const service = createWorkspaceService(config, { persistConfig: (nextConfig) => saveConfig(nextConfig) });
const server = new McpServer(
  { name: "secure-local-workspace-mcp", version: "0.3.0" },
  {
    instructions:
      "Work only with authorized projects or projects discovered beneath locally approved discovery roots. Both Git and non-Git projects are supported; never call Git tools for a project whose projectType is non-git. Read a file immediately before editing or deleting and pass its sha256. Preserve unrelated changes. Before git_commit, call git_status and git_diff, pass the latest statusSha256, and list only intended paths. Commit and push are separate actions; never imply a push occurred unless git_push succeeds. This server has no arbitrary shell, force-push, history rewrite, or deploy tools.",
  },
);

register(
  server,
  "diagnostics",
  {
    title: "Check local project workspace",
    description: "Check configuration and safety capabilities before starting local project work.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  },
  async () => result(service.diagnostics()),
);

register(
  server,
  "list_projects",
  {
    title: "List authorized local projects",
    description: "List the local projects, write permissions, and task names authorized by the user.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  },
  async () => result(service.listProjects()),
);

register(
  server,
  "discover_projects",
  {
    title: "Discover local projects",
    description:
      "Find Git repositories and common non-Git project folders only beneath parent folders that the user approved locally during setup.",
    inputSchema: {
      includeNonGit: z.boolean().default(true),
      maxDepth: z.number().int().min(0).max(8).default(4),
      maxProjects: z.number().int().min(1).max(500).default(100),
      maxDirectories: z.number().int().min(1).max(20000).default(5000),
    },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  },
  async (input) => result(await service.discoverProjects(input)),
);

register(
  server,
  "connect_project",
  {
    title: "Connect a local project",
    description:
      "Authorize one directory beneath a locally approved discovery root. Non-Git projects can be edited, but commit and push are automatically disabled.",
    inputSchema: {
      projectPath: z.string().min(1),
      projectId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/).optional(),
      label: z.string().min(1).max(120).optional(),
      writable: z.boolean().default(true),
      allowCommit: z.boolean().default(true).describe("Applied only when the selected directory is a Git root."),
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
  },
  async (input) => result(await service.connectProject(input), "Project connected. Call list_projects before working."),
);

register(
  server,
  "disconnect_project",
  {
    title: "Disconnect an authorized project",
    description: "Remove one project from the MCP authorization list without deleting any project files.",
    inputSchema: { projectId: z.string() },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: true },
  },
  async (input) => result(await service.disconnectProject(input), "Project disconnected. No project files were deleted."),
);

register(
  server,
  "list_files",
  {
    title: "List project files",
    description: "List files and directories beneath an authorized project path.",
    inputSchema: {
      projectId: z.string(),
      pathPrefix: z.string().default("."),
      maxDepth: z.number().int().min(0).max(20).default(4),
      maxEntries: z.number().int().min(1).max(2000).default(500),
    },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  },
  async (input) => result(await service.listFiles(input)),
);

register(
  server,
  "read_file",
  {
    title: "Read a project text file",
    description: "Read a bounded line range from a text file and return its SHA-256 edit precondition.",
    inputSchema: {
      projectId: z.string(),
      path: z.string(),
      startLine: z.number().int().min(1).default(1),
      endLine: z.number().int().min(1).optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  },
  async (input) => result(await service.readFile(input)),
);

register(
  server,
  "search_text",
  {
    title: "Search project text",
    description: "Search for a literal string across bounded text files in an authorized project.",
    inputSchema: {
      projectId: z.string(),
      query: z.string().min(1),
      pathPrefix: z.string().default("."),
      caseSensitive: z.boolean().default(false),
      extensions: z.array(z.string()).optional(),
      maxResults: z.number().int().min(1).max(2000).optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  },
  async (input) => result(await service.searchText(input)),
);

register(
  server,
  "apply_patch",
  {
    title: "Apply a guarded unified patch",
    description: "Apply a unified diff to one existing text file after verifying the SHA-256 returned by read_file.",
    inputSchema: {
      projectId: z.string(),
      path: z.string(),
      patch: z.string().min(1),
      expectedSha256: z.string().regex(/^[a-f0-9]{64}$/),
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
  },
  async (input) => result(await service.applyPatch(input), "Patch applied. Review git_diff before continuing."),
);

register(
  server,
  "create_text_file",
  {
    title: "Create a text file",
    description: "Create a new text file without overwriting an existing path.",
    inputSchema: {
      projectId: z.string(),
      path: z.string(),
      content: z.string(),
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
  },
  async (input) => result(await service.createTextFile(input), "File created. Review git_diff before continuing."),
);

register(
  server,
  "delete_text_file",
  {
    title: "Delete a guarded text file",
    description: "Delete one regular text file only after verifying the latest SHA-256 returned by read_file.",
    inputSchema: {
      projectId: z.string(),
      path: z.string(),
      expectedSha256: z.string().regex(/^[a-f0-9]{64}$/),
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: true },
  },
  async (input) => result(await service.deleteTextFile(input), "File deleted. Review git_diff before continuing."),
);

register(
  server,
  "git_status",
  {
    title: "Show Git status",
    description: "Run a fixed, read-only Git status command in an authorized project.",
    inputSchema: { projectId: z.string() },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  },
  async (input) => result(await service.gitStatus(input)),
);

register(
  server,
  "git_diff",
  {
    title: "Show Git diff",
    description: "Run a fixed, read-only Git diff command in an authorized project.",
    inputSchema: { projectId: z.string(), staged: z.boolean().default(false) },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  },
  async (input) => result(await service.gitDiff(input)),
);

register(
  server,
  "git_unstage",
  {
    title: "Unstage selected Git paths",
    description: "Remove explicit paths from the Git index without changing their working-tree contents.",
    inputSchema: {
      projectId: z.string(),
      paths: z.array(z.string().min(1)).min(1).max(100),
      expectedStatusSha256: z.string().regex(/^[a-f0-9]{64}$/),
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
  },
  async (input) => result(await service.gitUnstage(input), "Selected paths were unstaged; working files were not changed."),
);

register(
  server,
  "git_commit",
  {
    title: "Commit selected project changes",
    description:
      "Stage and commit only explicit relative paths after status review, concurrency validation, whitespace checks, and sensitive-content scanning.",
    inputSchema: {
      projectId: z.string(),
      paths: z.array(z.string().min(1)).min(1).max(100),
      message: z.string().min(1).max(4096),
      expectedStatusSha256: z.string().regex(/^[a-f0-9]{64}$/),
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
  },
  async (input) => result(await service.gitCommit(input), "Commit created locally. Nothing was pushed."),
);

register(
  server,
  "git_push",
  {
    title: "Push the current commit",
    description:
      "Push the reviewed current commit without force to an allowlisted remote and branch. This must be enabled locally per project.",
    inputSchema: {
      projectId: z.string(),
      remote: z.string().regex(/^[A-Za-z0-9._-]+$/).default("origin"),
      expectedCommitSha: z.string().regex(/^[a-f0-9]{40}$/),
    },
    annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
  },
  async (input) => result(await service.gitPush(input), "Current commit pushed to the configured remote."),
);

register(
  server,
  "run_task",
  {
    title: "Run an allowlisted project task",
    description: "Run one task whose executable and arguments were explicitly configured by the user.",
    inputSchema: { projectId: z.string(), taskName: z.string() },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
  },
  async (input) => result(await service.runTask(input)),
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`secure-local-workspace-mcp ready; config=${config.configPath}; projects=${config.projects.length}`);
