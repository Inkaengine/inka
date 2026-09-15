#!/usr/bin/env node
/**
 * Correct mis-modelled multi-node slate in the SOURCE content JSON.
 *
 * A slate block's value must be a single top-level node (the editor makes one
 * block per paragraph). Two shapes in the site tree break that, and each has a
 * different right answer:
 *
 *  - a gridBlock cell that packed a title paragraph + body paragraph into ONE
 *    slate. A gridBlock is one-block-per-cell, so it can't hold the two as
 *    separate blocks -- the correct container for a multi-block cell is `columns`
 *    (each `column` has its own `items` blocks_layout). So the whole gridBlock
 *    becomes a `columns` block, each cell a `column` of the split single-node
 *    slates. Renders identically (grid 1fr == flex:1; stacked slates == the old
 *    multi-node value).
 *  - a TOP-LEVEL multi-node slate (a page/section region allows many blocks), so
 *    it just splits into single-node slates in place.
 *
 * This is a source-data fix, not a mapping concern: the JSON was wrong.
 *
 *   node proposals/blockmd/migrate-columns.mjs [--write] [tree ...]
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const isMultiSlate = (b) =>
  b && b['@type'] === 'slate' && Array.isArray(b.value) && b.value.length > 1;

/** A slate node's plaintext (concatenated leaf text), recomputed per split node. */
function nodeText(node) {
  if (typeof node.text === 'string') return node.text;
  return (node.children || []).map(nodeText).join('');
}

/** Split a multi-node slate into [uid, single-node-slate] pairs, one per node. */
function splitSlate(slate, base) {
  return slate.value.map((node, i) => [
    `${base}-${i + 1}`,
    { '@type': 'slate', value: [node], plaintext: nodeText(node) },
  ]);
}

/** A gridBlock with any multi-node slate cell -> a columns block: each cell a
 *  column whose items are that cell's split single-node slates (a non-multi cell
 *  becomes a single-item column, migrated in case it nests). */
function toColumns(grid) {
  const blocks = {};
  const columns = [];
  for (const cellUid of grid.blocks_layout?.items || []) {
    const cell = grid.blocks[cellUid];
    const colUid = `col-${cellUid}`;
    let items;
    let cblocks;
    if (isMultiSlate(cell)) {
      const parts = splitSlate(cell, cellUid);
      cblocks = Object.fromEntries(parts);
      items = parts.map(([u]) => u);
    } else {
      cblocks = { [cellUid]: migrateBlock(cell) };
      items = [cellUid];
    }
    blocks[colUid] = { '@type': 'column', blocks: cblocks, blocks_layout: { items } };
    columns.push(colUid);
  }
  return { '@type': 'columns', blocks, blocks_layout: { columns } };
}

const gridHasMultiSlate = (grid) =>
  (grid.blocks_layout?.items || []).some((u) => isMultiSlate(grid.blocks?.[u]));

/** Migrate one block, descending into nested containers. */
function migrateBlock(block) {
  if (!block || typeof block !== 'object') return block;
  if (block['@type'] === 'gridBlock' && gridHasMultiSlate(block)) return toColumns(block);
  if (block.blocks && block.blocks_layout) return migrateContainer(block);
  return block;
}

/** Rebuild a container's region with SURGICAL edits: a grid with multi-node
 *  cells becomes columns in place (same uid), a multi-node slate splits into
 *  single-node slates where it sat, everything else keeps its object and its
 *  original key order -- so a diff shows only the blocks that actually changed. */
function migrateContainer(container) {
  const splits = {}; // uid -> [[newUid, slate], ...]  (a multi-node slate split in place)
  const replaced = {}; // uid -> new block (grid->columns, or a migrated nested container)
  for (const [uid, b] of Object.entries(container.blocks)) {
    if (b && b['@type'] === 'gridBlock' && gridHasMultiSlate(b)) replaced[uid] = toColumns(b);
    else if (isMultiSlate(b)) splits[uid] = splitSlate(b, uid);
    else { const m = migrateBlock(b); if (m !== b) replaced[uid] = m; }
  }
  // Nothing in this container changed -> return it untouched (same reference), so
  // a container that merely carries blocks_layout (a `search` block) is never
  // rewritten and the file is left byte-for-byte alone.
  if (!Object.keys(splits).length && !Object.keys(replaced).length) return container;
  // blocks: original key order, substituting replacements and expanding splits.
  const blocks = {};
  for (const uid of Object.keys(container.blocks)) {
    if (splits[uid]) for (const [u, sb] of splits[uid]) blocks[u] = sb;
    else blocks[uid] = replaced[uid] ?? container.blocks[uid];
  }
  // layout: original order, expanding a split uid into its parts.
  const items = [];
  for (const uid of container.blocks_layout?.items || []) {
    if (splits[uid]) for (const [u] of splits[uid]) items.push(u);
    else items.push(uid);
  }
  return { ...container, blocks, blocks_layout: { ...container.blocks_layout, items } };
}

export function migrateContent(content) {
  if (!content.blocks || !content.blocks_layout?.items) return content;
  return migrateContainer(content);
}

// --------------------------------------------------------------------- CLI ---
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name === 'data.json') out.push(p);
  }
  return out;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const WRITE = process.argv.includes('--write');
  const args = process.argv.slice(2).filter((a) => a !== '--write');
  const INKA = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const trees = args.length ? args.map((p) => resolve(p)) : [resolve(INKA, '../content/content')];
  // Order-insensitive equality: a block dict is unordered, so only a SEMANTIC
  // change (a grid became columns, a slate split) should rewrite a file.
  const stable = (v) => JSON.stringify(v, (k, val) =>
    (val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(Object.keys(val).sort().map((kk) => [kk, val[kk]]))
      : val));
  let changed = 0;
  for (const tree of trees) {
    for (const f of walk(tree)) {
      const parsed = JSON.parse(readFileSync(f, 'utf8'));
      const out = migrateContent(parsed);
      if (stable(out) === stable(parsed)) continue;
      changed += 1;
      console.log(`${WRITE ? 'WRITE' : 'would change'}: ${f.replace(`${tree}/`, '')}`);
      if (WRITE) writeFileSync(f, `${JSON.stringify(out, null, 2)}\n`);
    }
  }
  console.log(`\n${WRITE ? 'WROTE' : 'DRY RUN'} — ${changed} file(s) changed`);
}
