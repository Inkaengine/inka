/**
 * Boolean indexes, as Plone's catalog answers them: `exclude_from_nav` and a
 * site's `seo_noindex` (kitconcept.seo's "No Index", which a site indexes so a
 * search can leave such a page out). An item without the field is False, as a
 * site's indexer makes it, so "not no-index" finds every page nobody ticked.
 *
 * @querystring-search took a boolean criterion on exclude_from_nav only and
 * refused any other, and @search ignored a boolean it did not know, so a
 * frontend leaving no-index pages out of its sitemap was never held to it.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function distribution() {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-boolean-indexes-'));
  for (const name of ['discussions.json', 'portlets.json', 'principals.json', 'redirects.json']) {
    fs.writeFileSync(path.join(dist, name), '{}');
  }
  const content = path.join(dist, 'content');
  const item = (dir, data) => {
    fs.mkdirSync(path.join(content, dir), { recursive: true });
    fs.writeFileSync(path.join(content, dir, 'data.json'), JSON.stringify(data));
  };
  const page = (id, extra = {}) =>
    item(id, { '@id': `/${id}`, '@type': 'Document', UID: `bool-${id}-0001`, id, title: id, review_state: 'published', ...extra });
  item('plone_site_root', { '@id': '/Plone', '@type': 'Plone Site', UID: 'bool-root-0001', id: 'Plone', title: 'Site' });
  page('hidden', { seo_noindex: true });
  page('shown', { seo_noindex: false });
  page('untouched');
  page('offnav', { exclude_from_nav: true });
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

const ids = (body) => body.items.map((i) => new URL(i['@id']).pathname.slice(1)).sort();

async function search(params) {
  const res = await fetch(`${baseUrl}/@search?${new URLSearchParams(params)}`, { headers: { Accept: 'application/json' } });
  return { status: res.status, body: await res.json() };
}

async function query(criteria) {
  const res = await fetch(`${baseUrl}/@querystring-search`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: criteria, b_size: 50 }),
  });
  return { status: res.status, body: await res.json() };
}

const IS_FALSE = 'plone.app.querystring.operation.boolean.isFalse';
const IS_TRUE = 'plone.app.querystring.operation.boolean.isTrue';

describe('@querystring-search: a boolean criterion on any boolean index', () => {
  it('isFalse finds every item without it, the field missing included', async () => {
    const { status, body } = await query([{ i: 'seo_noindex', o: IS_FALSE }]);
    assert.equal(status, 200, JSON.stringify(body));
    assert.deepEqual(ids(body), ['offnav', 'shown', 'untouched']);
  });

  it('isTrue finds only the items with it', async () => {
    const { body } = await query([{ i: 'seo_noindex', o: IS_TRUE }]);
    assert.deepEqual(ids(body), ['hidden']);
  });

  it('exclude_from_nav still works as before', async () => {
    const { body } = await query([{ i: 'exclude_from_nav', o: IS_FALSE }]);
    assert.deepEqual(ids(body), ['hidden', 'shown', 'untouched']);
  });
});

describe('@search: a boolean index in the query string', () => {
  it('seo_noindex=false leaves the no-index page out', async () => {
    const { status, body } = await search({ seo_noindex: 'false' });
    assert.equal(status, 200, JSON.stringify(body));
    assert.deepEqual(ids(body), ['offnav', 'shown', 'untouched']);
  });

  it('seo_noindex=true finds only it', async () => {
    const { body } = await search({ seo_noindex: 'true' });
    assert.deepEqual(ids(body), ['hidden']);
  });

  it('a value that is not a boolean is refused, not ignored', async () => {
    const { status } = await search({ seo_noindex: 'maybe' });
    assert.equal(status, 400);
  });
});
