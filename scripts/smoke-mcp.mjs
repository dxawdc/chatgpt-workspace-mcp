import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createTwoFilesPatch } from "diff";

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "secure-local-workspace-mcp-"));
const projectRoot = path.join(tempRoot, "project");
const configPath = path.join(tempRoot, "config.json");
await mkdir(path.join(projectRoot, "src"), { recursive: true });
await writeFile(path.join(projectRoot, "src", "hello.js"), "export const greeting = 'hello';\n", "utf8");
execFileSync("git", ["init"], { cwd: projectRoot, stdio: "ignore" });
execFileSync("git", ["add", "."], { cwd: projectRoot, stdio: "ignore" });
execFileSync(
  "git",
  ["-c", "user.name=MCP Smoke", "-c", "user.email=smoke@example.invalid", "commit", "-m", "initial"],
  { cwd: projectRoot, stdio: "ignore" },
);
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
  const client = new Client({ name: "secure-local-workspace-mcp-smoke", version: "0.1.0" });
  await client.connect(transport);
  try {
    const listed = await client.listTools();
    const names = new Set(listed.tools.map((tool) => tool.name));
    for (const required of [
      "diagnostics",
      "list_projects",
      "list_files",
      "read_file",
      "search_text",
      "apply_patch",
      "create_text_file",
      "git_status",
      "git_diff",
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
    console.log(`MCP integration smoke test passed (${listed.tools.length} tools, guarded edit, task, Git diff).`);
  } finally {
    await client.close();
  }
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
