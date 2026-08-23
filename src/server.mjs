import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig } from "./config.mjs";
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
const service = createWorkspaceService(config);
const server = new McpServer(
  { name: "local-project-workspace", version: "0.1.0" },
  {
    instructions:
      "Work only with configured project IDs. Read a file immediately before editing and pass its sha256 to apply_patch. After edits, inspect git_diff and run only configured tasks. Preserve unrelated changes. This server has no arbitrary shell, delete, commit, push, or deploy tools.",
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
console.error(`local-project-workspace ready; config=${config.configPath}; projects=${config.projects.length}`);
