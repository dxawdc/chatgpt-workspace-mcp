import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createTwoFilesPatch } from "diff";
import { createWorkspaceService } from "../src/workspace.mjs";

const limits = {
  maxReadBytes: 1024 * 1024,
  maxReadLines: 1200,
  maxSearchFileBytes: 1024 * 1024,
  maxSearchFiles: 5000,
  maxSearchResults: 200,
  maxWriteBytes: 1024 * 1024,
  maxCommandOutputBytes: 256 * 1024,
};

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "secure-local-workspace-mcp-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "hello.js"), "export const greeting = 'hello';\n", "utf8");
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "MCP Test"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
  execFileSync(
    "git",
    ["commit", "-m", "initial"],
    { cwd: root, stdio: "ignore" },
  );
  const config = {
    configPath: path.join(root, "config.json"),
    limits,
    projects: [
      {
        id: "fixture",
        label: "Fixture",
        root,
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
  };
  return { root, service: createWorkspaceService(config) };
}

test("lists, reads, and searches authorized files", async (t) => {
  const { service } = await fixture(t);
  const projects = service.listProjects();
  assert.equal(projects.projects[0].id, "fixture");
  const listed = await service.listFiles({ projectId: "fixture", pathPrefix: "." });
  assert(listed.entries.some((entry) => entry.path.endsWith(path.join("src", "hello.js"))));
  const read = await service.readFile({ projectId: "fixture", path: "src/hello.js" });
  assert.match(read.text, /greeting/);
  assert.match(read.sha256, /^[a-f0-9]{64}$/);
  const searched = await service.searchText({ projectId: "fixture", query: "HELLO" });
  assert.equal(searched.matches.length, 1);
});

test("rejects paths outside the project root", async (t) => {
  const { service } = await fixture(t);
  await assert.rejects(
    service.readFile({ projectId: "fixture", path: "../outside.txt" }),
    /escapes the configured project root/,
  );
});

test("applies a hash-guarded unified patch and rejects stale writes", async (t) => {
  const { root, service } = await fixture(t);
  const before = await service.readFile({ projectId: "fixture", path: "src/hello.js" });
  const next = "export const greeting = 'hi';\n";
  const patch = createTwoFilesPatch("src/hello.js", "src/hello.js", before.text, next);
  const applied = await service.applyPatch({
    projectId: "fixture",
    path: "src/hello.js",
    patch,
    expectedSha256: before.sha256,
  });
  assert.notEqual(applied.sha256, before.sha256);
  assert.equal(await readFile(path.join(root, "src", "hello.js"), "utf8"), next);
  await assert.rejects(
    service.applyPatch({
      projectId: "fixture",
      path: "src/hello.js",
      patch,
      expectedSha256: before.sha256,
    }),
    /File changed since it was read/,
  );
});

test("deletes a text file only with its latest hash", async (t) => {
  const { root, service } = await fixture(t);
  const before = await service.readFile({ projectId: "fixture", path: "src/hello.js" });
  await assert.rejects(
    service.deleteTextFile({ projectId: "fixture", path: "src/hello.js", expectedSha256: "0".repeat(64) }),
    /File changed since it was read/,
  );
  const deleted = await service.deleteTextFile({
    projectId: "fixture",
    path: "src/hello.js",
    expectedSha256: before.sha256,
  });
  assert.equal(deleted.deleted, true);
  await assert.rejects(readFile(path.join(root, "src", "hello.js"), "utf8"), /ENOENT/);
});

test("commits only explicit paths after status review", async (t) => {
  const { root, service } = await fixture(t);
  await writeFile(path.join(root, "src", "hello.js"), "export const greeting = 'committed';\n", "utf8");
  await writeFile(path.join(root, "src", "unrelated.js"), "export const unrelated = true;\n", "utf8");
  const status = await service.gitStatus({ projectId: "fixture" });
  const blockingHook = path.join(root, ".git", "hooks", "pre-commit");
  await writeFile(blockingHook, "#!/bin/sh\nexit 1\n", "utf8");
  await chmod(blockingHook, 0o755);
  await assert.rejects(
    service.gitCommit({
      projectId: "fixture",
      paths: ["src"],
      message: "test: reject directory",
      expectedStatusSha256: status.statusSha256,
    }),
    /must name files/,
  );
  const commit = await service.gitCommit({
    projectId: "fixture",
    paths: ["src/hello.js"],
    message: "test: commit explicit file",
    expectedStatusSha256: status.statusSha256,
  });
  assert.match(commit.commitSha, /^[a-f0-9]{40}$/);
  assert.deepEqual(commit.paths, ["src/hello.js"]);
  assert.equal(commit.pushPerformed, false);
  const after = await service.gitStatus({ projectId: "fixture" });
  assert.match(after.stdout, /\?\? src\/unrelated\.js/);
  assert.doesNotMatch(after.stdout, /hello\.js/);
});

test("rejects stale commit state and sensitive files without leaving them staged", async (t) => {
  const { root, service } = await fixture(t);
  const clean = await service.gitStatus({ projectId: "fixture" });
  await writeFile(path.join(root, "src", "hello.js"), "export const greeting = 'changed';\n", "utf8");
  await assert.rejects(
    service.gitCommit({
      projectId: "fixture",
      paths: ["src/hello.js"],
      message: "test: stale",
      expectedStatusSha256: clean.statusSha256,
    }),
    /Git status changed/,
  );

  const fakeKey = `sk-${"a".repeat(32)}`;
  await writeFile(path.join(root, ".env"), `OPENAI_API_KEY=${fakeKey}\n`, "utf8");
  const status = await service.gitStatus({ projectId: "fixture" });
  await assert.rejects(
    service.gitCommit({
      projectId: "fixture",
      paths: [".env"],
      message: "test: should fail",
      expectedStatusSha256: status.statusSha256,
    }),
    /environment file/,
  );
  const after = await service.gitStatus({ projectId: "fixture" });
  assert.deepEqual(after.stagedPaths, []);
});

test("refuses pre-staged changes and can unstage without changing the working file", async (t) => {
  const { root, service } = await fixture(t);
  const changed = "export const greeting = 'staged';\n";
  await writeFile(path.join(root, "src", "hello.js"), changed, "utf8");
  execFileSync("git", ["add", "--", "src/hello.js"], { cwd: root, stdio: "ignore" });
  const status = await service.gitStatus({ projectId: "fixture" });
  await assert.rejects(
    service.gitCommit({
      projectId: "fixture",
      paths: ["src/hello.js"],
      message: "test: refuse mixed index",
      expectedStatusSha256: status.statusSha256,
    }),
    /pre-existing staged changes/,
  );
  const unstaged = await service.gitUnstage({
    projectId: "fixture",
    paths: ["src/hello.js"],
    expectedStatusSha256: status.statusSha256,
  });
  assert.deepEqual(unstaged.stagedPaths, []);
  assert.equal(await readFile(path.join(root, "src", "hello.js"), "utf8"), changed);
  assert.match(unstaged.stdout, /src\/hello\.js/);
});

test("creates new files without overwriting and runs only allowlisted tasks", async (t) => {
  const { service } = await fixture(t);
  await service.createTextFile({ projectId: "fixture", path: "src/new.js", content: "export {};\n" });
  await assert.rejects(
    service.createTextFile({ projectId: "fixture", path: "src/new.js", content: "overwrite\n" }),
    /EEXIST/,
  );
  const run = await service.runTask({ projectId: "fixture", taskName: "probe" });
  assert.equal(run.exitCode, 0);
  assert.equal(run.stdout, "task-ok");
  await assert.rejects(
    service.runTask({ projectId: "fixture", taskName: "arbitrary" }),
    /not allowlisted/,
  );
});
