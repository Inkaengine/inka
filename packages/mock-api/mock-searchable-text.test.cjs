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

const { searchTextOptions, withSearchableText } = require('@volto-hydra/helpers/searchableText.js');

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
  // Relevance: "aaa-notes" comes first on disk and mentions zinnias once in a
  // long note; "zinnias" is about them.
  item('aaa-notes', {
    '@id': '/aaa-notes', '@type': 'Document', UID: 'searchtext-notes-0001', id: 'aaa-notes', title: 'Allotment notes',
    review_state: 'published',
    blocks: { p: { '@type': 'slate', value: slate('Weeded the beans, staked the tomatoes, watered the onions, sowed a row of zinnias by the shed, and raked the leaves twice.') } },
    blocks_layout: { items: ['p'] },
  });
  item('zinnias', {
    '@id': '/zinnias', '@type': 'Document', UID: 'searchtext-zinnias-0001', id: 'zinnias', title: 'Zinnias',
    review_state: 'published',
    blocks: { p: { '@type': 'slate', value: slate('Growing zinnias from seed.') } },
    blocks_layout: { items: ['p'] },
  });
  // What real Plone is tested with (test_search_text.py), through the editor's own function.
  const page = withSearchableText(
    { ...CASES.page, '@id': '/searched', UID: 'searchtext-case-0001', review_state: 'published' },
    searchTextOptions(CASES.schemas, { formatMessage: (m) => m?.defaultMessage || '' }, CASES.page),
  );
  item('searched', page);
  return content;
}

const CASES = JSON.parse(fs.readFileSync(path.join(__dirname, '../../tests-playwright/fixtures/search-text-cases.json'), 'utf8'));

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

/** The paths @querystring-search finds, as a search block asks. */
async function foundByQuery(token, text) {
  const res = await fetch(`${baseUrl}/@querystring-search`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({
      query: [{ i: 'SearchableText', o: 'plone.app.querystring.operation.string.contains', v: text }],
    }),
  });
  assert.equal(res.status, 200);
  return (await res.json()).items.map((i) => new URL(i['@id']).pathname).sort();
}

describe('SearchableText', () => {
  for (const [route, search] of [['@search', found], ['@querystring-search', foundByQuery]]) {
    it(`${route} finds what real Plone finds, and not what it doesn't`, async () => {
      const token = await login();
      for (const word of CASES.found) {
        assert.deepEqual(await search(token, word), ['/searched'], word);
      }
      for (const word of CASES.notFound) {
        assert.deepEqual(await search(token, word), [], word);
      }
    });
  }

  it("doesn't look where restapi doesn't: an object list's text without searchableText", async () => {
    const token = await login();
    const res = await fetch(`${baseUrl}/`, {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify({
        '@type': 'Document', id: 'unsaved-table', title: 'A table',
        blocks: { t: { '@type': 'grid', table: { rows: [{ key: 'r', cells: [{ '@type': 'slate', value: slate('Unreachedword') }] }] } } },
        blocks_layout: { items: ['t'] },
      }),
    });
    assert.equal(res.status, 201);
    assert.deepEqual(await found(token, 'Unreachedword'), []);
  });

  it('looks only under where it is asked, or under the folder path.query names', async () => {
    // The path index at its default depth: that object and everything inside it.
    const token = await login();
    const at = async (query) => {
      const res = await fetch(`${baseUrl}${query}`, { headers: headers(token) });
      assert.equal(res.status, 200);
      return (await res.json()).items.map((i) => new URL(i['@id']).pathname).sort();
    };
    assert.deepEqual(await at('/beds/@search?SearchableText=marigolds'), ['/beds']);
    assert.deepEqual(await at('/searched/@search?SearchableText=marigolds'), []);
    assert.deepEqual(await at('/@search?SearchableText=marigolds&path.query=/searched'), []);
    assert.deepEqual(await at('/beds/@search'), ['/beds']);
  });

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

/**
 * The Title index alone, as a title autocomplete asks it: by `@search?Title=`
 * or by a `Title` criterion to @querystring-search (which, unlike
 * SearchableText, plone.app.querystring passes to the catalog un-munged).
 * The index is ZCTextIndex: every word must be a whole word of the title,
 * unless it ends in `*`, which makes it a prefix. Checked against a Plone 6.2
 * site: `Comp` finds nothing, `Comp*` finds "Complaint…", `omplain` finds
 * nothing, `complaint form` finds the titles with both words. The mock's
 * @querystring-search matched a substring, `*` included, so a `Head*` asked
 * for a title containing "head*" and found none.
 */
describe('Title index', () => {
  async function byTitleSearch(token, text) {
    const res = await fetch(`${baseUrl}/@search?Title=${encodeURIComponent(text)}`, { headers: headers(token) });
    assert.equal(res.status, 200);
    return (await res.json()).items.map((i) => new URL(i['@id']).pathname).sort();
  }
  async function byTitleQuery(token, text) {
    const res = await fetch(`${baseUrl}/@querystring-search`, {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify({
        query: [{ i: 'Title', o: 'plone.app.querystring.operation.string.contains', v: text }],
      }),
    });
    assert.equal(res.status, 200);
    return (await res.json()).items.map((i) => new URL(i['@id']).pathname).sort();
  }

  for (const [route, search] of [['@search', byTitleSearch], ['@querystring-search', byTitleQuery]]) {
    it(`${route} matches whole title words, and a prefix only where * says so`, async () => {
      const token = await login();
      assert.deepEqual(await search(token, 'Garden'), ['/beds']);
      assert.deepEqual(await search(token, 'gard*'), ['/beds']);
      assert.deepEqual(await search(token, 'garden bed*'), ['/beds']);
      assert.deepEqual(await search(token, 'Gard'), [], 'a part of a word, without *');
      assert.deepEqual(await search(token, 'arden*'), [], 'not the start of a word');
      assert.deepEqual(await search(token, 'garden roses'), [], 'every word must be there');
      assert.deepEqual(await search(token, 'marigolds'), [], 'the body is not the title');
    });
  }
});

/**
 * Relevance. Plone ranks a SearchableText search by relevance when the request
 * names no sort_on: the index is ZCTextIndex's Okapi BM25, so a page that says
 * the words more often, for its length, comes first. Any sort_on replaces the
 * ranking. The mock returned matches in the order they are on disk.
 */
describe('Relevance', () => {
  const ranked = async (token, body) => {
    const res = await fetch(`${baseUrl}/@querystring-search`, { method: 'POST', headers: headers(token), body: JSON.stringify(body) });
    assert.equal(res.status, 200);
    return (await res.json()).items.map((i) => new URL(i['@id']).pathname);
  };
  const zinnias = [{ i: 'SearchableText', o: 'plone.app.querystring.operation.string.contains', v: 'zinnias' }];

  it('@querystring-search with no sort_on ranks the page about the words first', async () => {
    assert.deepEqual(await ranked(await login(), { query: zinnias }), ['/zinnias', '/aaa-notes']);
  });

  it('a sort_on replaces the ranking', async () => {
    assert.deepEqual(
      await ranked(await login(), { query: zinnias, sort_on: 'sortable_title', sort_order: 'ascending' }),
      ['/aaa-notes', '/zinnias'],
    );
  });

  it('@search with no sort_on ranks the same way', async () => {
    const res = await fetch(`${baseUrl}/@search?SearchableText=zinnias`, { headers: headers(await login()) });
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).items.map((i) => new URL(i['@id']).pathname), ['/zinnias', '/aaa-notes']);
  });
});
