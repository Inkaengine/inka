/**
 * Read a README-shaped markdown tree as Plone content items.
 *
 * This is the reader the mock API mounts, and the same one the CI agreement
 * check runs — if they were separate implementations, the check would verify
 * something the server does not do.
 *
 * The exported markdown carries authored fields only. Server state is DERIVED
 * from the tree, because the tree already knows it:
 *
 *   parent          the containing folder. `enrichContent` reads this and,
 *                   when it is absent, defaults to the site root — so a page
 *                   at /docs/architecture would claim / as its parent and the
 *                   admin's breadcrumb and object browser would both be wrong.
 *   position        sibling order, from the folder's `order:` frontmatter.
 *
 * `is_folderish` is NOT derived: a Plone Document is folderish by type whether or
 * not it holds children, so the exporter carries it and the reader respects it
 * (falling back to "has children" only when absent, e.g. a blob).
 *
 * Nothing here needs a schema: the markdown says which containers hold field
 * items and which construct fills each field.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, dirname, relative, extname } from 'path';
import ignore from 'ignore';
import { decodePage } from './prototype-mapping.mjs';

/**
 * Decode one page to a content object. The one markdown source format is the
 * `<block>` prototype format (`prototype-mapping.mjs`); the old `:::block`
 * directive dialect is gone. Kept as the named seam `readTree` decodes through,
 * so a caller can still substitute a decoder.
 */
export function decodeAuto(text) {
  return decodePage(text);
}

/**
 * Rewrite a hand-authored relative `.md` link to the path the site serves.
 * External/absolute/anchor links pass through untouched. `base` is the directory
 * of the page's OWN .md file, relative to the tree root (so a folder index and
 * its leaf siblings resolve against the same directory). `foo.md` under base
 * `docs/x` -> `/docs/x/foo`; an `index`/`README` segment collapses to its folder.
 * A no-op for generated content (links are already absolute), it lets a mount be
 * authored by hand without every cross-link 404ing. Ported from the retired sync.
 */
export function resolveMarkdownLink(url, base, prefix = '') {
  if (!url || /^(https?:|mailto:|#|\/)/.test(url)) return url;
  const [target, ...anchorParts] = url.split('#');
  if (!target.endsWith('.md')) return url;
  const anchor = anchorParts.length ? `#${anchorParts.join('#')}` : '';
  const rel = target.slice(0, -'.md'.length);
  const segments = [];
  for (const part of `${base}/${rel}`.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') segments.pop();
    else segments.push(part);
  }
  // index.md / README.md are a folder's landing (idFor collapses them too), so
  // a link to one resolves to the folder itself — drop the trailing segment,
  // including the bare `index.md` at a tree/mount root.
  if (segments.length && /^(index|README)$/.test(segments.at(-1))) segments.pop();
  // The link is tree-root-relative; a non-'/' mount serves the tree under its
  // mountPath, so prepend it exactly as item @ids are prefixed (urlFor semantics)
  // — otherwise a cross-link under /docs would resolve to a bare /page and 404.
  const treePath = `/${segments.join('/')}`;
  const mounted = prefix && prefix !== '/' ? prefix + (treePath === '/' ? '' : treePath) : treePath;
  return `${mounted}${anchor}`;
}

/**
 * Rewrite a hand-authored RELATIVE media reference (an image or video block's
 * `url`) to the path the site serves — the media counterpart of
 * resolveMarkdownLink. The whole point of the markdown format is that a file
 * referenced on disk (relative to the authoring .md) also resolves on the site:
 * a docs page can point at `../images/x.png` and a page at the site root at
 * `./docs/static/demo.mp4`, and both resolve against the served tree. External
 * (`http:`), inline (`data:`), already-absolute (`/…`) and anchor urls pass
 * through untouched — only a genuinely relative path is rewritten. Unlike the
 * `.md` link resolver it keeps the filename (media isn't a folder index).
 */
export function resolveMediaUrl(url, base, prefix = '') {
  if (!url || /^(https?:|data:|mailto:|#|\/)/.test(url)) return url;
  const segments = [];
  for (const part of `${base}/${url}`.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') segments.pop();
    else segments.push(part);
  }
  const treePath = `/${segments.join('/')}`;
  return prefix && prefix !== '/' ? prefix + (treePath === '/' ? '' : treePath) : treePath;
}

/** Walk a decoded page and rewrite hand-authored relative references against
 *  `base`, prefixed by the mount path so they match the served @ids: every
 *  slate link's `.md` url, and every image/video block's media `url`. */
export function resolveMarkdownLinksInBlocks(node, base, prefix = '') {
  if (Array.isArray(node)) { node.forEach((n) => resolveMarkdownLinksInBlocks(n, base, prefix)); return node; }
  if (!node || typeof node !== 'object') return node;
  if (node.type === 'link' && node.data && typeof node.data.url === 'string') {
    node.data.url = resolveMarkdownLink(node.data.url, base, prefix);
  }
  if ((node['@type'] === 'image' || node['@type'] === 'video') && typeof node.url === 'string') {
    node.url = resolveMediaUrl(node.url, base, prefix);
  }
  for (const value of Object.values(node)) resolveMarkdownLinksInBlocks(value, base, prefix);
  return node;
}

const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.avif': 'image/avif',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.pdf': 'application/pdf', '.zip': 'application/zip',
};
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.avif']);
export const BLOB_FIELD = { Image: 'image', File: 'file' };

/**
 * What a blob's content object looks like when nothing is set.
 *
 * Held in one place because the exporter writes only what DIFFERS from this
 * and the reader restores the rest -- two lists would drift, and the field
 * that went missing would just be quietly absent.
 */
export function blobDefaults(type, filename) {
  return {
    title: filename,
    description: '',
    rights: '',
    exclude_from_nav: true,
    language: '##DEFAULT##',
    subjects: [],
    creators: ['admin'],
    contributors: [],
    allow_discussion: false,
    review_state: null,
    effective: null,
    expires: null,
    layout: type === 'Image' ? 'image_view' : 'file_view',
  };
}
const typeForFile = (f) => (IMAGE_EXT.has(extname(f).toLowerCase()) ? 'Image' : 'File');

/**
 * Width and height from the file itself.
 *
 * The format rests on these not being stored. A stored width can drift from
 * the file it describes; a computed one cannot — and one had already drifted:
 * an mp4 recorded 374638 bytes for a 433934-byte file.
 */
export function dimensions(file) {
  const b = readFileSync(file);
  const ext = extname(file).toLowerCase();
  if (ext === '.png') return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (ext === '.jpg' || ext === '.jpeg') {
    let i = 2;
    while (i < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      // SOF0..SOF15, excluding the non-frame markers in that range
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      }
      i += 2 + b.readUInt16BE(i + 2);
    }
    throw new Error(`no SOF marker in ${file}`);
  }
  if (ext === '.svg') {
    const t = b.toString('utf8', 0, 2000);
    const w = /\bwidth="([\d.]+)/.exec(t), h = /\bheight="([\d.]+)/.exec(t);
    if (w && h) return { width: Number(w[1]), height: Number(h[1]) };
    const vb = /viewBox="[\d.]+ [\d.]+ ([\d.]+) ([\d.]+)"/.exec(t);
    if (vb) return { width: Number(vb[1]), height: Number(vb[2]) };
    throw new Error(`no dimensions in ${file}`);
  }
  throw new Error(`unsupported image type ${ext}`);
}

/** A folder's `exclude:` manifest — the children it is NOT the parent of. It
 *  rides in the same per-folder frontmatter as `order:`, so it is recursive:
 *  each folder's index.md (or README.md) names the child dirs/files under IT to
 *  skip. Entries are child names relative to the folder and may glob (`test-*`),
 *  mirroring Sphinx's exclude_patterns. Parsed straight from the YAML block so
 *  the walk can consult it before decoding anything. */
export function folderExcludes(dir) {
  const idx = existsSync(join(dir, 'index.md')) ? join(dir, 'index.md')
    : existsSync(join(dir, 'README.md')) ? join(dir, 'README.md') : null;
  if (!idx) return () => false;
  const fm = /^---\n([\s\S]*?)\n---/.exec(readFileSync(idx, 'utf8'));
  if (!fm) return () => false;
  const m = /^exclude:\n((?:[ \t]*-[ \t]*.*\n?)+)/m.exec(fm[1]);
  if (!m) return () => false;
  const patterns = m[1].split('\n')
    .map((l) => l.replace(/^[ \t]*-[ \t]*/, '').trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean)
    .map((p) => new RegExp(`^${p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`));
  return (name) => patterns.some((re) => re.test(name));
}

/** The tree's `.blockmdignore` — a top-level, gitignore-syntax file naming the
 *  paths the mount must NOT walk into content (asset/build dirs, fixtures). It
 *  replaces the old per-folder `exclude:` frontmatter: one file, standard git
 *  patterns, matched against each path relative to the tree root — so a pattern
 *  works from the top level. The export never touches this file; it just
 *  rewrites the .md bodies, so what is content vs. asset stays defined here. */
function loadIgnore(root) {
  const ig = ignore();
  const f = join(root, '.blockmdignore');
  if (existsSync(f)) ig.add(readFileSync(f, 'utf8'));
  return ig;
}

function walk(dir, ig, root, hits = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const isDir = statSync(p).isDirectory();
    const rel = relative(root, p);
    if (rel && ig.ignores(isDir ? `${rel}/` : rel)) continue;
    if (isDir) walk(p, ig, root, hits);
    else hits.push(p);
  }
  return hits;
}

/** A markdown tree is one with an index.md (or README.md) at its root. */
export function isMarkdownTree(dir) {
  return existsSync(join(dir, 'index.md')) || existsSync(join(dir, 'README.md'));
}

/** file path in the tree -> content path */
function idFor(root, file) {
  const rel = relative(root, file).replace(/\\/g, '/');
  // README.md and index.md are both a folder's landing page (as Sphinx and the
  // link resolver treat them), so both collapse to the folder's own path.
  if (rel === 'index.md' || rel === 'README.md') return '/';
  return `/${rel.replace(/\/(?:index|README)\.md$/, '').replace(/\.md$/, '')}`;
}

/**
 * Read the tree. Returns items keyed by content path, plus the blob file each
 * one came from so the server can hand over the bytes.
 *
 * `decode` turns one page's markdown into a content object (metadata + blocks +
 * blocks_layout, with `order`/`blobs` frontmatter passed through). It is
 * injectable so the mount and the CI agreement check share ONE tree reader; it
 * defaults to `decodeAuto` (the `<block>` prototype format). The tree/server-
 * state/blob logic below works on the returned object, not the body.
 */
const LANG_BY_EXT = {
  '.jsx': 'jsx', '.tsx': 'tsx', '.js': 'javascript', '.ts': 'typescript',
  '.vue': 'vue', '.svelte': 'svelte', '.astro': 'astro', '.py': 'python', '.json': 'json',
};

/** Apply a `{literalinclude}`'s slice options (`:lines:`, `:start-after:`,
 *  `:end-before:`, `:start-at:`, `:end-at:`) to a file's contents -- same
 *  semantics as Sphinx. `-after`/`-before` exclude the matched line's marker;
 *  `-at` keep the whole matched line, so a slice can anchor on the block's own
 *  markup (e.g. the opening `<block …>` tag) with no injected markers. */
function sliceInclude(code, opts) {
  let lines = code.split('\n');
  if (opts.lines) {
    const [a, b] = opts.lines.split('-').map((n) => parseInt(n, 10));
    lines = lines.slice(a - 1, b);
  }
  // All boundaries are LINE-based (Sphinx semantics): `-at` keeps the matched
  // line, `-after`/`-before` exclude it entirely — so a marker comment's own
  // line (and any text on it) never leaks into the slice.
  if (opts['start-at']) {
    const i = lines.findIndex((l) => l.includes(opts['start-at']));
    if (i >= 0) lines = lines.slice(i);
  }
  if (opts['start-after']) {
    const i = lines.findIndex((l) => l.includes(opts['start-after']));
    if (i >= 0) lines = lines.slice(i + 1);
  }
  if (opts['end-at']) {
    const i = lines.findIndex((l) => l.includes(opts['end-at']));
    if (i >= 0) lines = lines.slice(0, i + 1);
  }
  if (opts['end-before']) {
    const i = lines.findIndex((l) => l.includes(opts['end-before']));
    if (i >= 0) lines = lines.slice(0, i);
  }
  return lines.join('\n').replace(/^\n+|\n+$/g, '');
}

/** Slice one object literal `<name>: { … }` out of a JS/TS source by matching
 *  braces — the analog of Sphinx `:pyobject:`. Skips braces inside strings and
 *  comments, so it is robust to how the entry is formatted (compact or spread)
 *  and to `{`/`}` inside string values. Returns the text from the `<name>: {`
 *  through its matching `}`. `name` is found as a top-level (4-space) key. */
function sliceJsObject(code, name) {
  const key = new RegExp(`^    ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: \\{`, 'm');
  const km = key.exec(code);
  if (!km) throw new Error(`literalinclude :jsobject: "${name}" not found`);
  const start = km.index;
  let depth = 0, str = null, lineC = false, blockC = false;
  for (let i = code.indexOf('{', start); i < code.length; i++) {
    const c = code[i], n = code[i + 1];
    if (lineC) { if (c === '\n') lineC = false; continue; }
    if (blockC) { if (c === '*' && n === '/') { blockC = false; i++; } continue; }
    if (str) { if (c === '\\') i++; else if (c === str) str = null; continue; }
    if (c === '/' && n === '/') { lineC = true; i++; continue; }
    if (c === '/' && n === '*') { blockC = true; i++; continue; }
    if (c === "'" || c === '"' || c === '`') { str = c; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return code.slice(start, i + 1);
  }
  throw new Error(`literalinclude :jsobject: "${name}" is unterminated`);
}

/** Resolve Sphinx `{literalinclude}` directives to inline code fences, so the
 *  engine (and the rendered docs) show the referenced file's real code with no
 *  copy in the markdown. Honors :language:, :start-after:/:end-before:, :lines:,
 *  matching Sphinx so both renderers show the identical slice. Paths are relative
 *  to `baseDir` (the markdown file's directory). Fails loudly on a missing file. */
export function resolveLiteralIncludes(text, baseDir) {
  return text.replace(/```\{literalinclude\}[ \t]+(\S+)[ \t]*\n([\s\S]*?)```/g, (_m, relPath, body) => {
    const opts = {};
    for (const line of body.split('\n')) {
      const mm = /^:([a-z-]+):[ \t]*(.*)$/.exec(line.trim());
      if (mm) opts[mm[1]] = mm[2];
    }
    const file = join(baseDir, relPath);
    if (!existsSync(file)) throw new Error(`literalinclude: file not found: ${relPath} (from ${baseDir})`);
    const full = readFileSync(file, 'utf8');
    // `:jsobject: <name>` — include one object literal (a block definition from
    // shared-block-schemas.js) by brace-matching, the `:pyobject:` analog. Just
    // slices text; no evaluation.
    if (opts.jsobject) {
      const lang = opts.language || LANG_BY_EXT[extname(relPath).toLowerCase()] || 'javascript';
      return `\`\`\`${lang}\n${sliceJsObject(full, opts.jsobject)}\n\`\`\``;
    }
    // `:as: json` — the included slice IS markdown (a `.md` file decodes straight
    // to blocks), so instead of showing the raw text, decode it and show the block
    // JSON. This subsumes codeExample `source="…" format="json"`: an example page
    // self-slices its own block and shows the decoded value, still single-sourced
    // from the one authored instance. uid churn is filtered like
    // resolveCodeExampleSources (default `uids`); a `:filter: none` opt disables it.
    if (opts.as === 'json') {
      if (extname(relPath).toLowerCase() !== '.md') throw new Error(`literalinclude :as: json: ${relPath} is not a .md file (only markdown decodes to blocks)`);
      // Decode the slice with the SOURCE file's own prototypes (blocks-matched/
      // blocks-tagged) so it decodes identically to how it renders on the page,
      // but WITHOUT the page's blocks-assignments (we want only the sliced block).
      // Slice the BODY (frontmatter stripped) so a no-slice include doesn't
      // double the frontmatter; prepend the frontmatter once for the prototypes.
      const fmMatch = /^---\n[\s\S]*?\n---\n?/.exec(full);
      const fm = fmMatch ? fmMatch[0] : '---\n---\n';
      const body = fmMatch ? full.slice(fmMatch[0].length) : full;
      const decoded = decodePage(`${fm}${sliceInclude(body, opts)}\n`, { ignoreAssignments: true });
      const entries = Object.values(decoded.blocks || {});
      // `:block: <uid-or-@type>` selects one block by identity (the `:pyobject:`
      // analog) — source= parity with no text anchors, robust across re-emit.
      // Otherwise a single-block slice shows that block's data; a multi-block
      // slice shows the whole decoded structure.
      let shown;
      if (opts.block) {
        const match = (decoded.blocks || {})[opts.block] || entries.find((e) => e['@type'] === opts.block);
        if (!match) throw new Error(`literalinclude :block: ${opts.block} matched no block in ${relPath}`);
        const { '@uid': _u, ...data } = match; shown = data;
      } else if (entries.length === 1) { const { '@uid': _u, ...data } = entries[0]; shown = data; }
      else shown = decoded;
      const filters = new Set((opts.filter ?? 'uids').split(',').map((s) => s.trim()).filter(Boolean));
      if (filters.has('uids')) shown = normalizeNestedUids(shown);
      return `\`\`\`json\n${JSON.stringify(shown, null, 2)}\n\`\`\``;
    }
    const lang = opts.language || LANG_BY_EXT[extname(relPath).toLowerCase()] || '';
    return `\`\`\`${lang}\n${sliceInclude(full, opts)}\n\`\`\``;
  });
}

/** Build a `schemaFor(type) -> blockSchema` lookup from a block-schema registry.
 *  Handles both shapes the project uses:
 *   - FLAT (`shared-block-schemas` `sharedBlocksConfig`): `{ type: { blockSchema } }`
 *     — the complete registry the frontends register from (every block type).
 *   - PAGE-GROUPED (`block-definitions.json`): `{ pageKey: { blocks: { type: { blockSchema } } } }`.
 *  Using the same registry the frontends use means a schema shown on a doc page
 *  is the one that actually renders. */
export function schemaRegistryFromBlockDefinitions(registry) {
  const byType = new Map();
  for (const [key, def] of Object.entries(registry || {})) {
    if (def && def.blockSchema) byType.set(key, def.blockSchema);          // flat
    for (const [type, d] of Object.entries((def && def.blocks) || {})) {   // page-grouped
      if (d && d.blockSchema) byType.set(type, d.blockSchema);
    }
  }
  return (type) => byType.get(type);
}

/**
 * Resolve `<block type="codeExample" source="<selector>" format="json|schema">`
 * blocks on a decoded page — the single-source example views. Instead of a
 * hand-written copy that drifts, a codeExample POINTS at the real thing:
 *   - format="json"   -> the data of the block on this page whose uid or @type
 *                        matches `source` (the live example instance itself).
 *   - format="schema" -> the registry blockSchema for `source` (@type).
 * Its `tabs` are filled with that, so the code the reader sees IS the object that
 * renders / the schema that validates. Resolved at load/build time (mount +
 * gen-myst), so it works for served docs and static Sphinx alike, with no
 * per-frontend plumbing. A selector that matches nothing fails loud — a doc that
 * can't show its own example is a bug, not a blank. A codeExample without
 * `source` (a literalinclude / literal tabs block) is left untouched.
 */
/** Rename a block tree's NESTED uids to deterministic, typed names (`column-1`,
 *  `slate-1`, …) and update every blocks_layout reference. A container's child
 *  uids are runtime identity, like the top-level `@uid` — arbitrary and unstable
 *  (they auto-mint on decode). In an illustrative JSON view they're pure noise
 *  AND churn a re-export, so `filter="uids"` normalizes them: readable + stable. */
export function normalizeNestedUids(data) {
  const clone = structuredClone(data);
  const counters = {};
  const walk = (node, top) => {
    if (Array.isArray(node)) { node.forEach((n) => walk(n, false)); return; }
    if (!node || typeof node !== 'object') return;
    // An object_list item (a nested instance) carries an `@id` that is runtime
    // identity like the top-level `@uid` — drop it. A link ref is `{@id}` with no
    // `@type`, so it's left alone.
    if (!top && node['@type'] && '@id' in node) delete node['@id'];
    // A blocks container: rename its child uids (the dict keys) to deterministic,
    // typed names and update the blocks_layout references.
    if (node.blocks && node.blocks_layout) {
      const ordered = [];
      for (const key of Object.keys(node.blocks_layout)) for (const u of node.blocks_layout[key] || []) ordered.push(u);
      for (const u of Object.keys(node.blocks)) if (!ordered.includes(u)) ordered.push(u);
      const remap = {}; const next = {};
      for (const u of ordered) {
        const child = node.blocks[u];
        if (!child) continue;
        const t = child['@type'];
        const nn = `${t}-${counters[t] = (counters[t] || 0) + 1}`;
        remap[u] = nn; next[nn] = child;
      }
      node.blocks = next;
      for (const key of Object.keys(node.blocks_layout)) node.blocks_layout[key] = (node.blocks_layout[key] || []).map((u) => remap[u] ?? u);
    }
    for (const v of Object.values(node)) walk(v, false);
  };
  walk(clone, true);
  return clone;
}

export function resolveCodeExampleSources(page, { schemaFor } = {}) {
  const blocks = page && page.blocks;
  if (!blocks) return page;
  const byType = (t) => Object.entries(blocks).find(([, b]) => b['@type'] === t);
  for (const [id, b] of Object.entries(blocks)) {
    if (b['@type'] !== 'codeExample' || !b.source) continue;
    const { source, format } = b;
    // Which runtime fields to filter out of the shown JSON; defaults to `uids`.
    const filters = new Set((b.filter ?? 'uids').split(',').map((s) => s.trim()).filter(Boolean));
    if (format === 'json') {
      const target = blocks[source] || (byType(source) || [])[1];
      if (!target) throw new Error(`codeExample ${id}: source "${source}" matches no block (uid or @type) on the page`);
      const { '@uid': _u, ...data } = target; // @uid is runtime, not authored data
      const shown = filters.has('uids') ? normalizeNestedUids(data) : data;
      b.tabs = [{ '@id': `${id}-json`, '@type': 'tab', label: 'JSON', language: 'json', code: JSON.stringify(shown, null, 2) }];
    } else if (format === 'schema') {
      const schema = schemaFor && schemaFor(source);
      if (!schema) throw new Error(`codeExample ${id}: no schema for "${source}" in the block-definitions registry`);
      b.tabs = [{ '@id': `${id}-schema`, '@type': 'tab', label: 'Schema', language: 'json', code: JSON.stringify(schema, null, 2) }];
    } else {
      throw new Error(`codeExample ${id}: source "${source}" set but format="${format}" (expected json|schema)`);
    }
    // `source`/`format`/`filter` are mount-time directives, now consumed into
    // `tabs`. Drop them so they never ship as served data — and so a `--markdown`
    // export re-emits a plain codeExample (no hoisted `<fields source=…>`
    // wrapper) that the post-export directive restore maps cleanly back.
    delete b.source; delete b.format; delete b.filter;
  }
  return page;
}

export function readTree(root, { decode = decodeAuto, prefix = '', schemaFor } = {}) {
  const items = new Map();
  const blobFiles = new Map();      // content path -> absolute file path
  const order = new Map();          // folder path -> child ids, in order
  // Ids whose source is a folder landing (`X/index.md` or `X/README.md`), so a
  // re-export writes them back as a folder — not `X.md` — preserving the
  // AUTHORED file form (some folderish pages are authored flat, some as a
  // folder landing; imposing a rule either way churns the source).
  const folderForm = new Set();

  const ig = loadIgnore(root);
  for (const file of walk(root, ig, root)) {
    if (!file.endsWith('.md')) continue;
    // `{literalinclude}` references are resolved to inline code before decoding,
    // so a codeExample tab shows the referenced file's real code with no copy.
    const page = decode(resolveLiteralIncludes(readFileSync(file, 'utf8'), dirname(file)));
    const id = idFor(root, file);
    page['@id'] = id;
    if (/(?:^|[/\\])(index|README)\.md$/i.test(file)) folderForm.add(id);

    // Rewrite hand-authored .md cross-links to served paths, against this page's
    // own directory relative to the root (root '' for the site root).
    if (page.blocks) resolveMarkdownLinksInBlocks(page.blocks, relative(root, dirname(file)), prefix);
    // Fill any `source=`/`format=` codeExample from the live instance / registry,
    // so an example page's shown JSON/schema IS what renders (single source). It
    // reads the AUTHORED block (a link is its lean `[{'@id'}]` reference), which
    // is exactly what a reader should see — the served summary is resolved later.
    if (page.blocks) resolveCodeExampleSources(page, { schemaFor });

    // `order:`, `exclude:` and `blobs:` describe the FOLDER (nav order, which
    // children are not pages, attached bytes) — not the page's own content, so
    // they never leak into the served item. `exclude:` was already consumed by
    // the walk above; drop it here too.
    if (page.order) { order.set(id, page.order); delete page.order; }
    delete page.exclude;
    const blobs = page.blobs || [];
    delete page.blobs;
    items.set(id, page);

    // A content item's OWN image/file field (a leadimage, an attached File)
    // ships its bytes too. Its blob_path is root-relative, as an exported item
    // carries it; register the bytes under the item's own path so the server —
    // and an export — resolves them just like a `blobs:` child. A MISSING file
    // is a warning, not a throw: generated media (editor screenshots, the demo
    // video) is git-ignored and may be absent on a fresh checkout / cache miss,
    // and the mount must still boot so those very images can be generated
    // against it. The item serves without its bytes (they 404 until made); the
    // fatal "all referenced media exist" check runs LAST, after generation.
    for (const field of Object.values(BLOB_FIELD)) {
      const bpath = page[field] && page[field].blob_path;
      if (!bpath) continue;
      const blob = join(root, bpath);
      if (!existsSync(blob)) {
        console.warn(`[markdown-mount] ${id}: ${field}.blob_path ${bpath} is not on disk — serving without bytes (regenerate it; the reference 404s until then)`);
        continue;
      }
      blobFiles.set(id, blob);
    }

    for (const entry of blobs) {
      const blob = join(dirname(file), entry.file);
      const ext = extname(entry.file).toLowerCase();
      if (!MIME[ext]) throw new Error(`${id}: no content type known for ${entry.file}`);
      // A missing blob file is a WARNING, not a skip: still register the ITEM so
      // the content graph stays complete (an image block referencing it resolves,
      // so discovery / checkIntegrity don't flag it) — only the BYTES are absent,
      // and the blob 404s until regenerated. page-integrity (sanity, after
      // generation) is what notices a truly-absent image, not the mount/discovery.
      const onDisk = existsSync(blob);
      if (!onDisk) {
        console.warn(`[markdown-mount] ${id}: blobs lists ${entry.file}, which is not on disk — registering the item without bytes (regenerate it; the reference 404s until then)`);
      }
      // Keep the extension in the content id (…/accordion-edit.png), so the id
      // matches the file: a Sphinx image ref (/docs/images/x.png) and the loader's
      // served path line up with no stripping. (The penguins already do this via
      // an explicit `id:`.)
      const bid = entry.id ?? entry.file;
      const type = entry.type ?? typeForFile(entry.file);
      // Only images have pixel dimensions; a video or a PDF has size and type.
      // With no file on disk there are no bytes to measure — size 0, no dims.
      const meta = { filename: entry.file, 'content-type': MIME[ext], size: onDisk ? statSync(blob).size : 0 };
      if (type === 'Image' && onDisk) Object.assign(meta, dimensions(blob));
      const bpath = `${id === '/' ? '' : id}/${bid}`;
      // The entry carries only what differs from the defaults; the rest is
      // restored. `blob_path` is what makes the server's existing transform
      // add the download URL and the scale set, so a blob served from
      // markdown looks the same as one served from JSON.
      const { file: _f, uid: _u, id: _i, type: _t, ...overrides } = entry;
      items.set(bpath, {
        '@id': bpath,
        '@type': type,
        UID: entry.uid,
        id: bid,
        ...blobDefaults(type, entry.file),
        ...overrides,
        [BLOB_FIELD[type]]: { blob_path: relative(root, blob), ...meta },
      });
      if (onDisk) blobFiles.set(bpath, blob);
    }
  }

  normalizeInstanceTemplateFields(items);
  resolveLinkSummaries(items, { schemaFor, prefix });
  deriveServerState(items, order);
  return { items, blobFiles, order, folderForm };
}

// The markdown mount stores a link to a local object as the bare, non-stale
// reference `[{'@id':'/path'}]` — the readable form, and the one that can't go
// stale because the label lives on the target, not the link. Volto snapshots a
// block link's summary at edit time and NEVER re-resolves it, so the
// DISTRIBUTION this builds (what gets imported) must already carry the summary,
// or the deployed teaser/link ships with no title/description. So fill it here,
// at decode, from the local target — driven by the WIDGET (an `object_browser`
// field), never the field name: `href` is object_browser on a teaser but a
// plain url string on a card, so only the schema knows which is a link. A
// `url`-widget field is an external string and is left alone; an `@id` that
// resolves to no local object (external / not in this tree) stays bare.
export function resolveLinkSummaries(items, { schemaFor, prefix = '' } = {}) {
  if (!schemaFor) return items; // widget-driven: no schema, nothing to key on
  const localId = (id) => (prefix && id.startsWith(prefix) ? id.slice(prefix.length) : id) || '/';
  const isBareLink = (o) => o && typeof o === 'object' && !Array.isArray(o)
    && typeof o['@id'] === 'string' && Object.keys(o).length === 1;

  const summary = (id, target) => {
    // Mirror the server serializer's teaser summary. image_field names WHICH
    // field a teaser pulls its preview from: an Image / a lead `image` field ->
    // 'image'; a `preview_image` -> 'preview_image'; nothing -> '' (no preview).
    const leadImage = !!(target.image && (target.image.blob_path || target.image.width));
    const hasPreview = !!(target.preview_image || target['@type'] === 'Image');
    const imageField = (target['@type'] === 'Image' || leadImage) ? 'image'
      : (hasPreview ? 'preview_image' : '');
    return {
      '@id': id,
      '@type': target['@type'],
      Title: target.title ?? null,
      Description: target.description ?? '',
      title: target.title ?? null,
      head_title: target.head_title ?? null,
      getRemoteUrl: target.getRemoteUrl ?? null,
      hasPreviewImage: hasPreview,
      image_field: imageField,
    };
  };

  // Fill a single object_browser field value in place. The widget stores the
  // object-list-of-one shape Volto uses, `[{'@id'}]`; a value already carrying a
  // summary (the snapshot form) is left untouched, so this only ever ENRICHES a
  // bare reference and can't overwrite authored data.
  const fillField = (value) => {
    if (!Array.isArray(value)) return value;
    return value.map((el) => {
      if (!isBareLink(el)) return el;
      const target = items.get(localId(el['@id']));
      return target ? summary(el['@id'], target) : el; // unresolvable -> keep bare
    });
  };

  const fillBlock = (block) => {
    if (!block || typeof block !== 'object') return;
    const schema = block['@type'] ? schemaFor(block['@type']) : null;
    if (schema && schema.properties) {
      for (const [field, def] of Object.entries(schema.properties)) {
        const v = block[field];
        if (v == null) continue;
        if (def.widget === 'object_browser') {
          block[field] = fillField(v);
        } else if (def.widget === 'object_list' && Array.isArray(v) && def.schema && def.schema.properties) {
          // Items are block instances; fill THEIR object_browser fields, and
          // recurse into any content blocks they hold (a teaser inside a panel).
          const itemProps = def.schema.properties;
          for (const item of v) {
            if (!item || typeof item !== 'object') continue;
            for (const [f, d] of Object.entries(itemProps)) {
              if (d.widget === 'object_browser' && item[f] != null) item[f] = fillField(item[f]);
            }
            if (item.blocks && typeof item.blocks === 'object') {
              for (const child of Object.values(item.blocks)) fillBlock(child);
            }
          }
        }
      }
    }
    // A container block holds its children in a shared `blocks` dict; recurse so
    // a link nested in a column / accordion panel is filled too.
    if (block.blocks && typeof block.blocks === 'object' && !Array.isArray(block.blocks)) {
      for (const child of Object.values(block.blocks)) fillBlock(child);
    }
  };

  for (const [, page] of items) {
    if (page.blocks && typeof page.blocks === 'object') {
      for (const block of Object.values(page.blocks)) fillBlock(block);
    }
  }
  return items;
}

/**
 * A block placed in a page's `<fields templateId=… templateInstanceId=…>` region
 * fills a template slot, and forced-layout expansion (helpers/fillRegionEntries)
 * renders it only if it carries a `slotId` (the slot branch) — the author writes
 * that. But the content model also asks a slot-fill to declare `fixed` and
 * `readOnly`: a page slot-fill is, by definition, editable page content in a slot
 * (`fixed:false`, `readOnly:false`), and stating it keeps the coupling the
 * validator enforces (any templateId block declares slotId + fixed + readOnly).
 * Authors would never write those two on every slot-fill, so synthesise them here
 * — the "in emit, not by hand" half of the rule. An explicit value the author DID
 * write (a readonly note: `readOnly:true`) is left untouched.
 *
 * Only INSTANCES are normalised, never a TEMPLATE's own definition blocks: a
 * template block's `fixed` is load-bearing (it decides chrome vs slot) and must
 * stay explicit so a forgotten one is caught, not defaulted. "Is a template" is
 * the same content-inferred test the validator uses — a page whose own blocks
 * point their templateId at ITSELF.
 */
function normalizeInstanceTemplateFields(items) {
  for (const [, page] of items) {
    const blocks = page.blocks || {};
    const top = (page.blocks_layout || {}).items || [];
    const own = new Set([page.UID && `resolveuid/${page.UID}`, page['@id']].filter(Boolean));
    const isTemplate = top.some((bid) => blocks[bid] && own.has(blocks[bid].templateId));
    if (isTemplate) continue;
    const walk = (container) => {
      for (const block of Object.values(container.blocks || {})) {
        if (!block || typeof block !== 'object') continue;
        // Only a block that actually fills a slot (templateId + slotId). A
        // templateId block with NO slotId is the render bug — leave it bare so
        // the validator flags it rather than papering it over with defaults.
        if (block.templateId && block.slotId) {
          if (typeof block.fixed !== 'boolean') block.fixed = false;
          if (typeof block.readOnly !== 'boolean') block.readOnly = false;
        }
        walk(block);
      }
    };
    walk(page);
  }
}

/** Everything the markdown deliberately does not store, from tree position. */
function deriveServerState(items, order) {
  const parentPathOf = (p) => (p === '/' ? null : (p.slice(0, p.lastIndexOf('/')) || '/'));

  const childCount = new Map();
  for (const path of items.keys()) {
    const parent = parentPathOf(path);
    if (parent !== null) childCount.set(parent, (childCount.get(parent) ?? 0) + 1);
  }

  for (const [path, item] of items) {
    if (!item.id) item.id = path === '/' ? '' : path.slice(path.lastIndexOf('/') + 1);
    // is_folderish is authored, not tree-derivable: a Plone Document is folderish
    // whether or not it currently holds children (folderish behaviour on the
    // type). Respect the stored value; only fall back to "has children" for a
    // blob or a page that never carried one.
    if (item.is_folderish === undefined) item.is_folderish = (childCount.get(path) ?? 0) > 0;

    const parentPath = parentPathOf(path);
    const parent = parentPath === null ? null : items.get(parentPath);
    if (parent) {
      item.parent = {
        '@id': parentPath,
        '@type': parent['@type'],
        UID: parent.UID,
        title: parent.title,
        description: parent.description ?? '',
      };
    }

    // Sibling order, from the folder's `order:` list. A child the list does
    // not name gets no position rather than a made-up one, which is what
    // `getObjPositionInParent` means.
    const siblings = parentPath === null ? null : order.get(parentPath);
    const at = siblings ? siblings.indexOf(item.id) : -1;
    if (at >= 0) item.getObjPositionInParent = at;
  }
}
