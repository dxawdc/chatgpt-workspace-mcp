import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config.mjs";

test("fills nested limit defaults when the limits block is omitted", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-project-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configPath = path.join(root, "config.json");
  await writeFile(configPath, JSON.stringify({ projects: [] }), "utf8");
  const config = await loadConfig(configPath);
  assert.equal(config.limits.maxReadLines, 1200);
  assert.equal(config.limits.maxWriteBytes, 1024 * 1024);
});
