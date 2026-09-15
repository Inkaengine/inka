/**
 * Apply lib/slate-normalize.mjs across the JSON content source: every slate
 * value that has more than one top-level node (or hard newlines) is collapsed to
 * a single node. Targets slate blocks and slateTable cells — any object carrying
 * a slate-node `value` array while not itself being a slate node.
 *
 *   node proposals/blockmd/normalize-slates.mjs [--write]
 *
 * Without --write it is a dry run: it prints every value it would change.
 */
import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { normalizeSlateValue } from '../../lib/slate-normalize.mjs';

const INKA = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = resolve(INKA, 'docs/content/content/content');
const WRITE = process.argv.includes('--write');

const isSlateNode = (n) => n && typeof n === 'object' && (Array.isArray(n.children) || typeof n.text === 'string');
const carriesSlateValue = (o) =>
  o && typeof o === 'object' && !Array.isArray(o) &&
  Array.isArray(o.value) && o.value.length > 0 && isSlateNode(o.value[0]) &&
  !Array.isArray(o.children) && typeof o.text !== 'string';

/** Walk, normalizing every slate-carrying object's value in place. Returns count. */
function normalizeTree(node, file, path, changes) {
  if (!node || typeof node !== 'object') return;
  if (carriesSlateValue(node)) {
    const before = JSON.stringify(node.value);
    const after = normalizeSlateValue(node.value);
    if (JSON.stringify(after) !== before) {
      changes.push({ file, path, from: node.value.length, to: after.length });
      node.value = after;
    }
  }
  for (const [k, v] of Object.entries(node)) {
    if (v && typeof v === 'object') normalizeTree(v, file, `${path}/${k}`, changes);
  }
}

const files = execSync(`find ${SRC} -name data.json`).toString().trim().split('\n');
const changes = [];
for (const f of files) {
  const doc = JSON.parse(readFileSync(f, 'utf8'));
  const before = changes.length;
  normalizeTree(doc, f.replace(`${SRC}/`, ''), '', changes);
  if (WRITE && changes.length > before) writeFileSync(f, `${JSON.stringify(doc, null, 2)}\n`);
}

const byFile = {};
for (const c of changes) (byFile[c.file] ||= []).push(c);
for (const [f, list] of Object.entries(byFile)) {
  console.log(`\n${f}  (${list.length})`);
  for (const c of list) console.log(`   ${c.from} -> ${c.to} nodes  @ ${c.path}`);
}
console.log(`\n${WRITE ? 'WROTE' : 'DRY RUN'} — ${changes.length} slate values normalized across ${Object.keys(byFile).length} files`);
