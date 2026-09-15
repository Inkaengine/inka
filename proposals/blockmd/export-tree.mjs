#!/usr/bin/env node
/**
 * Plone content tree -> a README-shaped markdown tree.
 *
 *   node export-tree.mjs [--out DIR]
 *
 * One file type. A page is a `.md`; a folder is a directory holding `index.md`;
 * a blob is an ordinary file next to the markdown that references it.
 *
 * Nothing needs a sidecar. What a `.png` cannot carry -- its UID, and the few
 * fields that are not derivable from the file -- goes in the parent's
 * `index.md` frontmatter under `contents:`, alongside where the toctree already
 * records page order. Everything else about an image (width, height, size,
 * content-type, filename) is computed from the file when it is served, which
 * is better than storing it: a stored width can drift from the file, a
 * computed one cannot.
 *
 * Read-only by design. Nothing writes back into the CMS, so there is no merge
 * and no id-stability problem to solve here.
 */
import {
  readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync,
  statSync, copyFileSync,
} from 'fs';
import { join, dirname, resolve, extname, basename } from 'path';
import { fileURLToPath } from 'url';
import YAML from 'yaml';
import { pageToMd, SERVER_STATE } from '../../lib/blockmd.mjs';
import { blobDefaults } from '../../lib/markdown-mount.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const INKA = resolve(HERE, '../..');
const SITE = resolve(INKA, '..');

/**
 * The trees to convert. `toc` is the authored Sphinx source whose {toctree}
 * gives sibling order; the site tree is authored as JSON and has none, so its
 * order comes from its own __metadata__.json.
 */
const TREES = {
  docs: {
    src: resolve(INKA, 'docs/content/content/content'),
    out: resolve(INKA, 'docs/content-md'),
    toc: { root: resolve(INKA, 'docs'), mount: '/docs' },
  },
  site: {
    src: resolve(SITE, 'content/content'),
    out: resolve(SITE, 'content-md'),
    toc: null,
  },
};

const which = process.argv.find((a) => TREES[a]) ?? null;
const outArg = process.argv.indexOf('--out');

const schema = existsSync(join(HERE, 'schemas.json'))
  ? JSON.parse(readFileSync(join(HERE, 'schemas.json'), 'utf8')) : {};
schema._markdown = existsSync(join(HERE, 'markdown-roles.json'))
  ? JSON.parse(readFileSync(join(HERE, 'markdown-roles.json'), 'utf8')) : {};

/**
 * Sibling order, from the authored {toctree}.
 *
 * This is the only place order is authored. __metadata__.json's `ordering` is
 * a lossy derivation of it -- children with no position at all, and colliding
 * positions -- so it is read from the source rather than carried forward.
 *
 * The exported index.md's body is generated from the page's blocks, so a
 * toctree written into it would parse back as a code-fence block. The toctree
 * is therefore the SOURCE of order; the exported tree RECORDS it in the
 * folder's frontmatter.
 */
function toctreeOrder(toc, contentPath) {
  if (!toc) return null;
  const rel = contentPath === toc.mount ? '' : contentPath.replace(`${toc.mount}/`, '');
  for (const name of ['index.md', 'README.md']) {
    const f = join(toc.root, rel, name);
    if (!existsSync(f)) continue;
    const m = /```\{toctree\}([\s\S]*?)```/.exec(readFileSync(f, 'utf8'));
    if (!m) return null;
    return m[1].split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith(':'))
      .map((l) => l.replace(/.*<(.*)>/, '$1').split('/')[0]);
  }
  return null;
}

function walk(dir, hits = []) {
  if (!existsSync(dir)) return hits;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, hits);
    else if (name === 'data.json') hits.push(p);
  }
  return hits;
}

function exportTree(name, { src: SRC, out: OUT, toc }) {
  // ------------------------------------------------------------- load ----
const items = [];
for (const f of walk(SRC)) {
  let d;
  try { d = JSON.parse(readFileSync(f, 'utf8')); } catch { continue; }
  if (!d['@id']) continue;
  items.push({ data: d, dir: dirname(f) });
}
// The site root calls itself "/Plone" while every child says its parent is
// "/". Canonicalise to "/" so the two halves agree and the root owns the tree.
const ROOT_ID = items.find((i) => i.data['@type'] === 'Plone Site')?.data['@id'];
const canon = (id) => (id === ROOT_ID ? '/' : id);

// Which field holds the binary, by content type.
const BLOB_FIELD = { Image: 'image', File: 'file' };
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.avif']);
const typeForFile = (f) => (IMAGE_EXT.has(extname(f).toLowerCase()) ? 'Image' : 'File');

// A folder is anything another item names as its parent.
const hasChildren = new Set();
for (const { data } of items) {
  const p = (data.parent || {})['@id'];
  if (p) hasChildren.add(canon(p));
}

/** Content path -> file path in the exported tree. */
function pathFor(id, folderish) {
  const rel = canon(id).replace(/^\//, '');
  if (!rel) return 'index.md';
  return folderish ? `${rel}/index.md` : `${rel}.md`;
}

// ------------------------------------------------------------- export ----
if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });

// Blob metadata, grouped by the folder whose index.md will carry it.
const blobsByFolder = new Map();  // folder @id -> blob entries
let pages = 0, blobs = 0; const skipped = [];

for (const { data, dir } of items) {
  const id = canon(data['@id']);
  const parentId = canon((data.parent || {})['@id'] ?? '');

  // --- a blob: the binary goes next to the markdown, identity to the parent.
  // Not just images -- a video or a PDF is a Plone File with a `file` field
  // instead of an `image` one, and the docs already carry an mp4.
  const blobField = BLOB_FIELD[data['@type']];
  if (blobField && data[blobField]?.blob_path) {
    const meta = data[blobField];
    const src = join(SRC, meta.blob_path);
    if (!existsSync(src)) { skipped.push(`${id}: blob missing at ${meta.blob_path}`); continue; }
    // The blob keeps its own filename; the content id is a separate thing.
    // /docs/examples/content-types/image-dark holds "black-starry-night.jpg",
    // and /images/penguin2.jpg has an id that includes the extension. Deriving
    // either from the other is wrong in both directions.
    const file = meta.filename || basename(src);
    const destDir = join(OUT, parentId.replace(/^\//, ''));
    mkdirSync(destDir, { recursive: true });
    copyFileSync(src, join(destDir, file));
    blobs++;

    // Only what the file cannot tell us. Defaults stay unwritten: title is the
    // filename for 38 of 43, and layout/language/subjects/creators are the
    // same value on every one.
    const entry = { file, uid: data.UID };
    // id defaults to the filename without its extension; record it when it isn't.
    if (data.id !== file.replace(/\.[^.]+$/, '')) entry.id = data.id;
    // The content type is derived from the extension; record it when it isn't
    // what the extension implies, rather than making every entry carry it.
    if (data['@type'] !== typeForFile(file)) entry.type = data['@type'];
    // Everything else that differs from the defaults. Comparing against the
    // shared defaults rather than naming fields means a field nobody thought
    // of is kept, not silently dropped.
    const defaults = blobDefaults(data['@type'], meta.filename);
    for (const [k, v] of Object.entries(defaults)) {
      if (data[k] !== undefined && JSON.stringify(data[k]) !== JSON.stringify(v)) entry[k] = data[k];
    }
    if (!blobsByFolder.has(parentId)) blobsByFolder.set(parentId, []);
    blobsByFolder.get(parentId).push(entry);
    continue;
  }

  // --- a page
  const folderish = hasChildren.has(id) || data['@type'] === 'Plone Site';
  const dest = join(OUT, pathFor(id, folderish));
  mkdirSync(dirname(dest), { recursive: true });
  const md = data.blocks && Object.keys(data.blocks).length
    ? pageToMd(data, schema)
    : `---\n${YAML.stringify(Object.fromEntries(
        Object.entries(data).filter(([k]) => !SERVER_STATE.has(k)),
      )).trim()}\n---\n`;
  writeFileSync(dest, md);
  pages++;
}

// --- folder-level facts: which blobs it holds, and what order its children go
// in. Both belong to the FOLDER rather than to any child, so both live in the
// folder's own frontmatter.
const childrenOf = new Map();
for (const { data } of items) {
  const pid = canon((data.parent || {})['@id'] ?? '');
  if (!pid || !data.id) continue;
  if (!childrenOf.has(pid)) childrenOf.set(pid, []);
  childrenOf.get(pid).push(data.id);
}

for (const folderId of new Set([...blobsByFolder.keys(), ...childrenOf.keys()])) {
  const target = join(OUT, pathFor(folderId, true));
  if (!existsSync(target)) {
    // A folder with children but no page of its own has nowhere to record
    // them. Fail loudly rather than invent a home silently.
    skipped.push(`${folderId}: has children but no index.md`);
    continue;
  }
  const text = readFileSync(target, 'utf8');
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  const front = m ? YAML.parse(m[1]) ?? {} : {};

  const listed = toctreeOrder(toc, folderId);
  const present = childrenOf.get(folderId) ?? [];
  if (listed) {
    // Anything the toctree does not name keeps document order after it,
    // rather than being dropped or silently sorted.
    const known = listed.filter((id) => present.includes(id));
    front.order = [...known, ...present.filter((id) => !known.includes(id))];
  } else if (present.length > 1) {
    front.order = present;
  }
  if (blobsByFolder.has(folderId)) front.blobs = blobsByFolder.get(folderId);

  const rest = m ? text.slice(m[0].length) : text;
  writeFileSync(target, `---\n${YAML.stringify(front).trim()}\n---\n${rest ? `\n${rest.replace(/^\n+/, '')}` : ''}`);
}

  console.log(`${name}: ${pages} pages, ${blobs} blobs -> ${OUT}`);
  if (skipped.length) {
    console.log(`  not exported (${skipped.length}):`);
    for (const x of skipped) console.log(`    ${x}`);
  }
}

for (const [name, cfg] of Object.entries(TREES)) {
  if (which && which !== name) continue;
  const out = outArg > -1 ? resolve(process.argv[outArg + 1]) : cfg.out;
  exportTree(name, { ...cfg, out });
}
