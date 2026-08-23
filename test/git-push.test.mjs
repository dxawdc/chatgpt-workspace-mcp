import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ConfigSchema } from "../src/config.mjs";
import { createWorkspaceService } from "../src/workspace.mjs";

test("pushes only the reviewed HEAD to an allowlisted local remote", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "secure-workspace-push-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const projectRoot = path.join(root, "project");
  const remoteRoot = path.join(root, "remote.git");
  await mkdir(projectRoot);
  await writeFile(path.join(projectRoot, "README.md"), "# Initial\n", "utf8");
  execFileSync("git", ["init"], { cwd: projectRoot, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "MCP Test"], { cwd: projectRoot, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: projectRoot, stdio: "ignore" });
  execFileSync("git", ["add", "."], { cwd: projectRoot, stdio: "ignore" });
  execFileSync(
    "git",
    ["commit", "-m", "initial"],
    { cwd: projectRoot, stdio: "ignore" },
  );
  execFileSync("git", ["init", "--bare", remoteRoot], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["remote", "add", "origin", remoteRoot], { cwd: projectRoot, stdio: "ignore" });

  const parsed = ConfigSchema.parse({
    projects: [
      {
        id: "project",
        root: projectRoot,
        writable: true,
        git: { allowCommit: true, allowPush: true, allowedRemotes: ["origin"], allowedBranches: [] },
      },
    ],
  });
  const service = createWorkspaceService({ ...parsed, configPath: path.join(root, "config.json") });
  await writeFile(path.join(projectRoot, "README.md"), "# Updated\n", "utf8");
  const status = await service.gitStatus({ projectId: "project" });
  const commit = await service.gitCommit({
    projectId: "project",
    paths: ["README.md"],
    message: "docs: update readme",
    expectedStatusSha256: status.statusSha256,
  });
  const pushed = await service.gitPush({
    projectId: "project",
    remote: "origin",
    expectedCommitSha: commit.commitSha,
  });
  assert.equal(pushed.pushed, true);
  const remoteHead = execFileSync("git", ["rev-parse", `refs/heads/${pushed.branch}`], {
    cwd: remoteRoot,
    encoding: "utf8",
  }).trim();
  assert.equal(remoteHead, commit.commitSha);
  await assert.rejects(
    service.gitPush({ projectId: "project", remote: "upstream", expectedCommitSha: commit.commitSha }),
    /Remote is not allowed/,
  );
});
