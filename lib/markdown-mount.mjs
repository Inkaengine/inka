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

function walk(dir, hits = []) {
  const isExcluded = folderExcludes(dir);
  for (const name of readdirSync(dir)) {
    if (isExcluded(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, hits);
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
 *  `:end-before:`) to a file's contents -- same semantics as Sphinx. */
function sliceInclude(code, opts) {
  let lines = code.split('\n');
  if (opts.lines) {
    const [a, b] = opts.lines.split('-').map((n) => parseInt(n, 10));
    lines = lines.slice(a - 1, b);
  }
  let text = lines.join('\n');
  if (opts['start-after']) {
    const i = text.indexOf(opts['start-after']);
    if (i >= 0) text = text.slice(i + opts['start-after'].length);
  }
  if (opts['end-before']) {
    const i = text.indexOf(opts['end-before']);
    if (i >= 0) text = text.slice(0, i);
  }
  return text.replace(/^\n+|\n+$/g, '');
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
    const code = sliceInclude(readFileSync(file, 'utf8'), opts);
    const lang = opts.language || LANG_BY_EXT[extname(relPath).toLowerCase()] || '';
    return `\`\`\`${lang}\n${code}\n\`\`\``;
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
export function resolveCodeExampleSources(page, { schemaFor } = {}) {
  const blocks = page && page.blocks;
  if (!blocks) return page;
  const byType = (t) => Object.entries(blocks).find(([, b]) => b['@type'] === t);
  for (const [id, b] of Object.entries(blocks)) {
    if (b['@type'] !== 'codeExample' || !b.source) continue;
    const { source, format } = b;
    if (format === 'json') {
      const target = blocks[source] || (byType(source) || [])[1];
      if (!target) throw new Error(`codeExample ${id}: source "${source}" matches no block (uid or @type) on the page`);
      const { '@uid': _u, ...data } = target; // @uid is runtime, not authored data
      b.tabs = [{ '@id': `${id}-json`, '@type': 'tab', label: 'JSON', language: 'json', code: JSON.stringify(data, null, 2) }];
    } else if (format === 'schema') {
      const schema = schemaFor && schemaFor(source);
      if (!schema) throw new Error(`codeExample ${id}: no schema for "${source}" in the block-definitions registry`);
      b.tabs = [{ '@id': `${id}-schema`, '@type': 'tab', label: 'Schema', language: 'json', code: JSON.stringify(schema, null, 2) }];
    } else {
      throw new Error(`codeExample ${id}: source "${source}" set but format="${format}" (expected json|schema)`);
    }
  }
  return page;
}

export function readTree(root, { decode = decodeAuto, prefix = '', schemaFor } = {}) {
  const items = new Map();
  const blobFiles = new Map();      // content path -> absolute file path
  const order = new Map();          // folder path -> child ids, in order

  for (const file of walk(root)) {
    if (!file.endsWith('.md')) continue;
    // `{literalinclude}` references are resolved to inline code before decoding,
    // so a codeExample tab shows the referenced file's real code with no copy.
    const page = decode(resolveLiteralIncludes(readFileSync(file, 'utf8'), dirname(file)));
    const id = idFor(root, file);
    page['@id'] = id;

    // Rewrite hand-authored .md cross-links to served paths, against this page's
    // own directory relative to the root (root '' for the site root).
    if (page.blocks) resolveMarkdownLinksInBlocks(page.blocks, relative(root, dirname(file)), prefix);
    // Fill any `source=`/`format=` codeExample from the live instance / registry,
    // so an example page's shown JSON/schema IS what renders (single source).
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
  deriveServerState(items, order);
  return { items, blobFiles, order };
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
