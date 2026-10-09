/**
 * Block sanity's field-mapping check offers what the sidebar offers. A
 * mapping field that names a vocabulary (plone.app.vocabularies.MetadataFields)
 * offers that vocabulary's columns beside its declared sources, so a mapping
 * from a site's own catalog column is valid — and a column the site does not
 * have still is not.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const mount = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-field-mapping-'));
process.env.CONTENT_MOUNTS = `/:${mount}`;
process.env.SKIP_CONTENT_VALIDATION = 'true';
const { app } = require('./mock-api-server.cjs');
const {
  collectFieldMappingIssues,
  loadMappingVocabularies,
} = require('../helpers/discover-blocks.cjs');

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

const listingSchema = {
  properties: {
    variation: { title: 'Item type', filterConvertibleFrom: '@default' },
    fieldMapping: {
      widget: 'field_mapping',
      sourceFields: { '@id': { title: 'URL', type: 'string' }, title: { title: 'Title', type: 'string' } },
      vocabulary: { '@id': 'plone.app.vocabularies.MetadataFields' },
    },
  },
};
const blocksConfig = {
  listing: { blockSchema: listingSchema },
  link: { blockSchema: { properties: { href: {}, title: {}, date: { type: 'string' } } } },
};

const issuesFor = (fieldMapping) => {
  const issues = [];
  collectFieldMappingIssues({ variation: 'link', fieldMapping }, listingSchema, blocksConfig, issues);
  return issues.filter((i) => i.includes('not a source the sidebar offers'));
};

describe('field mapping sources from a vocabulary', () => {
  before(() => loadMappingVocabularies(baseUrl, blocksConfig));

  it("a site's own catalog column is a source the sidebar offers", () => {
    assert.deepEqual(issuesFor({ '@id': { field: 'href' }, EffectiveDate: { field: 'date' } }), []);
  });

  it('a column repeating a declared source in another case is not offered', () => {
    // The sidebar lists `title` once, not the catalog's Title beside it.
    const issues = issuesFor({ Title: { field: 'title' } });
    assert.equal(issues.length, 1);
    assert.match(issues[0], /"Title"/);
  });

  it('a column the site does not have is still not', () => {
    const issues = issuesFor({ NotAColumn: { field: 'date' } });
    assert.equal(issues.length, 1);
    assert.match(issues[0], /"NotAColumn"/);
  });
});
