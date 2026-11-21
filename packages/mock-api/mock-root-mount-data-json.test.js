/**
 * A `/` mount's site root is its plone_site_root, never a data.json at the top
 * of its directory.
 *
 * One fixtures directory can be mounted at `/` by one server and under a prefix
 * (/_test_data) by another. Under the prefix its top data.json is the page at
 * the prefix, as Inka's own test data has one; at `/` it is no part of a
 * distribution tree (whose root is plone_site_root/data.json) and must not
 * take the site root's place.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-root-data-json-'));
fs.writeFileSync(
  path.join(dir, 'data.json'),
  JSON.stringify({ '@type': 'Document', UID: 'testdataroot0001', id: '_test_data', title: 'Test Data' }),
);

process.env.CONTENT_MOUNTS = `/:${dir}`;
const { app } = await import('./mock-api-server.js');

let server;
let baseUrl;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://localhost:${server.address().port}`;
      resolve();
    });
  });
});

after(() => server.close());

describe('a data.json at the top of a `/` mount', () => {
  it('is not the site root', async () => {
    const res = await fetch(`${baseUrl}/`, { headers: { Accept: 'application/json' } });
    assert.equal(res.status, 200);
    const root = await res.json();
    assert.equal(root['@type'], 'Plone Site');
    assert.equal(root.title, 'Plone Site');
  });
});
