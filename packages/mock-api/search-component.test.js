/**
 * The search component (collective.restapi.searchexpansion): `?expand=search` with
 * `expand.search.<index>` options runs a catalog search and answers it inside the page
 * read, at `@components.search`. A frontend brings the templates it forces this way
 * (templateSearchParams): one search for their paths, full objects.
 *
 * The mock answers that shape only, a depth-0 search for one or more paths, and refuses
 * any other option rather than ignoring it.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { app } from './mock-api-server.js';
import { loadTemplates, templateSearchParams } from '../helpers/index.js';

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
  if (server) await new Promise((resolve) => server.close(resolve));
});

const PAGE = '/_test_data/template-test-page';
const FOOTER = '/_test_data/templates/footer-layout';
const ASIDE = '/_test_data/templates/aside-layout';

async function read(path, entries) {
  const qs = new URLSearchParams([['expand', 'breadcrumbs,search'], ...entries]);
  const res = await fetch(`${baseUrl}${path}?${qs}`, { headers: { Accept: 'application/json' } });
  return { status: res.status, body: await res.json() };
}

describe('search component', () => {
  it('answers each path asked for, as a full object', async () => {
    const { status, body } = await read(PAGE, templateSearchParams([FOOTER, ASIDE]));
    assert.equal(status, 200, JSON.stringify(body));
    const search = body['@components'].search;
    assert.equal(search.items_total, 2);
    const byPath = Object.fromEntries(search.items.map((i) => [new URL(i['@id']).pathname, i]));
    assert.deepEqual(Object.keys(byPath).sort(), [ASIDE, FOOTER]);
    assert.equal(byPath[FOOTER].UID, 'footer-layout-uid');
    assert.ok(byPath[FOOTER].blocks && byPath[FOOTER].blocks_layout, 'a full object has its blocks');
    assert.ok(body['@components'].breadcrumbs.items, 'beside the other expansions');
  });

  it('is what loadTemplates takes the templates from, fetching none', async () => {
    const { body } = await read(PAGE, templateSearchParams([FOOTER]));
    const fetched = [];
    const { templates, errors } = await loadTemplates(
      { ...body, blocks: {}, blocks_layout: { items: [] } },
      async (id) => {
        fetched.push(id);
        throw new Error(`fetched ${id}`);
      },
      {},
      [FOOTER],
    );
    assert.deepEqual(fetched, []);
    assert.deepEqual(errors, []);
    assert.equal(templates[FOOTER].UID, 'footer-layout-uid');
  });

  it('leaves out a path the site lacks', async () => {
    const { body } = await read(PAGE, templateSearchParams([FOOTER, '/_test_data/templates/no-such']));
    assert.deepEqual(
      body['@components'].search.items.map((i) => new URL(i['@id']).pathname),
      [FOOTER],
    );
  });

  it('refuses a search option it does not answer', async () => {
    const { status, body } = await read(PAGE, [['expand.search.SearchableText', 'footer']]);
    assert.equal(status, 400, JSON.stringify(body));
    assert.match(body.message, /expand\.search\.SearchableText/);
  });
});
