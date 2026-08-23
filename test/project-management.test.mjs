import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ConfigSchema } from "../src/config.mjs";
import { createWorkspaceService } from "../src/workspace.mjs";

test("discovers and connects Git projects only beneath approved roots", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "secure-workspace-discovery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const approved = path.join(root, "approved");
  const projectRoot = path.join(approved, "sample-project");
  const outsideRoot = path.join(root, "outside-project");
  await mkdir(projectRoot, { recursive: true });
  await mkdir(outsideRoot, { recursive: true });
  for (const candidate of [projectRoot, outsideRoot]) {
    await writeFile(path.join(candidate, "README.md"), "# Test\n", "utf8");
    execFileSync("git", ["init"], { cwd: candidate, stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "MCP Test"], { cwd: candidate, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: candidate, stdio: "ignore" });
  }

  const config = {
    ...ConfigSchema.parse({ projects: [], discoveryRoots: [approved] }),
    configPath: path.join(root, "config.json"),
  };
  let persisted = 0;
  const service = createWorkspaceService(config, {
    persistConfig: async () => {
      persisted += 1;
    },
  });
  const discovered = await service.discoverProjects({ maxDepth: 3 });
  assert.equal(discovered.projects.length, 1);
  assert.equal(discovered.projects[0].path, projectRoot);

  const connected = await service.connectProject({ projectPath: projectRoot });
  assert.equal(connected.connected, true);
  assert.equal(connected.project.writable, true);
  assert.equal(connected.project.git.allowCommit, true);
  assert.equal(connected.project.git.allowPush, false);
  assert.equal(persisted, 1);
  assert.equal(service.listProjects().projects.length, 1);

  await assert.rejects(service.connectProject({ projectPath: outsideRoot }), /outside the locally approved discovery roots/);
  const disconnected = await service.disconnectProject({ projectId: connected.project.id });
  assert.equal(disconnected.filesDeleted, false);
  assert.equal(persisted, 2);
});
