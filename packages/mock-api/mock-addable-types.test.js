/**
 * What a folder lets the signed-in user add, as Plone's @types says it: every
 * type, each marked `addable`. An ordinary folder takes Images and Files (the
 * mock accepts their upload, so it lists them); a folder whose type
 * constraints allow less (`locally_allowed_types`) marks the rest not
 * addable. The editor asks this before it holds an image for upload on Save.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { mintToken } from './mock-tokens.js';

/** A site with an ordinary folder and one that takes pages only. */
function distribution() {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-addable-types-'));
  for (const name of ['discussions.json', 'portlets.json', 'principals.json', 'redirects.json']) {
    fs.writeFileSync(path.join(dist, name), '{}');
  }
  const content = path.join(dist, 'content');
  const item = (dir, data) => {
    fs.mkdirSync(path.join(content, dir), { recursive: true });
    fs.writeFileSync(path.join(content, dir, 'data.json'), JSON.stringify(data));
  };
  item('plone_site_root', { '@id': '/Plone', '@type': 'Plone Site', UID: 'addable-root-000001', id: 'Plone', title: 'Site' });
  item('open', {
    '@id': '/open', '@type': 'Document', UID: 'addable-open-000001', id: 'open',
    title: 'Open', is_folderish: true, review_state: 'published',
  });
  item('pages-only', {
    '@id': '/pages-only', '@type': 'Document', UID: 'addable-pages-00001', id: 'pages-only',
    title: 'Pages only', is_folderish: true, review_state: 'published',
    locally_allowed_types: ['Document'],
  });
  return content;
}

// CONTENT_MOUNTS is read when the mock loads, and node --test runs each file in
// its own process, so this mock serves only the site above.
process.env.CONTENT_MOUNTS = `/:${distribution()}`;
const { app, ready } = await import('./mock-plone-api.js');

let server;
let baseUrl;

before(async () => {
  await ready;
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://localhost:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

/** The types `folder` lets the admin add, by id. */
async function addable(folder) {
  const res = await fetch(`${baseUrl}${folder}/@types`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${mintToken('admin')}` },
  });
  assert.equal(res.status, 200);
  return (await res.json()).filter((type) => type.addable).map((type) => type.id);
}

describe('@types in a folder', () => {
  it('an ordinary folder takes images and files', async () => {
    assert.deepEqual(await addable('/open'), ['Document', 'Folder', 'Image', 'File']);
  });

  it('a folder that allows pages only takes no images', async () => {
    assert.deepEqual(await addable('/pages-only'), ['Document']);
  });
});
