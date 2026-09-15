/**
 * Prototype-tag mapping: markdown -> Plone blocks, driven by prototype tags.
 *
 * Design: docs/superpowers/specs/2026-08-14-blockmd-unified-mapping-design.md
 *
 * A prototype is a `<block>` tag read declaratively. Its `${type[n]/part}` refs
 * are the pattern -- they both locate the markdown nodes an instance spans and
 * map them to fields; there is no separate `match=`. A container prototype
 * nests a `<region>` whose item prototype applies in that child scope: the
 * item's heading ref is the repeat delimiter, and whatever the item's scalar
 * refs do not consume falls into the region as the implicit remainder.
 *
 * Matching is a run over the top-level node stream: leftmost, longest,
 * prototype declaration order as the tiebreak.
 *
 * NOTE (spike): uid-keying is deferred. A region yields an ordered list of
 * items, and a panel's remainder is an ordered `blocks` list -- not yet the
 * uid-keyed `blocks` dict + `blocks_layout` the stored shape uses.
 */
import YAML from 'yaml';
import { tagOf, mdParser, blockToSlate, slateToMd, fmtTagAttrs, renderTable,
         mdastToHtml, htmlToMd, htmlRichtext } from './slate-md.mjs';

// ${node[n]/part} -- node kind, optional match-index, optional accessor part.
// No `/part` means match-only: consume the node, capture nothing (separator,
// title). The `${}` is what marks a value as matching; a literal is a field
// default, so a field literally named `node` never collides with a directive.
// The node set is comma-separated (CSS-flavoured), e.g. `${p,h*,ul,ol/slate}`;
// `|` is still accepted for older content. `h*` is a heading wildcard.
// A trailing `?` on the node marks the ref OPTIONAL: `${strong?/text}` matches
// its node when present and is skipped when absent (a hero with no subtitle),
// instead of the required-by-default failure.
//
// The middle `[…]` slot is "which one", chainable and keyed OR positional
// (like `sections["Contents"].paragraphs[2]`, NOT a CSS attribute selector):
//   `[2]`         -> the 2nd of that kind (position)
//   `[Contents]`  -> within the thing labelled "Contents" (a heading section /
//                    a def-list term) -- an identifier, matched by text
//   `[Contents][2]` -> the 2nd, within that label's scope
const REF_RE = /^\$\{([a-z0-9|*,]+)(\?)?((?:\[[^\]]+\])*)(?:\/([a-z]+))?\}$/i;

function parseRef(v) {
  if (typeof v !== 'string') return null;
  const m = REF_RE.exec(v.trim());
  if (!m) return null;
  let index = null, label = null;
  for (const [, sel] of (m[3] || '').matchAll(/\[([^\]]+)\]/g)) {
    if (/^\d+$/.test(sel)) index = Number(sel); else label = sel; // number = position, identifier = label
  }
  return { node: m[1], optional: !!m[2], index, label, part: m[4] ?? null };
}

// Parse a tag's attributes, typed by syntax: a bare name is `true` (HTML
// boolean), an unquoted value is coerced (number / true / false / null / JSON),
// a double-quoted value stays a string (so `${refs}` survive), and a
// single-quoted value is a data JSON string (entities un-escaped).
const ATTR_RE = /([\w@.$-]+)(?:=(?:"([^"]*)"|'([^']*)'|(\S+)))?/g;
function typedAttrs(raw) {
  const inner = raw.replace(/^\s*<\/?[A-Za-z][\w-]*/, '').replace(/\/?>\s*$/, '');
  const out = {};
  for (const [, k, dq, sq, bare] of inner.matchAll(ATTR_RE)) {
    if (dq !== undefined) out[k] = dq;
    else if (sq !== undefined) out[k] = sq.replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    else if (bare === undefined) out[k] = true; // HTML boolean
    else if (bare === 'true' || bare === 'false') out[k] = bare === 'true';
    else if (bare === 'null') out[k] = null;
    else if (/^-?\d+(\.\d+)?$/.test(bare)) out[k] = Number(bare);
    else if (bare[0] === '{' || bare[0] === '[') out[k] = JSON.parse(bare);
    else out[k] = bare;
  }
  return out;
}

/**
 * Canonical node kind, in HTML vocabulary so refs read as `p`/`hr`/`img`/`td`
 * rather than mdast's internal names. A heading carries its level (`h2`).
 */
const HTML_KIND = {
  paragraph: 'p', image: 'img', thematicBreak: 'hr', code: 'pre',
  table: 'table', tableRow: 'tr', tableCell: 'td', link: 'a',
  listItem: 'li', blockquote: 'blockquote', break: 'br', inlineCode: 'code',
  strong: 'strong', emphasis: 'em', // an all-bold / all-italic paragraph (see topNodes)
  defList: 'dl', defListTerm: 'dt', defListDescription: 'dd', // a `Term\n: value` definition list
};
const kindOf = (n) => {
  if (n.type === 'heading') return `h${n.depth}`;
  if (n.type === 'list') return n.ordered ? 'ol' : 'ul';
  return HTML_KIND[n.type] ?? n.type;
};

// -------------------------------------------------------------- prototypes ---

/**
 * Parse a run of prototype tags into a tree. A `<block>` may nest `<region>`s,
 * and a region holds one item prototype.
 */
export function parsePrototypes(text, { explicit = false } = {}) {
  const roots = [];
  const stack = []; // {kind:'block',proto} | {kind:'region',region}
  const top = () => stack[stack.length - 1];

  const place = (proto) => {
    const t = top();
    if (!t) roots.push(proto);
    else if (t.kind === 'region') t.region.protos.push(proto);
    else throw new Error('a block prototype must sit inside a region, not a block');
  };

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const tag = tagOf(line);
    if (!tag) continue;
    const attrs = typedAttrs(line);

    if (tag.name === 'block') {
      // `explicit` comes from section membership (the `blocks-tagged:` frontmatter
      // key), not an attribute: an explicit prototype matches ONLY inside its
      // `<block type>` tag, never bare markdown -- so a pattern that overlaps a
      // common one (a heading-link is also a teaser) does not silently grab it.
      // Bare stays the implicit/common (`blocks-matched:`) reading.
      const { type, ...fields } = attrs;
      const proto = { type, explicit, fields, regions: [] };
      if (tag.kind === 'close') { stack.pop(); continue; }
      place(proto);
      if (tag.kind === 'open') stack.push({ kind: 'block', proto });
    } else if (tag.name === 'region') {
      if (tag.kind === 'close') { stack.pop(); continue; }
      const t = top();
      if (!t || t.kind !== 'block') throw new Error('region outside a block');
      // idField/typeField are the object_list item's identity/type keys, named
      // on the region because decode is schema-free (there's no blocksConfig to
      // read them from). They default to @id/@type; a region can override, e.g.
      // `<region widget="object_list" idField="key">` for slateTable rows.
      const region = { name: attrs.name, widget: attrs.widget, protos: [],
                       idField: attrs.idField, typeField: attrs.typeField };
      t.proto.regions.push(region);
      if (tag.kind === 'open') stack.push({ kind: 'region', region });
    }
  }
  return roots;
}

/** node kind -> how many the run needs (`index` null = one, `h2[2]` = two). */
/**
 * The node slots a prototype's refs imply. Each slot is a set of acceptable
 * node kinds (`p|h2|…`, or `*` for any); a ref with index n needs n slots of
 * that kind, and refs sharing a node (img/src, img/alt) share one slot.
 */
function slotsOf(proto) {
  const need = new Map(); // node-set string -> how many the run needs
  for (const v of Object.values(proto.fields)) {
    const r = parseRef(v); // includes match-only refs (no /part)
    if (!r) continue;
    need.set(r.node, Math.max(need.get(r.node) ?? 0, r.index ?? 1));
  }
  const slots = [];
  for (const [nodeSet, count] of need) for (let i = 0; i < count; i += 1) slots.push(nodeSet.split(/[|,]/));
  return slots;
}
// `h` is the heading at the current nesting depth (relative); `h*` is any
// heading; `h2` is absolute. `depth` = title level + nesting.
const nodeInSlot = (node, kinds, depth) => kinds.includes('*') || kinds.includes(kindOf(node))
  || (kinds.includes('h*') && /^h[1-6]$/.test(kindOf(node)))
  || (kinds.includes('h') && kindOf(node) === `h${depth}`);
// CSS specificity: each type (non-`*`) slot is a type selector; a multi-node run
// is a compound/combinator match so they SUM. A comma list inside one slot
// (`p,h*,ul`) is a selector list -> still one type-level slot, count does not add.
// A `*` slot is the universal selector -> contributes 0.
const specificity = (slots) => slots.filter((s) => !s.includes('*')).length;

/** The section under the heading whose text === `label`: its `heading` node and
 *  the `body` nodes up to the next heading of the same-or-higher level. `null`
 *  if no such heading. A `${p[Contents]}` ref scopes to `body`, and consuming
 *  `heading` too keeps it out of the region (so emit reproduces it once). */
function sectionUnder(nodes, label) {
  const i = nodes.findIndex((n) => /^h[1-6]$/.test(kindOf(n)) && nodeText(n) === label);
  if (i < 0) return null;
  const level = Number(kindOf(nodes[i]).slice(1));
  const body = [];
  for (let j = i + 1; j < nodes.length; j += 1) {
    const k = kindOf(nodes[j]);
    if (/^h[1-6]$/.test(k) && Number(k.slice(1)) <= level) break;
    body.push(nodes[j]);
  }
  return { heading: nodes[i], body };
}

/** The `dd` value for the def-list term whose text === `label`, plus the `dl`
 *  node it lives in (consumed once, so the whole list stays out of the region).
 *  null if no such term. Backs `${dd[Author]}`. */
function termValue(nodes, label) {
  for (const n of nodes) {
    if (kindOf(n) !== 'dl') continue;
    const kids = n.children || [];
    for (let i = 0; i < kids.length; i += 1) {
      if (kindOf(kids[i]) === 'dt' && nodeText(kids[i]) === label) {
        return { dl: n, dd: kids.slice(i + 1).find((c) => kindOf(c) === 'dd') ?? null };
      }
    }
  }
  return null;
}

// A container that can be matched/emitted BARE (no `<block>` wrapper): non-explicit,
// one object_list region, and a fixed-shape item (>= 2 slots, no sub-region -> no
// variable remainder) so greedy consumption has an unambiguous boundary.
const isGreedyContainer = (p) => !!p && !p.explicit && p.regions.length === 1
  && p.regions[0].widget === 'object_list'
  && (p.regions[0].protos[0]?.regions?.length ?? 0) === 0
  && slotsOf(p.regions[0].protos[0]).length >= 2;
const isLeaf = (p) => !p.regions?.length && slotsOf(p).length > 0;

// ------------------------------------------------------------------ nodes ----

/**
 * Top-level mdast nodes, normalised: a paragraph whose only child is an image
 * becomes an image node (a standalone image is its own block). Links stay
 * inline and are reached by path navigation.
 */
function topNodes(markdown) {
  return mdParser.parse(markdown).children.map((n) => {
    // A paragraph that is only an image is that image's own block (a standalone
    // image), so lift it out of the wrapping paragraph. A lone LINK is NOT
    // lifted: it stays a paragraph, so it reads as a slate (a paragraph with a
    // link) -- a button, being explicit, matches only inside its own tag.
    if (n.type === 'paragraph' && n.children?.length === 1 && n.children[0].type === 'image') {
      return n.children[0];
    }
    // A paragraph that is ONLY a bold/italic run is that run's own node (a
    // subtitle/kicker/lead), so `${strong/text}` / `${em/text}` can target it.
    // A paragraph with only SOME bold stays a paragraph (reads as slate).
    if (n.type === 'paragraph' && n.children?.length === 1
        && (n.children[0].type === 'strong' || n.children[0].type === 'emphasis')) {
      return n.children[0];
    }
    return n;
  });
}

const nodeText = (node) => (
  node.value !== undefined ? node.value : (node.children || []).map(nodeText).join('')
);

/** The first url in a node or its descendants (a link/image), or null. */
function findUrl(node) {
  if (typeof node.url === 'string') return node.url;
  for (const c of node.children || []) {
    const u = findUrl(c);
    if (u !== null) return u;
  }
  return null;
}

/** The title-string of an image/link (`![a](u "title")` / `[t](u "title")`),
 *  searched into a paragraph that wraps a link. */
function findTitle(node) {
  if (typeof node.title === 'string') return node.title;
  for (const c of node.children || []) {
    const t = findTitle(c);
    if (t !== null) return t;
  }
  return null;
}

/** A node's slate value, reconstructing the paragraph a lone strong/em or a
 *  table cell was lifted from. */
const slateValue = (node) => blockToSlate(
  node.type === 'tableCell' ? { type: 'paragraph', children: node.children }
    : (node.type === 'strong' || node.type === 'emphasis') ? { type: 'paragraph', children: [node] }
    : node);

function resolvePart(node, ref) {
  switch (ref.part) {
    // A table cell's content is inline; wrap it as a paragraph so it becomes a
    // slate value like any other block.
    // A lone strong/emphasis node was lifted OUT of its paragraph (topNodes), so
    // reconstruct that paragraph before slate-ifying -- its value is the same
    // `[{p, children:[{em/strong, …}]}]` a normal italic/bold paragraph would give.
    case 'slate': return slateValue(node);
    // A `richtext` WIDGET stores HTML (`{data, content-type, encoding}`), the
    // Volto RichText shape — NOT slate. (Slate FIELDS, e.g. a hero description
    // with `widget: 'slate'`, use `${…/slate}` for a bare array instead.)
    case 'richtext': return htmlRichtext(mdastToHtml(node));
    case 'text': return nodeText(node);
    case 'src': return node.url;
    case 'alt': return node.alt;
    case 'lang': return node.lang;
    // A link widget: the object-browser form Volto stores, `[{'@id': url}]`.
    // Only the id is authored; the summary (Title/Description/hasPreviewImage)
    // is resolved from the target at read time by the API, not carried here.
    case 'link': {
      const u = findUrl(node);
      if (u === null) throw new Error(`no link url in ${kindOf(node)}`);
      return [{ '@id': u }];
    }
    case 'title': return findTitle(node); // `![a](u "title")` / `[t](u "title")` -> a caption/tooltip
    case 'meta': return node.meta ?? null; // a code fence's info-string after the lang
    default: throw new Error(`unhandled ref part: ${ref.part}`);
  }
}

// ----------------------------------------------------------- leaf matching ---

/** Does the run of `slots.length` nodes at `i` fill every slot (a bijection)? */
function runAt(nodes, i, slots, depth) {
  const size = slots.length;
  if (size === 0 || i + size > nodes.length) return null;
  const run = nodes.slice(i, i + size);
  const used = new Set();
  for (const kinds of slots) {
    const j = run.findIndex((n, k) => !used.has(k) && nodeInSlot(n, kinds, depth));
    if (j < 0) return null;
    used.add(j);
  }
  return used.size === run.length ? run : null;
}

/** Resolve a ref against a run: the index-th node whose kind is in the ref's set. */
function resolveRef(run, ref, depth) {
  const kinds = ref.node.split(/[|,]/);
  const node = run.filter((n) => nodeInSlot(n, kinds, depth))[(ref.index ?? 1) - 1];
  if (!node) throw new Error(`ref ${ref.node}[${ref.index ?? 1}] not in run`);
  return resolvePart(node, ref);
}

/**
 * Required-by-default: a prototype matches only if EVERY element it asks for is
 * actually there. Node-kind slots alone are too loose -- a teaser's `${h/link}`
 * shares the heading with `${h/text}`, so slot-matching accepts any heading, then
 * the missing link surfaces only at resolve time. Checking that each ref resolves
 * (a `/link` needs a real link) makes a plain heading + paragraph stay two slates
 * instead of being grabbed as a linkless teaser.
 */
function runResolves(proto, run, depth) {
  for (const val of Object.values(proto.fields)) {
    const ref = parseRef(val);
    if (!ref || ref.part === null) continue;
    let v;
    try { v = resolveRef(run, ref, depth); } catch { return false; }
    if (v === null && !ref.optional) return false; // an optional part (title-string) may be absent
  }
  return true;
}

function leafBlock(proto, run, depth) {
  const block = { '@type': proto.type };
  for (const [field, val] of Object.entries(proto.fields)) {
    const ref = parseRef(val);
    // `_` is the discard sink, and a no-/part ref has nothing to store: both
    // consume their node for the pattern but keep nothing on the block.
    if (field === '_' || (ref && ref.part === null)) continue;
    // A captured part that resolves to nothing (a `![](u)` with no alt, a
    // `![a](u)` with no title-string) leaves the field ABSENT, not `null`/`""` --
    // so an optional markdown part round-trips against a block that omits it.
    if (ref) { const v = resolveRef(run, ref, depth); if (v != null && v !== '') block[field] = v; }
    else block[field] = val;
  }
  return block;
}

/** Match one bare-markdown block starting at `i`; returns {block, len}. */
function matchRun(protos, nodes, i, depth) {
  // CSS-accurate precedence: higher specificity wins; ties break by source order,
  // the later-declared prototype winning like the CSS cascade.
  const ordered = protos.map((p, order) => ({ p, order, slots: slotsOf(p) }))
    .filter(({ p }) => isLeaf(p) && !p.explicit)
    .sort((a, b) => specificity(b.slots) - specificity(a.slots) || b.order - a.order);
  for (const { p, slots } of ordered) {
    const run = runAt(nodes, i, slots, depth);
    if (run && runResolves(p, run, depth)) return { block: leafBlock(p, run, depth), len: run.length };
  }
  throw new Error(`no prototype matches node kind: ${kindOf(nodes[i])} at depth ${depth}`);
}

// --------------------------------------------------------- scoped matching ---

/** Split nodes into groups, each starting at a delimiter (a heading at `depth`). */
function splitAt(nodes, delim, depth) {
  const isDelim = (n) => (delim === 'h' ? kindOf(n) === `h${depth}` : kindOf(n) === delim);
  const groups = [];
  for (const n of nodes) {
    if (isDelim(n)) groups.push([n]);
    else if (groups.length) groups[groups.length - 1].push(n);
    else throw new Error(`content before first ${delim} delimiter`);
  }
  return groups;
}

/** The heading ref an item repeats on (`h` relative, or `h2` absolute). */
function delimiterOf(item) {
  for (const v of Object.values(item.fields)) {
    const r = parseRef(v);
    if (r && /^h([1-6])?$/.test(r.node)) return r.node;
  }
  throw new Error('a repeating item needs a heading delimiter ref');
}

// An object_list item's delimiter sits at `depth`; its content is one deeper.
function decodeItem(protos, item, group, depth) {
  // Symmetric with emitItem: pull a `<fields>` tag's values onto the item first
  // (the spilled head_title/flagAlign), then match refs against what remains.
  const { fields: extra, rest: nodes } = extractFields(group);
  const result = { ...extra };
  const consumed = new Set();
  for (const [field, val] of Object.entries(item.fields)) {
    const ref = parseRef(val);
    if (!ref) { result[field] = val; continue; }
    const node = nodes.filter((n) => nodeInSlot(n, ref.node.split(/[|,]/), depth))[(ref.index ?? 1) - 1];
    if (!node) { if (ref.optional) continue; throw new Error(`item ref ${ref.node} not found in item`); }
    consumed.add(node);
    if (field !== '_' && ref.part !== null) result[field] = resolvePart(node, ref);
  }
  // The implicit remainder region only appears when nodes are left over: a panel
  // keeps its content, but a tab (label + fence, both consumed) has none.
  const remainder = nodes.filter((n) => !consumed.has(n));
  if (remainder.length) result.blocks = matchNodes(protos, remainder, depth + 1);
  return result;
}

// Nodes whose children ARE the region items (already nested in mdast), so the
// region iterates them rather than splitting a flat stream at a delimiter.
const STRUCTURAL = new Set(['table', 'tr']);

/** Decode one item from a single already-structured node (a tr, a td). */
function decodeItemNode(protos, item, node, depth) {
  const result = {};
  for (const [field, val] of Object.entries(item.fields)) {
    const ref = parseRef(val);
    if (!ref) { result[field] = val; continue; }
    if (field !== '_' && ref.part !== null) result[field] = resolvePart(node, ref);
  }
  for (const region of item.regions || []) result[region.name] = decodeRegion(protos, region, [node], depth);
  return result;
}

function decodeRegion(protos, region, inner, depth) {
  if (region.widget === 'blocks_layout') { // a plain block sequence one level
    return matchNodes([...protos, ...region.protos], inner, depth + 1); // deeper, with scoped protos
  }
  const item = region.protos[0];
  if (inner.length === 1 && STRUCTURAL.has(kindOf(inner[0]))) { // iterate-children (tables)
    return inner[0].children.map((child) => decodeItemNode(protos, item, child, depth));
  }
  const delim = delimiterOf(item); // object_list: delimiter at `depth`, content one deeper
  return splitAt(inner, delim, depth).map((group) => decodeItem(protos, item, group, depth));
}

/**
 * Pull explicit `<region name=X>…</region>` tags out of a body: a local override
 * where the instance says exactly which content is that region. Returns the
 * region-name → its inner nodes, and the nodes left outside any region.
 */
function splitRegions(nodes) {
  const regions = {}, rest = [];
  let i = 0;
  while (i < nodes.length) {
    const n = nodes[i];
    const tag = n.type === 'html' ? tagOf(n.value) : null;
    if (tag && tag.name === 'region' && tag.kind === 'open') {
      let nest = 1, j = i + 1;
      for (; j < nodes.length && nest; j += 1) {
        const m = nodes[j].type === 'html' ? tagOf(nodes[j].value) : null;
        if (m && m.name === 'region' && m.kind === 'open') nest += 1;
        else if (m && m.name === 'region' && m.kind === 'close') nest -= 1;
      }
      regions[typedAttrs(n.value).name] = nodes.slice(i + 1, j - 1);
      i = j;
    } else { rest.push(n); i += 1; }
  }
  return { regions, rest };
}

/**
 * Pull `<fields …/>` tags out of a body and merge their values: a local override
 * that sets named fields on the enclosing block without a data blob. Typed
 * attrs set fields directly; a `data='…'` attr carries object fields. Returns
 * the merged fields and the content nodes left over.
 */
function extractFields(nodes) {
  const fields = {}, rest = [];
  for (const n of nodes) {
    const tag = n.type === 'html' ? tagOf(n.value) : null;
    if (tag && tag.name === 'fields') {
      const { 'data-json': data, ...attrs } = typedAttrs(n.value);
      Object.assign(fields, attrs);
      if (data) Object.assign(fields, JSON.parse(data));
    } else rest.push(n);
  }
  return { fields, rest };
}

/** Set a possibly-dotted path (`table.rows`) on an object. */
function setPath(obj, path, value) {
  const parts = path.split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i += 1) { o[parts[i]] ??= {}; o = o[parts[i]]; }
  o[parts[parts.length - 1]] = value;
}

/** Decode an explicit `<block type=X>` tag with body `inner`. A `data-json`
 *  attr carries object fields (e.g. `{"fixed":false}`), merged like everywhere
 *  else `data-json` is honoured -- self-closing tags and `<fields>` both parse
 *  it, so a block-with-children must too. */
function decodeTag(protos, attrs, inner, depth) {
  const { type, 'data-json': data, ...override } = attrs;
  if (data) Object.assign(override, JSON.parse(data));

  const container = protos.find((p) => p.type === type && p.regions.length);
  if (container) {
    const block = { '@type': type };
    for (const [k, v] of Object.entries(container.fields)) if (!parseRef(v)) block[k] = v;
    for (const [k, v] of Object.entries(override)) setPath(block, k, v); // dotted (table.celled) supported
    // Consume the container's own scalar refs from the body front (a grid
    // `headline="${h}"`), optionally -- absent leading heading = no headline --
    // then the region gets the remainder.
    const consumed = new Set();
    for (const [field, val] of Object.entries(container.fields)) {
      const ref = parseRef(val);
      if (!ref || ref.part === null || field === '_') continue;
      // `${dd[Author]}` reads a def-list term (its `dl` is consumed whole).
      if (ref.label && ref.node === 'dd') {
        const t = termValue(inner, ref.label);
        if (t) { consumed.add(t.dl); if (t.dd) block[field] = resolvePart(t.dd, ref); }
        continue;
      }
      // `[label]` scopes to that heading's section; `[n]`/none picks by position.
      const sect = ref.label ? sectionUnder(inner, ref.label) : null;
      const pool = ref.label ? (sect?.body ?? []) : inner;
      const cands = pool.filter((n) => !consumed.has(n) && nodeInSlot(n, ref.node.split(/[|,]/), depth));
      const node = cands[(ref.index ?? 1) - 1];
      if (node) { consumed.add(node); if (sect) consumed.add(sect.heading); block[field] = resolvePart(node, ref); }
    }
    const rest = inner.filter((n) => !consumed.has(n));
    // An explicit `<region name=X>` in the instance body overrides which content
    // is region X (a local override); regions without one take the remainder.
    const { regions: explicit, rest: bodyRest } = splitRegions(rest);
    for (const region of container.regions) {
      const content = region.name in explicit ? explicit[region.name] : bodyRest;
      setPath(block, region.name, decodeRegion(protos, region, content, depth));
    }
    // A markdown table's first row is its header (GFM); derive the cell type.
    if (Array.isArray(block.table?.rows)) {
      block.table.rows.forEach((row, i) => row.cells.forEach((c) => { c.type = i === 0 ? 'header' : 'data'; }));
    }
    return block;
  }

  // A leaf light tag: `<fields>` merged in, the rest matched by the type's leaf
  // prototype whose pattern fills the remaining body.
  const { fields: extra, rest: content } = extractFields(inner);
  const finish = (block) => {
    Object.assign(block, extra);
    for (const [k, v] of Object.entries(override)) block[k] = v;
    return block;
  };
  const leaves = protos.map((p, order) => ({ p, order }))
    .filter(({ p }) => p.type === type && isLeaf(p))
    .sort((a, b) => specificity(slotsOf(b.p)) - specificity(slotsOf(a.p)) || b.order - a.order);
  for (const { p: proto } of leaves) {
    const run = runAt(content, 0, slotsOf(proto), depth);
    if (run && run.length === content.length && runResolves(proto, content, depth)) {
      return finish(leafBlock(proto, content, depth));
    }
  }
  throw new Error(`no leaf prototype for <block type="${type}"> matching its body`);
}

/** A tier-3 self-closing data tag -> the raw block it stores. The `uid` is
 *  redundant (assignments carry it) and dropped; `data` merges the JSON fields. */
function decodeRawTag(attrs) {
  const { type, uid, 'data-json': data, ...rest } = attrs;
  const block = { '@type': type, ...rest };
  if (data) Object.assign(block, JSON.parse(data));
  return block;
}

/** A non-explicit container whose single object_list region has a FIXED-SHAPE
 *  item (>= 2 slots, no sub-regions -> no variable remainder) can be matched
 *  bare and greedily: consume consecutive items (maximal munch) until the item
 *  pattern breaks. That break IS the boundary, so no `<block>` wrapper is needed
 *  (e.g. codeExample = repeating `### heading` + fence). Variable-remainder
 *  containers (accordion) are `explicit` and excluded, since their boundary is
 *  ambiguous. Ties break by source order (later wins). Returns {block, len} | null. */
function matchGreedyContainer(protos, nodes, i, depth) {
  const ordered = protos
    .map((p, order) => ({ p, order }))
    .filter(({ p }) => isGreedyContainer(p))
    .sort((a, b) => b.order - a.order);
  for (const { p } of ordered) {
    const region = p.regions[0];
    const item = region.protos[0];
    const slots = slotsOf(item);
    const groups = [];
    let pos = i;
    for (let run; pos < nodes.length && (run = runAt(nodes, pos, slots, depth)); pos += run.length) {
      groups.push(nodes.slice(pos, pos + run.length));
    }
    if (groups.length) {
      const block = { '@type': p.type, [region.name]: groups.map((g) => decodeItem(protos, item, g, depth)) };
      return { block, len: pos - i };
    }
  }
  return null;
}

/** Walk a node stream, handling explicit `<block>` tags and bare runs, at the
 *  current heading `depth` (title level + nesting; top content is 2). */
function matchNodes(protos, nodes, depth = 2) {
  const blocks = [];
  let i = 0;
  while (i < nodes.length) {
    const n = nodes[i];
    if (n.type === 'html') {
      const tag = tagOf(n.value);
      if (tag && tag.name === 'block' && tag.kind === 'self') { // tier-3 data tag
        blocks.push(decodeRawTag(typedAttrs(n.value)));
        i += 1;
        continue;
      }
      if (tag && tag.name === 'fields' && tag.kind === 'open') {
        // An enclosing `<fields …>` propagates its field values onto every block
        // it wraps, as defaults -- a wrapped block's own field wins. Same tag as
        // the self-closing `<fields/>` (which sets fields on the block it sits
        // in); here the scope is what it encloses. Nest-aware, so nested wrappers
        // merge (outer fills whatever inner left unset).
        let nest = 1, j = i + 1;
        for (; j < nodes.length && nest; j++) {
          const m = nodes[j].type === 'html' ? tagOf(nodes[j].value) : null;
          if (m && m.name === 'fields' && m.kind === 'open') nest += 1;
          else if (m && m.name === 'fields' && m.kind === 'close') nest -= 1;
        }
        const { 'data-json': data, ...attrs } = typedAttrs(n.value);
        const shared = { ...attrs };
        if (data) Object.assign(shared, JSON.parse(data));
        for (const block of matchNodes(protos, nodes.slice(i + 1, j - 1), depth)) {
          for (const [k, v] of Object.entries(shared)) if (!(k in block)) setPath(block, k, v);
          blocks.push(block);
        }
        i = j;
        continue;
      }
      if (!tag || tag.name !== 'block' || tag.kind !== 'open') {
        throw new Error(`unexpected html node: ${n.value}`);
      }
      let nest = 1, j = i + 1;
      for (; j < nodes.length && nest; j++) {
        const m = nodes[j].type === 'html' ? tagOf(nodes[j].value) : null;
        if (m && m.name === 'block' && m.kind === 'open') nest += 1;
        else if (m && m.name === 'block' && m.kind === 'close') nest -= 1;
      }
      blocks.push(decodeTag(protos, typedAttrs(n.value), nodes.slice(i + 1, j - 1), depth));
      i = j;
      continue;
    }
    // A bare fixed-shape container (codeExample) is a multi-node compound, more
    // specific than any leaf, so try it before the leaf matchRun.
    const greedy = matchGreedyContainer(protos, nodes, i, depth);
    if (greedy) { blocks.push(greedy.block); i += greedy.len; continue; }
    const { block, len } = matchRun(protos, nodes, i, depth);
    blocks.push(block);
    i += len;
  }
  return blocks;
}

/** Match a markdown body against prototypes, producing block objects. */
export function matchBlocks(prototypes, markdown, depth = 2) {
  return matchNodes(prototypes, topNodes(markdown), depth);
}

/**
 * Decode a full markdown page -> block JSON. The frontmatter carries the page
 * metadata, the `prototypes` (the mapping) and the `assignments` (uids + type
 * anchor); the body is the content. This is the read side the mock API needs.
 */
export function decodePage(md) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(md);
  if (!m) throw new Error('page has no frontmatter');
  const {
    'blocks-assignments': ba, 'blocks-matched': bm, 'blocks-tagged': bt,
    assignments: oldA, prototypes: oldP, ...metadata
  } = YAML.parse(m[1]) ?? {};
  // `blocks-matched:` are the implicit (auto-matched) prototypes; `blocks-tagged:`
  // are explicit (tag-only). Section membership is the explicit flag. Old
  // `prototypes:`/`assignments:` keys are still accepted.
  const assignments = ba ?? oldA ?? [];
  const protos = [...parsePrototypes(bm ?? oldP ?? ''), ...parsePrototypes(bt ?? '', { explicit: true })];
  const keyed = keyBlocks(matchBlocks(protos, md.slice(m[0].length)), assignments, protos);
  return { ...metadata, ...keyed };
}

// ------------------------------------------------------------------ emit -----

/** Unwrap a link-widget value `[{'@id': url}]` back to its url. */
function linkUrl(v) {
  if (!Array.isArray(v) || !v[0] || typeof v[0]['@id'] !== 'string') {
    throw new Error(`not a link-widget value: ${JSON.stringify(v)}`);
  }
  return v[0]['@id'];
}

/** The heading hashes for a node kind (`h2` -> `##`, relative `h` -> depth). */
const hashes = (node, depth) => '#'.repeat(/^h[1-6]$/.test(node) ? Number(node[1]) : depth);

/** Reconstruct the markdown for one pattern node from the fields that feed it. */
function emitNode(block, entry, depth) {
  const p = entry.parts;
  // `/slate` renders whatever the value is (p, h2, list…), so it ignores the
  // node-kind set the ref matched on.
  if (p.slate) return slateToMd(block[p.slate]);
  if (p.richtext) return htmlToMd(block[p.richtext]?.data ?? ''); // an HTML {data, content-type} field
  // An optional title-string on an image/link: `![a](u "title")` / `[t](u "title")`.
  const title = p.title && block[p.title] != null ? ` "${block[p.title]}"` : '';
  // A link widget: `[text](url)`, in a paragraph or wrapped by a heading; an
  // image with a link-form url renders `![alt](url)`.
  if (p.link) {
    const url = linkUrl(block[p.link]);
    if (entry.node === 'img') return `![${p.alt ? block[p.alt] : ''}](${url}${title})`;
    const link = `[${p.text ? block[p.text] ?? '' : ''}](${url}${title})`;
    return /^h/.test(entry.node) ? `${hashes(entry.node, depth)} ${link}` : link;
  }
  if (entry.node === 'p' && p.text) return block[p.text];
  if (entry.node === 'img') return `![${p.alt ? block[p.alt] : ''}](${block[p.src]}${title})`;
  if (entry.node === 'hr') return '---';
  if (/^h[1-6]$/.test(entry.node)) return `${'#'.repeat(Number(entry.node[1]))} ${block[p.text] ?? ''}`;
  if (entry.node === 'h') return `${'#'.repeat(depth)} ${block[p.text] ?? ''}`; // relative
  if (entry.node === 'pre') return `\`\`\`${block[p.lang] ?? ''}${p.meta && block[p.meta] != null ? ` ${block[p.meta]}` : ''}\n${block[p.text] ?? ''}\n\`\`\``;
  if (entry.node === 'strong' && p.text) return `**${block[p.text] ?? ''}**`;
  if (entry.node === 'em' && p.text) return `*${block[p.text] ?? ''}*`;
  if (entry.node === 'dd' && p.text) return `${block[p.text] ?? ''}`; // a def-list value (emitFields adds the term)
  throw new Error(`cannot emit node ${entry.node}`);
}

/** Reverse a set of prototype refs against an object, into markdown nodes. */
function emitFields(proto, obj, depth) {
  const nodes = [];
  for (const [field, v] of Object.entries(proto.fields)) {
    const ref = parseRef(v);
    if (!ref) continue;
    const key = `${ref.label ?? ''}|${ref.node}[${ref.index ?? 1}]`;
    let entry = nodes.find((e) => e.key === key);
    if (!entry) { entry = { key, node: ref.node, label: ref.label, parts: {} }; nodes.push(entry); }
    if (ref.part !== null) entry.parts[ref.part] = field;
  }
  // An optional field that's absent (a grid with no headline) emits nothing; a
  // match-only node (no parts) always emits. A labelled entry re-emits its
  // `## Label` heading so the section round-trips.
  return nodes
    .filter((e) => { const ps = Object.values(e.parts); return ps.length === 0 || ps.some((f) => obj[f] !== undefined); })
    .map((e) => {
      const md = emitNode(obj, e, depth);
      if (e.label && e.node === 'dd') return `${e.label}\n: ${md}`; // def-list term
      return e.label ? `${'#'.repeat(depth)} ${e.label}\n\n${md}` : md; // heading section
    }).join('\n\n');
}

/** Non-default string fields, as an attribute string for a `<block>` tag. */
function emitOverrides(proto, block) {
  const out = [];
  const data = {}; // false booleans that are NOT "off == absent" — carried as data-json
  for (const [k, v] of Object.entries(block)) {
    if (k === '@type' || proto.regions.some((r) => r.name === k)) continue;
    const def = proto.fields[k];
    if (def !== undefined && parseRef(def)) continue; // a ref field is emitted inline, not as an attr
    if (def !== undefined && deepEqual(def, v)) continue; // matches default
    if (v === true) out.push(k); // HTML boolean; false is just absence
    else if (v === false) {
      // `fixed` is the template-slot marker: false is MEANINGFUL (the page
      // fills this slot), not "off == absent", and forced-layout validation
      // REQUIRES it stated — dropping it silently un-renders the block. An HTML
      // attr can't hold a false boolean, so carry it in data-json.
      if (MEANINGFUL_FALSE.has(k)) data[k] = v;
      continue;
    }
    else if (typeof v === 'number') out.push(`${k}=${v}`); // unquoted -> number
    else if (typeof v === 'string') out.push(`${k}="${v}"`);
    // objects can't be a clean attribute; verify-on-emit sends the block to tier-3
  }
  if (Object.keys(data).length) {
    const json = JSON.stringify(data).replace(/&/g, '&amp;').replace(/'/g, '&#39;');
    out.push(`data-json='${json}'`);
  }
  return out.length ? ` ${out.join(' ')}` : '';
}

// Boolean fields whose `false` is a stated fact, not the absence of a flag.
// `fixed: false` marks a template SLOT the page fills; forced-layout expansion
// requires it present, so it must survive emit even though other false booleans
// (an "off" toggle) are correctly dropped as absence.
const MEANINGFUL_FALSE = new Set(['fixed']);

/** Emit one repeating item: its ref'd nodes (at `depth`), then remainder blocks
 *  one level deeper. */
function emitItem(protos, itemProto, item, depth) {
  const fields = emitFields(itemProto, item, depth);
  // Same as a leaf: fields the captured refs don't carry (a slide's head_title,
  // flagAlign) spill into a `<fields>` tag rather than being dropped.
  const { blocks, blocks_layout, '@id': _id, ...scalar } = item;
  const extra = uncoveredFields(itemProto, scalar);
  const fieldsTag = Object.keys(extra).length ? `<fields ${fmtTagAttrs(extra)} />` : '';
  const rest = blocks ? emitBlocks(protos, blocks, depth + 1) : '';
  return [fields, fieldsTag, rest].filter(Boolean).join('\n\n');
}

/** Emit a greedy container BARE: its region items back to back, no `<block>`
 *  wrapper (a codeExample -> `### heading` + fence per tab). Only for
 *  isGreedyContainer protos; verify-on-emit falls back to the wrapped form if a
 *  neighbour would over-merge with it. */
function emitBareContainer(protos, proto, block, depth) {
  const region = proto.regions[0];
  return (block[region.name] ?? []).map((it) => emitItem(protos, region.protos[0], it, depth)).join('\n\n');
}

/** Emit a container block as a `<block type>` tag over its regions. */
const getPath = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);

function emitContainer(protos, proto, block, depth) {
  // A table-structured region (`table.rows`) emits a markdown table; if a cell
  // is too rich for one, renderTable returns null and verify-on-emit tier-3s it.
  const rowsRegion = proto.regions.find((r) => r.name.endsWith('rows'));
  if (rowsRegion) {
    const md = renderTable(getPath(block, rowsRegion.name));
    if (!md) throw new Error('table cell too rich for markdown'); // -> verify-on-emit fallback
    // Hoist the table's own true flags as dotted `table.celled` booleans; false
    // ones are semantic-ignored, so they need not be written.
    const tableObj = getPath(block, rowsRegion.name.split('.').slice(0, -1).join('.')) ?? {};
    const flags = Object.entries(tableObj).filter(([k, v]) => k !== 'rows' && v === true).map(([k]) => `table.${k}`);
    const attrs = [emitOverrides(proto, block).trim(), ...flags].filter(Boolean).join(' ');
    return `<block type="${block['@type']}"${attrs ? ` ${attrs}` : ''}>\n\n${md}\n\n</block>`;
  }
  const head = emitFields(proto, block, depth); // the container's own scalar refs (a grid headline)
  const body = proto.regions.map((region) => {
    const val = block[region.name];
    if (region.widget === 'blocks_layout') return emitBlocks([...protos, ...region.protos], val, depth + 1);
    return val.map((item) => emitItem(protos, region.protos[0], item, depth)).join('\n\n');
  }).join('\n\n');
  const inner = [head, body].filter(Boolean).join('\n\n');
  return `<block type="${block['@type']}"${emitOverrides(proto, block)}>\n\n${inner}\n\n</block>`;
}

/** Emit a leaf block by reversing its prototype's refs. */
function emitLeaf(protos, block, depth) {
  const leaves = protos.filter((p) => p.type === block['@type'] && isLeaf(p));
  // Prefer a prototype whose captured fields the block actually has, so a
  // caption-less image picks the 1-node prototype not the caption one. A
  // match-only ref (no /part) captures nothing, so it imposes no such need.
  const proto = leaves.find((p) => Object.entries(p.fields).every(([f, v]) => {
    const r = parseRef(v);
    return f === '_' || !r || r.part === null || block[f] !== undefined;
  })) ?? leaves[0];
  return emitFields(proto, block, depth);
}

/** Tier-3: an un-prototyped block -> a self-closing data tag (decodeRawTag reads it). */
function emitRawTag(block) {
  const { '@type': type, plaintext, ...rest } = block;
  for (const k of Object.keys(rest)) if (isEmptyObject(rest[k])) delete rest[k]; // drop no-op {} defaults (styles: {})
  const attrs = fmtTagAttrs(rest);
  return `<block type="${type}"${attrs ? ` ${attrs}` : ''} />`;
}

/**
 * Emit one block as markdown. A container (a type with regions) becomes a
 * `<block type>` tag over its regions; a leaf reverses its refs; a type with no
 * prototype falls back to a tier-3 data tag.
 */
function emitBlock(protos, block, depth) {
  const container = protos.find((p) => p.type === block['@type'] && p.regions.length);
  if (container) return emitContainer(protos, container, block, depth);
  if (protos.some((p) => p.type === block['@type'] && isLeaf(p))) return emitLeaf(protos, block, depth);
  return emitRawTag(block);
}

/** Wrap a block's bare markdown in an explicit `<block type>` tag. */
function emitTag(protos, block, depth) {
  return `<block type="${block['@type']}">\n\n${emitBlock(protos, block, depth)}\n\n</block>`;
}

/** Fields a leaf's clean form can't carry: not @type, not a ref (in the body),
 *  not a matching default. */
function uncoveredFields(proto, block) {
  const out = {};
  for (const [k, v] of Object.entries(block)) {
    if (k === '@type' || k === 'plaintext') continue;
    if (isEmptyObject(v)) continue; // a no-op default (e.g. styles: {}) parity drops -- don't emit it
    // a false boolean is "off" == absent (parity ignores it), like emitOverrides --
    // EXCEPT the ones whose false is a stated fact (`fixed`: a template slot).
    if (v === false && !MEANINGFUL_FALSE.has(k)) continue;
    const def = proto.fields[k];
    if (def !== undefined && parseRef(def)) continue; // emitted in the body
    if (def !== undefined && deepEqual(def, v)) continue; // default
    out[k] = v;
  }
  return out;
}

/** A leaf's clean body plus a `<fields>` tag for whatever it can't carry --
 *  the verify-on-emit rung before tier-3. Null if there's nothing to hoist. */
function emitFieldsTag(protos, block, depth) {
  const proto = protos.find((p) => p.type === block['@type'] && isLeaf(p));
  if (!proto) return null;
  const extra = uncoveredFields(proto, block);
  if (!Object.keys(extra).length) return null;
  return `<block type="${block['@type']}">\n\n${emitLeaf(protos, block, depth)}\n\n<fields ${fmtTagAttrs(extra)} />\n\n</block>`;
}

/**
 * A resolved link summary -- an object-browser value whose only authored part is
 * `@id`; the target's brain (`Title`, `Description`, `hasPreviewImage`, ...) is
 * resolved in at read time. The markdown owns the `@id`; the API restores the
 * rest. So verify-on-emit compares links on the target alone.
 */
const LINK_KEYS = new Set(['@id', '@type', 'title', 'Title', 'description', 'Description',
  'hasPreviewImage', 'getRemoteUrl', 'head_title', 'image_field', 'image_scales', 'review_state']);
// A link value carries an `@id` and NOTHING BUT resolved-summary keys -- so both
// the clean form ({@id, title}) and the stored brain ({@id, Title, ...}) reduce
// to the same {@id}, symmetrically. An object-browser reference also carries an
// `@type` (its target is `Document`/`Image`/…), and the resolved Image brain has
// many keys (getObjSize, mime_type, …) too varied to allow-list -- so `@id`+
// `@type` is itself the tell. A content ITEM (a slide/panel/tab) has its `@id`
// stripped before comparison and never an `@type`, so it is never collapsed.
const isLinkSummary = (o) => o && typeof o === 'object' && !Array.isArray(o)
  && '@id' in o && ('@type' in o || Object.keys(o).every((k) => LINK_KEYS.has(k)));

/**
 * Comparison view for verify-on-emit: drop what is derived or default-nothing --
 * `plaintext`, empty text leaves, empty objects (`styles:{}`, `credit:{}`), and
 * the resolved half of a link summary -- so a clean form that omits them still
 * counts as reproducing the block. Matches the parity harness's normalisation.
 */
/** Adjacent bare-text leaves are ONE leaf in Slate (it merges same-property text
 *  on normalise), so a serialise/reparse that splits or joins them differently --
 *  e.g. an inline HTML comment left as its own leaf -- is still the same value. */
function mergeTextLeaves(items) {
  const bare = (x) => x && typeof x === 'object' && Object.keys(x).length === 1 && typeof x.text === 'string';
  const out = [];
  for (const item of items) {
    if (bare(item) && bare(out[out.length - 1])) out[out.length - 1] = { text: out[out.length - 1].text + item.text };
    else out.push(item);
  }
  return out;
}

function semantic(v) {
  if (Array.isArray(v)) return mergeTextLeaves(v.map(semantic).filter((x) => x !== undefined));
  if (isLinkSummary(v)) return { '@id': v['@id'] };
  if (v && typeof v === 'object') {
    const keys = Object.keys(v);
    if (keys.length === 1 && keys[0] === 'text' && v.text === '') return undefined;
    const out = {};
    for (const k of keys.sort()) {
      if (k === 'plaintext' || k === 'key') continue; // derived / internal identity
      if (v[k] === false) continue; // a false boolean is "off" -- nothing
      const r = semantic(v[k]);
      if (r === undefined) continue;
      if (r && typeof r === 'object' && !Array.isArray(r) && !Object.keys(r).length) continue;
      out[k] = r;
    }
    return out;
  }
  return v;
}
export const semanticEqual = (a, b) => JSON.stringify(semantic(a)) === JSON.stringify(semantic(b));

/** A field whose value is `{}` — a no-op default (styles: {}) that carries no
 *  data; parity drops it, so the emitter never needs to write it. */
function isEmptyObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0;
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => deepEqual(a[k], b[k]));
}

const roundTrips = (protos, md, expected, depth) => {
  try { return semanticEqual(matchBlocks(protos, md, depth), expected); } catch { return false; }
};

/**
 * Emit an ordered block list as markdown, verifying on emit: each block is
 * written in its lightest form that still lets the sequence so far decode back
 * to exactly those blocks. The fallback chain is bare -> light `<block>` tag
 * (breaks an over-merge with a neighbour) -> tier-3 data tag. The last always
 * round-trips (decodeRawTag reads the full data), so emit can never lose a
 * block -- a field the clean form can't carry just lands in a data tag.
 */
function emitSegments(prototypes, blocks, depth = 2) {
  const parts = [];
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    const expected = blocks.slice(0, i + 1);
    const containerProto = prototypes.find((p) => p.type === block['@type'] && p.regions.length);
    // A container is already a tag, so light-wrapping it would double-nest. A
    // greedy container also gets a BARE candidate first (its items, no wrapper);
    // verify-on-emit falls back to the wrapped form on an over-merge. Candidates
    // are lazy -- a form that can't be produced (a table cell too rich for
    // markdown) throws and is skipped.
    const gens = containerProto
      ? (isGreedyContainer(containerProto)
        ? [() => emitBareContainer(prototypes, containerProto, block, depth),
           () => emitBlock(prototypes, block, depth), () => emitRawTag(block)]
        : [() => emitBlock(prototypes, block, depth), () => emitRawTag(block)])
      : [() => emitBlock(prototypes, block, depth), () => emitTag(prototypes, block, depth),
         () => emitFieldsTag(prototypes, block, depth), () => emitRawTag(block)];
    let chosen = null;
    for (const gen of gens) {
      let c; try { c = gen(); } catch { continue; }
      if (c != null && roundTrips(prototypes, [...parts, c].join('\n\n'), expected, depth)) { chosen = c; break; }
    }
    parts.push(chosen ?? emitRawTag(block));
  }
  return parts;
}

/** Emit a block list as one markdown string (per-block segments, joined). */
export function emitBlocks(prototypes, blocks, depth = 2) {
  return emitSegments(prototypes, blocks, depth).join('\n\n');
}

/**
 * Reverse of `keyBlocks`: read a keyed page back into the ordered block list
 * `emitBlocks` takes, collecting uids/@ids into an assignments list in the same
 * depth-first order `keyBlocks` consumes. Region kinds come from the prototypes
 * (an object_list region's items get `@id`s even when they carry no child
 * blocks, e.g. codeExample tabs). The input is not mutated.
 */
/** Every block prototype, top-level AND nested inside a region (a container item
 *  proto — e.g. `column` inside `columns` — is not top-level, but key/unkey must
 *  still find its regions when recursing into it). */
function collectProtos(protos, out = []) {
  for (const p of protos) {
    out.push(p);
    for (const region of p.regions ?? []) collectProtos(region.protos ?? [], out);
  }
  return out;
}

export function unkeyBlocks(keyed, protos = []) {
  const flat = collectProtos(protos);
  const regionsOf = (type) => flat.find((p) => p.type === type)?.regions ?? [];
  const assignments = [];
  // A blocks_layout region's children live in the shared `blocks` dict, ORDERED
  // by `blocks_layout[layoutKey]` -- and the region's NAME is that layout key
  // (gridBlock -> `items`, columns -> `columns`), exactly as the schema names its
  // blocks field. The page itself is the `items` region of the top level.
  const unkeyChildren = ({ blocks, blocks_layout }, layoutKey = 'items') =>
    (blocks_layout?.[layoutKey] ?? []).map((uid) => {
      const block = { ...blocks[uid] };
      assignments.push({ uid });
      unkeyRegions(block);
      return block;
    });
  const unkeyRegions = (block) => {
    let liftedBlocksLayout = false;
    for (const region of regionsOf(block['@type'])) {
      if (region.widget === 'blocks_layout') {
        if (block.blocks && block.blocks_layout?.[region.name]) {
          block[region.name] = unkeyChildren(
            { blocks: block.blocks, blocks_layout: block.blocks_layout }, region.name,
          );
          liftedBlocksLayout = true;
        }
        continue;
      }
      const val = block[region.name]; // object_list items are a bare array field
      if (!Array.isArray(val)) continue;
      const idKey = region.idField ?? '@id';
      block[region.name] = val.map((item) => {
        assignments.push({ id: item[idKey] });
        const { [idKey]: _id, blocks_layout: _bl, blocks: kids, ...rest } = item;
        return kids ? { ...rest, blocks: unkeyChildren({ blocks: kids, blocks_layout: _bl }) } : rest;
      });
    }
    // Only drop the shared dict + layout when a declared region actually lifted
    // them into per-region arrays. A block with NO blocks_layout region (a tier-3
    // block that carries its own `blocks`/`blocks_layout`, e.g. `search`) keeps
    // them so its raw `data-json` round-trips intact.
    if (liftedBlocksLayout) {
      delete block.blocks;
      delete block.blocks_layout;
    }
  };
  return { blocks: unkeyChildren(keyed), assignments };
}

/**
 * Emit a keyed page to a clean markdown body plus its frontmatter assignments,
 * read straight from the keyed shape.
 */
/** Deep-equal for field values (content is plain JSON). */
const fieldEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Fields (own key, deep-equal value) shared by EVERY block in the list, minus
 *  `@type`/`plaintext` and no-op empty-object defaults (`styles: {}`) -- hoisting
 *  those just wraps blocks in a `<fields data-json='{"styles":{}}'>` for nothing. */
function sharedByAll(blocks) {
  if (blocks.length < 2) return {};
  const [first, ...rest] = blocks;
  const shared = {};
  for (const [k, v] of Object.entries(first)) {
    if (k === '@type' || k === 'plaintext' || isEmptyObject(v)) continue;
    if (rest.every((b) => k in b && fieldEq(b[k], v))) shared[k] = v;
  }
  return shared;
}

const stripKeys = (block, keys) => {
  const out = { ...block };
  for (const k of keys) delete out[k];
  return out;
};

/** Longest prefix length whose blocks share ≥1 field (≥2), else 1. */
function sharedRunLen(blocks) {
  let k = blocks.length;
  while (k >= 2 && !Object.keys(sharedByAll(blocks.slice(0, k))).length) k -= 1;
  return k;
}

/**
 * Plan how a block list nests into `<fields>` wrappers: fields shared by ALL
 * blocks become an outer wrapper; the remainder splits into maximal contiguous
 * runs that share a field, each its own wrapper; singletons stay loose. Returns
 * nodes of {wrap:true, fields, children} | {wrap:false, idx}; blocks ride as
 * {block, idx} so leaves keep their position in the original list.
 */
function planHoist(items) {
  if (!items.length) return [];
  const outer = sharedByAll(items.map((x) => x.block));
  const keys = Object.keys(outer);
  if (keys.length) {
    const stripped = items.map((x) => ({ block: stripKeys(x.block, keys), idx: x.idx }));
    return [{ wrap: true, fields: outer, children: planHoist(stripped) }];
  }
  const len = sharedRunLen(items.map((x) => x.block));
  if (len >= 2) return [...planHoist(items.slice(0, len)), ...planHoist(items.slice(len))];
  return [{ wrap: false, idx: items[0].idx }, ...planHoist(items.slice(1))];
}

/**
 * Factor fields shared across runs into nested `<fields …>` wrappers. The blocks
 * are emitted ONCE through the full verify-on-emit (so each gets a merge-safe
 * form in sequence context), then the wrappers are assembled around those
 * segments -- inserting a `<fields>` tag only ever adds a boundary, so it can
 * never introduce a new over-merge. `emitPage` re-checks the whole result.
 */
function hoistFields(protos, blocks, depth = 2) {
  if (!blocks.length) return '';
  const plan = planHoist(blocks.map((block, idx) => ({ block, idx })));
  const hoisted = {}; // idx -> the field keys hoisted into wrappers that contain it
  const collect = (nodes, keys) => nodes.forEach((n) =>
    n.wrap ? collect(n.children, keys.concat(Object.keys(n.fields))) : (hoisted[n.idx] = keys));
  collect(plan, []);
  const stripped = blocks.map((b, i) => stripKeys(b, hoisted[i] ?? []));
  const segments = emitSegments(protos, stripped, depth);
  const render = (nodes) => nodes.map((n) => n.wrap
    ? `<fields ${fmtTagAttrs(n.fields)}>\n\n${render(n.children)}\n\n</fields>`
    : segments[n.idx]).join('\n\n');
  return render(plan);
}

export function emitPage(prototypes, keyed) {
  const { blocks, assignments } = unkeyBlocks(keyed, prototypes);
  let markdown = emitBlocks(prototypes, blocks);
  // Prefer the hoisted form, but only if it still round-trips to the same blocks
  // (page-level verify-on-emit); otherwise keep the flat emission.
  try {
    const hoisted = hoistFields(prototypes, blocks);
    if (hoisted && roundTrips(prototypes, hoisted, blocks, 2)) markdown = hoisted;
  } catch { /* keep flat */ }
  return { markdown, assignments };
}

// ------------------------------------------------------------- uid keying ----

/**
 * Key a matched block tree into stored shape from an ordered assignments list,
 * consumed depth-first (pre-order): a block's uid, then each object_list item's
 * `@id`, then that item's child blocks. Region kinds come from the prototypes.
 * Assignments are `{uid, type}` for a block (the `type` anchors the positional
 * bind) and `{id}` for an object_list item. Blocks are mutated in place.
 */
export function keyBlocks(blocks, assignments, protos = []) {
  const flat = collectProtos(protos);
  const regionsOf = (type) => flat.find((p) => p.type === type)?.regions ?? [];
  let i = 0;
  const next = () => {
    if (i >= assignments.length) throw new Error('ran out of assignments');
    return assignments[i++];
  };

  // With no assignments (the frozen markdown-as-source path) a block uid is a
  // pure per-load internal identity: nothing outside a single served response
  // references it (tests key on @type + page-UID; the incremental sync
  // normalizes block uids out of change detection). So mint fresh ids in
  // traversal order rather than reading them. The `@type` prefix keeps them
  // legible in the DOM / `data-block-uid`.
  const mint = assignments.length === 0;
  let n = 0;
  const mintUid = (type) => `${type}-${++n}`;
  const mintId = () => `i-${++n}`;

  // Key an ordered list of blocks into { dict, uids }, recursing into each block's
  // regions. Used for the page's top-level `items` and for object_list items.
  const keyChildren = (list) => {
    const dict = {}, uids = [];
    for (const block of list) {
      const a = mint ? { uid: mintUid(block['@type']) } : next();
      // `type` is optional: our content derives it from the prototype match, so
      // assignments carry only the uid. When present it stays an anchor check.
      if (a.type !== undefined && a.type !== block['@type']) {
        throw new Error(`assignment ${a.uid} type "${a.type}" does not anchor block type "${block['@type']}"`);
      }
      keyRegions(block);
      dict[a.uid] = block;
      uids.push(a.uid);
    }
    return { dict, uids };
  };
  // Convert a block's engine-shape regions (block[regionName] = ordered array)
  // into the stored shape: ONE shared `blocks` dict + `blocks_layout` keyed by
  // each region's name (the layout key). object_list fields stay bare arrays.
  const keyRegions = (block) => {
    const dict = {}, layout = {};
    for (const region of regionsOf(block['@type'])) {
      const val = block[region.name];
      if (region.widget === 'blocks_layout') {
        if (Array.isArray(val)) {
          const k = keyChildren(val);
          Object.assign(dict, k.dict);
          layout[region.name] = k.uids;
          delete block[region.name];
        }
        continue;
      }
      if (!Array.isArray(val)) continue; // object_list
      const idKey = region.idField ?? '@id';
      for (const item of val) {
        const ia = mint ? { id: mintId() } : next();
        if (!ia.id) throw new Error(`expected an item @id assignment, got ${JSON.stringify(ia)}`);
        item[idKey] = ia.id;
        if (Array.isArray(item.blocks)) { const k = keyChildren(item.blocks); item.blocks = k.dict; item.blocks_layout = { items: k.uids }; }
      }
    }
    if (Object.keys(dict).length) { block.blocks = dict; block.blocks_layout = layout; }
  };

  const top = keyChildren(blocks);
  if (i !== assignments.length) throw new Error(`${assignments.length - i} assignments left over`);
  return { blocks: top.dict, blocks_layout: { items: top.uids } };
}
