// @linkintegrity as plone.restapi answers it: for each item about to be
// deleted (by UID), the pages outside it that link to it or to anything in it
// ("breaches"), and how many items it holds ("items_total"). The editor's
// delete dialog shows these, and so must anything else that deletes.
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

const pathOf = (url) => new URL(url).pathname;
const sourcesOf = (result) => result.breaches.map((b) => pathOf(b['@id'])).sort();

describe('@linkintegrity', () => {
  it('names the pages that link to an item, not the item itself', async () => {
    const token = mintToken('admin');
    const { status, body } = await call('GET', '/@linkintegrity?uids=target-page-uid-0001', token);
    assert.equal(status, 200);
    assert.equal(body.length, 1);
    assert.equal(pathOf(body[0]['@id']), '/_test_data/target-page');
    assert.equal(body[0].title, 'Target Page');
    assert.equal(body[0].items_total, 0);
    assert.deepEqual(sourcesOf(body[0]), [
      '/_test_data/field-rules-page', '/_test_data/optional-fields-page', '/_test_data/test-page',
    ]);
    for (const breach of body[0].breaches) {
      assert.equal(typeof breach.title, 'string');
      assert.equal(typeof breach.uid, 'string');
    }
  });

  it('counts a link by UID (resolveuid), and a link to something inside the item', async () => {
    const token = mintToken('admin');
    const folder = (await call('POST', '/_test_data', token, { '@type': 'Document', id: 'li-folder', title: 'Folder' })).body;
    const child = (await call('POST', '/_test_data/li-folder', token, { '@type': 'Document', id: 'child', title: 'Child' })).body;
    await call('POST', '/_test_data', token, {
      '@type': 'Document', id: 'li-by-uid', title: 'By UID',
      blocks: { a: { '@type': 'teaser', href: [{ '@id': `../resolveuid/${child.UID}` }] } }, blocks_layout: { items: ['a'] },
    });
    await call('POST', '/_test_data', token, {
      '@type': 'Document', id: 'li-by-url', title: 'By URL',
      blocks: { a: { '@type': 'teaser', href: [{ '@id': `${baseUrl}/_test_data/li-folder/child` }] } }, blocks_layout: { items: ['a'] },
    });
    const { body } = await call('GET', `/@linkintegrity?uids=${folder.UID}`, token);
    assert.equal(body[0].items_total, 1);
    assert.deepEqual(sourcesOf(body[0]), ['/_test_data/li-by-uid', '/_test_data/li-by-url']);
  });

  it('has nothing to say of an item nothing links to', async () => {
    const token = mintToken('admin');
    const lonely = (await call('POST', '/_test_data', token, { '@type': 'Document', id: 'li-lonely', title: 'Lonely' })).body;
    const { body } = await call('GET', `/@linkintegrity?uids=${lonely.UID}`, token);
    assert.deepEqual(body[0].breaches, []);
  });
});
