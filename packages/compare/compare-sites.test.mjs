/**
 * The site comparison names no site of its own: which sites it compares, and
 * everything that belongs to one comparison, comes from its settings.
 *
 *   node --test packages/compare/compare-sites.test.mjs
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

const runner = path.join(path.dirname(new URL(import.meta.url).pathname), "compare-sites.mjs");

test("the runner refuses to run without settings", () => {
  const run = spawnSync(process.execPath, [runner, "--pages=/"], { encoding: "utf8" });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /--settings=<module> names the comparison to run/);
});
