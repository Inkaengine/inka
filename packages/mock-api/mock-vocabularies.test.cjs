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

/**
 * Signed in, because some of these are closed to anonymous (see the auth
 * matrix at the bottom). These cases are about the SHAPE of a term, so they
 * authenticate and keep asserting that.
 */
const login = async () => {
  const res = await fetch(`${baseUrl}/@login`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'admin', password: 'admin' }),
  });
  assert.equal(res.status, 200);
  return (await res.json()).token;
};

const vocabulary = async (name, query = '') => {
  const token = await login();
  const res = await fetch(`${baseUrl}/@vocabularies/${name}${query}`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
  });
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

/**
 * Who may read a vocabulary. Not a mock invention: checked against a live
 * Plone 6.2, anonymously —
 *
 *   plone.app.vocabularies.Keywords                 401
 *   plone.app.vocabularies.Users                    401
 *   plone.app.vocabularies.ReallyUserFriendlyTypes  200
 *   plone.app.vocabularies.MetadataFields           200
 *
 * The mock served all of them to anyone, which is how a facet UI reading the
 * keyword vocabulary passed in CI and rendered an empty topic strip in
 * production (#725). Both halves are asserted, because over-restricting would
 * be just as wrong as under-restricting: a consumer reading the types
 * vocabulary anonymously is doing nothing a real site forbids.
 */
describe('@vocabularies and anonymous access', () => {
  const anonymous = (name) =>
    fetch(`${baseUrl}/@vocabularies/${name}`, { headers: { Accept: 'application/json' } });

  it("refuses the keyword vocabulary to anonymous, in Plone's own words", async () => {
    const res = await anonymous('plone.app.vocabularies.Keywords');
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.deepEqual(body, {
      error: {
        type: 'Not authenticated',
        message:
          "You need to be authenticated to access the vocabulary 'plone.app.vocabularies.Keywords'.",
      },
    });
  });

  it('refuses the users vocabulary to anonymous', async () => {
    assert.equal((await anonymous('plone.app.vocabularies.Users')).status, 401);
  });

  it('answers the keyword vocabulary to a signed-in user', async () => {
    const token = await login();
    const res = await fetch(`${baseUrl}/@vocabularies/plone.app.vocabularies.Keywords`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
    assert.ok((await res.json()).items.length > 0);
  });

  it('does NOT restrict the vocabularies a real site serves to anyone', async () => {
    assert.equal((await anonymous('plone.app.vocabularies.ReallyUserFriendlyTypes')).status, 200);
    assert.equal((await anonymous('plone.app.vocabularies.MetadataFields')).status, 200);
  });
});

/**
 * The other half of the same production behaviour: @querystring does not inline
 * a keyword index's terms, it names the (closed) vocabulary. A facet UI must
 * therefore get its options elsewhere — from the result set — and this is the
 * response shape that forces it to.
 */
describe('@querystring index values', () => {
  const querystring = async () => {
    const res = await fetch(`${baseUrl}/@querystring`, { headers: { Accept: 'application/json' } });
    assert.equal(res.status, 200);
    return (await res.json()).indexes;
  };

  it('does not inline the keyword index terms', async () => {
    const Subject = (await querystring()).Subject;
    assert.equal(Subject.fetch_vocabulary, true);
    assert.deepEqual(Subject.values, {});
    assert.equal(Subject.vocabulary, 'plone.app.vocabularies.Keywords');
  });

  it('inlines portal_type AND flags its vocabulary, as live Plone does', async () => {
    const portal_type = (await querystring()).portal_type;
    // Both. `fetch_vocabulary` alone is not a reason to go fetching: a consumer
    // has to check whether `values` is empty, or it will discard nine real
    // terms (and their titles: "Page" for Document) to chase a vocabulary.
    assert.equal(portal_type.fetch_vocabulary, true);
    assert.ok(Object.keys(portal_type.values).length > 0);
    assert.equal(portal_type.values.Document.title, 'Page');
  });
});
