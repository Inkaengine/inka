/**
 * Full-text search (SearchableText), as Plone answers it: it finds a page by
 * the text in its blocks, not only its title and description (plone.restapi
 * indexes Text blocks, nested ones included), and it searches the site as it
 * is now, with this session's own new and edited pages. The mock matched
 * title/description/id of the content on disk only, so a page whose body
 * mentions something was never found, and an edit was never seen.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const slate = (text) => [{ type: 'p', children: [{ text }] }];

/** A site with one page whose body (not its title) says "marigolds", inside a container. */
function distribution() {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-searchable-text-'));
  for (const name of ['discussions.json', 'portlets.json', 'principals.json', 'redirects.json']) {
    fs.writeFileSync(path.join(dist, name), '{}');
  }
  const content = path.join(dist, 'content');
  const item = (dir, data) => {
    fs.mkdirSync(path.join(content, dir), { recursive: true });
    fs.writeFileSync(path.join(content, dir, 'data.json'), JSON.stringify(data));
  };
  item('plone_site_root', { '@id': '/Plone', '@type': 'Plone Site', UID: 'searchtext-root-0001', id: 'Plone', title: 'Site' });
  item('beds', {
    '@id': '/beds', '@type': 'Document', UID: 'searchtext-beds-0001', id: 'beds', title: 'Garden beds',
    review_state: 'published',
    blocks: {
      cols: {
        '@type': 'columns',
        blocks: { c1: { '@type': 'column', blocks: { p: { '@type': 'slate', value: slate('This year the marigolds came up early.') } }, blocks_layout: { items: ['p'] } } },
        blocks_layout: { columns: ['c1'] },
      },
    },
    blocks_layout: { items: ['cols'] },
  });
  return content;
}

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

const headers = (token) => ({ Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` });

/** The paths a SearchableText search finds. */
async function found(token, text) {
  const res = await fetch(`${baseUrl}/@search?SearchableText=${encodeURIComponent(text)}`, { headers: headers(token) });
  assert.equal(res.status, 200);
  return (await res.json()).items.map((i) => new URL(i['@id']).pathname).sort();
}

describe('SearchableText', () => {
  it("finds a page by the text in its blocks, nested ones included", async () => {
    assert.deepEqual(await found(await login(), 'marigolds'), ['/beds']);
  });

  it("finds this session's new pages, by title and by their text", async () => {
    const token = await login();
    const res = await fetch(`${baseUrl}/`, {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify({
        '@type': 'Document', id: 'compost', title: 'Compost corner',
        blocks: { p: { '@type': 'slate', value: slate('Bring your kitchen scraps.') } },
        blocks_layout: { items: ['p'] },
      }),
    });
    assert.equal(res.status, 201);
    assert.deepEqual(await found(token, 'compost'), ['/compost']);
    assert.deepEqual(await found(token, 'kitchen scraps'), ['/compost']);
  });

  it('searches a page as it is after an edit, not as it was', async () => {
    const token = await login();
    const page = await (await fetch(`${baseUrl}/beds`, { headers: headers(token) })).json();
    page.blocks.cols.blocks.c1.blocks.p.value = slate('This year the sunflowers came up early.');
    const res = await fetch(`${baseUrl}/beds`, { method: 'PATCH', headers: headers(token), body: JSON.stringify({ blocks: page.blocks }) });
    assert.ok(res.ok, `PATCH -> ${res.status}`);
    assert.deepEqual(await found(token, 'sunflowers'), ['/beds']);
    assert.deepEqual(await found(token, 'marigolds'), []);
  });
});
