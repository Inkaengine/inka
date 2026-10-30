/**
 * No test server's port is written down anywhere but its HYDRA_*_PORT variable.
 *
 * tests-playwright/ports.ts has no defaults on purpose: a checkout that fell
 * back to hydra's numbers could take over another checkout's servers without
 * saying so. That only holds if nothing ELSE names the numbers. Things that
 * did: a test frontend's `dev:test` script (astro listened on 3009 while the
 * harness waited on its configured port), an example's hardcoded API origin
 * (fetching from whatever answered on 8888), and CI's own start lines — which
 * had svelte and vue on each other's ports, so each project tested the other
 * frontend. `hydra-ports-check`-style checks only see the variables, never a
 * literal, so this reads the files.
 *
 * The numbers come from CI's env block (the one place they are stated). A hit
 * outside it fails, naming the file, line and the variable to use instead.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const WORKFLOW = path.join(ROOT, '.github/workflows/test.yaml');

/**
 * HYDRA_*_PORT: number, for THIS run's block.
 *
 * Read from the one module that knows the offsets, via the launcher that
 * derives them. It used to parse the workflow's top-level env block, which was
 * where the numbers were stated — nineteen of them, kept aligned with the
 * Makefile's identical list by hand. The workflow states only
 * HYDRA_PORT_BASE now.
 *
 * Note the limit this exposes, and why ports-are-not-hardcoded.test.ts exists
 * beside this: a check that only knows TODAY'S numbers cannot see a literal
 * outside them, which is why the contract suite's 8899/1337/8793 went
 * unnoticed here for as long as they did. This one still earns its place for
 * the files it scans — an example frontend's own start scripts, where a
 * literal and the harness's configured port disagree silently.
 */
function declaredPorts() {
  const printed = execFileSync(
    process.execPath,
    [path.join(ROOT, 'scripts/with-ports.mjs'), '--print'],
    { encoding: 'utf8' },
  );
  const ports = new Map();
  for (const line of printed.split('\n')) {
    const m = /^(HYDRA_[A-Z0-9_]+_PORT)=(\d+)$/.exec(line.trim());
    if (m) ports.set(m[2], m[1]);
  }
  assert.ok(ports.size > 0, 'scripts/with-ports.mjs --print listed no ports');
  return ports;
}

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.next', '.nuxt', '.output', '.astro']);

function walk(dir, keep, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, keep, out);
    else if (keep(full)) out.push(full);
  }
  return out;
}

/** Every file that starts, configures or points at a test server. */
function filesToScan() {
  const frontendDirs = ['docs/examples', 'examples', 'docs/quickstart'].map((d) => path.join(ROOT, d));
  const frontendFile = (f) =>
    /(^|\/)package\.json$/.test(f) ||
    /\.config\.(js|mjs|cjs|ts)$/.test(f) ||
    /\/src\/.*\.(js|mjs|jsx|ts|tsx|vue|svelte|astro)$/.test(f) ||
    /\.astro$/.test(f);
  return [
    WORKFLOW,
    path.join(ROOT, 'playwright.config.ts'),
    ...frontendDirs.flatMap((d) => walk(d, frontendFile)),
  ];
}

/** A port literal where a server is started or addressed. */
const PORT_USE = /(?:localhost:|127\.0\.0\.1:|--port[ =]|\s-p |PORT=|port:\s*)(\d{4,5})\b/g;

function isComment(line) {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('#') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('<!--');
}

/**
 * A package.json line that is NOT a test script. An example's own `dev`/`start`
 * scripts run it for a developer against a real admin — not a test server — so
 * only its `*test*` scripts are held to the rule.
 */
function isNonTestScript(file, line) {
  if (!file.endsWith('package.json')) return false;
  const m = line.match(/^\s*"([^"]+)":/);
  return !m || !/test/.test(m[1]);
}

test('no test server port is hardcoded outside its HYDRA_*_PORT variable', () => {
  const ports = declaredPorts();
  const hits = [];
  for (const file of filesToScan()) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (isComment(line) || isNonTestScript(file, line)) return;
      // The env block itself is where the numbers are stated.
      if (file === WORKFLOW && /^ {2}HYDRA_[A-Z0-9_]+_PORT: \d+$/.test(line)) return;
      for (const m of line.matchAll(PORT_USE)) {
        const name = ports.get(m[1]);
        if (name) hits.push(`${path.relative(ROOT, file)}:${i + 1}: ${m[1]} — use ${name}`);
      }
    });
  }
  assert.deepStrictEqual(hits, [], `hardcoded test ports:\n  ${hits.join('\n  ')}`);
});
