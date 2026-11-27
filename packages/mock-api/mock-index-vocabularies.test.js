/**
 * A site's index vocabularies, as collective.indexvocabularies makes them.
 *
 * Plone gives a visitor no values for a keyword index's query field: `Subject`
 * names `plone.app.vocabularies.Keywords`, which plone.restapi closes to
 * anonymous, so @querystring inlines nothing and a Tags filter has no options.
 * A site that filters on an index lists it in collective.indexvocabularies
 * (its `indexvocabularies.indexes` record). For each one that add-on registers
 * a vocabulary `collective.indexvocabularies.<index>` over the index's
 * `uniqueValues()`, which has no permission of its own (so a visitor may read
 * it), and points the index's query field at it, creating the field when the
 * site has none. @querystring then inlines the values for anyone.
 *
 * MOCK_INDEX_VOCABULARIES names those indexes here.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

function distribution() {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-index-vocabularies-'));
  for (const name of ['discussions.json', 'portlets.json', 'principals.json', 'redirects.json']) {
    fs.writeFileSync(path.join(dist, name), '{}');
  }
  const content = path.join(dist, 'content');
  const item = (dir, data) => {
    fs.mkdirSync(path.join(content, dir), { recursive: true });
    fs.writeFileSync(path.join(content, dir, 'data.json'), JSON.stringify(data));
  };
  item('plone_site_root', { '@id': '/Plone', '@type': 'Plone Site', UID: 'ivoc-root-0000001', id: 'Plone', title: 'Site' });
  item('roads', {
    '@id': '/roads', '@type': 'Document', UID: 'ivoc-roads-000001', id: 'roads', title: 'Roads',
    review_state: 'published', subjects: ['transport', 'roads'], ReportType: ['Annual report'],
  });
  item('rail', {
    '@id': '/rail', '@type': 'Document', UID: 'ivoc-rail-0000001', id: 'rail', title: 'Rail',
    review_state: 'published', subjects: ['transport'], ReportType: ['Inquiry'],
  });
  // uniqueValues() reads the index, which holds private content's values too.
  item('draft', {
    '@id': '/draft', '@type': 'Document', UID: 'ivoc-draft-000001', id: 'draft', title: 'Draft',
    review_state: 'private', subjects: ['budget'],
  });
  return content;
}

// Read when the mock loads; node --test runs each file in its own process.
process.env.CONTENT_MOUNTS = `/:${distribution()}`;
process.env.MOCK_INDEX_VOCABULARIES = 'Subject,ReportType';
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
after(() => server.close());

/** As a visitor: no token. */
const get = async (p) => {
  const res = await fetch(`${baseUrl}${p}`, { headers: { Accept: 'application/json' } });
  return { status: res.status, body: await res.json() };
};

describe('a site index vocabulary (collective.indexvocabularies)', () => {
  it('points the index\'s query field at it, with its values inline for a visitor', async () => {
    const { status, body } = await get('/@querystring');
    assert.equal(status, 200);
    const subject = body.indexes.Subject;
    assert.equal(subject.vocabulary, 'collective.indexvocabularies.Subject');
    assert.equal(subject.fetch_vocabulary, true);
    assert.deepEqual(subject.values, {
      budget: { title: 'budget' },
      roads: { title: 'roads' },
      transport: { title: 'transport' },
    });
    // The rest of the field is Plone's.
    assert.equal(subject.title, 'Tag');
  });

  it('creates the query field for an index Plone has none for, as the add-on does', async () => {
    const { body } = await get('/@querystring');
    const field = body.indexes.ReportType;
    assert.equal(field.vocabulary, 'collective.indexvocabularies.ReportType');
    assert.equal(field.title, 'ReportType');
    assert.equal(field.group, 'Metadata');
    assert.equal(field.sortable, false);
    assert.deepEqual(field.operations, [
      'plone.app.querystring.operation.selection.any',
      'plone.app.querystring.operation.selection.all',
      'plone.app.querystring.operation.selection.none',
    ]);
    assert.deepEqual(field.values, {
      'Annual report': { title: 'Annual report' },
      Inquiry: { title: 'Inquiry' },
    });
  });

  it('serves the vocabulary to a visitor, filtered by title', async () => {
    const all = await get('/@vocabularies/collective.indexvocabularies.Subject');
    assert.equal(all.status, 200);
    assert.deepEqual(all.body.items, [
      { token: 'budget', title: 'budget' },
      { token: 'roads', title: 'roads' },
      { token: 'transport', title: 'transport' },
    ]);
    const some = await get('/@vocabularies/collective.indexvocabularies.Subject?title=r');
    assert.deepEqual(some.body.items.map((i) => i.token), ['roads', 'transport']);
  });

  it('filters a search on a created field, like any keyword index', async () => {
    const res = await fetch(`${baseUrl}/@querystring-search`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: [{ i: 'ReportType', o: 'plone.app.querystring.operation.selection.any', v: ['Inquiry'] }],
      }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).items.map((i) => i.title), ['Rail']);
  });

  it('leaves Keywords closed to a visitor, as Plone does', async () => {
    const { status } = await get('/@vocabularies/plone.app.vocabularies.Keywords');
    assert.equal(status, 401);
  });
});
