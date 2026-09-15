/**
 * blockmd — two-way conversion between Plone block documents and markdown.
 *
 * Implements the format sketched in ../mcp-content-authoring.md. Measured
 * against all real content; see ../blockmd-prototype/FINDINGS.md for how the
 * mapping was derived and what it can't carry.
 *
 * DESIGN — two layers, each doing what it is good at:
 *
 *   1. Frame layer (here). A line-anchored scanner for `:::type{attrs}` … `:::`.
 *      This grammar is ours and is always block-level at line start, so a
 *      scanner is exact and needs no dependency. It nests, and `::::name`
 *      opens a blocks_layout region while `::::name[]` opens an object_list
 *      field — the document states which, so the READER needs no schema.
 *
 *   2. Prose layer (remark). mdast <-> slate. Markdown parsing is where
 *      hand-rolling goes wrong — the python prototype's regexes lost inline
 *      code, split lists and mangled nested emphasis — so it is delegated.
 *
 * Page metadata rides in YAML frontmatter, authored fields only, plus an
 * ordered `blocks:` map (uid -> type) so a plain paragraph can BE a slate block
 * without a directive wrapper. That map is the proposal's blockMap (§3).
 */
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import remarkGfm from 'remark-gfm';
import remarkDefinitionList from 'remark-definition-list';
import YAML from 'yaml';
import { Parser as HtmlParser } from 'htmlparser2';
import {
  mdParser, mdSerializer, MARK_KEYS, Ref, Template, inlineToSlate, listToSlate, blockToSlate, mdToSlate, slateInlineToMdast, slateBlockToMdast, slateToMd, plaintextOf, tagOf, fmtTagAttrs, renderTable,
} from './slate-md.mjs';
// Re-export the shared core so existing consumers of blockmd's API keep working
// until blockmd is retired (they should import from slate-md.mjs thereafter).
export { mdParser, mdSerializer, MARK_KEYS, Ref, Template, inlineToSlate, listToSlate, blockToSlate, mdToSlate, slateInlineToMdast, slateBlockToMdast, slateToMd, plaintextOf, tagOf, fmtTagAttrs, renderTable };

export const SERVER_STATE = new Set([
  '@id', 'created', 'modified', 'workflow_history', 'lock', 'version',
  'working_copy', 'working_copy_of', 'next_item', 'previous_item',
  'changeActor', 'versioning_enabled', 'type_title', 'items', 'items_total',
  '@components', 'exportimport.constrains', 'exportimport.conversation',
  'exportimport.versions',
  // derived from tree position by whatever reads the tree
  'parent', 'getObjPositionInParent',
  // carried by the body, not the frontmatter
  'blocks', 'blocks_layout', 'plaintext',
]);

const RESERVED = new Set(['@type', '@id', 'blocks', 'blocks_layout', 'value', 'plaintext']);

// ---------------------------------------------------------------- slate ----
export function slateRoundTrips(value, shift = 0) {
  try {
    const md = slateToMd(value, shift);
    // Empty prose emits nothing, and nothing cannot be read back as a block.
    if (!md.trim()) return false;
    return JSON.stringify(semantic(mdToSlate(md, shift))) === JSON.stringify(semantic(value));
  } catch {
    return false;
  }
}

/** Comparison view: empty text leaves are normalisation noise, not content. */
function semantic(v) {
  if (Array.isArray(v)) return v.map(semantic).filter((x) => x !== undefined);
  if (v && typeof v === 'object') {
    const keys = Object.keys(v);
    if (keys.length === 1 && keys[0] === 'text' && v.text === '') return undefined;
    const out = {};
    for (const k of keys.sort()) {
      const r = semantic(v[k]);
      // An empty children array and an absent one carry the same content;
      // stored slate uses both for an empty paragraph.
      if (r !== undefined && !(Array.isArray(r) && !r.length)) out[k] = r;
    }
    return out;
  }
  return v;
}

function attrable(v) {
  if (typeof v === 'boolean' || typeof v === 'number') return true;
  if (typeof v === 'string') return !v.includes('\n') && !v.includes('"') && v.length <= 200;
  return false;
}

/**
 * Is this line exactly one HTML tag?
 *
 * Asked of a real HTML parser rather than a regex -- the frame layer's bugs
 * all came from pattern-matching structure by hand. `lowerCaseAttributeNames`
 * is off because block fields are camelCase (slotId, autoplayDelay) and HTML
 * would otherwise flatten them.
 */
function fmtAttrs(o) {
  return Object.entries(o).map(([k, v]) => {
    if (v instanceof Template) return `${k}="${v.text}"`;
    if (Array.isArray(v) || (v && typeof v === 'object')) return `${k}=${JSON.stringify(v)}`;
    return typeof v === 'string' ? `${k}="${v}"` : `${k}=${v}`;
  }).join(' ');
}

const ATTR_RE = /([\w@.-]+)=(?:"([^"]*)"|(\S+))/g;

/**
 * An attribute value is a JSON scalar, or a `${...}` reference into the body.
 *
 * Those two spaces cannot overlap: `${` is not a valid start to any JSON
 * token, so a reference can never be mistaken for data and a literal never
 * needs escaping (`title="$5.00"` has no braces, so it is just a string).
 *
 * Anything else is an error. It used to fall through to `out[k] = bare`, so a
 * typo, a stray sigil, or syntax this reader predates all became plausible
 * string data and nothing complained -- the same silent-partial-loss shape as
 * the object_list bug that quietly dropped every codeExample's `code`.
 */
function parseAttrs(s) {
  const out = {};
  for (const [, k, quoted, bare] of (s || '').matchAll(ATTR_RE)) {
    if (quoted !== undefined) out[k] = isTemplate(quoted) ? new Template(quoted) : quoted;
    else if (bare === 'true' || bare === 'false') out[k] = bare === 'true';
    else if (bare === 'null') out[k] = null;
    else if (/^-?\d+(\.\d+)?$/.test(bare)) out[k] = Number(bare);
    else if (bare.startsWith('[') || bare.startsWith('{')) out[k] = JSON.parse(bare);
    else {
      throw new Error(
        `Bad attribute value ${k}=${bare}: expected a quoted string, a number, `
        + 'true/false/null, or a quoted "${reference}".',
      );
    }
  }
  return out;
}

/**
 * A quoted attribute carrying one or more `${...}` references.
 *
 * There is one syntax, always quoted:
 *
 *   title="${1/text}"       construct 1's `text`. The whole value is a single
 *                           reference, so the referenced type is preserved.
 *   tag="h${1/level}"       interpolation -- text around it, so the result is
 *                           a string, which is how level 2 becomes "h2"
 *                           without anything hardcoding the letter h.
 *

 * A Template is a kind established where it appears, never inferred from a
 * string's contents: source code in a fenced field is full of JS template
 * literals, and treating those as interpolation rewrote 11 codeExample blocks.
 */
const isTemplate = (v) => typeof v === 'string' && /\$\{[^}]+\}/.test(v);

/** Forward: "h${1/level}" + constructs -> "h2". */
function interpolate(text, constructs) {
  return text.replace(/\$\{([^}]+)\}/g, (_, spec) => String(lookup(constructs, new Ref(spec)) ?? ''));
}

/**
 * Backward: "h${1/level}" + "h2" -> {level: "2"}.
 *
 * Interpolation is not generally invertible ("${a}${b}" = "h2" has several
 * solutions), so only the EMITTER runs it backwards, and then checks that
 * rendering the result reproduces the stored value. The parser only runs
 * forward.
 */
function invert(template, value) {
  if (typeof value !== 'string') return null;
  const parts = [];
  let last = 0;
  for (const m of template.matchAll(/\$\{([^}]+)\}/g)) {
    parts.push({ lit: template.slice(last, m.index) });
    parts.push({ name: m[1] });
    last = m.index + m[0].length;
  }
  parts.push({ lit: template.slice(last) });
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${parts.map((x) => ('name' in x ? '(.+?)' : esc(x.lit))).join('')}$`);
  const m = re.exec(value);
  if (!m) return null;
  const out = {};
  parts.filter((x) => 'name' in x).forEach((x, i) => { out[x.name] = m[i + 1]; });
  return out;
}

/** Plain text of mdast inline nodes. */
function mdText(nodes) {
  return (nodes || []).map((n) => (n.value != null ? n.value : mdText(n.children))).join('');
}

/** One mdast node -> the parts a reference can name. */
function partsOf(n) {
  if (n.type === 'heading') return { text: mdText(n.children), level: n.depth };
  if (n.type === 'table') {
    // A markdown table cell is inline-only, so each becomes a one-paragraph
    // slate value. The first row is the header, which is what markdown means
    // by the delimiter line.
    return {
      rows: (n.children || []).map((row, i) => ({
        cells: (row.children || []).map((cell) => ({
          type: i === 0 ? 'header' : 'data',
          value: [{ type: 'p', children: inlineToSlate(cell.children) }],
        })),
      })),
    };
  }
  if (n.type === 'code') return { lang: n.lang || '', code: n.value ?? '' };
  if (n.type === 'paragraph') {
    const kids = n.children || [];
    const only = kids.length === 1 ? kids[0] : null;
    if (only?.type === 'image') return { src: only.url, alt: only.alt || '' };
    if (only?.type === 'link') return { text: mdText(only.children), href: only.url };
    return { text: mdText(kids) };
  }
  return {};
}

/**
 * The body's block-level constructs. This is the whole vocabulary a reference
 * can name -- tied to markdown's constructs, not to any block type, which is
 * what keeps the mechanism general.
 */
function constructsOf(md) {
  return (mdParser.parse(md || '').children || []).map(partsOf);
}

/**
 * Repeating groups: from construct `from`, a new group at every heading of
 * `level`.
 *
 * A group is a LIST of constructs, not a merged bag, so `${N/part}` means the
 * same thing inside a group as it does at page level: the Nth construct's
 * part. `${1/text}` is the heading's text; `${2/lang}` is the language of the
 * code block under it. A reference that named no position would say nothing
 * about where the value lives.
 */
function sectionsOf(md, from, level) {
  const nodes = (mdParser.parse(md || '').children || []).slice(from);
  const out = [];
  for (const n of nodes) {
    if (n.type === 'heading' && n.depth === level) out.push([partsOf(n)]);
    else if (out.length) out[out.length - 1].push(partsOf(n));
  }
  return out;
}

/** `${part}` searches the constructs in order; `${N/part}` indexes one. */
function lookup(constructs, ref) {
  if (ref.index != null) return constructs[ref.index]?.[ref.part];
  return constructs.find((c) => c[ref.part] !== undefined)?.[ref.part];
}

/** Resolve one attribute value against a construct list. */
function resolveOne(tpl, constructs) {
  const whole = tpl.whole;
  if (whole) return lookup(constructs, whole);
  return interpolate(tpl.text, constructs);
}

/**
 * Resolve every reference in a block against its own body.
 *
 * `field.sub` attributes describe one repeating item, so they are collected
 * and applied per group rather than set on the block.
 */
function resolveRefs(block, md) {
  const constructs = constructsOf(md);
  // A dotted attribute means one of two things, and they are told apart by
  // whether the head names an existing field. `tabs.label` describes each
  // item of a repeating container; `table.rows` fills a path inside a field
  // this block already has. Claiming every dotted key for the first meaning
  // silently swallowed the second.
  const itemMap = {};
  for (const [k, v] of Object.entries(block)) {
    const dot = k.indexOf('.');
    if (dot <= 0 || !(v instanceof Template)) continue;
    const head = k.slice(0, dot);
    if (block[head] !== undefined && typeof block[head] === 'object') {
      let target = block[head];
      const rest = k.slice(dot + 1).split('.');
      while (rest.length > 1) target = (target[rest.shift()] ||= {});
      // The hoisted data holds what markdown cannot -- a row's key, a cell's
      // key -- in the content's own shape. The reference supplies the rest.
      // They are two halves of the same array, so merge by position.
      target[rest[0]] = mergeByPosition(target[rest[0]], resolveOne(v, constructs));
    } else {
      (itemMap[head] ||= {})[k.slice(dot + 1)] = v;
    }
    delete block[k];
  }
  for (const [k, v] of Object.entries(block)) {
    if (!(v instanceof Template)) continue;
    block[k] = resolveOne(v, constructs);
  }
}

/**
 * Merge hoisted data with markdown-derived content, element by element.
 *
 * Neither half is complete on its own: the data carries identity, the
 * markdown carries the content, and position is what pairs them. A missing
 * hoisted entry is fine -- new content simply has no stored identity yet.
 */
function mergeByPosition(stored, derived) {
  if (!Array.isArray(derived)) return derived ?? stored;
  if (!Array.isArray(stored)) return derived;
  return derived.map((d, i) => {
    const s = stored[i];
    if (!s || typeof s !== 'object' || typeof d !== 'object') return d ?? s;
    const out = { ...s };
    for (const [k, v] of Object.entries(d)) out[k] = mergeByPosition(s[k], v);
    return out;
  });
}

/** Rows of slate cells -> a markdown table. */
function renderConstruct(kind, parts) {
  if (kind === 'heading') {
    const level = Math.min(6, Math.max(1, Number(parts.level) || 2));
    return `${'#'.repeat(level)} ${parts.text}`;
  }
  if (kind === 'table') return renderTable(parts.rows);
  if (kind === 'image') return `![${parts.alt ?? ''}](${parts.src})`;
  if (kind === 'link') return `[${parts.text}](${parts.href})`;
  return parts.text ?? '';
}

/**
 * Lift a block's mapped fields into the body, returning the markdown and the
 * attributes that replace them -- or null when it would not survive the round
 * trip, in which case the caller leaves the fields as ordinary attributes.
 */
function nativeBody(type, b, roles, schema, depth) {
  const role = roles?.[type];
  if (!role) return null;
  if (role.table) return tableBody(role.table, b);
  return role.sections ? sectionsBody(role.sections, b, schema, depth) : constructBody(role, b);
}

/**
 * A table field written as a markdown table.
 *
 * The rows go in the body; the settings and the row/cell KEYS go in `data`.
 * The keys are identity, not decoration -- some are `uid-rNcM` and some are
 * random (`0b0891c8-36un`), so deriving them would invent identity for the
 * ones that happen to look derivable and lose the rest.
 */
function tableBody(role, b) {
  const t = b[role.field];
  if (!t || !Array.isArray(t.rows) || !t.rows.length) return null;
  const md = renderTable(t.rows);
  if (md === null) return null;

  // The rows ride in data in their OWN shape, carrying only what the markdown
  // table cannot say: the row and cell keys. Values come from the body.
  const settings = { ...t };
  settings.rows = t.rows.map((r) => ({
    key: r.key,
    cells: r.cells.map((c) => ({ key: c.key })),
  }));

  // Check the table survives being read back, as every other native field
  // does: a cell holding anything but one paragraph cannot be a markdown cell.
  const back = partsOf(mdParser.parse(md).children[0]);
  const same = JSON.stringify(back.rows?.map((r) => r.cells.map((c) => c.value)))
    === JSON.stringify(t.rows.map((r) => r.cells.map((c) => c.value)));
  if (!same) return null;

  return {
    md,
    fields: [role.field],
    data: { [role.field]: settings },
    attrs: { [`${role.field}.rows`]: '${1/rows}' },
  };
}

/** A single construct: heading block, image block. */
function constructBody(role, b) {
  const parts = {}, attrs = {};
  for (const [field, spec] of Object.entries(role.fields)) {
    const v = b[field];
    if (v == null || v === '') continue;
    const tpl = new Template(spec);
    const whole = tpl.whole;
    if (whole) {
      if (typeof v !== 'string') return null;
      parts[whole.part] = v;
    } else {
      const got = invert(spec, v);
      if (!got) return null;
      for (const [k, x] of Object.entries(got)) parts[new Ref(k).part] = x;
    }
    attrs[field] = spec;
  }
  if (parts.text === undefined && parts.src === undefined) return null;
  const md = renderConstruct(role.construct, parts);

  // Check, do not assume. A value the construct cannot carry (a heading whose
  // text ends in a space) keeps its literal attribute instead of being
  // silently rewritten.
  const back = constructsOf(md);
  for (const [field, spec] of Object.entries(attrs)) {
    if (resolveOne(new Template(spec), back) !== b[field]) return null;
  }
  return { md, attrs };
}

/**
 * One construct of a repeating group, from the parts that reference it.
 *
 * The kind follows from which parts are named — a `code` part means a fenced
 * block, `src` an image, `href` a link — so no block type is named here.
 * Position 0 is the group's boundary and is therefore always the heading.
 */
function renderAt(idx, parts, level) {
  if (idx === 0) {
    const t = parts.text;
    if (typeof t !== 'string' || !t.trim() || t !== t.trim()) return null;
    return `${'#'.repeat(level)} ${t}`;
  }
  if ('code' in parts) {
    const code = parts.code;
    if (typeof code !== 'string') return null;
    const fence = '`'.repeat(fenceLen(code));
    return `${fence}${parts.lang ?? ''}\n${code}\n${fence}`;
  }
  if ('src' in parts) return `![${parts.alt ?? ''}](${parts.src})`;
  if ('href' in parts) return `[${parts.text}](${parts.href})`;
  if (typeof parts.text === 'string') return parts.text;
  return null;
}

/** Item-template attributes: references stay references, ids stay literal. */
function templateAttrs(tmpl) {
  const out = {};
  for (const [k, v] of Object.entries(tmpl)) out[k] = typeof v === 'string' ? new Template(v) : v;
  return out;
}

/** A repeating field: codeExample tabs, accordion panels. */
function sectionsBody(sec, b, schema, depth) {
  const items = b[sec.field];
  if (!Array.isArray(items) || !items.length) return null;
  // The role writes the boundary the way it appears in the document ("h3");
  // the heading depth is the number inside it.
  const level = Number(String(sec.at).replace(/^h/i, ''));
  if (!(level >= 1 && level <= 6)) return null;

  // Invert the mapping, keeping the POSITION: which item field supplies
  // construct N's part P. `${2/lang}` is the language of the second construct
  // in the group, so the emitter has to put it there.
  const byIndex = new Map();
  const covered = new Set(['@id']);
  let regionField = null;          // the field that takes the REST of the group
  for (const [field, spec] of Object.entries(sec.item)) {
    const whole = new Template(spec).whole;
    if (!whole || whole.index == null) return null;
    if (whole.rest) {
      // The remainder of the group is a nested region: the item's children
      // are blocks, written as ordinary directives under the heading.
      if (whole.part !== 'blocks_layout') return null;
      regionField = field;
      covered.add(field).add('blocks_layout');
      continue;
    }
    if (!byIndex.has(whole.index)) byIndex.set(whole.index, {});
    byIndex.get(whole.index)[whole.part] = field;
    covered.add(field);
  }
  // The group is delimited by a heading, so construct 1 must be one.
  if (!byIndex.get(0)?.text) return null;

  // Each item is one chunk, joined by a blank line. A fence's own lines must
  // stay adjacent — blank-separating them puts empty lines INSIDE the code.
  const chunks = [];
  for (const item of items) {
    const lines = [];
    for (const idx of [...byIndex.keys()].sort((x, y) => x - y)) {
      const parts = {};
      for (const [part, field] of Object.entries(byIndex.get(idx))) parts[part] = item[field];
      const rendered = renderAt(idx, parts, level);
      if (rendered === null) return null;
      if (lines.length) lines.push('');
      lines.push(rendered);
    }
    // Fields with no markdown form -- a select, or an object_browser
    // reference whose value is a 47-key catalog snapshot -- are hoisted into
    // the container's `items` instead of written here. One form of hoisting,
    // not two: emitting both put every slider's data in the file twice.
    if (regionField) {
      const kids = item[regionField];
      if (kids && typeof kids === 'object') {
        const order = item.blocks_layout?.items ?? Object.keys(kids);
        for (const k of order) {
          if (kids[k]) lines.push('', blockToMd(k, kids[k], schema, (depth ?? 0) + 1, level));
        }
      }
    }
    chunks.push(lines.join('\n'));
  }
  const md = chunks.join('\n\n');

  // Check, do not assume -- the same contract the single-construct path has
  // always had. Without this a role that does not fit emits silently wrong
  // content instead of falling back: mapping a slider's `href` (an
  // object_browser reference carrying resolved metadata) onto a markdown link
  // produced "[See all Content Types]([object Object])" and dropped the
  // reference entirely.
  if (regionField) {
    // The children are `:::` directives, and the scanner does not treat a
    // heading inside one as a boundary -- a panel body legitimately contains
    // its own headings. So count boundaries the way the scanner does, at
    // directive depth zero, rather than with sectionsOf, which would see the
    // children's headings too and report false groups.
    const heads = [];
    let depth = 0;
    for (const line of md.split('\n')) {
      const open = /^(:{3,4})([\w-]*)(\[[^\]]*\])?(?:\{(.*)\})?\s*$/.exec(line);
      if (open && open[2]) { depth += 1; continue; }
      if (open && !open[2]) { depth -= 1; continue; }
      const h = depth === 0 && new RegExp(`^#{${level}}\\s+(.*)$`).exec(line);
      if (h) heads.push(h[1]);
    }
    const titleField = byIndex.get(0).text;
    if (heads.length !== items.length) return null;
    if (heads.some((t, i) => t !== items[i][titleField])) return null;
  } else {
    const groups = sectionsOf(md, 0, level);
    if (groups.length !== items.length) return null;
    for (const [i, item] of items.entries()) {
      for (const [field, spec] of Object.entries(sec.item)) {
        const got = resolveOne(new Template(spec), groups[i]);
        if (JSON.stringify(got) !== JSON.stringify(item[field])) return null;
      }
    }
  }

  // The container states its own shape: `[h3]` is the repeat boundary and the
  // attributes say which part of each group fills which field. The parent
  // block carries nothing, so its directive line stays readable.
  const tmpl = { ...sec.item };
  // One form of hoisting: whatever markdown cannot supply for each item rides
  // an `items` array in the container's data, in the item's OWN shape. `@ids`
  // used to be a second mechanism for exactly this, with the id in a parallel
  // array and position as the only thing tying them together.
  const hoisted = items.map((it) => {
    const covered = new Set([...Object.keys(sec.item), regionField].filter(Boolean));
    return Object.fromEntries(Object.entries(it).filter(([k]) => !covered.has(k)));
  });
  const anyHoisted = hoisted.some((h) => Object.keys(h).length);
  return {
    region: `<region ${fmtTagAttrs({ name: sec.field, widget: 'object_list',
                                     repeat: `h${level}`, ...templateAttrs(tmpl),
                                     ...(anyHoisted ? { items: hoisted } : {}) })}>`,
    md,
    fields: [sec.field],
  };
}

// -------------------------------------------------------------- emitting ---
function childFields(schema, type) {
  return Object.entries(schema?.[type] || {})
    .filter(([, p]) => p.widget === 'object_list')
    .map(([f]) => f);
}


function blockToMd(uid, b, schema, depth = 0, shift = 0) {
  const type = b['@type'];
  const kidFields = childFields(schema, type);
  const skip = new Set([...RESERVED, ...kidFields]);
  const native = nativeBody(type, b, schema?._markdown, schema, depth);
  if (native) for (const f of native.fields ?? Object.keys(native.attrs)) skip.add(f);
  const attrs = {}, complex = {};
  for (const [k, v] of Object.entries(b)) {
    if (skip.has(k)) continue;
    (attrable(v) ? attrs : complex)[k] = v;
  }

  const refAttrs = {};
  if (native?.attrs) for (const [f, spec] of Object.entries(native.attrs)) {
    refAttrs[f] = typeof spec === 'string' ? new Template(spec) : spec;
  }
  const inData = Object.fromEntries(
    Object.entries(complex).filter(([, v]) => typeof v !== 'string'));
  const lines = [`<block ${fmtTagAttrs({ type, uid, ...attrs, ...inData, ...(native?.data ?? {}), ...refAttrs })}>`];

  // A multi-line STRING is prose or source code — the things markdown exists
  // for. Emitting it as a JSON one-liner (which is what a generic escape hatch
  // does) makes the most common structured block, codeExample, unreadable and
  // unauthorable. Give it a fenced block labelled with the field name, and use
  // the `language` attr for highlighting when there is one.
  // Only multi-line STRINGS still take a fence: a codeExample's `code` is
  // source and has to stay readable. Everything else non-string rides `data`
  // on the tag, where it renders as nothing rather than as a code block.
  const fenced = Object.fromEntries(
    Object.entries(complex).filter(([, v]) => typeof v === 'string'));
  for (const [k, v] of Object.entries(fenced)) {
    lines.push(openFence(v, k, attrs.language), v, closeFence(v));
  }
  if (native?.region) lines.push(native.region, '', native.md, '', '</region>');
  else if (native) lines.push(native.md);
  if ((type === 'slate' || type === 'introduction') && b.value) {
    if (slateRoundTrips(b.value, shift)) lines.push(slateToMd(b.value, shift));
    else lines.push('```field-json:value', JSON.stringify(b.value, null, 1), '```');
  }

  for (const f of kidFields) {
    if (!Array.isArray(b[f])) continue;
    // Already lifted into the body as repeating sections; emitting the
    // container too would give the field two sources and the parser would
    // push children onto a value that is not an array.
    if (native && (native.fields ?? Object.keys(native.attrs)).includes(f)) continue;
    // `[]` says these children are items in a field array, not blocks in a
    // region. The schema is consulted here, on the way out; the reader never
    // needs it because the marker is in the document.
    lines.push(`<region ${fmtTagAttrs({ name: f, widget: 'object_list' })}>`, '');
    for (const item of b[f]) {
      if (item && typeof item === 'object') {
        // form.subblocks items have no @id; inventing "" adds a field that
        // was never there.
        // form.subblocks items have no @id; emitting uid="" would invent one.
        lines.push(blockToMd(item['@id'], { ...item, '@type': item['@type'] ?? singular(f) },
                             schema, depth + 1));
      }
    }
    lines.push('', '</region>');
  }

  if (b.blocks && typeof b.blocks === 'object') {
    const bl = b.blocks_layout || {};
    const regions = Object.keys(bl);
    if (!regions.length) {
      for (const [k, v] of Object.entries(b.blocks)) lines.push(blockToMd(k, v, schema, depth + 1));
    } else {
      for (const region of regions) {
        const named = regions.length > 1 || region !== 'items';
        if (named) lines.push(`<region ${fmtTagAttrs({ name: region, widget: 'blocks_layout' })}>`, '');
        for (const k of bl[region] || []) if (b.blocks[k]) lines.push(blockToMd(k, b.blocks[k], schema, depth + 1));
        if (named) lines.push('', '</region>');
      }
    }
  }
  // A block with no body closes on its own line; one with content needs an
  // explicit close so the extent is in the document rather than inferred.
  if (lines.length === 1) return `${lines[0].slice(0, -1)} />`;
  lines.push('</block>');
  // A blank line after the opening tag and before the closing one is what
  // keeps the body markdown. Without them CommonMark treats the whole span as
  // one raw-HTML block and `## Heading` renders as literal text.
  return [lines[0], '', ...lines.slice(1, -1), '', '</block>'].join('\n');
}

/** A fence longer than any backtick run inside the payload. */
function fenceLen(text) {
  let max = 0;
  for (const m of String(text).matchAll(/`+/g)) max = Math.max(max, m[0].length);
  return Math.max(3, max + 1);
}
const openFence = (text, field, lang) =>
  '`'.repeat(fenceLen(text)) + `field:${field}` + (lang ? ` ${lang}` : '');
const closeFence = (text) => '`'.repeat(fenceLen(text));

const singular = (f) => (f.endsWith('s') ? f.slice(0, -1) : f);

export function pageToMd(page, schema = {}) {
  const blocks = page.blocks || {};
  const order = [...(page.blocks_layout?.items || [])];
  for (const k of Object.keys(blocks)) if (!order.includes(k)) order.push(k);

  const meta = {};
  for (const [k, v] of Object.entries(page)) if (!SERVER_STATE.has(k)) meta[k] = v;
  meta.blocks = order.filter((u) => blocks[u]).map((u) => ({ [u]: blocks[u]['@type'] }));

  const body = order.filter((u) => blocks[u]).map((uid) => {
    const b = blocks[uid];
    const extra = Object.keys(b).filter((k) => !['@type', 'value', 'plaintext'].includes(k));
    // Prose with nothing but a value renders as bare markdown.
    // Bare markdown only when there IS prose: an empty paragraph serialises to
    // an empty string and would silently disappear from the document.
    if (b['@type'] === 'slate' && !extra.length && (b.value || []).length === 1
        && slateToMd(b.value).trim() && slateRoundTrips(b.value)) {
      return slateToMd(b.value);
    }
    return blockToMd(uid, b, schema);
  });

  return `---\n${YAML.stringify(meta).trim()}\n---\n\n${body.join('\n\n')}\n`;
}

// --------------------------------------------------------------- parsing ---
/**
 * `:::type{attrs}` opens a block; `::::name` opens a container.
 *
 * A container is one of two different storage shapes, and the document says
 * which rather than the reader asking a schema:
 *
 *   ::::items      a blocks_layout region -- children are blocks in the
 *                  shared `blocks` dict, and the region records their order
 *   ::::panels[]   an object_list field  -- children are items inside a
 *                  field array; there is no shared dict and no ordering key
 *
 * `[]` cannot occur in a field or region name, so the two namespaces cannot
 * collide even when the names are identical. This is what lets mdToPage run
 * with no schema at all.
 */
const OPEN_RE = /^(:{3,4})([\w@-]*)(\[[^\]]*\])?(?:\{(.*)\})?\s*$/;

/**
 * markdown -> a page.
 *
 * Takes NO schema. Everything that used to need one is carried by the
 * document: `::::name[]` says a container holds field items rather than
 * blocks, and `${...}` references say which field a construct fills. That is
 * what makes a markdown mount possible -- the mock API can serve these files
 * without knowing any block type.
 */
/**
 * HTML attributes -> block fields.
 *
 * Strings arrive as attributes; everything else rides `data` as JSON, because
 * an attribute value is string-typed and could not otherwise say whether
 * "false" meant the boolean or the word. A `${…}` value is a reference.
 */
function tagFields(attrs) {
  const out = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'data-json') { Object.assign(out, JSON.parse(v)); continue; }
    out[k] = isTemplate(v) ? new Template(v) : v;
  }
  return out;
}

/** Finish a block frame: its regions, its prose, its references. */
function finishBlock(frame) {
  const { block, regions } = frame;
  if (regions && Object.keys(regions).length) block.blocks_layout = regions;
  const region = block._objlist;
  delete block._objlist;
  // The emitter synthesises a type from the field name (tabs -> tab) for
  // items that have none; drop it again so the item matches storage.
  if (region && block['@type'] === singular(region)) delete block['@type'];
  const hadRaw = block._rawValue; delete block._rawValue;
  const isProse = block['@type'] === 'slate' || block['@type'] === 'introduction';
  if (!hadRaw && isProse && block._md) {
    block.value = mdToSlate(block._md.trim(), frame.shift ?? 0);
    block.plaintext = plaintextOf(block.value);
  }
  if (hadRaw && block.value) block.plaintext = plaintextOf(block.value);
  // Fields written in their native markdown are read back out of the body.
  // The document says where each one goes, so this needs no schema.
  if (!isProse) resolveRefs(block, block._md || '');
  delete block._md;
}

/** An item opened by a heading: its regions become its blocks_layout. */
function closeItem(frame) {
  if (!frame) return;
  // The item's scalar fields come from the constructs in its OWN body, so
  // `${1/text}` is its heading and `${2/lang}` the fence under it.
  const constructs = constructsOf((frame.md ?? []).join('\n'));
  for (const [field, tpl] of Object.entries(frame.template ?? {})) {
    if (field === 'items' || field === frame.regionField) continue;
    if (frame.block[field] === undefined) frame.block[field] = resolveOne(tpl, constructs);
  }
  if (frame.regions && Object.keys(frame.regions).length) {
    frame.block.blocks_layout = frame.regions;
  }
  // Blank lines between the heading and its children land in the frame's
  // scratch buffer. An item is not a prose block, so that is not content.
  delete frame.block._md;
}

export function mdToPage(md) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(md);
  const meta = m ? YAML.parse(m[1]) || {} : {};
  const body = m ? md.slice(m[0].length) : md;

  const blockmap = (meta.blocks || []).map((e) => {
    const [uid, type] = Object.entries(e)[0];
    return { uid, type };
  });
  delete meta.blocks;

  const blocks = {}, order = [];
  const stack = [];       // { uid, block, order, region }
  let buf = [];

  const flushProse = () => {
    const text = buf.join('\n').trim();
    buf = [];
    if (!text) return;
    const next = blockmap.find((e) => e.type === 'slate' && !(e.uid in blocks));
    const uid = next?.uid ?? `slate-${Object.keys(blocks).length}`;
    const value = mdToSlate(text);
    blocks[uid] = { '@type': 'slate', value, plaintext: plaintextOf(value) };
    order.push(uid);
  };

  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    const open = tagOf(line);

    // `<field … />` is not a block. It carries fields of the item that
    // encloses it -- the ones with no markdown form, like a select or an
    // object_browser reference whose value is a resolved catalog snapshot.
    if (open?.name === 'field' && open.kind === 'self') {
      const parent = stack[stack.length - 1];
      if (!parent?.isItem) throw new Error('<field/> must sit inside a repeating item.');
      Object.assign(parent.block, tagFields(open.attrs));
      continue;
    }

    if (open?.name === 'block' && (open.kind === 'open' || open.kind === 'self')) {
      flushProse();
      const attrs = tagFields(open.attrs);
      const type = attrs.type;
      delete attrs.type;
      const attrsHadUid = attrs.uid !== undefined;
      const uid = attrs.uid ?? `${type}-${Object.keys(blocks).length}`;
      delete attrs.uid;
      const parent = stack[stack.length - 1];

      const block = { '@type': type, ...attrs };
      if (parent) {
        if (parent.regionIsField) {
          // Push the SAME object that goes on the stack, never a copy: later
          // ```fields updates mutate the stack entry, and a copy loses them
          // silently (this is how every codeExample lost its `code`).
          if (attrsHadUid) block['@id'] = uid;
          block._objlist = parent.region;
          (parent.block[parent.region] ||= []).push(block);
        } else {
          (parent.block.blocks ||= {})[uid] = block;
          (parent.regions ||= {});
          const region = parent.region || 'items';
          (parent.regions[region] ||= []).push(uid);
        }
      } else {
        blocks[uid] = block;
        order.push(uid);
      }
      const frame = { uid, block, regions: {}, region: null,
                      shift: stack[stack.length - 1]?.shift ?? 0 };
      // A self-closing block has no body, so it opens and closes at once.
      if (open.kind === 'self') { finishBlock(frame); continue; }
      stack.push(frame);
      continue;
    }

    if (open?.name === 'region' && open.kind === 'open') {
      if (stack.length) {
        const top = stack[stack.length - 1];
        const attrs = tagFields(open.attrs);
        top.region = attrs.name;
        delete attrs.name;
        const kind = attrs.widget;
        delete attrs.widget;
        if (kind !== 'blocks_layout' && kind !== 'object_list') {
          throw new Error(`<region name="${top.region}">: widget must be `
            + 'blocks_layout or object_list.');
        }
        top.regionIsField = kind === 'object_list';
        // `repeat="h3"` says the body is split into one item per h3, with the
        // remaining attributes saying which part of each group fills which
        // field. The container knows its own shape, so the parent block
        // carries nothing about it.
        const at = /^h([1-6])$/.exec(String(attrs.repeat?.text ?? attrs.repeat ?? ''));
        delete attrs.repeat;
        top.repeatAt = at ? Number(at[1]) : null;
        top.itemTemplate = at ? attrs : null;
        // One path for every repeat: a heading opens an item frame, the
        // item's own lines accumulate in it, `:::` children become its blocks
        // and `:::@` sets its fields. Collecting the whole region as markdown
        // and splitting it at the end could not see directives at all, so a
        // `:::@` inside an item was swallowed as prose.
        top.itemRegion = at && Object.entries(attrs).find(
          ([, v]) => v instanceof Template && v.whole?.rest);
        top.itemCount = 0;
      }
      continue;
    }

    if (open?.kind === 'close' && (open.name === 'block' || open.name === 'region')) {
      // A repeating item is closed by its region, not by a tag of its own.
      if (open.name === 'region' && stack[stack.length - 1]?.isItem) closeItem(stack.pop());
      const top = stack[stack.length - 1];
      if (open.name === 'region' && top?.region) {
        top.region = null;
        top.regionIsField = false;
        top.repeatAt = null;
        top.itemTemplate = null;
        top.itemRegion = null;
        continue;
      }
      const frame = stack.pop();
      if (frame) finishBlock(frame);
      continue;
    }

    const jsonFence = /^(`{3,})field-json:([\w.-]+)\s*$/.exec(line);
    if (jsonFence && stack.length) {
      const close = jsonFence[1];
      const chunk = [];
      let j = i + 1;
      while (j < lines.length && lines[j].trim() !== close) chunk.push(lines[j++]);
      stack[stack.length - 1].block[jsonFence[2]] = JSON.parse(chunk.join('\n'));
      stack[stack.length - 1].block._rawValue = true;
      i = j;
      continue;
    }

    const fieldFence = /^(`{3,})field:([\w.-]+)(?:\s+\S+)?\s*$/.exec(line);
    if (fieldFence && stack.length) {
      const close = fieldFence[1];
      const chunk = [];
      let j = i + 1;
      while (j < lines.length && lines[j].trim() !== close) chunk.push(lines[j++]);
      stack[stack.length - 1].block[fieldFence[2]] = chunk.join('\n');
      i = j;
      continue;
    }

    if (line === '```fields' && stack.length) {
      const chunk = [];
      let j = i + 1;
      while (j < lines.length && lines[j].trim() !== '```') chunk.push(lines[j++]);
      Object.assign(stack[stack.length - 1].block, JSON.parse(chunk.join('\n')));
      i = j;
      continue;
    }

    // A heading may arrive with the previous item still open, so look past an
    // open item frame for the region that owns the repeat.
    const itemOnTop = stack[stack.length - 1]?.isItem;
    const openItem = stack[stack.length - (itemOnTop ? 2 : 1)];
    if (openItem && openItem.repeatAt) {
      const h = new RegExp(`^#{${openItem.repeatAt}}\\s+(.*)$`).exec(line);
      if (h) {
        if (itemOnTop) closeItem(stack.pop());
        // The hoisted entry is the item's own shape, so it merges in whole.
        const hoisted = openItem.itemTemplate.items;
        const item = { ...(Array.isArray(hoisted) ? hoisted[openItem.itemCount] ?? {} : {}) };
        openItem.itemCount += 1;
        (openItem.block[openItem.region] ||= []).push(item);
        stack.push({
          uid: '', block: item, regions: {}, region: null, isItem: true,
          template: openItem.itemTemplate,
          regionField: openItem.itemRegion?.[1]?.whole?.part ?? null,
          md: [raw],                    // the item's own lines, heading first
          // Children wrote their headings below the split level; lift them
          // back by the same amount.
          shift: openItem.repeatAt,
        });
        continue;
      }
    }

    if (stack.length) {
      const top = stack[stack.length - 1];
      if (top.isItem) top.md.push(raw);
      else top.block._md = (top.block._md ?? '') + raw + '\n';
    } else if (!line && buf.length) {
      flushProse();
    } else if (line) {
      buf.push(raw);
    }
  }
  flushProse();

  // An item with no blocks has no layout either. Synthesising an empty one
  // makes a Link or an Event differ from what it actually stores.
  if (!order.length && !Object.keys(blocks).length) return { ...meta };
  return { ...meta, blocks, blocks_layout: { items: order } };
}
