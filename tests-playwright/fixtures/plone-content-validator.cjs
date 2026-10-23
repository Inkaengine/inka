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
// hydra's container API. Node require()s sync ESM, so a sync validator can use
// the same enumeration the editor does instead of reading blocks_layout itself.
const { getChildFields, getChildBlockEntries } = require('../../packages/helpers/index.js');
const { buildBlockPathMap, getResolvedSchema } = require('../../packages/hydra-js/buildBlockPathMap.js');

/**
 * Every child of a container, across every region it has, in order.
 *
 * The ONE place this file enumerates children. Each pass used to read
 * `blocks_layout` itself, which is why they disagreed with each other and with
 * the editor: 2c-bis saw only `items` and only inside fixed blocks, the slot
 * pass saw only `items`, and an object_list region was invisible to both. The
 * editor's validateTemplatePlaceholders walks via these same two helpers, so
 * routing everything through them makes the gate and the save-time check agree
 * by construction.
 *
 * The exception is pass 2d, which validates blocks_layout's own integrity and
 * must read it raw: getChildBlockEntries drops entries whose block is missing,
 * which is precisely the corruption 2d exists to report.
 *
 * `idFieldMap` is not optional in spirit. getChildFields recognises an
 * object_list field when its items carry `templateId` OR when the map names
 * the field for that block type — and an object_list is keyed by its own
 * idField (a form's subblocks by `field_id`, a table's rows by `key`), so
 * without the map those fields are skipped and any id taken from one is
 * bogus. Built by buildIdFieldMap from the site's schemas; when the caller has
 * no schemas, only templateId-marked lists are seen, which is a REDUCED check,
 * not the intended one.
 */
function childEntries(container, idFieldMap = null) {
  if (!container || typeof container !== 'object') return [];
  const out = [];
  for (const descriptor of getChildFields(container, idFieldMap, { allObjectLists: true })) {
    for (const entry of getChildBlockEntries(container, descriptor)) {
      if (entry.block && typeof entry.block === 'object') out.push({ ...entry, region: descriptor.region });
    }
  }
  return out;
}

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
  // The site's physical path is its root item's @id (/Plone in an export);
  // a root at "/" (or none) gives nothing to check against.
  const sitePath = (() => {
    const rootFile = path.join(contentDir, 'plone_site_root', 'data.json');
    if (!fs.existsSync(rootFile)) return '';
    const rootId = readJson(rootFile)['@id'];
    return rootId === '/' ? '' : rootId;
  })();
  if (fs.existsSync(redirectsPath)) {
    let redirectsData;
    try { redirectsData = readJson(redirectsPath); }
    catch (e) { errors.push(`  redirects.json: invalid JSON (${e.message})`); }
    if (redirectsData !== undefined) {
      if (Array.isArray(redirectsData) || typeof redirectsData !== 'object' || redirectsData === null) {
        errors.push(`  redirects.json: must be a plain {path: target} object, got ${Array.isArray(redirectsData) ? 'array' : typeof redirectsData}`);
      } else {
        // Physical vs site-relative. The importer hands each pair to
        // plone.app.redirector's storage as is, and that storage is keyed by
        // PHYSICAL path — so a site-relative "/old" sitting among physical ones
        // is stored where no request looks, never fires, and says nothing. That
        // is the bug worth catching.
        //
        // A WHOLLY site-relative file is not that bug. A consumer may convert
        // the raw export into a site-relative tree deliberately (pretagov's
        // convert-export-to-local.py strips the site prefix from redirect keys
        // and values), and re-adding the prefix there is undone by the next
        // export — churn forever, against redirects that demonstrably work.
        // So judge CONSISTENCY rather than conformance to one of the two.
        const prefixed = [];
        const bare = [];
        for (const [key, value] of Object.entries(redirectsData)) {
          if (typeof value !== 'string') {
            errors.push(`  redirects.json: value for "${key}" is ${Array.isArray(value) ? 'an array' : typeof value} — use {"/old": "/new"}, not the REST-API {items: [...]} shape`);
          } else if (!key.startsWith('/') || !value.startsWith('/')) {
            errors.push(`  redirects.json: paths must be absolute (start with /): ${JSON.stringify(key)} -> ${JSON.stringify(value)}`);
          } else if (sitePath) {
            for (const p of [key, value]) {
              (p === sitePath || p.startsWith(sitePath + '/') ? prefixed : bare).push(p);
            }
          }
        }
        if (prefixed.length && bare.length) {
          const sample = bare.slice(0, 3).map((x) => JSON.stringify(x)).join(', ');
          errors.push(
            `  redirects.json: mixes physical and site-relative paths — ` +
            `${prefixed.length} under ${JSON.stringify(sitePath)} and ${bare.length} not ` +
            `(${sample}${bare.length > 3 ? ', …' : ''}). Plone keys its redirect storage ` +
            `by PHYSICAL path, so the site-relative ones are stored where no request ` +
            `looks and never fire. Use one form throughout.`,
          );
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
      missingBlob(`  ${entry} in _blob_files_ but missing from disk`);
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
function checkIntegrity(source, { schemasFor, allowMissingBlobs = false, idFieldMap = null } = {}) {
  // Block types the caller supplied schemas for but which have none. Their
  // fields and references cannot be checked against anything, so the count is
  // surfaced rather than silently meaning "nothing wrong".
  const unschemad = new Set();
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

  // Every block stored under a container, at any depth.
  //
  // Region children come from the container API, so an object_list child — a
  // slider's slide, a form's subblock — is walked like a blocks_layout one.
  // This used to recurse on `block.blocks` alone and saw neither, so a broken
  // link inside a slide was never ref-checked.
  //
  // Blocks present in the dict but listed by no region are yielded too: they
  // are stored, so a dangling reference or a repeated id in one still counts,
  // and an orphan is exactly the state those checks exist to catch.
  const walkBlocks = (blocks, container = null, where = null) =>
    walkAllBlocks(blocks, container, idFieldMap, where);

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

  // Every list item needs its OWN id, in the field frontends read it from.
  // Frontends key items by that id (`expand(rows, null, 'key')` → `@uid`), so
  // items with no id — or a repeated one — all resolve to one item: a whole
  // table rendering its last cell everywhere. Reading the schema-named idField
  // (not "any id") also catches ids written under the wrong key.
  function checkItemIds(items, idKey, what, where) {
    const seen = new Set();
    items.forEach((item, i) => {
      if (!item || typeof item !== 'object') return;
      const id = item[idKey];
      if (id == null || id === '') {
        errors.push(`${where} ${what} ${i} has no id "${idKey}" — every item needs its own id, or frontends collapse the items onto one`);
      } else if (seen.has(id)) {
        errors.push(`${where} ${what} ${i} repeats id "${id}" — every item needs its own id, or frontends collapse the items onto one`);
      } else {
        seen.add(id);
      }
    });
  }

  function checkBlockRefs(rel, bid, block, schema = null) {
    // A table's rows and each row's cells are keyed by `key` — Volto's slateTable
    // shape, which every frontend reads. Not a schema object_list, so checked
    // here by type.
    if (block['@type'] === 'slateTable' && Array.isArray(block.table && block.table.rows)) {
      const where = `  ${rel}: block ${bid} (slateTable)`;
      checkItemIds(block.table.rows, 'key', 'table row', where);
      block.table.rows.forEach((row, r) => {
        if (row && Array.isArray(row.cells)) checkItemIds(row.cells, 'key', `table row ${r} cell`, where);
      });
    }
    // A block FIELD's value must match its schema widget's shape. This catches a
    // decode bug the link/slate-value checks below can't: they only look at
    // block.value, so a mismatched FIELD (a slate field stored as {value:[…]}
    // instead of a bare array, or a richtext HTML field stored as slate) slips
    // straight through. Schema-driven on purpose — "which field is slate" only
    // exists in the schema, so this runs when `schemasFor` is supplied.
    // `schemasFor(rel, data)` — the item is passed so a caller serving content
    // from several owners can answer with THAT content's config (or none).
    if (schema && schema.properties) {
      const shape = (v) => Array.isArray(v) ? 'an array'
        : (v && typeof v === 'object' ? `an object {${Object.keys(v).join(',')}}` : typeof v);
      for (const [field, def] of Object.entries(schema.properties)) {
        const v = block[field];
        if (v == null) continue;
        if (REFERENCE_WIDGETS.has(def.widget)) {
          // Every reference the field holds, in whichever shape it stores it.
          for (const ref of refStrings(v)) {
            const reason = refFailure(ref);
            if (reason) {
              stats.linksBroken += 1;
              errors.push(`  ${rel}: block ${bid} (${block['@type']}) ${field}: ${reason}`);
            } else {
              stats.linksOk += 1;
            }
          }
        } else if (def.widget === 'slate' && !Array.isArray(v)) {
          errors.push(`  ${rel}: block ${bid} (${block['@type']}) field "${field}" is widget:slate but its value is ${shape(v)} — a slate field must be a bare array of nodes (a {value:[…]} wrapper or richtext value has leaked in)`);
        } else if (def.widget === 'richtext' && (Array.isArray(v) || typeof v !== 'object' || typeof v.data !== 'string')) {
          errors.push(`  ${rel}: block ${bid} (${block['@type']}) field "${field}" is widget:richtext but its value is ${shape(v)} — a richtext field must be the HTML shape {data, content-type, encoding}`);
        } else if (def.widget === 'object_list' && Array.isArray(v)) {
          // An object_list must declare ONE of three things, and which one it
          // declares is the whole answer:
          //
          //   schema          items are records of that one shape. Nothing
          //                   varies, so there is no type to carry.
          //   allowedBlocks /
          //   typeField       items vary in kind, so each must say which.
          //   subBlocks:false a plain list of objects, edited in the sidebar
          //                   and stored as it is. No type either.
          //
          // Declaring none of them is the fault: a reader cannot tell what the
          // items are, and nor can this gate.
          const isTyped = !!(def.typeField || def.allowedBlocks);
          if (!def.schema && !isTyped && def.subBlocks !== false) {
            errors.push(`  ${rel}: block ${bid} (${block['@type']}) object_list field "${field}" declares none of \`schema\`, \`allowedBlocks\`/\`typeField\` or \`subBlocks: false\` — a list is records of one shape, items that vary in kind, or a plain list, and the schema has to say which`);
          }
          // allowedBlocks means the items vary in kind, so the schema has to
          // name the field that says which — the type does not live in a fixed
          // place. form.subblocks keys by `field_type`, search.facets by
          // `@type`; both state it. Defaulting to `@type` here guessed on the
          // schema's behalf and would read the wrong field without a word.
          if (def.allowedBlocks && !def.typeField) {
            errors.push(`  ${rel}: block ${bid} (${block['@type']}) object_list field "${field}" declares \`allowedBlocks\` but no \`typeField\` — its items vary in kind, so the schema has to name the field their type is read from`);
          }
          checkItemIds(v, def.idField || '@id', `object_list field "${field}" item`, `  ${rel}: block ${bid} (${block['@type']})`);
          if (isTyped) {
            // The schema-named field first, `@type` as the alternative — the
            // way hydra's own reader works: getBlockType is
            // `blockData?.['@type'] ?? blockData?.[typeField]`, so an item
            // carrying either IS typed and renders. Requiring the named field
            // alone looked tidier and would have failed content that works.
            // The field the schema names. No fallback: a list with
            // allowedBlocks and no typeField is reported above, so by here the
            // schema has said where the type lives.
            const typeKey = def.typeField || '@type';
            v.forEach((item, i) => {
              if (item && typeof item === 'object' && item[typeKey] == null && item['@type'] == null) {
                errors.push(`  ${rel}: block ${bid} (${block['@type']}) object_list field "${field}" item ${i} is missing its type field "${typeKey}" — this field declares \`allowedBlocks\`/\`typeField\`, so its items vary in kind and each must say which it is`);
              }
            });
          }
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
    // With a schema, the loop above has already scanned every reference field:
    // the widget says which they are, exactly.
    //
    // Without one — a consumer mount that ships no schemas — the references
    // are still there and still have to resolve, so they are found by SHAPE.
    // A reference is uid-encoded, path-rooted or an absolute URL; an
    // object_list item's own id is a bare token, which is how the two are told
    // apart without asking the schema. This is strictly a fallback: it cannot
    // know that a field was MEANT to hold a reference, so a field that should
    // have one and is empty reads as fine.
    if (!schema) {
      for (const [field, v] of Object.entries(block)) {
        if (field === '@id' || field === 'templateId') continue; // identity, not a link
        for (const ref of refStrings(v)) {
          if (!looksLikeReference(ref)) continue;
          const reason = refFailure(ref);
          if (reason) {
            stats.linksBroken += 1;
            errors.push(`  ${rel}: block ${bid} (${block['@type']}) ${field}: ${reason}`);
          } else {
            stats.linksOk += 1;
          }
        }
      }
    }
    // Children are not recursed into here: the walk that calls this yields
    // every child the container API reports, in either storage, so a sub-item
    // is visited as a block in its own right.
  }

  for (const { rel, data } of items) {
    // buildBlockPathMap is the single source of truth for where every block
    // lives, what type it is and which schema it is checked against — an
    // object_list item included, whose kind comes from the parent's
    // `typeField` and whose schema may be the field's own inline one, and
    // whose id in the map is composite (`parent::item`). Enumerating it
    // separately and joining on id silently misses exactly those.
    //
    // Blocks the map does not address are not content the editor can reach:
    // a readOnly template INSTANCE copy, re-derived at render from a template
    // that is itself walked as a document. Checking those again would report
    // one broken template link once per page using the template.
    const blocksConfig = schemasFor ? schemasFor(rel, data) : null;
    const seen = new Set(); // by block IDENTITY: the two walks key blocks differently
    if (blocksConfig) {
      const pathMap = buildBlockPathMap(data, blocksConfig);
      for (const [bid, info] of Object.entries(pathMap)) {
        if (bid.startsWith('_') || !info || !info.blockType) continue;
        if (!Array.isArray(info.path)) continue; // a virtual container, not storage
        const block = info.path.reduce((node, key) => (node == null ? node : node[key]), data);
        if (!block || typeof block !== 'object') continue;
        seen.add(block);
        // A type the config does not declare at all. A declared one whose
        // schema has no properties (a `title` block renders page metadata and
        // has no fields) is not that: there is simply nothing to check.
        if (!info.isVirtualBlockType && !blocksConfig[info.blockType]) unschemad.add(info.blockType);
        checkBlockRefs(rel, bid, block, getResolvedSchema(info, pathMap));
      }
    }
    // Blocks the path map did not address. It maps what the EDITOR can reach,
    // and integrity is about everything STORED, so the remainder still counts:
    //   - an orphan, in the dict but in no region. It is dead weight, but a
    //     broken reference in one is exactly what this pass exists to find.
    //   - a readOnly template INSTANCE copy, re-derived at render from a
    //     template that is itself walked as a document. Those are skipped:
    //     checking them would report one broken template link once per page
    //     that uses the template.
    // Their schema can only come from their own `@type` — nothing addresses
    // them, so no parent region declares their shape.
    for (const [bid, block] of walkBlocks(data.blocks, data)) {
      if (seen.has(block)) continue;
      if (block.readOnly === true && block.templateId) continue;
      checkBlockRefs(rel, bid, block, blocksConfig?.[block['@type']]?.blockSchema ?? null);
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
    const own = new Set([data.UID && `resolveuid/${data.UID}`, data['@id']].filter(Boolean));
    const isTemplate = childEntries(data, idFieldMap).some(({ block }) => own.has(block.templateId));
    if (!isTemplate) continue;
    // EVERY depth, not just the top. fillRegionEntries is the same function for
    // a nested container's regions as for the page's, and it opens with
    //     if (!child || !child.templateId) continue; // orphan / missing → drop
    // so a block buried in a column is dropped on the same rule — and takes its
    // own children with it, since they are only reachable through it. Measured:
    // removing `templateId` from one widget nested in a footer column removed
    // that widget AND its three slates from the merged footer.
    const walk = (container, prefix) => {
      // Descend into EVERY container, fixed or not.
      //
      // This used to stop at a non-fixed block, reasoning that a slot's
      // children are the page's content and need no tags — checked against
      // /templates/contact-cta, whose `cta-section` is `fixed: false` and whose
      // untagged `cta-btn` does survive the merge.
      //
      // It survives only because of that one flag. A template is the authored
      // source of truth, and an untagged block in one says nothing about who
      // owns it: set the section `fixed: true` — the kind of change made
      // routinely — and fillRegionEntries drops the button on its first rule,
      // `if (!child || !child.templateId) continue`, silently, from every page
      // using the template. The sibling /templates/contact-cta-info tags the
      // same button, so the tagged shape is already the house style; the
      // untagged one is the outlier, and the exemption existed to accommodate
      // exactly one block rather than because the shape is sound.
      // Regions via hydra's container API, so an object_list region is walked
      // like a blocks_layout one. Reading blocks_layout here saw neither.
      for (const descriptor of getChildFields(container, null, { allObjectLists: true })) {
        for (const { id, block } of getChildBlockEntries(container, descriptor)) {
          if (!block || typeof block !== 'object') continue;
          const label = prefix ? `${prefix} > ${id}` : id;
          yieldBlock(label, block);
          walk(block, label);
        }
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
      } else if (block.fixed === true && typeof block.readOnly !== 'boolean') {
        // `fixed: true` alone is ambiguous, and the two readings differ in who
        // owns the content: with readOnly the template owns it and the merge
        // re-derives it on every page; without, the block is the PAGE's — fixed
        // in place, still editable, its own text kept. A heading the author
        // types into and a heading the template dictates look identical here.
        //
        // `fixed: false` needs no readOnly: the page's own block fills that
        // slot and carries its own flags, so the placeholder has nothing to say.
        missing.push(
          'readOnly (true = the template owns the content, false = the page ' +
          'owns it and the block is merely fixed in place)',
        );
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
    for (const { id, block } of childEntries(data, idFieldMap)) {
      yieldBlock(id, block);
      walk(block, id);
    }
  }

  // Pass 2c-quater: a TEMPLATE's own slot ARRANGEMENT.
  //
  // `fixed` chrome is what separates one slot group from the next — it tells the
  // merge where one slot's content ends. Two OPEN slots side by side leave an
  // added block ambiguous, which is what hydra's validateTemplatePlaceholders
  // reports as "Missing Fixed Block"; the same function also requires the blocks
  // of one slotId to be contiguous.
  //
  // That check ran only in the EDITOR, at save time, against a merged page. So a
  // template saved with two adjacent open slots passed every gate here, and the
  // first anyone knew was an author refused on a page whose offending blocks sit
  // inside a readOnly, template-owned container they cannot reach: an error
  // about the template, raised against the page, with no route back to the
  // cause.
  //
  // The comment on 2c-ter says the arrangement "needs a render". That is true of
  // a PAGE, where the merge interleaves template and page blocks. It is not true
  // of a TEMPLATE's own blocks: their order is right there in blocks_layout.
  //
  // These two rules are a second copy of the editor's, which is a cost — the
  // editor's stays authoritative for merged pages. It is worth it because this
  // runs on the commit that introduces the fault, where the message can still
  // name the template.
  for (const { rel, data } of items) {
    // The same notion of "is a definition" the chrome pass uses: a doc whose
    // top blocks name itself, OR one whose top blocks hold slots and name no
    // other template. A definition need not name itself.
    const topBlocks = childEntries(data, idFieldMap).map(({ block }) => block);
    const ownRefs = [data.UID && `resolveuid/${data.UID}`, data['@id']].filter(Boolean);
    const isDefinition =
      topBlocks.some((block) => ownRefs.includes(block.templateId)) ||
      (topBlocks.some((block) => block.slotId) && !topBlocks.some((block) => block.templateId));
    if (!isDefinition) continue;

    // Regions come from hydra's own container API, not from reading
    // blocks_layout here. getChildFields enumerates a block's regions —
    // blocks_layout regions AND object_list fields — and getChildBlockEntries
    // returns a region's children in order, for either storage. They are what
    // the editor's validateTemplatePlaceholders walks, so this gate and the
    // save-time check see the same tree by construction rather than by two
    // implementations agreeing.
    //
    // I hand-rolled this first, on the assumption that a sync checkIntegrity
    // could not reach the ESM helpers. It can: Node require()s sync ESM.
    const checkOrder = (entries, where) => {
      const groups = new Map(); // slotId -> indexes
      let lastSlotId = null;
      entries.forEach(({ block }, i) => {
        if (!block) return;
        if (block.fixed === true) { lastSlotId = null; return; }
        const slotId = block.slotId;
        if (!slotId) return;
        if (!groups.has(slotId)) groups.set(slotId, []);
        groups.get(slotId).push(i);
        if (lastSlotId !== null && lastSlotId !== slotId) {
          errors.push(
            `${rel}: slot groups "${lastSlotId}" and "${slotId}" sit next to each other in ${where} ` +
            `with no fixed block between them — chrome is what marks where one slot ends, so a block ` +
            `added here could belong to either. Mark the one that is chrome (a heading, usually) ` +
            `fixed: true, or put a fixed block between them. Until then the EDITOR refuses to save ` +
            `any page using this template, naming blocks the author cannot reach.`,
          );
        }
        lastSlotId = slotId;
      });
      for (const [slotId, at] of groups) {
        for (let i = 1; i < at.length; i++) {
          if (at[i] !== at[i - 1] + 1) {
            errors.push(
              `${rel}: the blocks of slot "${slotId}" are not contiguous in ${where} — ` +
              `a slot's blocks must sit together, or the merge cannot tell which slot a block joins`,
            );
            break;
          }
        }
      }
    };

    const seen = new Set();
    const checkRegion = (container, where) => {
      if (!container || typeof container !== 'object' || seen.has(container)) return;
      seen.add(container);
      const fields = getChildFields(container, idFieldMap, { allObjectLists: true });
      for (const descriptor of fields) {
        const entries = getChildBlockEntries(container, descriptor);
        if (!entries.length) continue;
        const label = fields.length > 1 ? `${where} (${descriptor.region})` : where;
        checkOrder(entries, label);
        for (const { id, block } of entries) checkRegion(block, `${where} > ${id}`);
      }
    };
    checkRegion(data, 'the page');
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
    // A template is a document whose top-level blocks name it, or — a definition need
    // not name itself — whose top-level blocks hold slots and name no template at all.
    const isTemplateDoc = (data) => {
      const blocks = data.blocks || {};
      const top = childEntries(data, idFieldMap).map(({ block }) => block);
      const own = [data.UID && `resolveuid/${data.UID}`, data['@id']].filter(Boolean);
      if (top.some((block) => own.includes(block.templateId))) return true;
      return top.some((block) => block.slotId) && !top.some((block) => block.templateId);
    };
    const templateChrome = new Map(); // templateRef -> Map(slotId -> fixed)
    for (const { rel, data } of items) {
      const own = [data.UID && `resolveuid/${data.UID}`, data['@id']].filter(Boolean);
      if (!isTemplateDoc(data)) continue;
      const slots = new Map();
      // A region is a region: a slot held in an object_list (a slider's
      // slides) is a slot, so the container API enumerates both storages.
      // This used to recurse on `.blocks` alone and saw only blocks_layout,
      // so an object_list slot was never collected and its instances were
      // never checked against it.
      const collect = (container) => {
        for (const { block } of childEntries(container, idFieldMap)) {
          if (block.slotId) slots.set(block.slotId, block.fixed === true);
          collect(block);
        }
      };
      collect(data);
      for (const ref of own) templateChrome.set(ref, slots);
    }

    for (const { rel, data } of items) {
      if (isTemplateDoc(data)) continue; // a template, not an instance
      const check = (container) => {
        for (const { id: bid, block } of childEntries(container, idFieldMap)) {
          const chrome = block.templateId && templateChrome.get(block.templateId);
          if (chrome) {
            // On an INSTANCE only `slotId` is required, and it is the one that
            // matters: forced-layout expansion (helpers/fillRegionEntries) matches
            // a block to a slot by slotId and silently DROPS one that has none —
            // the block is composed into the page (block-sanity discovers it) yet
            // no frontend has a slot to render it, so its data-block-uid never
            // appears and the only symptom is a reveal timeout. That is how the
            // slate page's `callout` slipped through.
            //
            // `fixed` and `readOnly` are NOT required here. They are authored on
            // the template (checked above), and on a page block absent and false
            // are indistinguishable everywhere they are read — the merge branches
            // on `if (block.fixed)`, isSlot is `!b.fixed && !b.readOnly`,
            // isBlockPositionLocked and isBlockReadonly are both `!!`. Demanding
            // them here asked a real site to write two inert fields onto every
            // block that fills a template — 719 of them on the first tree this
            // ever ran against, none of which changed any behaviour.
            //
            // Stating TRUE still matters, and is still checked below: a page
            // block is classified as chrome by its OWN `fixed`, so a slot the
            // template marks fixed must say so on the instance too.
            const missing = [];
            if (!block.slotId) missing.push('slotId');
            if (missing.length) {
              stats.instanceBlocksBroken = (stats.instanceBlocksBroken || 0) + 1;
              errors.push(
                `  ${rel}: block ${bid} (${block['@type']}) fills template ` +
                `${block.templateId} but is missing ${missing.join(', ')} — a block ` +
                `with no slotId is dropped by forced-layout expansion and never ` +
                `renders`,
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
  // A block id names ONE block on its page: the editor maps an id to a block, so
  // of two blocks sharing an id only one can be selected or edited. Each
  // container's own layout can resolve perfectly (every summary-list row's value
  // block was "v1"), so the layout checks above can't see it.
  // Ids are checked over walkBlocks' tree, so an id repeated inside an
  // object_list — a slider's slides, a form's subblocks — is caught like one
  // in a blocks_layout container. Walking `blocks` dicts alone missed those.
  function checkUniqueIds(rel, blocks, parent, firstIn, container = null) {
    for (const [bid, block, parentId] of walkBlocks(blocks, container)) {
      if (!block || typeof block !== 'object') continue;
      const where = parentId ?? parent ?? 'the page';
      if (firstIn.has(bid)) {
        errors.push(`  ${rel}: block id ${bid} is used twice (in ${firstIn.get(bid)} and ${where}) — a block id must be unique on its page, or the editor can select and edit only one of them`);
      } else {
        firstIn.set(bid, where);
      }

    }
  }
  for (const { rel, data } of items) {
    checkLayout(rel, null, data);  // page-level blocks_layout
    for (const [bid, block] of walkBlocks(data.blocks, data)) {
      if (block.blocks && typeof block.blocks === 'object') checkLayout(rel, bid, block);
    }
    checkUniqueIds(rel, data.blocks, null, new Map(), data);
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

  stats.unschemadTypes = unschemad.size;
  if (unschemad.size) {
    warnings.push(
      `  ${unschemad.size} block type(s) have no schema, so their fields and ` +
        `references were NOT checked: ${[...unschemad].sort().join(', ')}`,
    );
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
function checkBlockSchemas(source, fieldMap, { idFieldMap = null } = {}) {
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
      if (entry && entry.builtIn) {
        // Its fields are the admin's built-in schema's (fieldMapFromSchemas):
        // not checked here. Its children still are, below.
      } else if (!declared) {
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
  };

  for (const entry of onDisk ? walkData(source) : source) {
    const { rel, data } = entry;
    stats.items += 1;
    // walkAllBlocks is the one enumeration point: it reports children of both
    // storages and nothing else. This used to descend into EVERY value and
    // call anything with an `@type` a block — so a link field, whose value is
    // the restapi's summary of the TARGET, was read as a child block and the
    // target's content type ("Document", "CaseStudy") reported as an
    // unrenderable block type.
    for (const [, block] of walkAllBlocks(data.blocks, data, idFieldMap)) visit(block, rel);
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

/**
 * Everything in the content the editor would refuse or rewrite.
 *
 * The schemas already say where a block may go — a region's `allowedBlocks`,
 * an ancestor's `disallowDescendantBlocks`, a region's `maxLength` — and the
 * editor enforces them on every add, drag and convert. Content that reached
 * Plone some other way (an import, a conversion, a fixture) was never held to
 * them: checkBlockSchemas only asks whether a block's FIELDS are declared, so
 * a block written into a container that does not allow it passed validation.
 *
 * It asks buildBlockPathMap, the module the editor itself reads, rather than
 * re-deriving the rules: each block's `allowedSiblingTypes` (its region's
 * allowedBlocks less anything an ancestor disallows), `maxSiblings` and
 * `emptyRequiredFields`, and its region's slate rules run through the same
 * normalizeSlateFields the editor applies on load. A region that names no
 * allowedBlocks (`allowedSiblingTypesDerived`) restricts nothing, so nothing
 * in it is reported.
 *
 * `schemas` is the site's `{ type: { blockSchema, ... } }` with its page
 * regions under `_page` — the same file `--schemas` reads. `exemptSlots`
 * names template slots whose blocks are placed deliberately where the editor
 * would not put them (documentation examples): their placement and maxLength
 * are not checked, every other rule is.
 */
// The groups the block chooser orders: Volto's four, plus the `templates`
// group hydra appends. A block whose `group` is none of these is offered
// under a heading the chooser never renders.
// A field holds a reference when its schema says so. These are the widgets
// that store one: an object_browser/url entry, or an image field. Which FIELD
// that is varies per block and is not knowable from its name — `link` and
// `searchPath` hold references, `items` and `steps` do not.
/** Whether a value is a REFERENCE rather than a local identifier or prose:
 *  uid-encoded (`resolveuid/…`, possibly with `../` hops), rooted at the site
 *  (`/about`), or an absolute URL. An object_list item's id (`slide-1`) is
 *  none of those, and neither is a headline — whitespace rules out prose,
 *  which a bare `scheme:` test does not ("Listing: Default" is not a mailto).
 *  Used only where no schema says which fields are links. */
function looksLikeReference(ref) {
  if (typeof ref !== 'string' || ref === '' || /\s/.test(ref)) return false;
  return (
    /^(\.\.\/)*resolveuid\//.test(ref) ||
    ref.startsWith('/') ||
    /^[a-z][a-z0-9+.-]*:\/\//i.test(ref) ||
    /^(mailto|tel):/i.test(ref)
  );
}

const REFERENCE_WIDGETS = new Set(['object_browser', 'url', 'image']);

/**
 * Every block stored under a container, at any depth — the ONE place the
 * validator enumerates blocks.
 *
 * Region children come from the container API, so an object_list child — a
 * slider's slide, a form's subblock — is walked like a blocks_layout one.
 *
 * Blocks present in the dict but listed by no region are yielded too: they are
 * stored, so a dangling reference, a repeated id or an undeclared field in one
 * still counts, and an orphan is exactly the state those checks exist to catch.
 */
function* walkAllBlocks(blocks, container = null, idFieldMap = null, where = null) {
  const seenIds = new Set();
  if (container) {
    for (const { id, block } of childEntries(container, idFieldMap)) {
      seenIds.add(id);
      yield [id, block, where];
      yield* walkAllBlocks(block.blocks, block, idFieldMap, id);
    }
  }
  for (const [bid, block] of Object.entries(blocks || {})) {
    if (!block || typeof block !== 'object' || seenIds.has(bid)) continue;
    yield [bid, block, where];
    yield* walkAllBlocks(block.blocks, block, idFieldMap, bid);
  }
}



// The admin's own chooser order. A frontend that declares its own
// (voltoConfig.blocks.groupBlocksOrder) replaces it — the INIT merge replaces
// arrays — and its --schemas module passes that order as `_groupBlocksOrder`.
const CHOOSER_GROUPS = new Set(['mostUsed', 'text', 'media', 'common', 'templates']);

/**
 * Every block an author can add must say where it lives in the chooser.
 *
 * A block with no `group` falls into an unnamed bucket; one naming a group
 * the chooser does not order is worse, because it reads as deliberate. Neither
 * shows up in content, so no content check can find it: this is a defect in
 * the config, not in any page, which is why it is its own pass rather than
 * part of the per-page rule check.
 *
 * `restricted` blocks are exempt: they are not in the picker at all, they are
 * placed by a template or a parent block.
 */
function checkChooserGroups(schemas) {
  const errors = [];
  const declared = schemas?._groupBlocksOrder;
  const groups = declared ? new Set(declared.map((g) => g.id)) : CHOOSER_GROUPS;
  for (const [type, def] of Object.entries(schemas || {})) {
    if (!def || typeof def !== 'object' || type.startsWith('_')) continue;
    if (def.restricted) continue;
    if (!def.blockSchema) continue; // not a block config
    if (!def.group) {
      errors.push(`  ${type}: no \`group\`, so the block chooser offers it under no heading — one of ${[...groups].join(', ')}`);
    } else if (!groups.has(def.group)) {
      errors.push(`  ${type}: group "${def.group}" is not one the chooser orders (${[...groups].join(', ')}), so the block is offered under a heading that never renders`);
    }
  }
  return { errors, warnings: [], stats: { blocks: Object.keys(schemas || {}).length, ungrouped: errors.length } };
}

async function checkEditorRules(source, schemas, { exemptSlots = [] } = {}) {
  const exempt = new Set(exemptSlots);
  const hydraJs = (file) =>
    import(
      require('url').pathToFileURL(
        require('path').join(__dirname, '..', '..', 'packages', 'hydra-js', file),
      ).href
    );
  const { buildBlockPathMap } = await hydraJs('buildBlockPathMap.js');
  const { normalizeSlateFields } = await hydraJs('slateStyles.js');
  const { createFieldRulesEnhancer } = await hydraJs('fieldRules.js');
  // A schemas file carries schemaEnhancer RECIPES (plain data), and
  // buildBlockPathMap runs only enhancer FUNCTIONS — in the admin, blockSync
  // turns recipes into functions at init. Do the same for `fieldRules`, with
  // the same module, so a rule means here exactly what it means in the editor.
  const withRules = Object.fromEntries(
    Object.entries(schemas).map(([type, def]) => {
      const recipe = def && def.schemaEnhancer;
      if (!recipe || typeof recipe === 'function' || !recipe.fieldRules) return [type, def];
      return [type, { ...def, schemaEnhancer: createFieldRulesEnhancer(recipe.fieldRules) }];
    }),
  );
  const onDisk = typeof source === 'string';
  const errors = [];
  const warnings = [];
  const stats = {
    items: 0, blocks: 0, misplaced: 0, overfull: 0, emptyRequired: 0, restyled: 0,
    ruleErrors: 0, ruleWarnings: 0,
  };
  // A LAYOUT document holds the blocks of the region that names it in
  // `allowedLayouts` (a site footer's blocks are the footer region's, not the
  // page content's), so it is held to that region's rules: its own `items` are
  // checked with that region's definition in place of the page's.
  const pageSchema = (withRules._page && withRules._page.blockSchema) || { properties: {} };
  const layoutRegion = new Map(); // layout path -> region field definition
  for (const def of Object.values(pageSchema.properties || {})) {
    for (const layout of (def && def.allowedLayouts) || []) {
      if (typeof layout === 'string') layoutRegion.set(layout.replace(/\/+$/, ''), def);
    }
  }
  const schemasFor = (data) => {
    const id = typeof data['@id'] === 'string' ? data['@id'].replace(/^https?:\/\/[^/]+/, '').replace(/\/+$/, '') : '';
    const region = layoutRegion.get(id);
    if (!region) return withRules;
    return {
      ...withRules,
      _page: { ...withRules._page, blockSchema: { ...pageSchema, properties: { items: region } } },
    };
  };
  for (const { rel, data } of onDisk ? walkData(source) : source) {
    stats.items += 1;
    if (!data || !data.blocks) continue;
    const pathMap = buildBlockPathMap(data, schemasFor(data));
    const regionCounts = new Map(); // parent + region -> [counted blocks, max, where]
    for (const [uid, info] of Object.entries(pathMap)) {
      if (uid.startsWith('_') || !info || typeof info !== 'object' || !info.blockType) continue;
      // A template instance's VIRTUAL container (no path: it groups the
      // instance's blocks in the editor, it is not content) — its blocks are
      // checked where they actually live.
      if (!Array.isArray(info.path)) continue;
      stats.blocks += 1;
      const blockData = info.path.reduce((node, key) => (node == null ? node : node[key]), data);
      // A block in an exempt template slot is deliberately placed where the
      // editor would not put it (an example on a documentation page): its
      // PLACEMENT is not checked, and it does not count against maxLength.
      // Every other rule below still applies to it.
      const placementExempt = Boolean(blockData && exempt.has(blockData.slotId));
      const where = info.parentId === '_page'
        ? `the page's ${info.region}`
        : `${pathMap[info.parentId]?.blockType ?? info.parentId}.${info.region}`;
      if (
        !placementExempt &&
        !info.allowedSiblingTypesDerived &&
        Array.isArray(info.allowedSiblingTypes) &&
        !info.allowedSiblingTypes.includes(info.blockType)
      ) {
        stats.misplaced += 1;
        errors.push(
          `  ${rel}: a "${info.blockType}" block (${uid}) is in ${where}, which ` +
            `does not allow it there — the editor would refuse to put it there`,
        );
      }
      // A required field left empty: the editor will not save the block.
      for (const { fieldName } of info.emptyRequiredFields || []) {
        stats.emptyRequired += 1;
        errors.push(
          `  ${rel}: a "${info.blockType}" block (${uid}) has no ${fieldName}, ` +
            `which its schema requires — the editor will not save it`,
        );
      }
      // A text style the region does not allow: the editor rewrites it on load,
      // so the stored content is not what anyone will see or save.
      const schema = info._schemaRef ? pathMap._schemas[info._schemaRef] : null;
      if (info.slateRules && schema) {
        const { changes } = normalizeSlateFields(blockData, schema, info.slateRules);
        for (const c of changes) {
          stats.restyled += 1;
          errors.push(
            `  ${rel}: a "${info.blockType}" block (${uid}) uses "${c.from}" in ${c.field}, ` +
              `which ${where} does not allow — the editor rewrites it ` +
              `${c.to ? `as "${c.to}"` : 'away'} on load`,
          );
        }
      }
      // A fieldRules `error` / `warning` that fired on this block's data: the
      // resolved schema carries it on the field, as the sidebar shows it.
      for (const [field, def] of Object.entries((schema && schema.properties) || {})) {
        if (def && def.hydraRuleError) {
          stats.ruleErrors += 1;
          errors.push(`  ${rel}: a "${info.blockType}" block (${uid}), ${field}: ${def.hydraRuleError}`);
        }
        if (def && def.hydraRuleWarning) {
          stats.ruleWarnings += 1;
          warnings.push(`  ${rel}: a "${info.blockType}" block (${uid}), ${field}: ${def.hydraRuleWarning}`);
        }
      }
      if (typeof info.maxSiblings === 'number' && !placementExempt) {
        // Per container INSTANCE: two blocks of the same type each have their
        // own region, and its own limit.
        const key = `${info.parentId}\u0000${info.region}`;
        const [count] = regionCounts.get(key) || [0];
        regionCounts.set(key, [count + 1, info.maxSiblings, where]);
      }
    }
    for (const [count, max, where] of regionCounts.values()) {
      if (count <= max) continue;
      stats.overfull += 1;
      errors.push(
        `  ${rel}: ${where} holds ${count} blocks, but takes at most ${max} — ` +
          `the editor would refuse to add the extra ones`,
      );
    }
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
  } else if (title === 'rules') {
    lines.push(`Content: ${result.stats.items} items, ${result.stats.blocks} blocks`);
    lines.push(
      `Rules:   ${result.stats.misplaced} misplaced, ${result.stats.overfull} over maxLength, ` +
        `${result.stats.emptyRequired} required empty, ${result.stats.restyled} disallowed styles, ` +
        `${result.stats.ruleErrors} rule errors, ${result.stats.ruleWarnings} rule warnings`,
    );
  } else if (title === 'chooser') {
    lines.push(
      `Chooser: ${result.stats.blocks} block types, ${result.stats.ungrouped} not offered under any heading`,
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

/**
 * A site's block schemas -- `{ blockType: { blockSchema, schemaEnhancer? } }`,
 * the JSON its frontend config loads -- read for the two questions content is
 * checked against: which fields a block declares (checkBlockSchemas) and what
 * shape each field's value has (checkIntegrity, through buildBlockPathMap).
 * One source; no map derived from it and stored.
 */
/** Load a site's schemas: a JS module (`.mjs`/`.js`, its default export) --
 *  plain data the frontend config also imports, so shared pieces are written
 *  once -- or a `.json` file. */
async function loadSchemas(file) {
  const abs = require('path').resolve(file);
  if (abs.endsWith('.json')) return JSON.parse(require('fs').readFileSync(abs, 'utf8'));
  const mod = await import(require('url').pathToFileURL(abs).href);
  return mod.default ?? mod;
}

/** The field map checkBlockSchemas reads, derived from the schemas: each
 *  block's declared fields (its schema properties), the prefix its per-item
 *  defaults are stored under (`<defaultsField>_<field>`), and the keys a
 *  container stamps on its children (every object_list's idField/typeField). */
function fieldMapFromSchemas(schemas) {
  const blocks = {};
  const identityFields = new Set(['@id', '@type']);
  const stamps = (node) => {
    if (Array.isArray(node)) { node.forEach(stamps); return; }
    if (!node || typeof node !== 'object') return;
    for (const key of ['idField', 'typeField']) if (typeof node[key] === 'string') identityFields.add(node[key]);
    Object.values(node).forEach(stamps);
  };
  for (const [type, def] of Object.entries(schemas)) {
    // No blockSchema: the frontend adds rules or an enhancer to a block the
    // admin already provides, and the admin's schema stays (mergeFrontendBlock
    // replaces only the keys given). Its fields are that schema's, which this
    // map cannot see — so they are not checked here, and the block is known.
    if (!def?.blockSchema) {
      blocks[type] = { builtIn: true };
      continue;
    }
    const entry = { fields: Object.keys(def.blockSchema.properties ?? {}) };
    const defaultsField = def?.schemaEnhancer?.inheritSchemaFrom?.defaultsField;
    if (defaultsField) entry.defaultsPrefix = defaultsField;
    blocks[type] = entry;
    stamps(def?.blockSchema);
  }
  return { blocks, identityFields: [...identityFields] };
}

module.exports = { validate, checkIntegrity, checkBlockSchemas, checkEditorRules, checkChooserGroups, fieldMapFromSchemas, loadSchemas, formatReport };
