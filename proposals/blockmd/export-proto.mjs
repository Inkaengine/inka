#!/usr/bin/env node
/**
 * Convert the docs content tree to the prototype-mapping markdown format,
 * emitting THROUGH the engine (emitPage) so emit and decode share one
 * implementation and verify-on-emit guarantees the round-trip. A block the
 * clean prototypes can't carry falls back to a tier-3 data tag, never lost.
 *
 *   node proposals/blockmd/export-proto.mjs [--out DIR]
 */
import {
  readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync, statSync, copyFileSync,
} from 'fs';
import { join, dirname, resolve, basename, extname, relative } from 'path';
import { fileURLToPath } from 'url';
import YAML from 'yaml';
import { SERVER_STATE } from '../../lib/blockmd.mjs';
import { blobDefaults, BLOB_FIELD } from '../../lib/markdown-mount.mjs';
import { parsePrototypes, emitPage } from '../../lib/prototype-mapping.mjs';

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.avif']);
const typeForFile = (f) => (IMAGE_EXT.has(extname(f).toLowerCase()) ? 'Image' : 'File');

const HERE = dirname(fileURLToPath(import.meta.url));
const INKA = resolve(HERE, '../..');
const srcArg = process.argv.indexOf('--src');
const SRC = srcArg > -1 ? resolve(process.argv[srcArg + 1]) : resolve(INKA, 'docs/content/content/content');
const outArg = process.argv.indexOf('--out');
const OUT = outArg > -1 ? resolve(process.argv[outArg + 1]) : resolve(INKA, 'docs/content-md-proto');

// A codeExample fence whose code IS a renderer file becomes a `{literalinclude}`
// reference -- so the markdown points at the single source instead of copying it.
// (Hand-written snippets that match no file stay inline.) The mount's readTree
// resolves the reference back to the file's code, so the served content is
// identical; `{literalinclude}` paths are regenerated on every export, so they
// track wherever the doc tree moves.
const EX = resolve(INKA, 'docs/examples/examples');
const rendererByContent = new Map();
for (const fw of ['react', 'vue', 'svelte', 'astro']) {
  const dir = join(EX, fw);
  if (existsSync(dir)) for (const f of readdirSync(dir)) rendererByContent.set(readFileSync(join(dir, f), 'utf8').trim(), join(dir, f));
}
function referenceRenderers(markdown, destDir) {
  return markdown.replace(/```(\w+)\n([\s\S]*?)\n```/g, (m, lang, code) => {
    const file = rendererByContent.get(code.trim());
    return file ? `\`\`\`{literalinclude} ${relative(destDir, file)}\n:language: ${lang}\n\`\`\`` : m;
  });
}

// Emit-capable prototypes, one text block per type. Types not here (slateTable,
// gridBlock, the long tail) fall to tier-3 data tags automatically.
const PROTO_TEXT = {
  // slate is the catch-all; more specific same-specificity prototypes (title on an
  // h1) are declared AFTER it so they win the CSS cascade tie.
  slate: '<block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />',
  title: '<block type="title" _="${h1}" />',
  // `align: full` is the default separator style (34 of 56); declaring it here
  // makes those emit as a bare `---` and be restored on decode, while left/center
  // /background variants keep their explicit `<fields>`.
  separator: '<block type="separator" _="${hr}" styles={"align":"full"} />',
  button: '<block type="button" title="${p/text}" href="${p/link}" />',
  // href is @id-only (the heading's link); the teaser's rendered title/
  // description/hasPreviewImage are RESOLVED from the target by the mount, not
  // stored redundantly here. block.title (the heading text) is the teaser's own
  // override, shown only when overwrite is on.
  teaser: '<block type="teaser" title="${h/text}" href="${h/link}" description="${p/text}" />',
  // title comes from the markdown image's title-string (`![alt](url "title")`),
  // not a fixed default -- real image titles vary. align/size keep their
  // defaults; image_field (when present) spills to <fields>.
  image: [
    '<block type="image" description="${p?/text}" url="${img/src}" alt="${img?/alt}" title="${img?/title}" align="center" size="l" />',
    '<block type="image" url="${img/src}" alt="${img?/alt}" title="${img?/title}" align="center" size="l" />',
  ].join('\n'),
  slateTable: [
    '<block type="slateTable">',
    '  <region name="table.rows">',
    '    <block type="row">',
    '      <region name="cells">',
    '        <block type="cell" value="${td/slate}" />',
    '      </region>',
    '    </block>',
    '  </region>',
    '</block>',
  ].join('\n'),
  codeExample: [
    '<block type="codeExample">',
    '  <region name="tabs" widget="object_list">',
    '    <block type="tab" label="${h3/text}" language="${pre/lang}" code="${pre/text}" />',
    '  </region>',
    '</block>',
  ].join('\n'),
  gridBlock: [
    '<block type="gridBlock" headline="${h/text}">',
    '  <region name="items" widget="blocks_layout">',
    '    <block type="teaser" title="${h/text}" description="${p/text}" />',
    '  </region>',
    '</block>',
  ].join('\n'),
  accordion: [
    '<block type="accordion" right_arrows=true>',
    '  <region name="panels" widget="object_list">',
    '    <block type="panel" title="${h/text}" />',
    '  </region>',
    '</block>',
  ].join('\n'),
  // A slide is a teaser-shaped card: heading (title) + paragraph (description) +
  // image (preview_image, object-browser @id) + a button link (buttonText/href);
  // head_title/flagAlign the card can't carry spill into a per-slide <fields>.
  slider: [
    '<block type="slider">',
    '  <region name="slides" widget="object_list">',
    '    <block type="slide" title="${h/text}" head_title="${strong?/text}" description="${p/text}" buttonText="${p[2]/text}" href="${p[2]/link}" preview_image="${img/link}" />',
    '  </region>',
    '</block>',
  ].join('\n'),
  // A hero: h1 heading, a bold subheading, an italic (slate) description, and a
  // button link — captured positionally, the italic description only in this run.
  hero: '<block type="hero" heading="${h1/text}" subheading="${strong/text}" description="${em/richtext}" buttonText="${p/text}" buttonLink="${p/link}" />',
  // A columns block: a blocks_layout container whose region key is `columns`
  // (region name = layout key), each column a nested blocks_layout container
  // ordered under `items`. Its children are whatever bare markdown matches
  // (slates), so the region item proto is empty. Doubly nested — proves the
  // container path handles container-in-container.
  columns: [
    '<block type="columns">',
    '  <region name="columns" widget="blocks_layout">',
    '    <block type="column">',
    '      <region name="items" widget="blocks_layout" />',
    '    </block>',
    '  </region>',
    '</block>',
  ].join('\n'),
};
// Prototypes split into two frontmatter sections: `blocks-matched` (implicit --
// auto-matched from bare markdown, source order = cascade) and `blocks-tagged`
// (explicit -- require the tag). Section membership IS the explicit flag. Only
// these leaves auto-match; button/teaser overlap common patterns and containers
// need their tag (until greedy container matching lands), so those are tagged.
const MATCHED = new Set(['slate', 'title', 'separator', 'image', 'codeExample']);
const isMatched = (t) => MATCHED.has(t);
const textFor = (matched) => Object.entries(PROTO_TEXT)
  .filter(([t]) => isMatched(t) === matched).map(([, v]) => v).join('\n');
const PROTOS = [...parsePrototypes(textFor(true)), ...parsePrototypes(textFor(false), { explicit: true })];

/** The prototypes a page uses, as a frontmatter block scalar for one section. */
function sectionYaml(key, used, matched) {
  const lines = Object.entries(PROTO_TEXT)
    .filter(([t]) => used.has(t) && isMatched(t) === matched)
    .flatMap(([, txt]) => txt.split('\n'));
  return lines.length ? `${key}: |\n${lines.map((l) => `  ${l}`).join('\n')}` : '';
}

/** Every @type in a block tree, descending into nested blocks + object_list items.
 *  Assignments no longer carry the type, so the used-prototype set comes from here. */
function collectTypes(blocks, out = new Set()) {
  for (const b of Object.values(blocks || {})) {
    if (!b || typeof b !== 'object') continue;
    if (b['@type']) out.add(b['@type']);
    if (b.blocks) collectTypes(b.blocks, out);
    for (const v of Object.values(b)) if (Array.isArray(v)) for (const it of v) if (it && it.blocks) collectTypes(it.blocks, out);
  }
  return out;
}

const flow = (o) => `{ ${Object.entries(o).map(([k, v]) => `${k}: ${v}`).join(', ')} }`;

// Sibling order comes from the authored Sphinx {toctree}, not the lossy
// __metadata__.json ordering. Recorded in the folder's own frontmatter; the
// mount reads it back into getObjPositionInParent / uidPositionMap.
const TOC = { root: resolve(INKA, 'docs'), mount: '/docs' };
function toctreeOrder(contentPath) {
  const rel = contentPath === TOC.mount ? '' : contentPath.replace(`${TOC.mount}/`, '');
  for (const name of ['index.md', 'README.md']) {
    const f = join(TOC.root, rel, name);
    if (!existsSync(f)) continue;
    const m = /```\{toctree\}([\s\S]*?)```/.exec(readFileSync(f, 'utf8'));
    if (!m) return null;
    return m[1].split('\n').map((l) => l.trim())
      .filter((l) => l && !l.startsWith(':'))
      .map((l) => l.replace(/.*<(.*)>/, '$1').split('/')[0]);
  }
  return null;
}

// --------------------------------------------------------------- tree --------
function walk(dir, hits = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, hits);
    else if (name === 'data.json') hits.push(p);
  }
  return hits;
}

const items = [];
for (const f of walk(SRC)) {
  let d; try { d = JSON.parse(readFileSync(f, 'utf8')); } catch { continue; }
  if (d['@id']) items.push(d);
}
const ROOT = items.find((i) => i['@type'] === 'Plone Site')?.['@id'];
const canon = (id) => (id === ROOT ? '/' : id);
const hasKids = new Set(items.map((i) => canon((i.parent || {})['@id'] ?? '')).filter(Boolean));
const isBlob = (d) => BLOB_FIELD[d['@type']] && d[BLOB_FIELD[d['@type']]]?.blob_path;
const childrenOf = new Map(); // folder path -> page child ids, in document order
for (const d of items) {
  if (isBlob(d)) continue; // a blob is carried in `blobs:`, not a nav child
  const pid = canon((d.parent || {})['@id'] ?? '');
  if (!pid || !d.id) continue;
  if (!childrenOf.has(pid)) childrenOf.set(pid, []);
  childrenOf.get(pid).push(d.id);
}
const pathFor = (id, folderish) => {
  const rel = canon(id).replace(/^\//, '');
  if (!rel) return 'index.md';
  return folderish ? `${rel}/index.md` : `${rel}.md`;
};

if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const blobsByFolder = new Map(); // folder path -> blob entries
let pages = 0, tier3 = 0, clean = 0, blobs = 0;
const skipped = [];
for (const d of items) {
  const id = canon(d['@id']);
  const parentId = canon((d.parent || {})['@id'] ?? '');

  // A blob (Image/File): the bytes go next to the parent's markdown and the
  // identity is recorded in the parent folder's `blobs:` -- not written as a
  // page. Only what the file cannot tell us is stored; the reader restores the
  // rest from blobDefaults, so the two lists cannot drift.
  const blobField = BLOB_FIELD[d['@type']];
  if (blobField && d[blobField]?.blob_path) {
    const meta = d[blobField];
    const src = join(SRC, meta.blob_path);
    if (!existsSync(src)) { skipped.push(`${id}: blob missing at ${meta.blob_path}`); continue; }
    const file = meta.filename || basename(src);
    const destDir = join(OUT, parentId.replace(/^\//, ''));
    mkdirSync(destDir, { recursive: true });
    copyFileSync(src, join(destDir, file));
    blobs += 1;
    const entry = { file, uid: d.UID };
    if (d.id !== file.replace(/\.[^.]+$/, '')) entry.id = d.id;
    if (d['@type'] !== typeForFile(file)) entry.type = d['@type'];
    for (const [k, v] of Object.entries(blobDefaults(d['@type'], meta.filename))) {
      if (d[k] !== undefined && JSON.stringify(d[k]) !== JSON.stringify(v)) entry[k] = d[k];
    }
    if (!blobsByFolder.has(parentId)) blobsByFolder.set(parentId, []);
    blobsByFolder.get(parentId).push(entry);
    continue;
  }

  const folderish = hasKids.has(id) || d['@type'] === 'Plone Site';
  const dest = join(OUT, pathFor(id, folderish));
  mkdirSync(dirname(dest), { recursive: true });

  const meta = Object.fromEntries(Object.entries(d)
    .filter(([k]) => !SERVER_STATE.has(k) && k !== 'blocks' && k !== 'blocks_layout'));
  const front = YAML.stringify(meta).trim();

  if (d.blocks && d.blocks_layout?.items?.length) {
    const { markdown, assignments } = emitPage(PROTOS, { blocks: d.blocks, blocks_layout: d.blocks_layout });
    const used = collectTypes(d.blocks);
    const asg = `blocks-assignments:\n${assignments.map((a) => `  - ${flow(a)}`).join('\n')}`;
    const fmBody = [front, asg, sectionYaml('blocks-matched', used, true), sectionYaml('blocks-tagged', used, false)]
      .filter(Boolean).join('\n');
    // Fill the title block's otherwise-empty `# ` with the page title for
    // readability. This is emit-only: the title block is match-only, so decode
    // ignores the heading text and reads `title` from frontmatter (kept) -- the
    // h1 is a readable duplicate, not a second source.
    const body = d.title ? markdown.replace(/^# *$/m, () => `# ${d.title}`) : markdown;
    writeFileSync(dest, `---\n${fmBody}\n---\n\n${referenceRenderers(body, dirname(dest))}\n`);
    pages += 1;
    // rough coverage: count self-closing data tags (tier-3) vs the rest
    tier3 += (markdown.match(/<block type="[^"]*"[^>]*\/>/g) || []).length;
    clean += assignments.filter((a) => a.uid).length;
  } else {
    writeFileSync(dest, `---\n${front}\n---\n`);
  }
}

// Second pass: fold folder-level facts (sibling `order:` and `blobs:`) into each
// folder's own frontmatter. Insert textually before the closing `---` so the
// assignments/prototypes blocks stay byte-for-byte intact (reparsing them would
// reformat the mapping).
let ordered = 0;
for (const folderId of new Set([...childrenOf.keys(), ...blobsByFolder.keys()])) {
  const target = join(OUT, pathFor(folderId, true));
  if (!existsSync(target)) { skipped.push(`${folderId}: has children/blobs but no index.md`); continue; }
  const present = childrenOf.get(folderId) ?? [];
  const listed = toctreeOrder(folderId);
  const fm = {};
  if (listed) {
    const known = listed.filter((id) => present.includes(id));
    fm.order = [...known, ...present.filter((id) => !known.includes(id))];
  } else if (present.length > 1) fm.order = present;
  if (blobsByFolder.has(folderId)) fm.blobs = blobsByFolder.get(folderId);
  if (!Object.keys(fm).length) continue;
  const text = readFileSync(target, 'utf8');
  writeFileSync(target, text.replace(/\n---\n/, `\n${YAML.stringify(fm).trim()}\n---\n`));
  ordered += 1;
}

console.log(`\n${pages} pages, ${blobs} blobs, ${ordered} folders annotated -> ${OUT}`);
if (skipped.length) console.log(`  skipped: ${skipped.length}\n${skipped.slice(0, 10).map((s) => `    ${s}`).join('\n')}`);
console.log(`~${tier3} tier-3 data tags of ${clean} blocks (${Math.round((1 - tier3 / clean) * 100)}% clean)`);
