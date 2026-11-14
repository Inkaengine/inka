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
const { app } = require('@inka/mock-api/server');
const {
  collectFieldMappingIssues,
  loadMappingVocabularies,
} = require('./discover-blocks.cjs');

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
      sourceFields: { getURL: { title: 'URL', type: 'string' }, title: { title: 'Title', type: 'string' } },
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
    assert.deepEqual(issuesFor({ getURL: { field: 'href' }, EffectiveDate: { field: 'date' } }), []);
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

// The address is mapped from `getURL`. A stored mapping keyed `@id`, in either
// form, is content that wasn't migrated.
describe("a stored mapping keyed '@id', the address's old name", () => {
  const allIssues = (fieldMapping) => {
    const issues = [];
    collectFieldMappingIssues({ variation: 'link', fieldMapping }, listingSchema, blocksConfig, issues);
    return issues;
  };
  before(() => loadMappingVocabularies(baseUrl, blocksConfig));

  for (const entry of ['href', { field: 'href', type: 'link' }]) {
    it(`is refused as ${JSON.stringify(entry)}`, () => {
      const issues = allIssues({ '@id': entry });
      assert.equal(issues.length, 1);
      assert.match(issues[0], /migrate/);
      assert.match(issues[0], /getURL/);
    });
  }
});

// Each result becomes an item carrying the listing's `@uid`, its `@type` and
// `readOnly`; a stored mapping onto any of them (or `@id`) overwrites what
// makes it that item.
describe("a stored mapping onto an item's id or type", () => {
  const allIssues = (fieldMapping) => {
    const issues = [];
    collectFieldMappingIssues({ variation: 'link', fieldMapping }, listingSchema, blocksConfig, issues);
    return issues;
  };
  before(() => loadMappingVocabularies(baseUrl, blocksConfig));

  for (const target of ['@uid', '@type', '@id', 'readOnly']) {
    it(`"${target}" is refused`, () => {
      const issues = allIssues({ title: target });
      assert.equal(issues.filter((i) => i.includes('id or type')).length, 1, issues.join('\n'));
    });
  }
});

// What each result's value becomes in the item, by the rule the widget offers by.
describe('a stored mapping that would put the wrong shape in a field', () => {
  const schema = {
    properties: {
      variation: { title: 'Item type', filterConvertibleFrom: '@default' },
      fieldMapping: {
        widget: 'field_mapping',
        sourceFields: {
          getURL: { title: 'URL', type: 'string' },
          title: { title: 'Title', type: 'string' },
          Subject: { title: 'Categories', type: 'array' },
          created: { title: 'Created', type: 'date' },
        },
      },
    },
  };
  const config = {
    listing: { blockSchema: schema },
    card: {
      blockSchema: {
        properties: {
          title: { type: 'string' },
          url: { widget: 'object_browser', mode: 'link' },
          tags: { type: 'array' },
          body: { type: 'array', widget: 'slate' },
        },
      },
    },
  };
  const issuesFor = (fieldMapping) => {
    const issues = [];
    collectFieldMappingIssues({ variation: 'card', fieldMapping }, schema, config, issues);
    return issues;
  };

  it('passes conversions that fit', () => {
    assert.deepEqual(
      issuesFor({
        getURL: { field: 'url', type: 'link' },
        title: { field: 'title', type: 'string' },
        Subject: { field: 'tags', type: 'array' },
        created: { field: 'title', type: 'string' },
      }),
      [],
    );
  });

  for (const [label, fieldMapping] of [
    ['the address, unconverted, into a link field', { getURL: 'url' }],
    ['a list into a text field, unconverted', { Subject: 'title' }],
    ['a date into a link field', { created: { field: 'url', type: 'link' } }],
    ['text into slate, unconverted', { title: 'body' }],
    ['text into text, with no conversion stored', { title: 'title' }],
    ['a field with no conversion stored', { title: { field: 'title' } }],
    ['a conversion Inka has no name for', { title: { field: 'title', type: 'links' } }],
  ]) {
    it(`refuses ${label}`, () => {
      const issues = issuesFor(fieldMapping);
      assert.equal(issues.length, 1, issues.join('\n'));
      assert.match(issues[0], /can't/);
    });
  }

  it("refuses a target the item type doesn't declare, href included", () => {
    const issues = issuesFor({ getURL: { field: 'href', type: 'link' } });
    assert.equal(issues.length, 1);
    assert.match(issues[0], /no such field/);
  });
});

