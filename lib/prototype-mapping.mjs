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
import { getAtPath, ensureMutablePath } from '../packages/helpers/index.js';
import { tagOf, mdParser, mdSerializer, blockToSlate, slateToMd, fmtTagAttrs, cleanAttrStr, normaliseTables, tableToMd, slateBlockToMdast, isBrTag,
         mdastToHtml, htmlToMd, htmlRichtext, isFlatDict, flatDictAttrs } from './slate-md.mjs';

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
// `:` is in the key charset so a dict field's `field:key=value` attribute (and a
// key that itself contains a colon, `styles:size:noprefix`) is one token.
const ATTR_RE = /([\w@.$:-]+)(?:=(?:"([^"]*)"|'([^']*)'|(\S+)))?/g;
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
  // Fold a dict field's `field:key` attributes back into a nested object, split
  // on the FIRST colon (everything after is the key, colons and all). The mirror
  // of flatDictAttrs on emit; a bare attribute name never contains a colon, so
  // only namespaced dict entries fold. The field sits where its first entry was
  // written, so a re-emit keeps the authored order.
  const folded = {};
  for (const [k, v] of Object.entries(out)) {
    const i = k.indexOf(':');
    if (i === -1) { folded[k] = v; continue; }
    (folded[k.slice(0, i)] ??= {})[k.slice(i + 1)] = v;
  }
  return folded;
}

/**
 * Canonical node kind, in HTML vocabulary so refs read as `p`/`hr`/`img`/`td`
 * rather than mdast's internal names. A heading carries its level (`h2`).
 */
const HTML_KIND = {
  paragraph: 'p', image: 'img', thematicBreak: 'hr', code: 'pre',
  table: 'table', tableRow: 'tr', tableHeaderCell: 'th', tableCell: 'td', link: 'a',
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
/**
 * An object_list region's typeField, once its item types are known. With ONE
 * item type there is nothing to tell apart, so an omitted typeField means null:
 * the items store no type field and editors type them by their container
 * (table rows are `slateTable:rows`). With several, the stored type is the only
 * thing that says which each item is, so it must be declared.
 */
function settleTypeField(region) {
  if (region.widget === 'blocks_layout' || region.typeField !== undefined) return;
  if (region.protos.length > 1) {
    const types = region.protos.map((p) => p.type).join(', ');
    throw new Error(`object_list region "${region.name}" of <block type="${region.owner}"> allows ${region.protos.length} item types (${types}), so it must declare typeField`);
  }
  region.typeField = null;
}

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
      // A value that starts a ref must BE one: a typo'd ref would otherwise be
      // a literal, silently stamped onto every block this prototype decodes.
      for (const [k, v] of Object.entries(fields)) {
        if (typeof v === 'string' && v.trim().startsWith('${') && !parseRef(v)) {
          throw new Error(`<block type="${type}"> ${k}="${v}" is not a valid ref`);
        }
      }
      const proto = { type, explicit, fields, regions: [] };
      if (tag.kind === 'close') { stack.pop(); continue; }
      place(proto);
      if (tag.kind === 'open') stack.push({ kind: 'block', proto });
    } else if (tag.name === 'region') {
      if (tag.kind === 'close') { settleTypeField(stack.pop().region); continue; }
      const t = top();
      if (!t || t.kind !== 'block') throw new Error('region outside a block');
      // idField/typeField are the object_list item's identity/type keys, named
      // on the region because decode is schema-free (there's no blocksConfig to
      // read them from). idField has no default: an unstated one once minted
      // table ids into `@id` while frontends read `key`, and every table
      // rendered its last cell. typeField is settled when the region closes
      // (settleTypeField), once its item types are known.
      if (attrs.widget !== 'blocks_layout' && !attrs.idField) {
        throw new Error(`object_list region "${attrs.name}" of <block type="${t.proto.type}"> must declare idField`);
      }
      // `path` is the field path the region's value lives at: a region may be
      // nested in an object field (slateTable's `table.rows`).
      const region = { name: attrs.name, path: attrs.name.split('.'), widget: attrs.widget, protos: [],
                       idField: attrs.idField, typeField: attrs.typeField, owner: t.proto.type };
      t.proto.regions.push(region);
      if (tag.kind === 'open') stack.push({ kind: 'region', region });
      else settleTypeField(region);
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
  const need = new Map(); // node-set string -> { count, optional }
  for (const v of Object.values(proto.fields)) {
    const r = parseRef(v); // includes match-only refs (no /part)
    if (!r) continue;
    // A NODE is optional only if EVERY ref to it is optional -- `url="${img/src}"`
    // makes the img node required even though `alt="${img?/alt}"` is optional.
    const cur = need.get(r.node) ?? { count: 0, optional: true };
    cur.count = Math.max(cur.count, r.index ?? 1);
    cur.optional = cur.optional && !!r.optional;
    need.set(r.node, cur);
  }
  const slots = [];
  for (const [nodeSet, { count, optional }] of need) {
    for (let i = 0; i < count; i += 1) slots.push({ kinds: nodeSet.split(/[|,]/), optional });
  }
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
const specificity = (slots) => slots.filter((s) => !s.kinds.includes('*')).length;

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
  && slotsOf(p.regions[0].protos[0]).filter((s) => !s.optional).length >= 2;
const isLeaf = (p) => !p.regions?.length && slotsOf(p).length > 0;

// ------------------------------------------------------------------ nodes ----

/**
 * Top-level mdast nodes, normalised: a paragraph whose only child is an image
 * becomes an image node (a standalone image is its own block). Links stay
 * inline and are reached by path navigation.
 */
function topNodes(markdown) {
  return normaliseTables(mdParser.parse(markdown)).children.map((n) => {
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

/**
 * A node's plain text, for a string field.
 *
 * A line break comes back as "\n" whichever way it was written — a hard break,
 * <br>, or a plain newline, which remark leaves inside the text value. For a
 * string field that is right on all three counts: a textarea's stored value has
 * no wrapping, so every newline in it is the author's own line. (Slate differs:
 * there a plain newline is wrapping, and reads as a space — see inlineToSlate.)
 * A hard break used to come back as "", since a `break` node has neither value
 * nor children, and <br> as the literal text "<br>".
 */
const nodeText = (node) => {
  if (node.type === 'break') return '\n';
  if (node.type === 'html' && isBrTag(node.value)) return '\n';
  return node.value !== undefined ? node.value : (node.children || []).map(nodeText).join('');
};

/**
 * A string field's value as inline mdast: text, with each line break a
 * `break` node — which the serializer writes as a trailing backslash,
 * CommonMark's visible hard break. A plain newline would read back the same,
 * but is indistinguishable from wrapping to anyone editing the file; two
 * trailing spaces are invisible, and editors strip them.
 */
const textNodes = (value) => String(value ?? '').split('\n')
  .flatMap((line, i) => (i ? [{ type: 'break' }] : []).concat(line ? [{ type: 'text', value: line }] : []));

/** Markdown for block-level mdast nodes, escaped by the serializer. */
const mdOf = (...nodes) => mdSerializer.stringify({ type: 'root', children: nodes }).trim();

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

/** A node's slate value. A table cell holds block nodes (normaliseTables), so
 *  its value is theirs; a lone strong/em is rebuilt into the paragraph it was
 *  lifted from. */
const isCell = (node) => kindOf(node) === 'td' || kindOf(node) === 'th';
const slateValue = (node) => (isCell(node) ? node.children.flatMap((c) => blockToSlate(c)) : blockToSlate(
  (node.type === 'strong' || node.type === 'emphasis') ? { type: 'paragraph', children: [node] }
    : node));

/** An accessor's empty value: what a field it reads holds when the block is
 *  written as an empty `<block>` tag. `/slate`'s is the empty paragraph an
 *  editor starts with. An accessor with no empty value can't be empty. */
const EMPTY_PART = { slate: () => [{ type: 'p', children: [{ text: '' }] }], text: () => '' };

/** A leaf block from an EMPTY body: literals as declared, each field the
 *  prototype reads through an accessor at that accessor's empty value, an
 *  optional one without an empty value left out. Null if a required field's
 *  accessor has no empty value. */
function emptyLeafBlock(proto) {
  const block = { '@type': proto.type };
  for (const [field, val] of Object.entries(proto.fields)) {
    const ref = parseRef(val);
    if (!ref) { block[field] = val; continue; }
    if (field === '_' || ref.part === null) { if (ref.optional) continue; return null; }
    const empty = EMPTY_PART[ref.part];
    if (!empty) { if (ref.optional) continue; return null; }
    const v = empty();
    if (v !== '') block[field] = v; // an empty string is an absent field, as in leafBlock
  }
  return block;
}

function resolvePart(node, ref) {
  switch (ref.part) {
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
      if (u === null) { if (ref.optional) return null; throw new Error(`no link url in ${kindOf(node)}`); }
      return [{ '@id': u }];
    }
    // A link whose url is stored as a PLAIN STRING field (not the `[{'@id'}]`
    // widget) — e.g. a maps embed url. Lets `[text](url)` carry a long url in
    // link syntax instead of a data-json attr.
    case 'href': {
      const u = findUrl(node);
      if (u === null) { if (ref.optional) return null; throw new Error(`no link url in ${kindOf(node)}`); }
      return u;
    }
    case 'title': return findTitle(node); // `![a](u "title")` / `[t](u "title")` -> a caption/tooltip
    case 'meta': return node.meta ?? null; // a code fence's info-string after the lang
    default: throw new Error(`unhandled ref part: ${ref.part}`);
  }
}

// ----------------------------------------------------------- leaf matching ---

/** Can every node in `run` map to a DISTINCT slot it fits, with every REQUIRED
 *  slot covered? Optional slots may go unfilled (their node was absent). A tiny
 *  backtracking assignment -- runs and slot lists are a handful of items. */
function coverRun(run, slots, depth) {
  const assign = (ni, usedSlots) => {
    if (ni === run.length) {
      // Every node placed; the run is valid iff no REQUIRED slot was left empty.
      return slots.every((s, si) => s.optional || usedSlots.has(si));
    }
    for (let si = 0; si < slots.length; si += 1) {
      if (usedSlots.has(si) || !nodeInSlot(run[ni], slots[si].kinds, depth)) continue;
      usedSlots.add(si);
      if (assign(ni + 1, usedSlots)) return true;
      usedSlots.delete(si);
    }
    return false;
  };
  return assign(0, new Set());
}

/** The run of nodes at `i` a prototype's slots consume: MAXIMAL MUNCH -- the
 *  largest contiguous run (up to one node per slot) that covers every required
 *  slot, so a present optional node (a caption, a kicker) is taken when there.
 *  Absent optionals just shrink the run. Null if the required slots can't fill. */
function runAt(nodes, i, slots, depth) {
  const required = slots.filter((s) => !s.optional).length;
  const max = Math.min(slots.length, nodes.length - i);
  for (let size = max; size >= Math.max(required, 1); size -= 1) {
    const run = nodes.slice(i, i + size);
    if (coverRun(run, slots, depth)) return run;
  }
  return null;
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
    // An optional NODE may be absent from the run entirely (resolveRef throws);
    // an optional PART may resolve to null. Either way `?` tolerates it.
    try { v = resolveRef(run, ref, depth); } catch { if (ref.optional) continue; return false; }
    if (v === null && !ref.optional) return false;
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
    if (ref) {
      let v;
      // An absent optional node -> the field is simply omitted (same as an
      // optional part that resolved to nothing).
      try { v = resolveRef(run, ref, depth); } catch (e) { if (ref.optional) continue; throw e; }
      if (v != null && v !== '') block[field] = v;
    } else block[field] = val;
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
/**
 * For each node: is it inside a nested `<block>…</block>`? (Its own open and
 * close tags count as inside.) An item's body is a flat run of nodes, so a
 * heading or `<fields>` tag that belongs to a nested block would otherwise be
 * read as the item's own — a new item's delimiter, or the item's fields.
 */
function nestedFlags(nodes) {
  let d = 0;
  return nodes.map((n) => {
    const tag = n.type === 'html' ? tagOf(n.value) : null;
    if (tag && tag.name === 'block' && tag.kind === 'open') { d += 1; return true; }
    if (tag && tag.name === 'block' && tag.kind === 'close') { d -= 1; return true; }
    return d > 0;
  });
}

function splitAt(nodes, delim, depth) {
  const isDelim = (n) => (delim === 'h' ? kindOf(n) === `h${depth}` : kindOf(n) === delim);
  const nested = nestedFlags(nodes);
  const groups = [];
  for (const [i, n] of nodes.entries()) {
    if (!nested[i] && isDelim(n)) groups.push([n]);
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
    if (field === '_' || ref.part === null) continue;
    const v = resolvePart(node, ref);
    if (v != null) result[field] = v; // an optional part that isn't there (a button with no link)
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
  for (const region of item.regions || []) setAt(result, region.path, decodeRegion(protos, region, [node], depth));
  return result;
}

function decodeRegion(protos, region, inner, depth) {
  if (region.widget === 'blocks_layout') { // a plain block sequence one level
    return matchNodes([...protos, ...region.protos], inner, depth + 1); // deeper, with scoped protos
  }
  const item = region.protos[0];
  // An object_list item carries its @type (the CMS shape a data-json instance
  // has), keyed by the region's `typeField` (default `@type`; a region can name
  // another, e.g. a form field's `field_type`). unkeyBlocks strips it on emit.
  const typeKey = region.typeField;
  // typeField null (omitted, one item type): the items store no type field — each has the single shape
  // the container's schema defines, and editors type it by its container
  // (Volto's table rows `{key, cells}`, cells `{key, type, value}`, typed
  // `slateTable:rows` / `slateTable:rows:cells`). Stamping `@type: "row"` there
  // would add a second, unregistered name.
  const typed = (proto, obj) => (typeKey === null ? obj : { [typeKey]: proto.type, ...obj });
  if (inner.length === 1 && STRUCTURAL.has(kindOf(inner[0]))) { // iterate-children (a table's rows, a row's cells)
    // Each child is the item whose prototype names its node kind: a `${tr}` row,
    // a `${th/…}` header cell or a `${td/…}` data cell.
    return inner[0].children.map((child) => {
      const proto = region.protos.find((p) => slotsOf(p).some((s) => nodeInSlot(child, s.kinds, depth)));
      if (!proto) throw new Error(`region "${region.name}" has no item prototype for a ${kindOf(child)}`);
      return typed(proto, decodeItemNode(protos, proto, child, depth));
    });
  }
  const delim = delimiterOf(item); // object_list: delimiter at `depth`, content one deeper
  return splitAt(inner, delim, depth).map((group) => typed(item, decodeItem(protos, item, group, depth)));
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
  const nested = nestedFlags(nodes); // a nested block's own <fields> stay with it
  for (const [i, n] of nodes.entries()) {
    const tag = !nested[i] && n.type === 'html' ? tagOf(n.value) : null;
    if (tag && tag.name === 'fields') {
      const { 'data-json': data, ...attrs } = typedAttrs(n.value);
      Object.assign(fields, attrs);
      if (data) Object.assign(fields, JSON.parse(data));
    } else rest.push(n);
  }
  return { fields, rest };
}

/** Set a value at a field path (shared helper; copies each object on the way). */
const setAt = (obj, path, value) => { ensureMutablePath(obj, path.slice(0, -1))[path.at(-1)] = value; };

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
    for (const [k, v] of Object.entries(container.fields)) if (!parseRef(v)) setAt(block, k.split('.'), v);
    for (const [k, v] of Object.entries(override)) setAt(block, k.split('.'), v); // dotted (table.celled) supported
    // Consume the container's own scalar refs from the body front (a grid
    // `headline="${h}"`), optionally -- absent leading heading = no headline --
    // then the region gets the remainder.
    const consumed = new Set();
    // The container's own nodes: one inside a nested `<block>` belongs to that
    // block, so a container ref (a grid's headline) never takes it.
    const nested = nestedFlags(inner);
    const own = inner.filter((_, i) => !nested[i]);
    for (const [field, val] of Object.entries(container.fields)) {
      const ref = parseRef(val);
      if (!ref || ref.part === null || field === '_') continue;
      // `${dd[Author]}` reads a def-list term (its `dl` is consumed whole).
      if (ref.label && ref.node === 'dd') {
        const t = termValue(own, ref.label);
        if (t) { consumed.add(t.dl); if (t.dd) block[field] = resolvePart(t.dd, ref); }
        continue;
      }
      // `[label]` scopes to that heading's section; `[n]`/none picks by position.
      const sect = ref.label ? sectionUnder(own, ref.label) : null;
      const pool = ref.label ? (sect?.body ?? []) : own;
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
      setAt(block, region.path, decodeRegion(protos, region, content, depth));
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
  // An empty body: the block is there, its accessor-read fields empty.
  if (!content.length) {
    for (const { p: proto } of leaves) {
      const block = emptyLeafBlock(proto);
      if (block) return finish(block);
    }
  }
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
      const typeKey = region.typeField;
      const block = { '@type': p.type, [region.name]: groups.map((g) => (typeKey === null ? decodeItem(protos, item, g, depth) : { [typeKey]: item.type, ...decodeItem(protos, item, g, depth) })) };
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
          for (const [k, v] of Object.entries(shared)) if (!(k in block)) setAt(block, k.split('.'), v);
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
export function decodePage(md, { ignoreAssignments = false } = {}) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(md);
  if (!m) throw new Error('page has no frontmatter');
  const {
    'blocks-assignments': ba, 'blocks-matched': bm, 'blocks-tagged': bt,
    assignments: oldA, prototypes: oldP, ...metadata
  } = YAML.parse(m[1]) ?? {};
  // `blocks-matched:` are the implicit (auto-matched) prototypes; `blocks-tagged:`
  // are explicit (tag-only). Section membership is the explicit flag. Old
  // `prototypes:`/`assignments:` keys are still accepted.
  // `ignoreAssignments` decodes only the body's own blocks (no template
  // assignments injected) — a `{literalinclude} … :as: json` self-slice wants
  // the one sliced block with the page's prototypes, not the page's full layout.
  const assignments = ignoreAssignments ? [] : (ba ?? oldA ?? []);
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
  // Every other node is built as mdast and written by the serializer, so text
  // with markdown punctuation in it (a `code` span in an alt, a `*`) is escaped.
  const title = p.title && block[p.title] != null ? block[p.title] : null; // `![a](u "title")` / `[t](u "title")`
  const text = (f) => textNodes(f ? block[f] : '');
  const para = (...children) => ({ type: 'paragraph', children });
  const heading = (children) => ({ type: 'heading', depth: /^h[1-6]$/.test(entry.node) ? Number(entry.node[1]) : depth, children });
  const image = (url) => ({ type: 'image', url, title, alt: p.alt && block[p.alt] != null ? block[p.alt] : '' });
  // A link widget: `[text](url)`, in a paragraph or wrapped by a heading; an
  // image with a link-form url renders `![alt](url)`.
  // An optional link that's absent (a button with text but no target yet)
  // leaves the node as its text.
  const linkField = p.link ?? p.href;
  if (linkField && block[linkField] != null) {
    // `href` is a plain-string url field; `link` is the `[{'@id'}]` widget.
    const url = p.link ? linkUrl(block[p.link]) : block[p.href];
    if (entry.node === 'img') return mdOf(para(image(url)));
    const link = { type: 'link', url, title, children: text(p.text) };
    return mdOf(/^h/.test(entry.node) ? heading([link]) : para(link));
  }
  if (entry.node === 'img') return mdOf(para(image(block[p.src])));
  if (entry.node === 'hr') return mdOf({ type: 'thematicBreak' });
  if (/^h([1-6])?$/.test(entry.node)) return mdOf(heading(text(p.text)));
  if (entry.node === 'pre') {
    return mdOf({ type: 'code', lang: block[p.lang] ?? null, meta: p.meta && block[p.meta] != null ? block[p.meta] : null, value: block[p.text] ?? '' });
  }
  if (entry.node === 'strong' && p.text) return mdOf(para({ type: 'strong', children: text(p.text) }));
  if (entry.node === 'em' && p.text) return mdOf(para({ type: 'emphasis', children: text(p.text) }));
  if ((entry.node === 'p' || entry.node === 'dd') && p.text) return mdOf(para(...text(p.text))); // a dd: emitFields adds the term
  throw new Error(`cannot emit node ${entry.node}`);
}

/** Reverse a set of prototype refs against an object, into markdown nodes. */
function emitFields(proto, obj, depth) {
  const nodes = [];
  for (const [field, v] of Object.entries(proto.fields)) {
    const ref = parseRef(v);
    if (!ref) continue;
    const slot = `${ref.label ?? ''}|${ref.node}[${ref.index ?? 1}]`;
    let entry = nodes.find((e) => e.slot === slot);
    if (!entry) { entry = { slot, node: ref.node, label: ref.label, parts: {} }; nodes.push(entry); }
    if (ref.part !== null) entry.parts[ref.part] = field;
  }
  // An optional field that's absent (a grid with no headline) emits nothing; a
  // match-only node (no parts) always emits. A labelled entry re-emits its
  // `## Label` heading so the section round-trips.
  return nodes
    .filter((e) => { const ps = Object.values(e.parts); return ps.length === 0 || ps.some((f) => obj[f] != null && obj[f] !== ''); })
    .map((e) => {
      const md = emitNode(obj, e, depth);
      if (e.label && e.node === 'dd') return `${e.label}\n: ${md}`; // def-list term
      return e.label ? `${'#'.repeat(depth)} ${e.label}\n\n${md}` : md; // heading section
    }).join('\n\n');
}

/** Non-default string fields, as an attribute string for a `<block>` tag. */
function emitOverrides(proto, block) {
  const out = [];
  const regionRoots = new Set(proto.regions.map((r) => r.path[0]));
  const attr = (k, v) => {
    const def = proto.fields[k];
    if (def !== undefined && parseRef(def)) return; // a ref field is emitted inline, not as an attr
    if (def !== undefined && deepEqual(def, v)) return; // matches the prototype's value
    if (v === true) out.push(k); // HTML boolean
    else if (v === false || typeof v === 'number') out.push(`${k}=${v}`); // unquoted -> JSON
    else if (typeof v === 'string') out.push(`${k}="${v}"`);
    else if (isFlatDict(v)) out.push(...flatDictAttrs(k, v)); // a dict field -> `field:key=value` attrs
    // a nested/array value still can't be a clean attribute; verify-on-emit tier-3s it
  };
  for (const [k, v] of Object.entries(block)) {
    if (k === '@type' || proto.regions.some((r) => r.name === k)) continue;
    if (!regionRoots.has(k)) { attr(k, v); continue; }
    // An object field that holds a region (`table` around `table.rows`): its
    // other entries are the block's own, written as dotted attributes.
    const inRegion = new Set(proto.regions.filter((r) => r.path[0] === k && r.path.length === 2).map((r) => r.path[1]));
    for (const [sub, sv] of Object.entries(v ?? {})) if (!inRegion.has(sub)) attr(`${k}.${sub}`, sv);
  }
  return out.length ? ` ${out.join(' ')}` : '';
}

/** Emit one repeating item: its ref'd nodes (at `depth`), then remainder blocks
 *  one level deeper. */
function emitItem(protos, itemProto, item, depth) {
  const fields = emitFields(itemProto, item, depth);
  // Same as a leaf: fields the captured refs don't carry (a slide's head_title,
  // flagAlign) spill into a `<fields>` tag rather than being dropped.
  // @id and @type are derived (minted id, prototype-supplied type), so the clean
  // form omits them — decode re-stamps both. Dropping @type here keeps it from
  // spilling into a `<fields>` tag as an "uncovered" field.
  const { blocks, blocks_layout, '@id': _id, '@type': _t, ...scalar } = item;
  const extra = uncoveredFields(itemProto, scalar);
  const fieldsTag = Object.keys(extra).length ? `<fields ${fmtTagAttrs(extra)} />` : '';
  const rest = blocks ? emitItemBody(protos, itemProto, blocks, depth) : '';
  return [fields, fieldsTag, rest].filter(Boolean).join('\n\n');
}

/**
 * An item's body blocks. Items are split at a heading of the item's delimiter
 * level, so a body block whose bare markdown has such a heading (a slate `##`)
 * would read back as the next item. Wrap that block in its `<block>` tag —
 * decode doesn't look for delimiters inside a nested block.
 */
function emitItemBody(protos, itemProto, blocks, depth) {
  const delim = delimiterOf(itemProto);
  const level = delim === 'h' ? depth : Number((delim || '').slice(1)) || null;
  const parts = emitSegments(protos, blocks, depth + 1);
  if (!level) return parts.join('\n\n');
  const heading = new RegExp(`^#{${level}}\\s`);
  const hasDelimHeading = (md) => {
    let fence = false;
    return md.split('\n').some((line) => {
      if (/^(```|~~~)/.test(line)) fence = !fence;
      return !fence && heading.test(line);
    });
  };
  return parts.map((part, i) => (!part.startsWith('<block') && hasDelimHeading(part)
    ? `<block type="${blocks[i]['@type']}">\n\n${part}\n\n</block>` : part)).join('\n\n');
}

/** Emit a greedy container BARE: its region items back to back, no `<block>`
 *  wrapper (a codeExample -> `### heading` + fence per tab). Only for
 *  isGreedyContainer protos; verify-on-emit falls back to the wrapped form if a
 *  neighbour would over-merge with it. */
function emitBareContainer(protos, proto, block, depth) {
  const region = proto.regions[0];
  return (getAtPath(block, region.path) ?? []).map((it) => emitItem(protos, region.protos[0], it, depth)).join('\n\n');
}

/** The one node kind an item prototype's refs name (`_="${tr}"` -> tr,
 *  `value="${td/slate}"` -> td), or null. */
function itemKind(proto) {
  const kinds = new Set(Object.values(proto.fields).map(parseRef).filter(Boolean).map((r) => r.node));
  return kinds.size === 1 ? [...kinds][0] : null;
}

/** The item prototype an object_list item was decoded by: named by its type
 *  field, or the region's only one. */
function itemProtoOf(region, item) {
  if (region.typeField === null) return region.protos[0];
  const proto = region.protos.find((p) => p.type === item[region.typeField]);
  if (!proto) throw new Error(`region "${region.name}" has no item prototype "${item[region.typeField]}"`);
  return proto;
}

const MDAST_OF_KIND = { tr: 'tableRow', th: 'tableHeaderCell', td: 'tableCell' };

/**
 * Reverse an item prototype whose node is structural — a `${tr}` row or a
 * `${th/…}` / `${td/…}` cell — into its mdast node: the inverse of
 * decodeItemNode. A row's children come from its own regions; a cell's from
 * its `/slate` field. A field the rule has no place for can't be written, so
 * this throws and verify-on-emit keeps the block's data form.
 */
function emitItemNode(region, item) {
  const proto = itemProtoOf(region, item);
  const kind = itemKind(proto);
  if (!MDAST_OF_KIND[kind]) throw new Error(`item "${proto.type}" is not a table row or cell`);
  const node = { type: MDAST_OF_KIND[kind], children: [] };
  const regionRoots = new Set(proto.regions.map((r) => r.path[0]));
  for (const [k, v] of Object.entries(item)) {
    if (k === region.typeField || regionRoots.has(k)) continue;
    const def = proto.fields[k];
    const ref = def === undefined ? null : parseRef(def);
    if (ref?.part === 'slate') node.children = v.map((b) => slateBlockToMdast(b));
    else if (ref || def === undefined || !deepEqual(def, v)) throw new Error(`a ${kind} has no place for field "${k}"`);
  }
  for (const r of proto.regions) node.children.push(...(getAtPath(item, r.path) ?? []).map((it) => emitItemNode(r, it)));
  return node;
}

/** Emit a container block as a `<block type>` tag over its regions. */
function emitContainer(protos, proto, block, depth) {
  const head = emitFields(proto, block, depth); // the container's own scalar refs (a grid headline)
  // `wrap`: write each blocks_layout child in its own `<block>` tag. A bare
  // child can be claimed by the container's own refs on decode (a heading
  // slate read as the grid's headline); a tagged one never is.
  const render = (wrap) => proto.regions.map((region) => {
    const val = getAtPath(block, region.path);
    if (region.widget === 'blocks_layout') {
      const scope = [...protos, ...region.protos];
      const parts = emitSegments(scope, val, depth + 1);
      return (wrap ? parts.map((part, i) => (/^<(block|fields)[\s>]/.test(part) ? part
        : `<block type="${val[i]['@type']}">\n\n${part}\n\n</block>`)) : parts).join('\n\n');
    }
    // Items that are table rows (`${tr}`) are a markdown table.
    if (region.protos.every((p) => itemKind(p) === 'tr')) {
      return tableToMd({ type: 'table', children: val.map((item) => emitItemNode(region, item)) });
    }
    return val.map((item) => emitItem(protos, region.protos[0], item, depth)).join('\n\n');
  }).join('\n\n');
  const tag = (body) => `<block type="${block['@type']}"${emitOverrides(proto, block)}>\n\n${[head, body].filter(Boolean).join('\n\n')}\n\n</block>`;
  const bare = tag(render(false));
  if (roundTrips(protos, bare, [block], depth)) return bare;
  return tag(render(true));
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
  const { '@type': type, ...rest } = block;
  for (const k of Object.keys(rest)) if (isEmptyObject(rest[k])) delete rest[k]; // drop no-op {} defaults (styles: {})
  // fmtTagAttrs hoists clean scalars to attributes and puts everything else in a
  // trailing data-json — which reorders the block on decode (attrs come first).
  // If ANY field must go to data-json, emit ALL of them there in AUTHORED order
  // so the block round-trips byte-stably; an all-clean block keeps its attrs.
  // Booleans and numbers are plain unquoted attributes too (read back as JSON).
  const cleanScalar = (v) => (typeof v === 'string' ? cleanAttrStr(v)
    : typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)));
  // A flat dict field flattens to `field:key=value` attrs, so it no longer forces
  // the whole block to data-json — only a nested/array value does.
  const mixed = Object.values(rest).some((v) => v !== undefined && !cleanScalar(v) && !isFlatDict(v));
  const attrs = mixed
    ? `data-json='${JSON.stringify(rest).replace(/&/g, '&amp;').replace(/'/g, '&#39;')}'`
    : fmtTagAttrs(rest);
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
  const body = emitBlock(protos, block, depth);
  return `<block type="${block['@type']}">\n\n${body ? `${body}\n\n` : ''}</block>`;
}

/** Fields a leaf's clean form can't carry: not @type, not a ref (in the body),
 *  not a matching default. */
function uncoveredFields(proto, block) {
  const out = {};
  for (const [k, v] of Object.entries(block)) {
    if (k === '@type') continue;
    if (isEmptyObject(v)) continue; // a no-op default (e.g. styles: {}) parity drops -- don't emit it
    if (v === null) continue; // null is "no value": nothing to carry
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
  const body = [emitLeaf(protos, block, depth), `<fields ${fmtTagAttrs(extra)} />`].filter(Boolean).join('\n\n');
  return `<block type="${block['@type']}">\n\n${body}\n\n</block>`;
}

/**
 * Comparison view for verify-on-emit: drop what is default-nothing -- empty
 * text leaves, empty objects (`styles:{}`, `credit:{}`), null -- so a clean form
 * that omits them still counts as reproducing the block. What a FIELD means is
 * the prototypes' business (see `authored`), never a name listed here.
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
  if (v && typeof v === 'object') {
    const keys = Object.keys(v);
    if (keys.length === 1 && keys[0] === 'text' && v.text === '') return undefined;
    const out = {};
    for (const k of keys.sort()) {
      if (v[k] === null) continue; // null is "no value" -- the same as absent
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

/**
 * A block as its prototypes say it is authored (see refView). A `/link` field
 * is authored as its target alone (`[{'@id': url}]`): the rest of a stored link
 * value is the target's summary, which the API resolves at read time, so it is
 * not something the markdown has to reproduce. Recurses into the block's regions.
 */
function authored(protos, block) {
  if (!block || typeof block !== 'object') return block;
  const own = protos.filter((p) => p.type === block['@type']);
  let out = refView(own, block);
  for (const region of own.find((p) => p.regions.length)?.regions ?? []) {
    const val = getAtPath(out, region.path);
    if (!Array.isArray(val)) continue;
    out = { ...out };
    setAt(out, region.path, region.widget === 'blocks_layout'
      ? val.map((b) => authored([...protos, ...region.protos], b))
      : val.map((item) => authoredItem(protos, region, item)));
  }
  return out;
}

function authoredItem(protos, region, item) {
  const proto = region.typeField === null ? region.protos[0] : region.protos.find((p) => p.type === item[region.typeField]);
  if (!proto) return item;
  let out = refView([proto], item);
  if (Array.isArray(out.blocks)) out = { ...out, blocks: out.blocks.map((b) => authored(protos, b)) };
  for (const r of proto.regions) {
    const val = getAtPath(out, r.path);
    if (Array.isArray(val)) { out = { ...out }; setAt(out, r.path, val.map((it) => authoredItem(protos, r, it))); }
  }
  return out;
}

/** An object as its prototypes read it: a field read through `/link` is its
 *  targets alone, and a field read through any ref that is `""` is absent —
 *  decode never gives a ref'd field an empty string. */
function refView(protos, obj) {
  const out = { ...obj };
  for (const p of protos) {
    for (const [f, v] of Object.entries(p.fields)) {
      const ref = parseRef(v);
      if (!ref || ref.part === null) continue;
      if (out[f] === '') delete out[f];
      else if (ref.part === 'link' && Array.isArray(out[f])) out[f] = out[f].map((x) => ({ '@id': x?.['@id'] }));
    }
  }
  return out;
}

/** Are two block lists the same content, as these prototypes read it? The
 *  equality verify-on-emit uses: the semantic view of each block's authored
 *  form (see `authored`). With no prototypes it is plain semantic equality. */
export const sameBlocks = (protos, a, b) =>
  semanticEqual(a.map((x) => authored(protos, x)), b.map((x) => authored(protos, x)));

const roundTrips = (protos, md, expected, depth) => {
  try { return sameBlocks(protos, matchBlocks(protos, md, depth), expected); } catch { return false; }
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

/**
 * Why a block isn't written as markdown: for each clean form (bare, tagged,
 * with `<fields>`), either it can't be produced (`error`), or it doesn't read
 * back the same — `path` is the first place the decoded block differs, with
 * both values. Null when a clean form round-trips. For reports and debugging.
 */
export function explainFallback(protos, block, depth = 2) {
  const forms = [['clean', () => emitBlock(protos, block, depth)], ['tagged', () => emitTag(protos, block, depth)],
    ['with-fields', () => emitFieldsTag(protos, block, depth)]];
  const tried = [];
  for (const [form, gen] of forms) {
    let md;
    try { md = gen(); } catch (e) { tried.push({ form, error: String(e) }); continue; }
    if (md == null) continue;
    let back;
    try { [back] = matchBlocks(protos, md, depth); } catch (e) { tried.push({ form, error: String(e), md }); continue; }
    const a = semantic(authored(protos, block)), b = semantic(authored(protos, back));
    const path = firstDiff(a, b);
    if (path === null) return null;
    tried.push({ form, path: path.join('.'), expected: getAtPath(a, path), got: getAtPath(b, path), md });
  }
  return tried.length ? tried : [{ form: 'none', error: `no prototype for ${block['@type']}` }];
}

function firstDiff(a, b, path = []) {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const d = firstDiff(a[k], b[k], [...path, k]);
      if (d) return d;
    }
  }
  return path;
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
  // `regions` defaults to the block's own prototype regions. An object_list item
  // passes its CONTAINER's declared item prototype instead: the regions come
  // from that declaration, and the item may carry no type to look them up by
  // (typeField omitted/null: table rows/cells).
  const unkeyRegions = (block, regions = regionsOf(block['@type'])) => {
    let liftedBlocksLayout = false;
    for (const region of regions) {
      if (region.widget === 'blocks_layout') {
        if (block.blocks && block.blocks_layout?.[region.name]) {
          block[region.name] = unkeyChildren(
            { blocks: block.blocks, blocks_layout: block.blocks_layout }, region.name,
          );
          liftedBlocksLayout = true;
        }
        continue;
      }
      // object_list items are a bare array field, possibly at a dotted path
      // (slateTable's `table.rows`).
      const val = getAtPath(block, region.path);
      if (!Array.isArray(val)) continue;
      const idKey = region.idField;
      setAt(block, region.path, val.map((item) => {
        assignments.push({ id: item[idKey] });
        // Keep the item's type field: it's derived (from the prototype) for the
        // clean form — emitItem drops it there — but for a tier-3 data-json
        // fallback it's the ONLY carrier of the item's type, and the content
        // validator requires every object_list item to declare it.
        const { [idKey]: _id, blocks_layout: _bl, blocks: kids, ...rest } = item;
        const out = kids ? { ...rest, blocks: unkeyChildren({ blocks: kids, blocks_layout: _bl }) } : rest;
        unkeyRegions(out, region.protos[0]?.regions ?? []); // an item's own regions (a row's cells)
        return out;
      }));
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
 *  `@type` and no-op empty-object defaults (`styles: {}`) -- hoisting
 *  those just wraps blocks in a `<fields data-json='{"styles":{}}'>` for nothing. */
function sharedByAll(blocks) {
  if (blocks.length < 2) return {};
  const [first, ...rest] = blocks;
  const shared = {};
  for (const [k, v] of Object.entries(first)) {
    if (k === '@type' || isEmptyObject(v)) continue;
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
  // Fields the flat form never writes are never hoisted:
  // - one the block's own prototype writes as a literal (accordion's
  //   right_arrows=true) — decode puts it back, and stripping it would make the
  //   block fail its own round trip and fall back to data-json;
  const notHoisted = (block) => {
    const proto = protos.find((p) => p.type === block['@type']);
    const supplied = proto ? Object.entries(proto.fields)
      .filter(([k, v]) => !parseRef(v) && k in block && deepEqual(block[k], v)).map(([k]) => k) : [];
    // - a field the prototype captures from the markdown body (a teaser's
    //   heading, link, description) — hoisting it strips the body;
    const body = proto ? Object.entries(proto.fields).filter(([, v]) => parseRef(v)).map(([k]) => k) : [];
    // - a value no plain attribute can hold (long or multi-line text, a link
    //   list, a slate value) — it would force the wrapper into data-json.
    const plainAttr = (v) => (typeof v === 'string' ? cleanAttrStr(v)
      : typeof v === 'boolean' || typeof v === 'number' || isFlatDict(v));
    const unwritable = Object.keys(block).filter((k) => !plainAttr(block[k]));
    return [...supplied, ...body, ...unwritable];
  };
  const plan = planHoist(blocks.map((block, idx) => ({ block: stripKeys(block, notHoisted(block)), idx })));
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
  // (page-level verify-on-emit) AND is no less readable. Stripping a hoisted
  // field the block's prototype supplies itself (accordion's right_arrows=true)
  // makes that block fail its own round trip and fall back to a data-json tag;
  // the page still round-trips, but more of it is JSON. Keep the flat emission then.
  const rawTags = (md) => (md.match(/<block [^>]*data-json=/g) || []).length;
  try {
    const hoisted = hoistFields(prototypes, blocks);
    if (hoisted && rawTags(hoisted) <= rawTags(markdown) && roundTrips(prototypes, hoisted, blocks, 2)) markdown = hoisted;
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
  // Same as unkeyRegions: an item recurses with its container's declared item
  // prototype's regions, not a lookup by the item's (possibly absent) type.
  const keyRegions = (block, regions = regionsOf(block['@type'])) => {
    const dict = {}, layout = {};
    for (const region of regions) {
      const val = getAtPath(block, region.path);
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
      const idKey = region.idField;
      for (const item of val) {
        const ia = mint ? { id: mintId() } : next();
        if (!ia.id) throw new Error(`expected an item @id assignment, got ${JSON.stringify(ia)}`);
        item[idKey] = ia.id;
        if (Array.isArray(item.blocks)) { const k = keyChildren(item.blocks); item.blocks = k.dict; item.blocks_layout = { items: k.uids }; }
        keyRegions(item, region.protos[0]?.regions ?? []); // an item's own regions (a row's cells)
      }
    }
    if (Object.keys(dict).length) { block.blocks = dict; block.blocks_layout = layout; }
  };

  const top = keyChildren(blocks);
  if (i !== assignments.length) throw new Error(`${assignments.length - i} assignments left over`);
  return { blocks: top.dict, blocks_layout: { items: top.uids } };
}
