import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
