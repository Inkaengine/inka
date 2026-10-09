/**
 * The mock's @vocabularies, as plone.restapi serves them: each term is a
 * `token` (the stored value) and a `title` (what a person reads), and they
 * differ. The content types vocabulary is the plain case — the type
 * "Document" is titled "Page" — so a frontend that shows a type's name must
 * read the title. A mock that echoed the token as the title let one show
 * "Document" and pass.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const mount = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-vocabularies-'));
process.env.CONTENT_MOUNTS = `/:${mount}`;
process.env.SKIP_CONTENT_VALIDATION = 'true';
const { app } = require('./mock-api-server.cjs');

let server;
let baseUrl;
before(
  () =>
    new Promise((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://localhost:${server.address().port}`;
        resolve();
      });
    }),
);
after(() => server.close());

const vocabulary = async (name, query = '') => {
  const res = await fetch(`${baseUrl}/@vocabularies/${name}${query}`);
  assert.equal(res.status, 200);
  return (await res.json()).items;
};

describe('@vocabularies', () => {
  it('names content types by their titles, not their ids', async () => {
    const items = await vocabulary('plone.app.vocabularies.ReallyUserFriendlyTypes');
    assert.deepEqual(
      items.find((i) => i.token === 'Document'),
      { token: 'Document', title: 'Page' },
    );
    assert.deepEqual(
      items.find((i) => i.token === 'News Item'),
      { token: 'News Item', title: 'News Item' },
    );
  });

  it('filters by title, as a type-ahead asks', async () => {
    const items = await vocabulary('plone.app.vocabularies.ReallyUserFriendlyTypes', '?title=pag');
    assert.deepEqual(items.map((i) => i.token), ['Document']);
  });

  it('a vocabulary whose terms are their own titles still answers token = title', async () => {
    const items = await vocabulary('plone.app.vocabularies.Keywords', '?title=news');
    assert.deepEqual(items, [
      { token: 'news', title: 'news' },
      { token: 'newsletter', title: 'newsletter' },
      { token: 'newsroom', title: 'newsroom' },
    ]);
  });

  it('lists the catalog metadata columns, as MetadataFields does', async () => {
    const items = await vocabulary('plone.app.vocabularies.MetadataFields');
    assert.deepEqual(items.find((i) => i.token === 'EffectiveDate'), {
      token: 'EffectiveDate',
      title: 'Effective date',
    });
    assert.ok(items.some((i) => i.token === 'review_state'));
  });
});

