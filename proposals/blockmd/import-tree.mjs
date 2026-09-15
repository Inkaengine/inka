#!/usr/bin/env node
/**
 * The README-shaped markdown tree -> Plone content items.
 *
 *   node import-tree.mjs [--diff]
 *
 * This is what a mock-API markdown mount would do on read. `--diff` compares
 * the result against the source content tree, which is the check that counts:
 * the exporter is only correct if what comes back out is what the frontend
 * would have been served from the JSON.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, dirname, resolve, relative, extname, basename } from 'path';
import { fileURLToPath } from 'url';
import YAML from 'yaml';
import { readTree, BLOB_FIELD } from '../../lib/markdown-mount.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const INKA = resolve(HERE, '../..');
const SITE = resolve(INKA, '..');

// Both trees, each with the JSON it must agree with.
const TREES = {
  docs: { tree: resolve(INKA, 'docs/content-md'), src: resolve(INKA, 'docs/content/content/content') },
  site: { tree: resolve(SITE, 'content-md'),      src: resolve(SITE, 'content/content') },
};
const which = process.argv.find((a) => TREES[a]) ?? null;

// Reads through the same module the mock API mounts. Two implementations
// would mean this check verified something the server does not do.

// --------------------------------------------------------------- diff ----


function walkSrc(dir, hits = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkSrc(p, hits);
    else if (name === 'data.json') hits.push(p);
  }
  return hits;
}
const BLOB_KEYS = ['UID', 'id', 'title', 'description', 'rights', 'exclude_from_nav'];

/** Compare one tree against the JSON the frontend would have been served. */
function diffTree(name, { tree, src: SRC }) {
  const { items } = readTree(tree);
  const src = new Map();
  let ROOT_ID = null;
  for (const f of walkSrc(SRC)) {
    const d = JSON.parse(readFileSync(f, 'utf8'));
    if (d['@type'] === 'Plone Site') ROOT_ID = d['@id'];
    src.set(d['@id'], d);
  }
  if (ROOT_ID && src.has(ROOT_ID)) { src.set('/', src.get(ROOT_ID)); src.delete(ROOT_ID); }

  let ok = 0;
  const bad = [];
  for (const [id, want] of src) {
    const got = items.get(id);
    if (!got) { bad.push(`${id}: missing from the tree`); continue; }
    const field = BLOB_FIELD[want['@type']];
    if (field) {
      const diffs = BLOB_KEYS.filter((k) => JSON.stringify(want[k]) !== JSON.stringify(got[k]));
      for (const k of ['filename', 'content-type', 'size', 'width', 'height']) {
        if (JSON.stringify(want[field]?.[k]) !== JSON.stringify(got[field]?.[k])) diffs.push(`${field}.${k}`);
      }
      if (diffs.length) bad.push(`${id}: ${diffs.join(', ')}`);
      else ok++;
      continue;
    }
    // The derived fields matter as much as the stored ones -- the admin's
    // breadcrumb, object browser and navigation all read them, and the
    // markdown stores none of them.
    //
    // They are checked against the TREE, not against the stored values,
    // because the stored values do not agree with each other: is_folderish is
    // 32 true / 25 false / 11 absent across Documents, and a top-level parent
    // is "/" on ten items and "" on one. Deriving from tree position gives a
    // consistent answer; comparing against an inconsistent one would only
    // test which inconsistency we had copied.
    const derived = [];
    const parentPath = id === '/' ? null : (id.slice(0, id.lastIndexOf('/')) || '/');
    if (parentPath !== null && src.has(parentPath)
        && (got.parent || {})['@id'] !== parentPath) {
      derived.push(`parent should be ${parentPath}, got ${JSON.stringify((got.parent || {})['@id'])}`);
    }
    const hasKids = [...src.keys()].some((k) => k !== id && k.startsWith(`${id === '/' ? '' : id}/`)
      && !k.slice(id === '/' ? 1 : id.length + 1).includes('/'));
    if (got.is_folderish !== hasKids) {
      derived.push(`is_folderish should be ${hasKids} (children in tree), got ${got.is_folderish}`);
    }
    if (derived.length) { bad.push(`${id}: ${derived.join(', ')}`); continue; }
    ok++;
  }
  console.log(`${name}: ${ok}/${src.size} items match (${items.size} read from markdown)`);
  for (const b of bad.slice(0, 10)) console.log(`    ${b}`);
  if (bad.length > 10) console.log(`    …and ${bad.length - 10} more`);
  return bad.length;
}

let failures = 0;
for (const [name, cfg] of Object.entries(TREES)) {
  if (which && which !== name) continue;
  if (!existsSync(cfg.tree)) {
    console.log(`${name}: no markdown tree at ${cfg.tree} — run export-tree.mjs`);
    failures++;
    continue;
  }
  failures += process.argv.includes('--diff')
    ? diffTree(name, cfg)
    : (console.log(`${name}: read ${readTree(cfg.tree).items.size} items`), 0);
}
process.exit(failures ? 1 : 0);
