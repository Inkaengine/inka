/**
 * Project seed.json into the on-disk tree the mock Plone API serves.
 *
 * Layout mirrors tests-playwright/fixtures/content: one directory per content
 * item, each holding a data.json, nested to match the path hierarchy.
 *
 * Run: node tests-adapters/fixtures/project-plone.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SEED = JSON.parse(fs.readFileSync(path.join(HERE, 'seed.json'), 'utf8'));
const OUT = path.join(HERE, 'content');

/** Canonical seed type -> Plone portal type. */
const PLONE_TYPES = { folder: 'Document', page: 'Document', image: 'Image' };

/** Canonical seed state -> Plone review_state. */
const PLONE_STATES = { published: 'published', draft: 'private' };

function uidFor(p) {
  return p === '/' ? 'seed-root' : `seed${p.replace(/\//g, '-')}`;
}

function dirFor(p) {
  return p === '/' ? OUT : path.join(OUT, ...p.split('/').filter(Boolean));
}

fs.rmSync(OUT, { recursive: true, force: true });

const byPath = new Map(SEED.documents.map((d) => [d.path, d]));

for (const doc of SEED.documents) {
  // The mock synthesises the site root itself (getSiteRoot in
  // mock-plone-api.cjs) and scanContentDir only descends into SUBdirectories,
  // so a data.json at the mount root would be ignored anyway.
  if (doc.path === '/') continue;

  const dir = dirFor(doc.path);
  fs.mkdirSync(dir, { recursive: true });

  const isFolderish = SEED.documents.some(
    (d) => d.path !== doc.path && path.posix.dirname(d.path) === doc.path,
  );

  const data = {
    // scanContentDir derives the URL path from @id, NOT from directory
    // nesting — without this every child would register at the tree root.
    '@id': doc.path,
    '@type': PLONE_TYPES[doc.type],
    UID: uidFor(doc.path),
    id: doc.path === '/' ? '' : doc.path.split('/').pop(),
    title: doc.title,
    review_state: PLONE_STATES[doc.state],
    is_folderish: isFolderish,
    blocks: doc.blocks ?? {},
    blocks_layout: doc.blocksLayout ?? { items: [] },
  };

  fs.writeFileSync(
    path.join(dir, 'data.json'),
    JSON.stringify(data, null, 2) + '\n',
  );
}

console.log(
  `projected ${SEED.documents.length} documents into ${path.relative(process.cwd(), OUT)}`,
);
if (byPath.size !== SEED.documents.length) {
  throw new Error('seed.json contains duplicate paths');
}
