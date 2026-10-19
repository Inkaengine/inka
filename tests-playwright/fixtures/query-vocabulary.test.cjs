/**
 * The fixture projects into every CMS's query vocabulary — all of it, once.
 *
 * A listing block stores what the adapter advertised, so the shared fixture
 * carries tokens and each seeder substitutes. Three places did that, and two
 * of them substituted the index NAME only: the operator and the sort key
 * stayed Plone's on every other CMS, their readers refused a query in names
 * they never advertised, and the public listing rendered nothing — diagnosed
 * from a screenshot of a blank strip, a day later.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const REPO = path.resolve(__dirname, '../..');
const {
  VOCABULARIES,
  projectQueryVocabulary,
} = require('../../tests-adapters/fixtures/query-vocabulary.cjs');
const seed = require('../../tests-adapters/fixtures/seed.json');

describe('the fixture, in each CMS vocabulary', () => {
  for (const [cms, vocabulary] of Object.entries(VOCABULARIES)) {
    it(`${cms}: every token is substituted`, () => {
      const projected = projectQueryVocabulary(seed.documents, vocabulary);
      assert.equal(
        JSON.stringify(projected).match(/__[A-Z_]+__/g),
        null,
        'no token survives',
      );
      const listing = projected
        .flatMap((doc) => Object.values(doc.blocks ?? {}))
        .find((block) => block['@type'] === 'listing');
      assert.ok(listing, 'the fixture still has a listing to project');
      const [criterion] = listing.querystring.query;
      assert.equal(criterion.i, vocabulary.pathIndex);
      assert.equal(criterion.o, vocabulary.pathOperator);
      assert.equal(listing.querystring.sort_on, vocabulary.sortOn);
    });
  }

  it('refuses a vocabulary with a part missing', () => {
    assert.throws(
      () =>
        projectQueryVocabulary(seed.documents, {
          pathIndex: 'parent',
          pathOperator: '',
          sortOn: '',
        }),
      /has no pathOperator, sortOn/,
    );
  });

  it('is the ONLY place a token is substituted', () => {
    // A fourth copy is how this broke: each one has to be found and updated
    // by hand when the fixture grows a part, and the ones that are not simply
    // leave another CMS's name in the query.
    const hits = execFileSync(
      'git',
      ['grep', '-l', '-e', '__PATH_INDEX__', '-e', '__PATH_OP__', '-e', '__SORT_ON__'],
      { cwd: REPO, encoding: 'utf8' },
    )
      .split('\n')
      .filter(Boolean)
      // The fixture DECLARES the tokens; this test names them; the shared
      // module is the one that substitutes them.
      .filter(
        (file) =>
          ![
            'tests-adapters/fixtures/seed.json',
            'tests-adapters/fixtures/query-vocabulary.cjs',
            'tests-playwright/fixtures/query-vocabulary.test.cjs',
          ].includes(file),
      );
    assert.deepEqual(hits, [], `these substitute tokens of their own: ${hits}`);
  });
});
