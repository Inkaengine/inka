#!/usr/bin/env node
/**
 * Normalise slate quirks in stored content. These are editing debris, not
 * anything a renderer needs, and they are what stops a markdown round-trip
 * being exact:
 *
 *   - `{"type": "a"}` link nodes (2) where the rest of the content uses "link" (110)
 *   - inline element nodes with no text at all — an empty <em>/<strong>, which
 *     renders nothing and serialises to stray asterisks
 *
 * Usage: node normalise-content.mjs [--write]
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname, resolve, relative } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const INKA = resolve(HERE, '../..');
const WRITE = process.argv.includes('--write');
const roots = [resolve(INKA, '../content/content'), resolve(INKA, 'docs/content/content/content')];

function walk(d, h = []) {
  if (!existsSync(d)) return h;
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    statSync(p).isDirectory() ? walk(p, h) : (n === 'data.json' && h.push(p));
  }
  return h;
}

const textOf = (n) => {
  let s = '';
  const w = (x) => {
    if (Array.isArray(x)) x.forEach(w);
    else if (x && typeof x === 'object') { if (typeof x.text === 'string') s += x.text; (x.children || []).forEach(w); }
  };
  w(n); return s;
};

let renamedA = 0, droppedEmpty = 0, trimmedNl = 0;

function clean(node) {
  if (Array.isArray(node)) {
    return node.map(clean).filter((n) => {
      if (!n || typeof n !== 'object' || !n.type || n.type === 'link') return true;
      // keep structural nodes; drop empty inline formatting
      if (!['strong', 'em', 'del', 'code', 'b', 'i'].includes(n.type)) return true;
      if (textOf(n.children)) return true;
      droppedEmpty++; return false;
    });
  }
  if (node && typeof node === 'object') {
    if (node.type === 'a') { node.type = 'link'; renamedA++; }
    // A text leaf ending in a newline: markdown has no way to express a
    // trailing newline at the end of a paragraph, and it renders as nothing.
    if (typeof node.text === 'string' && /\n$/.test(node.text)) {
      node.text = node.text.replace(/\n+$/, ''); trimmedNl++;
    }
    if (node.children) node.children = clean(node.children);
    for (const [k, v] of Object.entries(node)) {
      if (k !== 'children' && v && typeof v === 'object') node[k] = clean(v);
    }
  }
  return node;
}

let files = 0;
for (const root of roots) {
  for (const f of walk(root)) {
    let d; try { d = JSON.parse(readFileSync(f, 'utf8')); } catch { continue; }
    const before = JSON.stringify(d);
    clean(d);
    const after = JSON.stringify(d);
    if (before !== after) {
      files++;
      if (WRITE) writeFileSync(f, `${JSON.stringify(d, null, 2)}\n`);
      console.log(`  ${WRITE ? 'fixed' : 'would fix'} ${relative(INKA, f)}`);
    }
  }
}
console.log(`\n${files} files, ${renamedA} "a" -> "link", ${droppedEmpty} empty inline nodes dropped, ${trimmedNl} trailing newlines trimmed`);
if (!WRITE) console.log('(dry run — pass --write to apply)');
