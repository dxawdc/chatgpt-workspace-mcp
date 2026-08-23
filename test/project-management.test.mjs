import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ConfigSchema } from "../src/config.mjs";
import { createWorkspaceService } from "../src/workspace.mjs";

test("discovers and connects Git and non-Git projects beneath approved roots", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "secure-workspace-discovery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const approved = path.join(root, "approved");
  const gitProjectRoot = path.join(approved, "git-project");
  const nonGitProjectRoot = path.join(approved, "non-git-project");
  const plainFolderRoot = path.join(approved, "plain-folder");
  const outsideRoot = path.join(root, "outside-project");
  await mkdir(gitProjectRoot, { recursive: true });
  await mkdir(nonGitProjectRoot, { recursive: true });
  await mkdir(plainFolderRoot, { recursive: true });
  await mkdir(outsideRoot, { recursive: true });
  for (const candidate of [gitProjectRoot, outsideRoot]) {
    await writeFile(path.join(candidate, "README.md"), "# Test\n", "utf8");
    execFileSync("git", ["init"], { cwd: candidate, stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "MCP Test"], { cwd: candidate, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: candidate, stdio: "ignore" });
  }
  await writeFile(
    path.join(nonGitProjectRoot, "package.json"),
    JSON.stringify({ name: "non-git-project", scripts: { test: "node --test" } }),
    "utf8",
  );
  await writeFile(path.join(plainFolderRoot, "notes.txt"), "Plain project\n", "utf8");

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
  assert.equal(discovered.projects.length, 2);
  const discoveredGit = discovered.projects.find((project) => project.path === gitProjectRoot);
  const discoveredNonGit = discovered.projects.find((project) => project.path === nonGitProjectRoot);
  assert.equal(discoveredGit.projectType, "git");
  assert.equal(discoveredNonGit.projectType, "non-git");
  assert.deepEqual(discoveredNonGit.markers, ["package.json"]);
  assert.equal(discovered.projects.some((project) => project.path === plainFolderRoot), false);
  const gitOnly = await service.discoverProjects({ includeNonGit: false, maxDepth: 3 });
  assert.deepEqual(gitOnly.projects.map((project) => project.path), [gitProjectRoot]);

  const connectedGit = await service.connectProject({ projectPath: gitProjectRoot });
  assert.equal(connectedGit.connected, true);
  assert.equal(connectedGit.project.projectType, "git");
  assert.equal(connectedGit.project.writable, true);
  assert.equal(connectedGit.project.git.allowCommit, true);
  assert.equal(connectedGit.project.git.allowPush, false);

  const connectedNonGit = await service.connectProject({ projectPath: nonGitProjectRoot });
  assert.equal(connectedNonGit.connected, true);
  assert.equal(connectedNonGit.gitPermissionsDisabled, true);
  assert.equal(connectedNonGit.project.projectType, "non-git");
  assert.equal(connectedNonGit.project.writable, true);
  assert.equal(connectedNonGit.project.git.allowCommit, false);
  assert.equal(connectedNonGit.project.git.allowPush, false);
  assert.deepEqual(Object.keys(connectedNonGit.project.tasks), ["test"]);

  const connectedPlain = await service.connectProject({ projectPath: plainFolderRoot });
  assert.equal(connectedPlain.project.projectType, "non-git");
  assert.equal(connectedPlain.project.git.allowCommit, false);
  assert.equal(service.listProjects().projects.length, 3);
  assert.equal(persisted, 3);

  await assert.rejects(service.gitStatus({ projectId: connectedNonGit.project.id }), /not a Git repository/);

  await assert.rejects(service.connectProject({ projectPath: outsideRoot }), /outside the locally approved discovery roots/);
  const disconnected = await service.disconnectProject({ projectId: connectedNonGit.project.id });
  assert.equal(disconnected.filesDeleted, false);
  assert.equal(persisted, 4);
});
