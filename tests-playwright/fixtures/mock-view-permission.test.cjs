/**
 * What a reader may see, everywhere the mock lists content — as Plone does.
 *
 * Plone filters every catalog query by the reader's permission to view
 * (allowedRolesAndUsers): under simple_publication_workflow an anonymous
 * reader sees `published` content only, while a `private` or `pending` item
 * is seen by its Owner and by the roles that may view it. The mock refused
 * such an item only when it was fetched by its own URL, so every listing,
 * search and menu still offered it to anonymous readers — a link that 401s
 * the moment it is followed.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** A site holding /folder with one item in each workflow state. */
function distribution() {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-view-permission-'));
  for (const name of ['discussions.json', 'portlets.json', 'principals.json', 'redirects.json']) {
    fs.writeFileSync(path.join(dist, name), '{}');
  }
  const content = path.join(dist, 'content');
  const item = (dir, data) => {
    fs.mkdirSync(path.join(content, dir), { recursive: true });
    fs.writeFileSync(path.join(content, dir, 'data.json'), JSON.stringify(data));
  };
  item('plone_site_root', { '@id': '/Plone', '@type': 'Plone Site', UID: 'viewperm-root-00001', id: 'Plone', title: 'Site' });
  item('folder', {
    '@id': '/folder', '@type': 'Document', UID: 'viewperm-folder-0001', id: 'folder',
    title: 'Folder', is_folderish: true, review_state: 'published',
  });
  for (const state of ['published', 'private', 'pending']) {
    item(`folder-${state}`, {
      '@id': `/folder/${state}`, '@type': 'Document', UID: `viewperm-${state}-0001`, id: state,
      title: `A ${state} page`, review_state: state, creators: ['someone-else'],
    });
  }
  return content;
}

// CONTENT_MOUNTS is read when the mock loads, and node --test runs each file in
// its own process, so this mock serves only the site above.
process.env.CONTENT_MOUNTS = `/:${distribution()}`;
const { app, ready } = require('./mock-plone-api.cjs');

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

async function login() {
  const res = await fetch(`${baseUrl}/@login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ login: 'admin', password: 'admin' }),
  });
  assert.equal(res.status, 200);
  return (await res.json()).token;
}

function headers(token) {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function getJson(url, token) {
  const res = await fetch(`${baseUrl}${url}`, { headers: headers(token) });
  assert.equal(res.status, 200, `${url} -> ${res.status}`);
  return res.json();
}

/** The ids each listing of /folder offers, by endpoint. */
async function listings(token) {
  const ids = (items) => items.map((i) => String(i['@id']).split('/').pop()).sort();
  const qs = await fetch(`${baseUrl}/folder/@querystring-search`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({
      query: [{ i: 'path', o: 'plone.app.querystring.operation.string.relativePath', v: '.::1' }],
    }),
  });
  assert.equal(qs.status, 200);
  const nav = await getJson('/folder/@navigation?expand.navigation.depth=3', token);
  const navFolder = nav.items.find((i) => String(i['@id']).endsWith('/folder'));
  assert.ok(navFolder, `no /folder in the menu: ${JSON.stringify(nav.items.map((i) => i['@id']))}`);
  return {
    folderItems: ids((await getJson('/folder', token)).items),
    search: ids((await getJson('/folder/@search?path.depth=1', token)).items),
    searchAll: ids((await getJson('/@search', token)).items).filter((id) => id !== 'folder'),
    textSearch: ids((await getJson('/@search?SearchableText=page', token)).items),
    querystringSearch: ids((await qs.json()).items),
    navigation: ids(navFolder.items),
  };
}

describe('content an anonymous reader may not view', () => {
  it('is left out of every listing, search and menu', async () => {
    const seen = await listings(null);
    for (const [where, ids] of Object.entries(seen)) {
      assert.deepEqual(ids, ['published'], where);
    }
  });

  it('is found by UID only by those who may view it', async () => {
    const anonymous = await getJson('/@search?UID=viewperm-private-0001', null);
    assert.equal(anonymous.items_total, 0);
    const token = await login();
    const editor = await getJson('/@search?UID=viewperm-private-0001', token);
    assert.deepEqual(editor.items.map((i) => i.title), ['A private page']);
  });

  it('is still listed for a reader with a role that may view it', async () => {
    // @login answers that everyone signing in is a Manager.
    const seen = await listings(await login());
    for (const [where, ids] of Object.entries(seen)) {
      assert.deepEqual(ids, ['pending', 'private', 'published'], where);
    }
  });
});
