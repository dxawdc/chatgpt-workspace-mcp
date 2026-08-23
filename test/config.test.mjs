import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadConfig, saveConfig } from "../src/config.mjs";

test("fills nested limit defaults when the limits block is omitted", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-project-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configPath = path.join(root, "config.json");
  await writeFile(configPath, JSON.stringify({ projects: [] }), "utf8");
  const config = await loadConfig(configPath);
  assert.equal(config.limits.maxReadLines, 1200);
  assert.equal(config.limits.maxWriteBytes, 1024 * 1024);
  assert.deepEqual(config.discoveryRoots, []);
});

test("fills safe Git defaults and persists configuration updates", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-project-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const projectRoot = path.join(root, "project");
  await mkdir(projectRoot);
  const configPath = path.join(root, "config.json");
  await writeFile(
    configPath,
    JSON.stringify({ projects: [{ id: "project", root: projectRoot, writable: true }] }),
    "utf8",
  );
  const config = await loadConfig(configPath);
  assert.equal(config.projects[0].git.allowCommit, false);
  assert.equal(config.projects[0].git.allowPush, false);
  config.discoveryRoots.push(root);
  config.projects[0].git.allowCommit = true;
  await saveConfig(config);
  const reloaded = await loadConfig(configPath);
  assert.equal(reloaded.projects[0].git.allowCommit, true);
  assert.deepEqual(reloaded.discoveryRoots, [path.resolve(root)]);
});
