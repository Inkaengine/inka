/**
 * The blockmd engine maps markdown to blocks ONLY through prototype rules. It
 * knows markdown (node kinds, how GFM writes a table) and the rule language
 * (refs, regions, widgets) — never a block type, field, or region name. Every
 * such name belongs in a prototype.
 *
 * This scans the engine for string literals that are names the content or the
 * default prototypes use. A hit means block knowledge was hard-coded: move it
 * into a prototype rule instead of adding it to the vocabulary below.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import YAML from 'yaml';
import { parsePrototypes } from './prototype-mapping.mjs';
import { DEFAULT_PROTOTYPES } from './default-prototypes.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINE = join(HERE, 'prototype-mapping.mjs');

// The engine's own vocabulary — markdown and the rule language, each of which
// also happens to be spelled like some content field. Keep this to words the
// engine defines, never a block's field.
const VOCABULARY = new Set([
  // node kinds (markdown)
  'p', 'h', 'h*', 'img', 'a', 'ul', 'ol', 'li', 'blockquote', 'pre', 'hr', 'table', 'tr', 'td', 'th',
  'strong', 'em', 'dl', 'dt', 'dd', 'br', 'code',
  // ref parts (accessors)
  'text', 'textarea', 'slate', 'richtext', 'src', 'alt', 'lang', 'link', 'href', 'title', 'meta', 'level',
  // prototype tags and their attributes
  'block', 'region', 'fields', 'type', 'name', 'widget', 'idField', 'typeField', 'data-json', '_',
  // widgets, and the storage shape the blocks_layout widget defines
  'blocks_layout', 'object_list', 'blocks', 'items',
  // block identity, and the frontmatter assignments that carry it
  '@type', '@id', 'uid', 'id',
  // a parsed ref's own parts (`${node[label][index]/part}`) and a heading section
  'node', 'index', 'label', 'part', 'optional', 'body',
  // the value shape the `richtext` accessor reads and writes ({data, content-type})
  'data',
  // mdast and slate node shapes (the markdown and rich-text layers)
  'heading', 'paragraph', 'image', 'children', 'value', 'depth', 'url', 'ordered',
  'tableCell', 'tableHeaderCell', 'tableRow', 'html', 'break', 'root',
  // JavaScript's own properties
  'length', 'size',
]);

/** Every name a prototype or the content uses: block types, fields, regions. */
function contentNames() {
  const names = new Set();
  const addProtos = (text, explicit) => {
    const walk = (protos) => protos.forEach((p) => {
      names.add(p.type);
      Object.keys(p.fields).forEach((f) => f.split('.').forEach((s) => names.add(s)));
      p.regions.forEach((r) => {
        r.path.forEach((s) => names.add(s));
        if (r.idField) names.add(r.idField);
        if (r.typeField) names.add(r.typeField);
        walk(r.protos);
      });
    });
    walk(parsePrototypes(text, { explicit }));
  };
  addProtos(DEFAULT_PROTOTYPES.matched, false);
  addProtos(DEFAULT_PROTOTYPES.tagged, true);
  // Field names in the content itself (JSON keys in data-json and <fields>).
  const pages = [];
  const rec = (d) => readdirSync(d, { withFileTypes: true }).forEach((e) => {
    const p = join(d, e.name);
    if (e.isDirectory()) { if (e.name !== 'content' && e.name !== 'node_modules') rec(p); } else if (e.name.endsWith('.md')) pages.push(p);
  });
  rec(join(HERE, '..', 'docs'));
  for (const page of pages) {
    const md = readFileSync(page, 'utf8');
    for (const m of md.matchAll(/"([A-Za-z_@][\w:@-]*)"\s*:/g)) names.add(m[1]);
    for (const m of md.matchAll(/\s([A-Za-z_][\w-]*)(?:[.:][\w-]+)*=/g)) names.add(m[1]);
    const fm = /^---\n([\s\S]*?)\n---/.exec(md);
    if (fm) {
      const meta = YAML.parse(fm[1]) ?? {};
      if (meta['blocks-matched']) addProtos(meta['blocks-matched'], false);
      if (meta['blocks-tagged']) addProtos(meta['blocks-tagged'], true);
    }
  }
  return names;
}

/**
 * The names the engine's code refers to, comments stripped: whole string
 * literals (`'rows'`), the literal parts of template strings (`table.${k}`),
 * and property accesses (`block.table`, `row.cells`).
 */
function engineNames() {
  const src = readFileSync(ENGINE, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
  const out = new Set();
  for (const m of src.matchAll(/(['"])((?:\\.|(?!\1).)*)\1/g)) out.add(m[2]);
  for (const m of src.matchAll(/`([^`]*)`/g)) {
    // A literal chunk with whitespace is message prose; a bare one (`table.`)
    // is a name being built.
    for (const part of m[1].split(/\$\{[^}]*\}/)) if (!/\s/.test(part)) part.split(/[.:=]+/).forEach((w) => out.add(w));
  }
  // Lookbehind, so a chain (`b.table?.rows`) yields every link, not every other.
  for (const m of src.matchAll(/(?<=[\w\])])\??\.([A-Za-z_]\w*)/g)) out.add(m[1]);
  return out;
}

describe('the engine holds no block knowledge', () => {
  it('names no block type, field, or region the content uses', () => {
    const names = contentNames();
    const hits = [...engineNames()].filter((w) => w.length > 1 && names.has(w) && !VOCABULARY.has(w));
    expect(hits).toEqual([]);
  });
});
