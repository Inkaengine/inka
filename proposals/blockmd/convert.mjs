#!/usr/bin/env node
/**
 * Convert every doc page to markdown, then parse it back and compare.
 *
 *   node convert.mjs            # write .md files + report round-trip
 *   node convert.mjs --check    # report only, write nothing
 *
 * Output goes to ./out/ mirroring the content tree, so the markdown can be
 * read as a human would read it — the point is that it looks like a document,
 * not like serialised JSON.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { join, dirname, relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import { readdirSync, statSync } from 'fs';
import { pageToMd, mdToPage, SERVER_STATE } from '../../lib/blockmd.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const INKA = resolve(HERE, '../..');
const SITE = resolve(INKA, '../content/content');
const DOCS = resolve(INKA, 'docs/content/content/content');
const OUT = join(HERE, 'out');
const CHECK = process.argv.includes('--check');

const schema = existsSync(join(HERE, 'schemas.json'))
  ? JSON.parse(readFileSync(join(HERE, 'schemas.json'), 'utf8')) : {};
// Which fields have a native markdown spelling. Belongs alongside `widget` in
// the block schema; kept separate while the shape is being settled.
schema._markdown = existsSync(join(HERE, 'markdown-roles.json'))
  ? JSON.parse(readFileSync(join(HERE, 'markdown-roles.json'), 'utf8')) : {};

function walk(dir, hits = []) {
  if (!existsSync(dir)) return hits;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, hits);
    else if (name === 'data.json') hits.push(p);
  }
  return hits;
}

/** Semantic view: drop empty text leaves and the derived plaintext. */
function sem(v) {
  if (Array.isArray(v)) return v.map(sem).filter((x) => x !== undefined);
  if (v && typeof v === 'object') {
    const keys = Object.keys(v);
    if (keys.length === 1 && keys[0] === 'text' && v.text === '') return undefined;
    const out = {};
    for (const k of keys.sort()) {
      if (k === 'plaintext') continue;
      const r = sem(v[k]);
      if (r !== undefined) out[k] = r;
    }
    return out;
  }
  return v;
}

function flatten(blocks, out = {}, pre = '') {
  for (const [uid, b] of Object.entries(blocks || {})) {
    if (!b || typeof b !== 'object') continue;
    const { blocks: kids, blocks_layout, ...rest } = b;
    out[pre + uid] = rest;
    if (kids) flatten(kids, out, `${pre + uid}/`);
  }
  return out;
}

const eq = (a, b) => JSON.stringify(sem(a)) === JSON.stringify(sem(b));

let pages = 0, metaOk = 0, orderOk = 0, blocks = 0, blocksOk = 0;
const failures = [];
const byType = new Map();

if (!CHECK && existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });

for (const root of [SITE, DOCS]) {
  for (const file of walk(root)) {
    let page;
    try { page = JSON.parse(readFileSync(file, 'utf8')); } catch { continue; }
    if (!page.blocks || !Object.keys(page.blocks).length) continue;
    pages++;

    const md = pageToMd(page, schema);

    // Write, then read the file back off disk and parse THAT. Comparing the
    // in-memory string against itself only proves the functions compose; it
    // says nothing about what actually landed in the file.
    const rel = relative(root, dirname(file));
    const dest = join(OUT, root === SITE ? 'site' : 'docs', `${rel || 'root'}.md`);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, md);
    const onDisk = readFileSync(dest, 'utf8');
    if (onDisk !== md) {
      console.error(`  !! file on disk differs from generated markdown: ${dest}`);
    }
    const back = mdToPage(onDisk);
    if (CHECK) rmSync(dest, { force: true });

    if (Object.keys(page).every((k) => SERVER_STATE.has(k) || eq(page[k], back[k]))) metaOk++;
    if (JSON.stringify(page.blocks_layout?.items || []) === JSON.stringify(back.blocks_layout.items)) orderOk++;

    const A = flatten(page.blocks), B = flatten(back.blocks);
    for (const uid of new Set([...Object.keys(A), ...Object.keys(B)])) {
      blocks++;
      if (eq(A[uid], B[uid])) blocksOk++;
      else {
        const t = (A[uid] || B[uid] || {})['@type'] ?? '?';
        byType.set(t, (byType.get(t) || 0) + 1);
        if (failures.length < 5) failures.push({ file: relative(INKA, file), uid, type: t, a: A[uid], b: B[uid] });
      }
    }
  }
}

const pct = (n, d) => `${n}/${d} (${Math.round((100 * n) / d)}%)`;
console.log(`pages            : ${pages}`);
console.log(`page metadata    : ${pct(metaOk, pages)}`);
console.log(`block order      : ${pct(orderOk, pages)}`);
console.log(`blocks semantic  : ${pct(blocksOk, blocks)}`);
if (byType.size) {
  console.log('\nblocks differing, by type:');
  for (const [t, n] of [...byType].sort((x, y) => y[1] - x[1]).slice(0, 10)) {
    console.log(`  ${String(n).padStart(5)}  ${t}`);
  }
  console.log('\nfirst failures:');
  for (const f of failures) {
    console.log(`  ${f.file} :: ${f.uid} (${f.type})`);
    console.log(`     was: ${String(JSON.stringify(sem(f.a))).slice(0, 120)}`);
    console.log(`     got: ${String(JSON.stringify(sem(f.b))).slice(0, 120)}`);
  }
}
console.log(`\nmarkdown ${CHECK ? 'checked' : 'written'} in ${relative(process.cwd(), OUT)}/`);
process.exit(blocksOk === blocks && metaOk === pages && orderOk === pages ? 0 : 1);
