/**
 * Page formats an MCP could offer an agent, all converting to and from one
 * canonical form so results can be compared like for like.
 *
 * Canonical form: `{ blocks: [block, …] }`, an ordered tree with no uids and
 * no `blocks_layout` bookkeeping. A block holding child blocks has them as an
 * ordered array under the same field name; Slate rich-text values are markdown
 * strings. Derived fields (`plaintext`) are dropped.
 *
 * Formats:
 *   blockmd  — the real engine with the page's own prototypes (decodePage/emitPage)
 *   tagged   — markdown prose + <block type="…">{json}</block>, children nested
 *   simple   — the canonical form itself, as JSON
 *   stored   — the CMS's stored block JSON (Volto shape), as JSON
 */
import YAML from 'yaml';
import { decodePage, emitPage, parsePrototypes } from '../../lib/prototype-mapping.mjs';
import { slateToMd, mdToSlate, plaintextOf } from '../../lib/slate-md.mjs';
import { sharedBlocksConfig } from '../../tests-playwright/fixtures/shared-block-schemas.js';

/** A Slate value: an array of element nodes with `children`. */
const isSlate = (v) => Array.isArray(v) && v.length > 0
  && v.every((n) => n && typeof n === 'object' && typeof n.type === 'string' && Array.isArray(n.children));

/**
 * An object holding child blocks in stored shape: a shared `blocks` dict plus
 * one or more ordered lists in `blocks_layout` (`items`, or a named region such
 * as columns' `columns`).
 */
const holdsBlocks = (o) => o && typeof o === 'object' && !Array.isArray(o)
  && o.blocks && typeof o.blocks === 'object' && !Array.isArray(o.blocks)
  && o.blocks_layout && typeof o.blocks_layout === 'object'
  && Object.values(o.blocks_layout).length > 0 && Object.values(o.blocks_layout).every(Array.isArray);

/** Canonical name of a layout list: `items` is `blocks`, a named region keeps its name. */
const listField = (key) => (key === 'items' ? 'blocks' : key);

/** Is field F of block type T a blocks_layout region (so canonical F is a block list)? */
export const isLayoutField = (type, field) => field === 'blocks'
  || sharedBlocksConfig[type]?.blockSchema?.properties?.[field]?.widget === 'blocks_layout';

// ------------------------------------------------------- stored <-> simple ---

/** Stored (Volto) page -> canonical block list (the page's `items` layout). */
export function storedToSimple(container) {
  return layoutList(container, 'items');
}

function layoutList(container, key) {
  return container.blocks_layout[key].map((id) => {
    const b = container.blocks[id];
    if (!b) throw new Error(`layout names missing block ${id}`);
    return simplifyBlock(b);
  });
}

function simplifyValue(v) {
  if (isSlate(v)) return { md: slateToMd(v) };
  if (Array.isArray(v)) return v.map(simplifyValue);
  if (v && typeof v === 'object') {
    if (holdsBlocks(v)) {
      const { blocks, blocks_layout, ...rest } = v;
      const out = mapObj(rest, simplifyValue);
      for (const key of Object.keys(blocks_layout)) out[listField(key)] = layoutList(v, key);
      return out;
    }
    return mapObj(v, simplifyValue);
  }
  return v;
}

function simplifyBlock(b) {
  const out = simplifyValue(b);
  if (isSlate(b.value)) delete out.plaintext;
  return out;
}

const mapObj = (o, f) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, f(v, k)]));
export const isMd = (v) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 1 && typeof v.md === 'string';

/**
 * Canonical -> stored. Mints block uids `b1…`, and `@id`s for object_list items
 * that hold blocks but have none (new items); derives plaintext.
 */
export function simpleToStored(list) {
  let n = 0;
  const restore = (v, inArray = false) => {
    if (isMd(v)) return mdToSlate(v.md);
    if (Array.isArray(v)) return v.map((x) => restore(x, true));
    if (v && typeof v === 'object') {
      const out = {};
      const blocks = {}; const layout = {};
      for (const [k, x] of Object.entries(v)) {
        if (Array.isArray(x) && isLayoutField(v['@type'], k)) {
          const r = restoreList(x);
          Object.assign(blocks, r.blocks);
          layout[k === 'blocks' ? 'items' : k] = r.items;
        } else out[k] = restore(x);
      }
      if (Object.keys(layout).length) { out.blocks = blocks; out.blocks_layout = layout; }
      // An object_list item holding blocks (accordion panel, tab…): needs an @id.
      if (inArray && Array.isArray(v.blocks)) out['@id'] ??= `i${++n}`;
      return out;
    }
    return v;
  };
  const restoreList = (list) => {
    const keyed = {}; const items = [];
    for (const b of list) {
      if (!b || typeof b !== 'object' || Array.isArray(b) || typeof b['@type'] !== 'string') {
        throw new Error(`not a block (needs "@type"): ${JSON.stringify(b).slice(0, 120)}`);
      }
      const id = `b${++n}`;
      const out = restore(b);
      if (isSlate(out.value)) out.plaintext = plaintextOf(out.value);
      keyed[id] = out; items.push(id);
    }
    return { blocks: keyed, items };
  };
  const top = restoreList(list);
  return { blocks: top.blocks, blocks_layout: { items: top.items } };
}

// ----------------------------------------------------------------- tagged ---
//
// Prose between blocks is plain markdown (each run becomes `slate` blocks, one
// per markdown block). A block is
//
//   <block type="teaser">{"href": "/a", "title": "A"}</block>
//
// with its fields as a JSON object. Rich-text fields are markdown strings.
// A field holding child blocks is written as nested tags inside
// <region name="field">…</region>; when the block has exactly one such field
// named `blocks` the region wrapper may be omitted. object_list items that hold
// blocks are <item>{json}…child blocks…</item> inside the region.
//
// Rich-text fields in JSON: markdown strings. The decoder turns a string field
// into Slate when the block's schema says the field is a slate widget.

export function toTagged(blocks, { richFields }) {
  const out = [];
  for (const b of blocks) {
    if (b['@type'] === 'slate' && Object.keys(b).every((k) => ['@type', 'value'].includes(k)) && b.value?.md) {
      out.push(b.value.md);
      continue;
    }
    out.push(tagBlock(b, richFields));
  }
  return out.join('\n\n');
}

function jsonFields(o, rich, keepType = false) {
  const fields = {}; const regions = [];
  for (const [k, v] of Object.entries(o)) {
    if (k === '@type' && !keepType) continue;
    if (Array.isArray(v) && isLayoutField(o['@type'], k)) { regions.push([k, v, 'blocks']); continue; }
    if (Array.isArray(v) && v.some((x) => x && typeof x === 'object' && Array.isArray(x.blocks))) { regions.push([k, v, 'items']); continue; }
    // A field the schema marks as rich text is a plain markdown string; rich
    // text the schema doesn't name (table cells, deep structures) stays {"md": "…"}.
    fields[k] = rich.has(k) && isMd(v) ? v.md : v;
  }
  return { fields, regions };
}

// No indentation: four spaces would turn nested markdown into a code block.
const indent = (s) => s;

function tagBlock(b, richFields) {
  const rich = richFields(b['@type']);
  const { fields, regions } = jsonFields(b, rich);
  const json = Object.keys(fields).length ? JSON.stringify(fields) : '';
  if (!regions.length) return `<block type="${b['@type']}">${json}</block>`;
  const parts = [`<block type="${b['@type']}">`];
  if (json) parts.push(indent(json));
  for (const [name, list, kind] of regions) {
    const body = kind === 'blocks'
      ? toTagged(list, { richFields })
      : list.map((item) => {
        const { blocks: kids = [], ...rest } = item;
        const { fields: f } = jsonFields(rest, rich, true);
        return `<item>${Object.keys(f).length ? JSON.stringify(f) : ''}\n${indent(toTagged(kids, { richFields }))}\n</item>`;
      }).join('\n');
    parts.push(indent(`<region name="${name}">\n${indent(body)}\n</region>`));
  }
  parts.push('</block>');
  return parts.join('\n');
}

/**
 * Parse tagged text -> canonical blocks. `richFields(type)` names the fields
 * the schema marks as slate, so a markdown string there becomes `{md}`.
 * Throws a TaggedError with a message an agent can act on.
 */
export class TaggedError extends Error {}

/**
 * Blank out code fences and inline code spans (same length) so a `<region>`
 * written ABOUT the format in prose is not read as a tag.
 */
function maskCode(text) {
  const blank = (m) => m.replace(/[^\n]/g, ' ');
  return text
    .replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, blank)
    // An escaped backtick isn't a delimiter, and a code span can't cross a blank line.
    .replace(/(?<![\\`])(`+)(?!`)(?:(?!\n\s*\n)[\s\S])*?[^`\\]\1(?!`)/g, blank);
}

export function fromTagged(text, { richFields }) {
  const p = { s: text, i: 0 };
  const out = parseSeq(p, richFields, null);
  if (p.i < p.s.length) throw new TaggedError(`unexpected text at offset ${p.i}: ${p.s.slice(p.i, p.i + 40)}`);
  return out;
}

const TAG = /(?<!\\)<(\/?)(block|region|item)\b([^>]*)>/g;

/**
 * The next tag at or after p.i, ignoring code. Code is masked from p.i, which is
 * always a boundary (after a tag or a JSON body), so backtick pairing starts fresh.
 */
function nextTag(p) {
  TAG.lastIndex = 0;
  const m = TAG.exec(maskCode(p.s.slice(p.i)));
  if (!m) return null;
  const at = p.i + m.index;
  return Object.assign([p.s.slice(at, at + m[0].length), m[1], m[2], p.s.slice(at + 1 + m[1].length + m[2].length, at + m[0].length - 1)], { index: at });
}

function proseBlocks(md) {
  const t = md.trim();
  if (!t) return [];
  // One slate block per top-level markdown block, as the editor splits them.
  return mdToSlate(t).map((node) => ({ '@type': 'slate', value: { md: slateToMd([node]) } }));
}

function parseSeq(p, richFields, closer) {
  const out = [];
  for (;;) {
    const m = nextTag(p);
    if (!m) {
      if (closer) throw new TaggedError(`missing </${closer}>`);
      out.push(...proseBlocks(p.s.slice(p.i)));
      p.i = p.s.length;
      return out;
    }
    out.push(...proseBlocks(p.s.slice(p.i, m.index)));
    p.i = m.index + m[0].length;
    const [, close, name, attrs] = m;
    if (close) {
      if (name !== closer) throw new TaggedError(`</${name}> where </${closer ?? 'nothing'}> was expected, at offset ${m.index}`);
      return out;
    }
    if (name !== 'block') throw new TaggedError(`<${name}> outside a <block>, at offset ${m.index}`);
    const type = /type="([^"]+)"/.exec(attrs)?.[1];
    if (!type) throw new TaggedError(`<block> without type="…", at offset ${m.index}`);
    if (attrs.trim().endsWith('/')) { out.push({ '@type': type }); continue; }
    out.push(parseBlockBody(p, type, richFields));
  }
}

/** Read a leading JSON object (if any) from p.s at p.i. */
function readJson(p, where) {
  const rest = p.s.slice(p.i);
  const lead = rest.match(/^\s*/)[0].length;
  if (rest[lead] !== '{') return {};
  // Scan to the matching brace, respecting strings.
  let depth = 0; let inStr = false; let esc = false;
  for (let j = lead; j < rest.length; j++) {
    const c = rest[j];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      const src = rest.slice(lead, j + 1);
      p.i += j + 1;
      try { return JSON.parse(src); } catch (e) { throw new TaggedError(`invalid JSON in ${where}: ${e.message}`); }
    }
  }
  throw new TaggedError(`unterminated JSON in ${where}`);
}

function toRich(type, fields, richFields) {
  const rich = typeof richFields === 'function' ? richFields(type) : richFields;
  const out = {};
  for (const [k, v] of Object.entries(fields)) out[k] = rich.has(k) && typeof v === 'string' ? { md: v } : v;
  return out;
}

function parseBlockBody(p, type, richFields) {
  const block = { '@type': type, ...toRich(type, readJson(p, `<block type="${type}">`), richFields) };
  const kids = [];
  for (;;) {
    const m = nextTag(p);
    if (!m) throw new TaggedError(`missing </block> for <block type="${type}">`);
    const between = p.s.slice(p.i, m.index);
    if (m[2] === 'region' && !m[1]) {
      if (between.trim()) kids.push(...proseBlocks(between));
      p.i = m.index + m[0].length;
      const name = /name="([^"]+)"/.exec(m[3])?.[1];
      if (!name) throw new TaggedError(`<region> without name="…" in <block type="${type}">`);
      block[name] = parseRegion(p, richFields, type, name);
      continue;
    }
    if (m[2] === 'block' && m[1]) {
      kids.push(...proseBlocks(between));
      p.i = m.index + m[0].length;
      if (kids.length) {
        if (block.blocks) throw new TaggedError(`<block type="${type}"> has both a blocks region and loose children`);
        block.blocks = kids;
      }
      return block;
    }
    // Loose children (no region wrapper) — the `blocks` field.
    const before = p.i;
    p.i = m.index;
    if (m[2] !== 'block') throw new TaggedError(`unexpected <${m[1]}${m[2]}> in <block type="${type}">`);
    kids.push(...proseBlocks(p.s.slice(before, m.index)));
    kids.push(...parseOne(p, richFields));
  }
}

function parseOne(p, richFields) {
  const m = nextTag(p);
  p.i = m.index + m[0].length;
  const type = /type="([^"]+)"/.exec(m[3])?.[1];
  if (!type) throw new TaggedError(`<block> without type="…", at offset ${m.index}`);
  if (m[3].trim().endsWith('/')) return [{ '@type': type }];
  return [parseBlockBody(p, type, richFields)];
}

function parseRegion(p, richFields, type, name) {
  // Either a list of <item>s, or a sequence of blocks/prose.
  const save = p.i;
  const m = nextTag(p);
  if (m && m[2] === 'item' && !m[1] && !p.s.slice(p.i, m.index).trim()) {
    const items = [];
    for (;;) {
      const t = nextTag(p);
      if (!t) throw new TaggedError(`missing </region> in <block type="${type}">`);
      if (t[2] === 'region' && t[1]) { p.i = t.index + t[0].length; return items; }
      if (t[2] !== 'item' || t[1]) throw new TaggedError(`expected <item> in region "${name}" of <block type="${type}">`);
      p.i = t.index + t[0].length;
      const fields = toRich(type, readJson(p, `<item> in region "${name}"`), richFields);
      const blocks = parseSeq(p, richFields, 'item');
      items.push({ ...fields, blocks });
    }
  }
  p.i = save;
  return parseSeq(p, richFields, 'region');
}

// ---------------------------------------------------------------- blockmd ---

/** Split a page into frontmatter (kept by the host) and the body the agent sees. */
export function splitPage(md) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(md);
  if (!m) throw new Error('page has no frontmatter');
  return { frontmatter: m[1], fm: YAML.parse(m[1]), body: md.slice(m[0].length) };
}

/** The page's prototype rules as text, for the format description. */
export function prototypeText(fm) {
  return [fm['blocks-matched'] && `blocks-matched:\n${fm['blocks-matched']}`, fm['blocks-tagged'] && `blocks-tagged:\n${fm['blocks-tagged']}`]
    .filter(Boolean).join('\n');
}

/** Body written by the agent -> stored blocks, using the page's own frontmatter. */
export function blockmdToStored(frontmatter, body) {
  const fm = YAML.parse(frontmatter);
  delete fm['blocks-assignments']; // let decode mint uids; the agent's body is authoritative
  return decodePage(`---\n${YAML.stringify(fm)}---\n${body}`);
}

export function storedToBlockmd(fm, stored) {
  const protos = [...parsePrototypes(fm['blocks-matched'] ?? ''), ...parsePrototypes(fm['blocks-tagged'] ?? '', { explicit: true })];
  return emitPage(protos, stored).markdown;
}

// --------------------------------------------------------------- schemas ---

/** Fields of each block type the schema marks as slate (rich text). */
export function richFieldsFrom(blocksConfig) {
  const cache = new Map();
  return (type) => {
    if (!cache.has(type)) {
      const props = blocksConfig[type]?.blockSchema?.properties ?? {};
      const rich = new Set(Object.entries(props).filter(([, f]) => f.widget === 'slate').map(([k]) => k));
      // object_list item schemas: their slate fields too (same name space is fine for the experiment).
      for (const f of Object.values(props)) {
        for (const [k, sf] of Object.entries(f?.schema?.properties ?? {})) if (sf.widget === 'slate') rich.add(k);
      }
      cache.set(type, rich);
    }
    return cache.get(type);
  };
}
