import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createTwoFilesPatch } from "diff";

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "chatgpt-workspace-mcp-"));
const projectRoot = path.join(tempRoot, "project");
const configPath = path.join(tempRoot, "config.json");
await mkdir(path.join(projectRoot, "src"), { recursive: true });
await writeFile(path.join(projectRoot, "src", "hello.js"), "export const greeting = 'hello';\n", "utf8");
execFileSync("git", ["init"], { cwd: projectRoot, stdio: "ignore" });
execFileSync("git", ["config", "user.name", "MCP Smoke"], { cwd: projectRoot, stdio: "ignore" });
execFileSync("git", ["config", "user.email", "smoke@example.invalid"], { cwd: projectRoot, stdio: "ignore" });
execFileSync("git", ["add", "."], { cwd: projectRoot, stdio: "ignore" });
execFileSync("git", ["commit", "-m", "initial"], { cwd: projectRoot, stdio: "ignore" });
await writeFile(
  configPath,
  JSON.stringify(
    {
      projects: [
        {
          id: "smoke",
          label: "MCP smoke project",
          root: projectRoot,
          writable: true,
          ignoreNames: ["node_modules", ".git"],
          tasks: {
            probe: {
              command: process.execPath,
              args: ["-e", "process.stdout.write('task-ok')"],
              timeoutSeconds: 10,
            },
          },
          git: {
            allowCommit: true,
            allowPush: false,
            allowedRemotes: ["origin"],
            allowedBranches: [],
          },
        },
      ],
    },
    null,
    2,
  ),
  "utf8",
);

try {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [new URL("../src/server.mjs", import.meta.url).pathname.replace(/^\/(.:)/, "$1")],
    env: { ...process.env, LOCAL_PROJECT_WORKSPACE_CONFIG: configPath },
    stderr: "pipe",
  });
  const client = new Client({ name: "chatgpt-workspace-mcp-smoke", version: "0.1.0" });
  await client.connect(transport);
  try {
    const listed = await client.listTools();
    const names = new Set(listed.tools.map((tool) => tool.name));
    for (const required of [
      "diagnostics",
      "list_projects",
      "discover_projects",
      "connect_project",
      "disconnect_project",
      "list_files",
      "read_file",
      "search_text",
      "apply_patch",
      "create_text_file",
      "delete_text_file",
      "git_status",
      "git_diff",
      "git_unstage",
      "git_commit",
      "git_push",
      "run_task",
    ]) {
      assert(names.has(required), `Missing MCP tool: ${required}`);
    }

    const projects = await client.callTool({ name: "list_projects", arguments: {} });
    assert.equal(projects.structuredContent.projects[0].id, "smoke");
    const read = await client.callTool({
      name: "read_file",
      arguments: { projectId: "smoke", path: "src/hello.js" },
    });
    const next = "export const greeting = 'hi';\n";
    const patch = createTwoFilesPatch("src/hello.js", "src/hello.js", read.structuredContent.text, next);
    const applied = await client.callTool({
      name: "apply_patch",
      arguments: {
        projectId: "smoke",
        path: "src/hello.js",
        patch,
        expectedSha256: read.structuredContent.sha256,
      },
    });
    assert.equal(applied.isError, undefined);
    assert.equal(await readFile(path.join(projectRoot, "src", "hello.js"), "utf8"), next);

    const task = await client.callTool({
      name: "run_task",
      arguments: { projectId: "smoke", taskName: "probe" },
    });
    assert.equal(task.structuredContent.exitCode, 0);
    assert.equal(task.structuredContent.stdout, "task-ok");

    const diff = await client.callTool({ name: "git_diff", arguments: { projectId: "smoke" } });
    assert.match(diff.structuredContent.stdout, /greeting = 'hi'/);
    const status = await client.callTool({ name: "git_status", arguments: { projectId: "smoke" } });
    const commit = await client.callTool({
      name: "git_commit",
      arguments: {
        projectId: "smoke",
        paths: ["src/hello.js"],
        message: "test: guarded MCP commit",
        expectedStatusSha256: status.structuredContent.statusSha256,
      },
    });
    assert.match(commit.structuredContent.commitSha, /^[a-f0-9]{40}$/);
    assert.equal(commit.structuredContent.pushPerformed, false);
    console.log(
      `MCP integration smoke test passed (${listed.tools.length} tools, guarded edit, task, diff, and commit).`,
    );
  } finally {
    await client.close();
  }
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
