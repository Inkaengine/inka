/**
 * Mounts at the same path are layers: a site's own content over a starter it
 * builds on, say, or a frontend's test fixtures over that starter. Where both
 * hold a path, the mount listed first serves it, whatever either's format; the
 * other's item there is not served at all, so its uid doesn't resolve. A
 * folder holds the children of every layer. An export takes each item from the
 * layer that serves it.
 *
 * The markdown layer is listed second here on purpose: markdown loads after
 * JSON, and loading used to decide, so the second mount won.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

const page = (dir, rel, data) => {
  fs.mkdirSync(path.join(dir, rel), { recursive: true });
  fs.writeFileSync(path.join(dir, rel, 'data.json'), JSON.stringify(data));
};

// The upper layer: an exportimport tree, as a site's own content is.
const upperDist = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-layers-upper-'));
const upper = path.join(upperDist, 'content');
page(upper, 'shared', { '@id': '/shared', '@type': 'Document', UID: 'upper-shared-0001', id: 'shared', title: 'Upper shared' });
page(upper, 'folder', { '@id': '/folder', '@type': 'Document', UID: 'upper-folder-0001', id: 'folder', title: 'Upper folder' });
page(upper, 'folder/upper-child', {
  '@id': '/folder/upper-child', '@type': 'Document', UID: 'upper-child-0001', id: 'upper-child', title: 'Upper child',
});
fs.writeFileSync(path.join(upper, '__metadata__.json'), JSON.stringify({
  _data_files_: ['shared/data.json', 'folder/data.json', 'folder/upper-child/data.json'],
  _blob_files_: [],
  ordering: {},
}));
for (const sibling of ['discussions', 'portlets', 'principals', 'redirects']) {
  fs.writeFileSync(path.join(upperDist, `${sibling}.json`), sibling === 'principals' ? '{"members":[],"groups":[]}' : '{}');
}

// The lower layer: a markdown starter.
const lower = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-layers-lower-'));
const md = (rel, front) => {
  const file = path.join(lower, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const yaml = Object.entries(front).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join('\n');
  fs.writeFileSync(file, `---\n${yaml}\n---\n`);
};
md('index.md', { '@type': 'Plone Site', UID: 'plone_site_root', id: 'site', title: 'Lower root' });
md('shared.md', { '@type': 'Document', UID: 'lower-shared-0001', id: 'shared', title: 'Lower shared', review_state: 'published' });
md('folder/index.md', { '@type': 'Document', UID: 'lower-folder-0001', id: 'folder', title: 'Lower folder', review_state: 'published' });
md('folder/lower-child.md', {
  '@type': 'Document', UID: 'lower-child-0001', id: 'lower-child', title: 'Lower child', review_state: 'published',
});
md('lower-only.md', { '@type': 'Document', UID: 'lower-only-0001', id: 'lower-only', title: 'Lower only', review_state: 'published' });

process.env.CONTENT_MOUNTS = `/:${upper},/:${lower}`;
const { app, ready } = await import('./mock-plone-api.js');

let server;
let baseUrl;
const get = (p) => fetch(`${baseUrl}${p}`, { headers: { Accept: 'application/json' } });

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
  await new Promise((resolve) => server.close(resolve));
});

describe('two mounts at the same path', () => {
  it('serves a path both hold from the mount listed first', async () => {
    const body = await (await get('/shared')).json();
    assert.equal(body.UID, 'upper-shared-0001');
    assert.equal((await (await get('/folder')).json()).UID, 'upper-folder-0001');
  });

  it("serves a path only the second holds", async () => {
    assert.equal((await (await get('/lower-only')).json()).UID, 'lower-only-0001');
  });

  it("doesn't resolve the uid of an item the first mount hides", async () => {
    const res = await fetch(`${baseUrl}/resolveuid/lower-shared-0001`, { redirect: 'manual' });
    assert.equal(res.status, 404);
  });

  it('lists the children of every layer in a folder both hold', async () => {
    const { items } = await (await get('/folder')).json();
    assert.deepEqual(items.map((item) => item['@id'].split('/').pop()).sort(), ['lower-child', 'upper-child']);
  });

  it("exports each item from the layer that serves it", async () => {
    const res = await fetch(`${baseUrl}/@export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'json' }),
    });
    assert.equal(res.status, 200, await res.clone().text());
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-layers-export-'));
    fs.writeFileSync(path.join(dir, 'e.zip'), Buffer.from(await res.arrayBuffer()));
    execFileSync('unzip', ['-q', '-o', 'e.zip'], { cwd: dir });
    const content = path.join(dir, 'content');
    const uids = fs.readdirSync(content, { recursive: true })
      .filter((f) => f.endsWith('data.json'))
      .map((f) => JSON.parse(fs.readFileSync(path.join(content, f), 'utf8')).UID)
      .sort();
    // The starter's items, except the two the site's own content replaces.
    assert.deepEqual(uids, [
      'lower-child-0001', 'lower-only-0001', 'plone_site_root',
      'upper-child-0001', 'upper-folder-0001', 'upper-shared-0001',
    ]);
  });
});
