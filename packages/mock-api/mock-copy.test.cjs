// @copy as Plone pastes a copy: into the same folder it gets a new id
// (copy_of_<id>, then copy2_of_<id>…) and the original is untouched; what the
// item holds is copied with it; every copied item is a distinct object (UID).
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { app } = require('./mock-api-server.cjs');
const { mintToken } = require('./mock-tokens.cjs');

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

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function call(method, path, token, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
}

const pathOf = (url) => (url.startsWith('http') ? new URL(url).pathname : url);

describe('@copy', () => {
  it('copies into the same folder under a new id, leaving the original', async () => {
    const token = mintToken('admin');
    const original = (await call('POST', '/_test_data', token, { '@type': 'Document', id: 'cp-same', title: 'Original' })).body;
    const first = await call('POST', '/_test_data/@copy', token, { source: `${baseUrl}/_test_data/cp-same` });
    assert.equal(pathOf(first.body[0].target), '/_test_data/copy_of_cp-same');
    const second = await call('POST', '/_test_data/@copy', token, { source: '/_test_data/cp-same' });
    assert.equal(pathOf(second.body[0].target), '/_test_data/copy2_of_cp-same');

    const kept = (await call('GET', '/_test_data/cp-same', token)).body;
    assert.equal(kept.UID, original.UID);
    const copy = (await call('GET', '/_test_data/copy_of_cp-same', token)).body;
    assert.equal(copy.title, 'Original');
    assert.equal(copy.id, 'copy_of_cp-same');
    assert.notEqual(copy.UID, original.UID);
  });

  it('copies what the item holds with it', async () => {
    const token = mintToken('admin');
    await call('POST', '/_test_data', token, { '@type': 'Document', id: 'cp-folder', title: 'Folder' });
    const child = (await call('POST', '/_test_data/cp-folder', token, { '@type': 'Document', id: 'child', title: 'Child' })).body;
    await call('POST', '/_test_data', token, { '@type': 'Document', id: 'cp-into', title: 'Into' });
    const copied = await call('POST', '/_test_data/cp-into/@copy', token, { source: '/_test_data/cp-folder' });
    assert.equal(pathOf(copied.body[0].target), '/_test_data/cp-into/cp-folder');
    const copiedChild = await call('GET', '/_test_data/cp-into/cp-folder/child', token);
    assert.equal(copiedChild.status, 200);
    assert.equal(copiedChild.body.title, 'Child');
    assert.notEqual(copiedChild.body.UID, child.UID);
    assert.equal((await call('GET', '/_test_data/cp-folder/child', token)).status, 200);
  });
});
