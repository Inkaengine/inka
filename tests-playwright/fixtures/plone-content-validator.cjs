/**
 * Validate and integrity-check a plone.exportimport content tree.
 *
 * Two entry points:
 *   validate(contentDir) — export shape: _data_files_/_blob_files_ consistency,
 *                          parent/UID/id presence, Image blob paths, ordering
 *   checkIntegrity(source) — graph integrity: resolveuid refs, image refs,
 *                            teaser/button hrefs, parent containers.
 *                            `source` is a content DIR (full check) or an
 *                            in-memory [{ rel, data }] array (e.g. pages
 *                            fetched from a live API) — the disk-only passes
 *                            (blob files, __metadata__ cross-check) skip for
 *                            the in-memory form.
 *
 * Both return { errors: string[], warnings: string[], stats: object }.
 * Mirrors the behaviour of pretagov-site/{validate,test}-content.py so the
 * same errors surface whether invoked at mock-api startup or from a CI
 * script.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { UNDECLARED_EXEMPT } = require('../helpers/discover-blocks.cjs');

/**
 * Content ids that break their PARENT, not themselves.
 *
 * `BTreeFolder2Base.__getattr__` resolves an attribute miss out of `self._tree`,
 * so a child whose id matches a name Plone reads off the container with
 * `getattr(aq_base(container), name)` is returned instead of that attribute.
 * Plone content is callable, so code like CMFDynamicViewFTI's
 * `if safe_callable(layout): layout = layout()` then invokes the child on an
 * acquisition-stripped object and dies in `aq_acquire(self, 'REQUEST')` —
 * surfacing as a 500 on the container, with nothing wrong in the child.
 *
 * Only names that Dexterity does NOT keep as instance attributes are listed:
 * an attribute that already exists never reaches `__getattr__`. `layout` is the
 * one confirmed against a live site (it 500'd /components and is covered by
 * tests/test_reserved_content_ids.py); the others are the same read pattern in
 * CMFPlone/CMFDynamicViewFTI and are reserved to prevent a repeat.
 */
const RESERVED_CONTENT_IDS = new Set(['layout', 'default_page', 'index_html']);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function listDataEntries(contentDir) {
  const out = [];
  for (const name of fs.readdirSync(contentDir)) {
    const dataFile = path.join(contentDir, name, 'data.json');
    if (fs.statSync(path.join(contentDir, name), { throwIfNoEntry: false })?.isDirectory()
        && fs.existsSync(dataFile)) {
      out.push({ name, dataFile });
    }
  }
  return out;
}

/** Recursively walk every data.json under contentDir, yielding { rel, data }. */
function* walkData(contentDir) {
  const stack = [contentDir];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    const dataPath = path.join(dir, 'data.json');
    if (fs.existsSync(dataPath)) {
      const rel = path.relative(contentDir, dir) || '.';
      yield { rel, data: readJson(dataPath), dir };
    }
    for (const e of entries) {
      if (e.isDirectory()) stack.push(path.join(dir, e.name));
    }
  }
}

/**
 * Export-shape validation. Mirrors validate-content.py, plus a few checks
 * we've learned about the hard way at site-creation time:
 *
 *   - `id` starting with underscore — Plone OFS rejects with
 *     "BadRequest: The id ... is invalid because it begins with an underscore"
 *     (see Products/CMFCore/PortalFolder.py).
 *   - Top-level `content` key in __metadata__.json — Plone's
 *     ExportImportMetadata.__init__ rejects unknown kwargs at site creation
 *     and the whole import aborts before any content is created.
 *   - Every UID has a local_roles entry — without it, the imported page
 *     has no owner and may not be reachable from the admin.
 *
 * Walks the entire content tree (not just direct children) so nested
 * pages catch the same failures as top-level ones.
 */
function validate(contentDir, { allowMissingBlobs = false } = {}) {
  const errors = [];
  const warnings = [];
  // Generated doc assets are git-ignored; a structure-only check on a fresh
  // checkout has not regenerated them. Under allowMissingBlobs a bytes-less
  // blob is a warning, not an error (a real export keeps it fatal).
  const missingBlob = (msg) => (allowMissingBlobs ? warnings : errors).push(msg);
  const stats = { dataFiles: 0, blobFiles: 0 };

  const metaPath = path.join(contentDir, '__metadata__.json');
  if (!fs.existsSync(metaPath)) {
    errors.push(`${metaPath} not found`);
    return { errors, warnings, stats };
  }
  const meta = readJson(metaPath);
  const listed = new Set(meta._data_files_ || []);
  const listedBlobs = new Set(meta._blob_files_ || []);
  stats.dataFiles = listed.size;
  stats.blobFiles = listedBlobs.size;

  // Required sibling files one level above the content dir
  const parentDir = path.dirname(contentDir);
  for (const req of ['discussions.json', 'portlets.json', 'principals.json', 'redirects.json']) {
    if (!fs.existsSync(path.join(parentDir, req))) {
      errors.push(`  Missing ${req} in ${parentDir}/`);
    }
  }

  // ExportImportMetadata is a strict dataclass — unknown kwargs raise TypeError.
  // The legitimate top-level keys here are:
  //   __version__, _blob_files_, _data_files_, default_page, local_roles,
  //   ordering, relations
  if ('content' in meta) {
    errors.push("  __metadata__.json has top-level 'content' key — ExportImportMetadata rejects this at site creation. Use 'local_roles' instead.");
  }

  // redirects.json shape: plone.exportimport's set_redirects expects a
  // flat Dict[str, str] mapping {old_path: new_path}. The REST API's
  // @aliases response uses an `{items: [{path, redirect-to, ...}]}` array
  // shape — easy to confuse the two. The importer iterates `data.items()`
  // and crashes with `'list' object has no attribute 'endswith'` if you
  // feed it the items-array shape. Catching this here keeps a bad
  // redirects.json from silently breaking site bootstrap on deploy.
  const redirectsPath = path.join(parentDir, 'redirects.json');
  if (fs.existsSync(redirectsPath)) {
    let redirectsData;
    try { redirectsData = readJson(redirectsPath); }
    catch (e) { errors.push(`  redirects.json: invalid JSON (${e.message})`); }
    if (redirectsData !== undefined) {
      if (Array.isArray(redirectsData) || typeof redirectsData !== 'object' || redirectsData === null) {
        errors.push(`  redirects.json: must be a plain {path: target} object, got ${Array.isArray(redirectsData) ? 'array' : typeof redirectsData}`);
      } else {
        for (const [key, value] of Object.entries(redirectsData)) {
          if (typeof value !== 'string') {
            errors.push(`  redirects.json: value for "${key}" is ${Array.isArray(value) ? 'an array' : typeof value} — use {"/old": "/new"}, not the REST-API {items: [...]} shape`);
          } else if (!key.startsWith('/') || !value.startsWith('/')) {
            errors.push(`  redirects.json: paths must be absolute (start with /): ${JSON.stringify(key)} -> ${JSON.stringify(value)}`);
          }
        }
      }
    }
  }

  // Per-item checks on EVERY data.json in the tree (not just direct children)
  const allUids = new Set();
  for (const { rel, data, dir } of walkData(contentDir)) {
    const relSlash = rel.split(path.sep).join('/');
    const entry = relSlash === '.' ? 'data.json' : `${relSlash}/data.json`;
    const isRoot = relSlash === 'plone_site_root';
    const contentType = data['@type'] || '?';

    if (entry !== 'data.json' && !listed.has(entry)) {
      errors.push(`  ${entry} on disk but not in __metadata__.json _data_files_`);
    }
    if (!isRoot && !data.UID) {
      errors.push(`  ${entry} missing UID`);
    }
    // `parent` is an export-only field: plone.distribution import infers the
    // parent from the on-disk directory tree / _data_files_ ordering, so a
    // minimal/hand-built distribution legitimately omits it (verified on the
    // live site). The structural parent-container-ordering check below still
    // enforces correct nesting; this only dropped the per-item field presence.
    if (!data.id) {
      errors.push(`  ${entry} has empty id`);
    } else if (/^_/.test(data.id)) {
      errors.push(`  ${entry} id "${data.id}" starts with underscore (Plone OFS rejects this at import)`);
    } else if (RESERVED_CONTENT_IDS.has(data.id)) {
      errors.push(
        `  ${entry} id "${data.id}" is reserved — it shadows an attribute Plone ` +
        `reads off the container, which makes the PARENT return 500 ` +
        `(AttributeError). Rename it (e.g. "page-${data.id}").`,
      );
    }
    if (data.UID) allUids.add(data.UID);

    if (contentType === 'Image') {
      const img = data.image || {};
      const blobPath = img.blob_path || '';
      const download = img.download || '';
      if (download && download.startsWith('http')) {
        errors.push(`  ${entry} image has remote URL instead of blob_path: ${download.slice(0, 80)}`);
      } else if (blobPath) {
        const fullBlob = path.join(contentDir, blobPath);
        if (!fs.existsSync(fullBlob)) {
          missingBlob(`  ${entry} blob_path file missing: ${blobPath}`);
        }
        if (!listedBlobs.has(blobPath)) {
          warnings.push(`  ${entry} blob_path not in _blob_files_: ${blobPath}`);
        }
      } else if (!blobPath && !download) {
        warnings.push(`  ${entry} Image has no image data`);
      }
    }

    // A File's blob lives at data.file.blob_path (same shape as an Image's
    // data.image), but was never checked -- a File pointing at a missing blob
    // imported as a broken download with no error. Mirror the Image blob checks.
    if (contentType === 'File') {
      const blobPath = (data.file || {}).blob_path || '';
      if (blobPath) {
        if (!fs.existsSync(path.join(contentDir, blobPath))) {
          missingBlob(`  ${entry} blob_path file missing: ${blobPath}`);
        }
        if (!listedBlobs.has(blobPath)) {
          warnings.push(`  ${entry} blob_path not in _blob_files_: ${blobPath}`);
        }
      }
    }
  }

  // Parent containers must be listed, and must be listed BEFORE their children.
  //
  // plone.exportimport walks _data_files_ in order and skips any object whose
  // container does not exist yet — logging a WARNING, not an error, while
  // create-site still exits 0. A mis-ordered manifest therefore ships a partial
  // site with every gate green (this cost us 90 of 150 objects once).
  //
  // Derive the hierarchy from each item's `@id`, NOT from its directory path.
  // Real distributions are UID-keyed and flat (`<uid>/data.json`), so the path
  // carries no hierarchy at all and a path-derived parent silently no-ops —
  // which is exactly why the check above it never fired. `@id` works for both
  // the flat and the path-shaped layout.
  const listedList = meta._data_files_ || [];
  const entryId = new Map();
  for (const entry of listedList) {
    const entryPath = path.join(contentDir, entry);
    if (!fs.existsSync(entryPath)) continue;  // reported by the on-disk check below
    const atId = readJson(entryPath)['@id'];
    if (typeof atId !== 'string' || !atId) {
      errors.push(`  ${entry} has no @id — hierarchy cannot be determined`);
      continue;
    }
    entryId.set(entry, atId);
  }
  const idPosition = new Map();
  listedList.forEach((entry, index) => {
    const atId = entryId.get(entry);
    if (atId !== undefined && !idPosition.has(atId)) idPosition.set(atId, index);
  });
  listedList.forEach((entry, index) => {
    const atId = entryId.get(entry);
    if (atId === undefined) return;
    // A top-level item's parent is the site root, which always exists before
    // content import begins.
    const parentAtId = atId.slice(0, atId.lastIndexOf('/'));
    if (!parentAtId) return;
    const parentPosition = idPosition.get(parentAtId);
    if (parentPosition === undefined) {
      errors.push(`  ${entry} (${atId}) parent container missing: ${parentAtId}`);
    } else if (parentPosition > index) {
      errors.push(
        `  ${entry} (${atId}) appears before its parent ${parentAtId} in _data_files_`,
      );
    }
  });

  // Listed entries must exist on disk
  for (const entry of listed) {
    if (!fs.existsSync(path.join(contentDir, entry))) {
      errors.push(`  ${entry} in _data_files_ but missing from disk`);
    }
  }
  for (const entry of listedBlobs) {
    if (!fs.existsSync(path.join(contentDir, entry))) {
      errors.push(`  ${entry} in _blob_files_ but missing from disk`);
    }
  }

  // local_roles is OPTIONAL for plone.distribution import: when absent, items
  // import fine and default to admin ownership (verified on the live site —
  // 178 items, no local_roles, working). A full plone.exportimport export
  // includes it, but requiring it here only rejected valid hand-built/older
  // distributions, so we no longer validate local_roles coverage.

  return { errors, warnings, stats };
}

/**
 * Graph integrity. Mirrors test-content.py.
 */
function checkIntegrity(source, { schemaFor, allowMissingBlobs = false } = {}) {
  const onDisk = typeof source === 'string';
  const contentDir = onDisk ? source : null;
  const errors = [];
  const warnings = [];
  // See validate(): a bytes-less generated blob is a warning under this flag.
  const missingBlob = (msg) => (allowMissingBlobs ? warnings : errors).push(msg);
  const stats = {
    items: 0,
    imagesOk: 0, imagesBroken: 0, imagesPlaceholder: 0,
    resolveuidOk: 0, resolveuidBroken: 0,
    linksOk: 0, linksBroken: 0,
    layoutOk: 0, layoutBroken: 0,
  };

  // Pass 1: build UID → relpath and path → data
  // Detect duplicate UIDs as we go — two content items sharing one UID
  // makes Plone's catalog throw `A different document with value '<UID>'
  // already exists in the index` during create-site, which silently leaves
  // half the import incomplete (missing nav items, redirects don't install,
  // etc.) while the API still responds enough to pass api-wait. Catching
  // this here turns it into a deploy-blocking validate failure.
  const uidMap = new Map();
  const pathMap = new Map();
  const items = [];
  for (const entry of onDisk ? walkData(contentDir) : source) {
    items.push(entry);
    const { rel, data } = entry;
    // `id` is required by the Plone importer: a missing id aborts the ENTIRE
    // create-site with `KeyError: 'id'` (plone.exportimport process_id), and an
    // underscore-prefixed id is rejected by Plone OFS. Both silently leave an
    // empty site that still answers api-wait. Catch them here — like the
    // duplicate-UID check below — so they're deploy-blocking, not runtime
    // surprises. (The site root legitimately has no on-disk `id`.)
    const isRoot =
      data['@type'] === 'Plone Site' ||
      rel === 'plone_site_root' ||
      data['@id'] === '/Plone';
    // Identity presence is an IMPORT-side concern (a real API always serves
    // `id`; mocks serving fixture JSON verbatim legitimately may not) — check
    // it only for on-disk export trees, where a missing id aborts the import.
    if (!isRoot && onDisk) {
      if (!data.id) {
        errors.push(`  ${rel}: missing id (Plone import aborts with KeyError: 'id')`);
      } else if (/^_/.test(data.id)) {
        errors.push(`  ${rel}: id "${data.id}" starts with underscore (Plone OFS rejects it at import)`);
      }
    }
    if (data.UID) {
      if (uidMap.has(data.UID)) {
        errors.push(`  ${rel}: duplicate UID ${data.UID} (also in ${uidMap.get(data.UID)})`);
      } else {
        uidMap.set(data.UID, rel);
      }
    }
    const atId = data['@id'];
    if (atId) pathMap.set(atId, data);
    pathMap.set('/' + rel.split(path.sep).join('/'), data);
    // The site root is linked to as "/" in content hrefs, but on disk its @id
    // is "/Plone" and its rel is "plone_site_root" — register "/" too so
    // homepage links resolve instead of false-flagging as broken.
    if (data['@type'] === 'Plone Site' || rel === 'plone_site_root' || atId === '/Plone') {
      pathMap.set('/', data);
    }
  }
  stats.items = uidMap.size;

  // Pass 2a: resolveuid references
  // The UID alphabet the mock resolves (`[a-z0-9][-a-z0-9]*`): Plone's own are
  // hex, test fixtures use readable ones like `test-image-1-uid`.
  const resolveuidRe = /(?:\.\.\/)*resolveuid\/([a-z0-9][-a-z0-9]*)/g;
  for (const { rel, dir, data } of items) {
    const text = onDisk
      ? fs.readFileSync(path.join(dir, 'data.json'), 'utf8')
      : JSON.stringify(data);
    let m;
    while ((m = resolveuidRe.exec(text)) !== null) {
      const uid = m[1];
      if (uidMap.has(uid)) {
        stats.resolveuidOk += 1;
      } else {
        stats.resolveuidBroken += 1;
        errors.push(`  ${rel}: broken resolveuid/${uid}`);
      }
    }
  }

  /**
 * Pixel dimensions from an image file's header — no decoding, no dependencies.
 * Returns null for a format we don't parse (SVG has no intrinsic size anyway).
 */
function imageDimensions(file) {
  let buf;
  try {
    const fd = fs.openSync(file, 'r');
    buf = Buffer.alloc(64);
    fs.readSync(fd, buf, 0, 64, 0);
    fs.closeSync(fd);
  } catch {
    return null;
  }
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    // JPEG dimensions live in a SOF segment, which needs the whole file.
    let all;
    try { all = fs.readFileSync(file); } catch { return null; }
    let i = 2;
    while (i < all.length - 9) {
      if (all[i] !== 0xff) { i += 1; continue; }
      const marker = all[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: all.readUInt16BE(i + 5), width: all.readUInt16BE(i + 7) };
      }
      i += 2 + all.readUInt16BE(i + 2);
    }
  }
  return null;
}

  // Pass 2b: Image content items have blob files (disk only — an API-fed
  // check has no blob files to stat; scale URLs are the frontend's concern).
  for (const { rel, data } of items) {
    if (!onDisk) break;
    if (data['@type'] !== 'Image') continue;
    const img = data.image || {};
    const blobPath = img.blob_path || '';
    const download = img.download || '';
    if (download && download.startsWith('http')) {
      errors.push(`  ${rel}: image has remote URL (not blob_path): ${download.slice(0, 60)}`);
      stats.imagesBroken += 1;
    } else if (blobPath) {
      const blobFile = path.join(contentDir, blobPath);
      if (fs.existsSync(blobFile)) {
        // "The file is there" is not the same as "there is a picture there". A
        // 1x1 stub passes every existence check and every rendered check — it
        // loads, so naturalWidth is 1, not 0 — and shows as an empty box on the
        // page. This is the only layer that can tell the difference, because it
        // is the only one that reads the bytes.
        const dim = imageDimensions(blobFile);
        if (dim && dim.width <= 1 && dim.height <= 1) {
          warnings.push(
            `  ${rel}: image is a ${dim.width}x${dim.height} placeholder, not a real image: ${blobPath}`,
          );
          stats.imagesPlaceholder += 1;
        } else {
          stats.imagesOk += 1;
        }
      } else {
        missingBlob(`  ${rel}: blob file missing: ${blobPath}`);
        stats.imagesBroken += 1;
      }
    } else {
      errors.push(`  ${rel}: Image has no image data`);
      stats.imagesBroken += 1;
    }
  }

  // Pass 2c: link/media reference integrity across every block (nested included).
  //
  // Every reference-bearing field must point at something that EXISTS or is a
  // recognized external/resource form. A reference the validator cannot verify
  // is a FAILURE, not a skip. The old version only looked at `url` when it was a
  // STRING and treated broken refs as warnings — so an image block storing
  // `url: [{ "@id": "/images/test-image" }]` (object_browser ARRAY form) pointing
  // at a nonexistent object was never checked, and 5 such dead blocks shipped
  // while this gate reported "Links: N ok, 0 broken".
  const LINK_FIELDS = ['url', 'href', 'image', 'preview_image', 'preview_image_link', 'backgroundImage'];

  function* walkBlocks(blocks) {
    for (const [bid, block] of Object.entries(blocks || {})) {
      if (!block || typeof block !== 'object') continue;
      yield [bid, block];
      if (block.blocks && typeof block.blocks === 'object') {
        yield* walkBlocks(block.blocks);
      }
    }
  }

  // Extract every reference string from a field value in any shape it takes:
  //   "…"                  plain string
  //   [{ "@id": "…" }, …]   object_browser / image array
  //   { "@id": "…" }        single relation
  function refStrings(val) {
    const out = [];
    const pushId = (o) => { if (o && typeof o === 'object' && typeof o['@id'] === 'string') out.push(o['@id']); };
    if (typeof val === 'string') out.push(val);
    else if (Array.isArray(val)) val.forEach(pushId);
    else if (val && typeof val === 'object') pushId(val);
    return out.filter((s) => s !== '');
  }

  // Classify a reference. Returns null when verified/recognized, or a reason
  // string when it is a failure. NOTHING is silently accepted — an unrecognized
  // form returns a reason so it fails loudly.
  function refFailure(ref) {
    const ru = ref.match(/resolveuid\/([a-z0-9][-a-z0-9]*)/);
    if (ru) return uidMap.has(ru[1]) ? null : `broken resolveuid/${ru[1]}`;
    if (/^https?:\/\//.test(ref)) return null;             // external — well-formed, unverifiable offline
    if (/^(mailto:|tel:|data:)/.test(ref)) return null;    // known schemes
    if (ref.startsWith('#')) return null;                  // in-page anchor
    // Static frontend media assets (e.g. generated doc demo clips served from
    // the frontend's public/ dir, like `/docs/cards/x.mp4`) — not Plone
    // content, verifiable only in a built frontend, like external URLs.
    if (/\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/i.test(ref)) return null;
    if (ref.startsWith('/') || ref.startsWith('../')) {
      // strip ../ prefixes, scale suffixes (@@images/…) and resource views (/++…)
      let base = ref.replace(/^(\.\.\/)+/, '');
      if (!base.startsWith('/')) base = '/' + base;
      // Drop the #fragment and ?query before looking the path up. Deep-linking
      // to a heading is legitimate content (RichText emits slugged heading ids
      // so `page#section` resolves), and without this a good link read as
      // "path not in content: /services/advise#discovery". The PATH is still
      // checked — only the part after # is dropped, so a dead page cannot be
      // smuggled past the gate by appending an anchor.
      base = base.split('#')[0].split('?')[0];
      base = base.split('/@@')[0].split('/++')[0].replace(/\/+$/, '') || '/';
      return pathMap.has(base) ? null : `path not in content: ${base}`;
    }
    // Plone action / browser-view URLs relative to the current context (they
    // don't match the absolute-path branch above). These are UI actions, not
    // content references — they resolve at runtime for whatever container the
    // page lives in, so they can't (and shouldn't) be checked as content paths.
    // e.g. `./add?type=Document` (add form), `./edit`, `@@some-view`, `++resource++…`.
    const relAction = ref.replace(/^\.\//, '');
    if (/^(@@|\+\+)/.test(relAction)) return null;
    if (/^(add|edit|view|delete|sharing|contents|folder_contents|login|logout|history)(\?|\/|#|$)/.test(relAction))
      return null;
    return `unrecognized reference form: ${ref.slice(0, 60)}`;
  }

  // Slate links live at value[].data.url — inside the block's rich text, not in
  // one of LINK_FIELDS — so the field scan below never saw them. Only resolveuid
  // refs were caught, by a raw-text regex over the whole file; a plain-path
  // slate link pointing nowhere was not checked at all while the gate still
  // reported "0 broken".
  function* slateLinkUrls(value) {
    if (Array.isArray(value)) {
      for (const node of value) yield* slateLinkUrls(node);
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (value.type === 'link') {
      const url = (value.data || {}).url;
      if (typeof url === 'string' && url !== '') yield url;
    }
    yield* slateLinkUrls(value.children);
  }

  function checkBlockRefs(rel, bid, block) {
    // A block FIELD's value must match its schema widget's shape. This catches a
    // decode bug the link/slate-value checks below can't: they only look at
    // block.value, so a mismatched FIELD (a slate field stored as {value:[…]}
    // instead of a bare array, or a richtext HTML field stored as slate) slips
    // straight through. Schema-driven on purpose — "which field is slate" only
    // exists in the schema, so this runs when a `schemaFor` is supplied.
    const schema = schemaFor && block['@type'] ? schemaFor(block['@type']) : null;
    if (schema && schema.properties) {
      const shape = (v) => Array.isArray(v) ? 'an array'
        : (v && typeof v === 'object' ? `an object {${Object.keys(v).join(',')}}` : typeof v);
      for (const [field, def] of Object.entries(schema.properties)) {
        const v = block[field];
        if (v == null) continue;
        if (def.widget === 'slate' && !Array.isArray(v)) {
          errors.push(`  ${rel}: block ${bid} (${block['@type']}) field "${field}" is widget:slate but its value is ${shape(v)} — a slate field must be a bare array of nodes (a {value:[…]} wrapper or richtext value has leaked in)`);
        } else if (def.widget === 'richtext' && (Array.isArray(v) || typeof v !== 'object' || typeof v.data !== 'string')) {
          errors.push(`  ${rel}: block ${bid} (${block['@type']}) field "${field}" is widget:richtext but its value is ${shape(v)} — a richtext field must be the HTML shape {data, content-type, encoding}`);
        } else if (def.widget === 'object_list' && Array.isArray(v)) {
          // Every object_list item must carry its type in the field the schema
          // names — `def.typeField`, defaulting to `@type` (the same key the
          // decode stamps and the region declares). object_list items are block
          // instances (they get a @uid, are selectable/editable), and a block
          // without a @type can't be discovered/rendered. A decode or author
          // that drops it (the bug that made `tab` read as "no editable example",
          // and that left socialLinks' links untyped) is caught here in seconds
          // instead of 17 minutes into the bridge suite.
          const typeKey = def.typeField || '@type';
          v.forEach((item, i) => {
            // Read the way hydra's getBlockType does: `@type` first, then the
            // schema's typeField — an item carrying either is typed.
            if (item && typeof item === 'object' && item['@type'] == null && item[typeKey] == null) {
              errors.push(`  ${rel}: block ${bid} (${block['@type']}) object_list field "${field}" item ${i} is missing its type field "${typeKey}" — an object_list item is a block and must carry its type`);
            }
          });
        }
      }
    }
    // A slate value must be a SINGLE top-level node. The editor makes one block
    // per paragraph, and a paragraph boundary is a block boundary, so a value
    // with >1 top-level node (a title + body packed into one slate) has no
    // bare-markdown spelling. lib/slate-normalize collapses it; a genuine
    // multi-block cell belongs in a `columns` block. (Recurses via the sub-item
    // walk below, so object_list/column children are checked too.)
    if (block['@type'] === 'slate' && Array.isArray(block.value) && block.value.length > 1) {
      errors.push(`  ${rel}: block ${bid} (slate) value has ${block.value.length} top-level nodes (expected 1; run normalizeSlateValue)`);
    }
    for (const url of slateLinkUrls(block.value)) {
      const reason = refFailure(url);
      if (reason) {
        stats.linksBroken += 1;
        errors.push(`  ${rel}: block ${bid} (${block['@type']}) slate link: ${reason}`);
      } else {
        stats.linksOk += 1;
      }
    }
    for (const field of LINK_FIELDS) {
      if (!(field in block)) continue;
      for (const ref of refStrings(block[field])) {
        const reason = refFailure(ref);
        if (reason) {
          stats.linksBroken += 1;
          errors.push(`  ${rel}: block ${bid} (${block['@type']}) ${field}: ${reason}`);
        } else {
          stats.linksOk += 1;
        }
      }
    }
    // object_list / column sub-items carry the same link/media fields
    for (const key of ['items', 'columns', 'column_items']) {
      const arr = block[key];
      if (!Array.isArray(arr)) continue;
      arr.forEach((it, i) => {
        if (it && typeof it === 'object') checkBlockRefs(rel, `${bid}.${key}[${i}]`, it);
      });
    }
  }

  for (const { rel, data } of items) {
    for (const [bid, block] of walkBlocks(data.blocks)) {
      checkBlockRefs(rel, bid, block);
    }
  }

  // Pass 2c-bis: a TEMPLATE's top-level blocks must carry templateId AND slotId.
  //
  // Forced-layout expansion matches a template's blocks onto a page's region by
  // those two fields. A block missing either is silently skipped — no error is
  // raised anywhere, the block just never renders. Nothing else catches it: the
  // schema gate only checks declared fields (neither is one), and block-sanity
  // only sees blocks that DID render.
  //
  // "Is a template" means a page whose own blocks point at ITSELF — that is what
  // distinguishes a template from a page that merely EMBEDS one. An ordinary
  // page (e.g. /services/onyx) carries a block with a templateId referencing the
  // shared contact-CTA template; treating that as "this is a template" flagged
  // every other block on the page. Inferred from content, not from the path, so
  // a template stored outside /templates is still checked.
  for (const { rel, data } of items) {
    const blocks = data.blocks || {};
    const top = (data.blocks_layout || {}).items || [];
    const own = new Set([data.UID && `resolveuid/${data.UID}`, data['@id']].filter(Boolean));
    const isTemplate = top.some((bid) => blocks[bid] && own.has(blocks[bid].templateId));
    if (!isTemplate) continue;
    // EVERY depth, not just the top. fillRegionEntries is the same function for
    // a nested container's regions as for the page's, and it opens with
    //     if (!child || !child.templateId) continue; // orphan / missing → drop
    // so a block buried in a column is dropped on the same rule — and takes its
    // own children with it, since they are only reachable through it. Measured:
    // removing `templateId` from one widget nested in a footer column removed
    // that widget AND its three slates from the merged footer.
    const walk = (container, prefix) => {
      // Descend into FIXED containers only. A fixed block is template-owned
      // structure: the merge re-derives its children from the template, so each
      // one needs its own tags or it is dropped. A NON-fixed block is a SLOT —
      // its children are the page's content, carried through as-is and needing
      // no tags at all. Checked: /templates/contact-cta's `cta-section` is
      // `fixed: false` and its untagged `cta-btn` survives the merge intact, so
      // flagging it would be a false alarm on shipping content.
      if (container.fixed !== true && prefix) return;
      const kids = container.blocks || {};
      const order = Object.values(container.blocks_layout || {}).flat();
      for (const bid of order.length ? order : Object.keys(kids)) {
        const block = kids[bid];
        if (!block || typeof block !== 'object') continue;
        yieldBlock(prefix ? `${prefix} > ${bid}` : bid, block);
        walk(block, prefix ? `${prefix} > ${bid}` : bid);
      }
    };
    const yieldBlock = (label, block) => {
      const missing = [];
      if (!block.templateId) missing.push('templateId');
      // A non-fixed child is a SLOT, matched to the page's content by slotId
      // (`else if (child.slotId)`); without one it matches neither branch and is
      // dropped too. A fixed child needs it to be matched when the page has
      // overridden it, and the top-level rule has always required it.
      if (!block.slotId) missing.push('slotId');
      // `fixed` must be stated, true or false. Omitting it does not mean "not
      // fixed" — it makes the block a SLOT for the page to fill, so on a page
      // whose region is empty the block renders as nothing. Requiring the
      // decision means a template block can no longer disappear because
      // somebody forgot to say what kind of block it is.
      if (typeof block.fixed !== 'boolean') {
        missing.push(block.fixed === undefined
          ? 'fixed (true = template-controlled, false = a slot the page fills)'
          : `fixed as a boolean (got ${JSON.stringify(block.fixed)})`);
      }
      if (missing.length) {
        stats.templateBlocksBroken = (stats.templateBlocksBroken || 0) + 1;
        errors.push(
          `  ${rel}: template block ${label} (${block['@type']}) is missing ` +
          `${missing.join(' and ')} — forced-layout expansion skips it silently, ` +
          `so it will never render`,
        );
      } else {
        stats.templateBlocksOk = (stats.templateBlocksOk || 0) + 1;
      }
    };
    for (const bid of top) {
      const block = blocks[bid];
      if (!block || typeof block !== 'object') continue;
      yieldBlock(bid, block);
      walk(block, bid);
    }
  }

  // Pass 2c-ter: an INSTANCE must agree with its template about what is chrome.
  //
  // Pass 2c-bis above checks a TEMPLATE's own blocks. This checks the pages that
  // instantiate one, which is where the drift actually happens: six /components/*
  // pages carried their section headings with page-specific uids and no `fixed`
  // at all, while the twenty-eight that worked used the template's uid and said
  // `fixed: true`.
  //
  // That is not cosmetic. `fixed` is what makes a block CHROME, and chrome is
  // what separates one slot group from the next. An unfixed heading is read as
  // an open slot, so it collides with the slot beside it, and the page cannot be
  // saved in the editor at all — the error names two slot groups and says
  // nothing about a heading, so there is no way to get from the symptom back to
  // this cause.
  //
  // What this canNOT check is the arrangement itself: whether two slot groups
  // end up adjacent depends on the merge, and the merge needs a render. That
  // lives in block-sanity's "Template slots" suite, which reads the expanded
  // tree from the bridge and calls hydra's own validateTemplatePlaceholders. The
  // split is deliberate — this pass is the cheap static half (are the tags
  // present and do they agree with the template), and re-deriving the merge here
  // would just be a second implementation to be wrong in a second way.
  {
    // slotId -> fixed, per template, from the template's own blocks at any depth.
    const templateChrome = new Map(); // templateRef -> Map(slotId -> fixed)
    for (const { data } of items) {
      const blocks = data.blocks || {};
      const top = (data.blocks_layout || {}).items || [];
      const own = [data.UID && `resolveuid/${data.UID}`, data['@id']].filter(Boolean);
      const isTemplate = top.some((bid) => blocks[bid] && own.includes(blocks[bid].templateId));
      if (!isTemplate) continue;
      const slots = new Map();
      const collect = (container) => {
        for (const [, block] of Object.entries(container.blocks || {})) {
          if (!block || typeof block !== 'object') continue;
          if (block.slotId) slots.set(block.slotId, block.fixed === true);
          collect(block);
        }
      };
      collect(data);
      for (const ref of own) templateChrome.set(ref, slots);
    }

    for (const { rel, data } of items) {
      const top = (data.blocks_layout || {}).items || [];
      const blocks = data.blocks || {};
      const own = [data.UID && `resolveuid/${data.UID}`, data['@id']].filter(Boolean);
      if (top.some((bid) => blocks[bid] && own.includes(blocks[bid].templateId))) continue; // a template, not an instance
      const check = (container) => {
        for (const [bid, block] of Object.entries(container.blocks || {})) {
          if (!block || typeof block !== 'object') continue;
          const chrome = block.templateId && templateChrome.get(block.templateId);
          if (chrome) {
            // A block that fills THIS template must carry the coupled markers:
            // slotId + fixed + readOnly. slotId is the render-critical one —
            // forced-layout expansion (helpers/fillRegionEntries) matches a block
            // to a slot by slotId and silently DROPS one that has none: the block
            // is composed into the page (block-sanity discovers it) yet no frontend
            // has a slot to render it, so its data-block-uid never appears and the
            // only symptom is a reveal timeout. That is exactly how the slate page's
            // `callout` slipped through — 2c-ter used to only look at blocks whose
            // slotId already matched a slot. fixed and readOnly are the content-model
            // half: a page slot-fill is editable page content (both false), stated
            // so the coupling holds and the merge locks it right. Emit synthesises
            // both for a slot-fill (markdown-mount normalizeInstanceTemplateFields),
            // so a miss here means the emit path did not run — a real gap.
            const missing = [];
            if (!block.slotId) missing.push('slotId');
            if (typeof block.fixed !== 'boolean') missing.push('fixed');
            if (typeof block.readOnly !== 'boolean') missing.push('readOnly');
            if (missing.length) {
              stats.instanceBlocksBroken = (stats.instanceBlocksBroken || 0) + 1;
              errors.push(
                `  ${rel}: block ${bid} (${block['@type']}) fills template ` +
                `${block.templateId} but is missing ${missing.join(', ')} — a block ` +
                `with no slotId is dropped by forced-layout expansion and never ` +
                `renders; fixed and readOnly must be stated (both false for an ` +
                `editable slot-fill)`,
              );
            } else if (chrome.has(block.slotId)) {
              const shouldBeFixed = chrome.get(block.slotId);
              if (shouldBeFixed && block.fixed !== true) {
                stats.instanceBlocksBroken = (stats.instanceBlocksBroken || 0) + 1;
                errors.push(
                  `  ${rel}: block ${bid} fills slot "${block.slotId}", which its template ` +
                  `marks fixed — the instance must say fixed: true too, or the heading is ` +
                  `read as an open slot and the page cannot be saved`,
                );
              } else {
                stats.instanceBlocksOk = (stats.instanceBlocksOk || 0) + 1;
              }
            } else {
              stats.instanceBlocksOk = (stats.instanceBlocksOk || 0) + 1;
            }
          }
          check(block);
        }
      };
      check(data);
    }
  }

  // Pass 2d: blocks_layout references must resolve to a block in the SAME
  // container. A uid listed in a container's blocks_layout but absent from its
  // `blocks` dict is a dangling reference — exactly what a partial block deletion
  // leaves behind (block def removed, layout entry not). Checks the page itself
  // and every nested container, across EVERY array in blocks_layout (standard
  // `items` plus the vestigial nested `blocks_layout` key some exports carry).
  function checkLayout(rel, bid, container) {
    const sub = container.blocks;
    const bl = container.blocks_layout;
    if (!sub || typeof sub !== 'object' || !bl || typeof bl !== 'object') return;
    for (const [lkey, arr] of Object.entries(bl)) {
      if (!Array.isArray(arr)) continue;
      // A block id listed twice is not dangling — both entries resolve — but it
      // is always a bug: the block renders twice, and whatever the second entry
      // was meant to be renders never. It is what a colliding id generator
      // leaves behind, so check it here rather than only its dangling cousin.
      const seen = new Set();
      for (const ref of arr) {
        if (typeof ref !== 'string') continue;
        if (seen.has(ref)) {
          stats.layoutBroken += 1;
          const where = bid ? `block ${bid} ` : 'page ';
          errors.push(`  ${rel}: ${where}blocks_layout.${lkey} lists block ${ref} twice`);
          continue;
        }
        seen.add(ref);
        if (Object.prototype.hasOwnProperty.call(sub, ref)) {
          stats.layoutOk += 1;
        } else {
          stats.layoutBroken += 1;
          const where = bid ? `block ${bid} ` : 'page ';
          errors.push(`  ${rel}: ${where}blocks_layout.${lkey} references missing block ${ref}`);
        }
      }
    }
  }
  for (const { rel, data } of items) {
    checkLayout(rel, null, data);  // page-level blocks_layout
    for (const [bid, block] of walkBlocks(data.blocks)) {
      if (block.blocks && typeof block.blocks === 'object') checkLayout(rel, bid, block);
    }
  }

  // Parent containers (metadata cross-check for completeness). Uses the `@id`
  // hierarchy via pathMap, not the directory path — see validate()'s note: our
  // content is UID-keyed and flat, so a path-derived parent never resolves.
  const metaPath = onDisk ? path.join(contentDir, '__metadata__.json') : null;
  if (metaPath && fs.existsSync(metaPath)) {
    const meta = readJson(metaPath);
    for (const entry of meta._data_files_ || []) {
      const entryPath = path.join(contentDir, entry);
      if (!fs.existsSync(entryPath)) continue;
      const atId = readJson(entryPath)['@id'];
      if (typeof atId !== 'string' || !atId) continue;  // validate() reports this
      const parentAtId = atId.slice(0, atId.lastIndexOf('/'));
      if (!parentAtId) continue;  // top-level: parent is the site root
      if (!pathMap.has(parentAtId)) {
        errors.push(`  ${entry}: parent container missing (${parentAtId})`);
      }
    }
  }

  return { errors, warnings, stats };
}


/**
 * Every block field the schemas do not declare.
 *
 * A conversion writes blocks, and the only way to know it wrote them correctly
 * is to compare what it produced against the schema those blocks are edited by.
 * Nothing did that outside a browser: block-sanity holds the equivalent check,
 * but it needs a frontend, a discovery pass and a mock parent, so it only ever
 * ran over content we commit. A converted export is generated on a server and
 * never comes local, and there it went unchecked — `contentBlock` held its link
 * as `url` where the schema says `linkUrl`, so a "View more" link stopped
 * rendering and no test anywhere had an opinion.
 *
 * This asks the same question with nothing but the content and a field map:
 * `{ blockType: ["field", ...] }`, which the frontend emits from its own
 * schemas. It runs over a directory or an in-memory array, like checkIntegrity,
 * so the same call serves a CI corpus and a live site's pages.
 *
 * A block type absent from the map is REPORTED, not skipped: an unknown type is
 * either a block the frontend cannot render or a map gone stale, and both are
 * worth hearing about.
 */
function checkBlockSchemas(source, fieldMap) {
  // `{ blocks: { type: { fields, defaultsPrefix } }, identityFields: [...] }`.
  // A bare `{ type: [fields] }` map still works, for a caller that has one.
  const declaredFields = fieldMap && fieldMap.blocks ? fieldMap.blocks : fieldMap;
  // Keys a CONTAINER stamps onto its children — an object_list's `idField` /
  // `typeField`. The table block keys its cells by `key`, and the cell's own
  // schema has no reason to declare it.
  const identityFields = new Set(
    (fieldMap && fieldMap.identityFields) || ['@id', '@type'],
  );
  const onDisk = typeof source === 'string';
  const errors = [];
  const warnings = [];
  const stats = { items: 0, blocks: 0, undeclared: 0, unknownTypes: 0 };
  const unknown = new Set();
  // One report per (blockType, field): a stray field is a converter bug, and a
  // converter repeats itself across every page it touched.
  const strays = new Map();

  const visit = (block, rel) => {
    if (!block || typeof block !== 'object') return;
    const type = block['@type'];
    if (typeof type === 'string') {
      stats.blocks += 1;
      const entry = declaredFields[type];
      // `{ fields, defaultsPrefix }`, or a bare array from an older map.
      const declared = Array.isArray(entry) ? entry : entry && entry.fields;
      const defaultsPrefix = Array.isArray(entry) ? null : entry && entry.defaultsPrefix;
      if (!declared) {
        if (!unknown.has(type)) {
          unknown.add(type);
          stats.unknownTypes += 1;
          warnings.push(
            `  ${rel}: block type "${type}" is in the content but not in the ` +
              `field map — an unrenderable block, or a stale map`,
          );
        }
      } else {
        for (const field of Object.keys(block)) {
          // `@`-prefixed keys are the block's identity, and UNDECLARED_EXEMPT is
          // the same set block-sanity uses: fields that ride on a block without
          // being schema fields. Template machinery is the big one —
          // `templateId`, `templateInstanceId`, `slotId`, `fixed`, `readOnly` —
          // and it is not unchecked, it is checked by the pass that owns it
          // (a template's blocks must carry templateId AND slotId, above).
          // Reporting them here would bury the real findings under three lines
          // for every block on every templated page: 151 of them on content
          // that has nothing wrong with it.
          if (field.startsWith('@') || UNDECLARED_EXEMPT.has(field)) continue;
          // A container's per-item defaults (`itemDefaults_colour`) are not
          // properties of the container, and which are valid depends on the
          // item type — resolvable only with the bridge's registry, which is
          // exactly why discovery exempts the prefix rather than flagging it.
          if (defaultsPrefix && field.startsWith(defaultsPrefix)) continue;
          if (identityFields.has(field)) continue;
          if (declared.includes(field)) continue;
          const key = `${type}.${field}`;
          if (!strays.has(key)) strays.set(key, rel);
        }
      }
    }
    for (const value of Object.values(block)) {
      if (Array.isArray(value)) value.forEach((v) => visit(v, rel));
      else if (value && typeof value === 'object') visit(value, rel);
    }
  };

  for (const entry of onDisk ? walkData(source) : source) {
    const { rel, data } = entry;
    stats.items += 1;
    visit(data.blocks, rel);
  }

  for (const [key, rel] of [...strays.entries()].sort()) {
    stats.undeclared += 1;
    errors.push(
      `  ${key} is not declared by the block's schema (e.g. ${rel}) — ` +
        `the field cannot be edited, and whatever reads it renders nothing`,
    );
  }
  return { errors, warnings, stats };
}

function formatReport(title, result) {
  const lines = [];
  if (title === 'schema') {
    lines.push(
      `Content: ${result.stats.items} items, ${result.stats.blocks} blocks`,
    );
    lines.push(
      `Fields:  ${result.stats.undeclared} undeclared` +
        (result.stats.unknownTypes
          ? `, ${result.stats.unknownTypes} block type(s) not in the field map`
          : ''),
    );
  } else if (title === 'validate') {
    lines.push(`Content export OK: ${result.stats.dataFiles} data files, ${result.stats.blobFiles} blob files`);
  } else {
    lines.push(`Content: ${result.stats.items} items`);
    lines.push(
      `Images:  ${result.stats.imagesOk} ok, ${result.stats.imagesBroken} broken` +
        (result.stats.imagesPlaceholder
          ? `, ${result.stats.imagesPlaceholder} placeholder`
          : ''),
    );
    lines.push(`UIDs:    ${result.stats.resolveuidOk} resolved, ${result.stats.resolveuidBroken} broken`);
    lines.push(`Links:   ${result.stats.linksOk} ok, ${result.stats.linksBroken} broken`);
    lines.push(`Layout:  ${result.stats.layoutOk} ok, ${result.stats.layoutBroken} dangling`);
  }
  if (result.errors.length) {
    lines.push('');
    lines.push(`ERRORS (${result.errors.length}):`);
    for (const e of result.errors) lines.push(e);
  }
  if (result.warnings.length) {
    lines.push('');
    lines.push(`Warnings (${result.warnings.length}):`);
    for (const w of result.warnings) lines.push(w);
  }
  return lines.join('\n');
}

module.exports = { validate, checkIntegrity, checkBlockSchemas, formatReport };
