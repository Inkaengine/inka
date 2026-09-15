#!/usr/bin/env node
/**
 * Serve the same content from markdown and from JSON, and diff every path.
 *
 *   node proposals/blockmd/check-parity.mjs
 *
 * This is the check that counts. The item-level check (import-tree --diff)
 * compares a fixed list of keys and passed 111/111 while a Link's `remoteUrl`
 * -- its entire target -- and every Event's start, end and location were being
 * dropped. Comparing what the API actually serves has no fixed list to be
 * wrong about.
 *
 * Two differences are allowed, and only these:
 *
 *   plaintext   blockmd recomputes it from `value`. The stored copy is stale
 *               -- it still says "test Plone 6" where the value says "test
 *               Inka Edit" -- so recomputing is a fix, not a difference.
 *   empty text  leaves. Stored slate is inconsistently normalised: some blocks
 *               carry {"text":""} either side of an inline element and some do
 *               not. Semantically identical, and no parser can guess which
 *               convention a given block used.
 *
 * Anything else fails.
 */
import { spawn } from 'child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const INKA = resolve(HERE, '../..');
const SERVER = join(INKA, 'tests-playwright/fixtures/mock-api-server.cjs');

const PAIRS = [
  { name: 'docs', json: 'docs/content/content/content', md: 'docs/content-md' },
  { name: 'site', json: '../content/content', md: '../content-md' },
];

// Server-derived or known-inconsistent in the stored JSON; compared elsewhere.
const IGNORE = new Set([
  'created', 'modified', 'is_folderish', 'parent', 'items', 'items_total',
  '@components', 'workflow_history', 'lock', 'version', 'type_title',
  'changeActor', 'versioning_enabled', 'working_copy', 'working_copy_of',
  'next_item', 'previous_item', 'getObjPositionInParent',
  'exportimport.constrains', 'exportimport.conversation', 'exportimport.versions',
]);

function walk(dir, hits = []) {
  if (!existsSync(dir)) return hits;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, hits);
    else if (name === 'data.json') hits.push(p);
  }
  return hits;
}

// Every spawned server is tracked, so a failure to start one still kills the
// other. Leaking a listener makes the next run fail with EADDRINUSE, which
// looks like a content problem and is not.
const running = [];
process.on('exit', () => running.forEach((p) => p.kill()));

function start(mount, port) {
  const proc = spawn('node', [SERVER], {
    cwd: INKA,
    env: { ...process.env, CONTENT_MOUNTS: `/:${mount}`, PORT: String(port),
           SKIP_CONTENT_VALIDATION: 'true' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  running.push(proc);
  return new Promise((ok, fail) => {
    let out = '';
    const timer = setTimeout(() => fail(new Error(`server on ${port} did not start:\n${tail(out)}`)), 30000);
    proc.stdout.on('data', (d) => {
      out += d;
      if (out.includes('running on')) { clearTimeout(timer); ok(proc); }
    });
    proc.stderr.on('data', (d) => { out += d; });
    proc.on('exit', (c) => { clearTimeout(timer); fail(new Error(`server on ${port} exited (${c}):\n${tail(out)}`)); });
  });
}

/** The interesting part of a server log is the end, not the scan chatter. */
const tail = (s) => s.split('\n').filter((l) => !/^(Scanning|Registered content)/.test(l)).slice(-12).join('\n');

const fetchJson = async (port, path) => {
  const r = await fetch(`http://localhost:${port}${path}`, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  return r.json();
};

/** Comparison view: drop the derived plaintext and empty text leaves. */
function semantic(v) {
  if (Array.isArray(v)) return v.map(semantic).filter((x) => x !== undefined);
  if (v && typeof v === 'object') {
    const keys = Object.keys(v);
    if (keys.length === 1 && keys[0] === 'text' && v.text === '') return undefined;
    const out = {};
    for (const k of keys.sort()) {
      if (k === 'plaintext') continue;
      const r = semantic(v[k]);
      if (r !== undefined) out[k] = r;
    }
    return out;
  }
  return v;
}

let failures = 0;
for (const [i, pair] of PAIRS.entries()) {
  const jsonDir = resolve(INKA, pair.json);
  const mdDir = resolve(INKA, pair.md);
  if (!existsSync(mdDir)) { console.log(`${pair.name}: no markdown tree — run export-tree.mjs`); failures++; continue; }

  const paths = new Set();
  for (const f of walk(jsonDir)) {
    const d = JSON.parse(readFileSync(f, 'utf8'));
    if (d['@id']) paths.add(d['@type'] === 'Plone Site' ? '/' : d['@id']);
  }

  const [a, b] = [8990 + i * 2, 8991 + i * 2];
  const procs = await Promise.all([start(pair.json, a), start(pair.md, b)]);
  const bad = [];
  let same = 0;
  try {
    for (const p of [...paths].sort()) {
      const [x, y] = await Promise.all([fetchJson(a, p), fetchJson(b, p)]);
      // The host differs by port; that is the harness, not the content.
      const strip = (o, port) => JSON.parse(JSON.stringify(o).replaceAll(`http://localhost:${port}`, 'HOST'));
      const [sx, sy] = [strip(x, a), strip(y, b)];
      const diff = [...new Set([...Object.keys(sx), ...Object.keys(sy)])]
        .filter((k) => !IGNORE.has(k))
        .filter((k) => JSON.stringify(semantic(sx[k])) !== JSON.stringify(semantic(sy[k])));
      if (diff.length) bad.push(`${p}: ${diff.join(', ')}`);
      else same++;
    }
  } finally {
    for (const proc of procs) proc.kill();
  }
  console.log(`${pair.name}: ${same}/${paths.size} paths serve identically`);
  for (const x of bad.slice(0, 10)) console.log(`    ${x}`);
  if (bad.length > 10) console.log(`    …and ${bad.length - 10} more`);
  failures += bad.length;
}
process.exit(failures ? 1 : 0);
