/**
 * The query vocabulary the mock serves is the one a real Plone serves.
 *
 * It was written out by hand here and drifted: 11 of plone.app.querystring's
 * 22 indexes, `string.is` offered on Creator — an operation Plone has never
 * registered — Title claimed sortable when Plone says it is not, and none of
 * the relative-date operations on created/modified/effective. The admin builds
 * its query builder, its rearrange menu and its contents columns from this, so
 * the missing half was untestable and the invented operation was one an adapter
 * could be written against, pass its contract, and fail on the CMS.
 *
 * So the structure is captured from a real Plone (scripts/capture-querystring.mjs)
 * and these pin what a reader cannot check offline: that the route still answers
 * what was captured, that nothing has been added by hand since, and that the
 * specific wrong answers cannot come back.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

const fixture = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, 'api', 'querystring.json'), 'utf-8'),
);

process.env.SKIP_CONTENT_VALIDATION = 'true';
const { app, ready } = await import('./mock-plone-api.js');

let server, baseUrl, served;
before(async () => {
  await ready;
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://localhost:${server.address().port}`;
      resolve();
    });
  });
  served = await (await fetch(`${baseUrl}/@querystring`)).json();
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

describe('the captured vocabulary', () => {
  it('says where it came from, so it can be captured again', () => {
    assert.match(fixture._source, /real Plone/);
    assert.match(fixture._regenerate, /capture-querystring\.mjs/);
    assert.ok(fixture._captured_at);
  });

  it('carries no site of its own: the values belong to whoever answers', () => {
    const perSite = [];
    for (const [root, obj] of [['indexes', fixture.indexes], ['sortable_indexes', fixture.sortable_indexes]]) {
      (function walk(node, trail) {
        if (!node || typeof node !== 'object') return;
        for (const [key, value] of Object.entries(node)) {
          if (['values', 'vocabulary', 'fetch_vocabulary'].includes(key)) perSite.push(`${trail}.${key}`);
          walk(value, `${trail}.${key}`);
        }
      })(obj, root);
    }
    assert.deepEqual(perSite, [], 'a captured site\'s own vocabulary leaked into the fixture');
  });

  /**
   * plone.app.querystring's profile declares exactly these. Written out because
   * a test cannot read Plone's source: regenerate with the capture script and
   * update this list in the same commit, which is the point at which someone
   * has to look at what changed.
   */
  it('is all 22 of Plone\'s indexes', () => {
    assert.deepEqual(Object.keys(fixture.indexes).sort(), [
      'Creator', 'Description', 'SearchableText', 'Subject', 'Title',
      'created', 'effective', 'effectiveRange', 'end', 'expires', 'getId',
      'getObjPositionInParent', 'getRawRelatedItems', 'isDefaultPage',
      'isFolderish', 'modified', 'path', 'portal_type', 'review_state',
      'show_inactive', 'sortable_title', 'start',
    ]);
  });
});

describe('what the route answers', () => {
  it('serves every captured index, and adds none of its own', () => {
    assert.deepEqual(
      Object.keys(served.indexes).sort(),
      Object.keys(fixture.indexes).sort(),
      'the route and the capture disagree about which indexes exist',
    );
    assert.deepEqual(
      Object.keys(served.sortable_indexes).sort(),
      Object.keys(fixture.sortable_indexes).sort(),
    );
  });

  it('offers exactly the captured operations on each index', () => {
    for (const [name, index] of Object.entries(fixture.indexes)) {
      assert.deepEqual(
        (served.indexes[name].operations ?? []).slice().sort(),
        (index.operations ?? []).slice().sort(),
        `${name} offers operations Plone did not`,
      );
      assert.equal(served.indexes[name].sortable, index.sortable, `${name}: sortable`);
    }
  });

  /**
   * The one deviation, and it is deliberate: `string.search` comes from a
   * plone.app.querystring fork some production sites run, so the mock can be
   * one of them. It must ADD to the captured answer — a site without the fork
   * offers `contains` alone — and must not quietly change anything else.
   */
  it('adds the fork\'s string.search, and only that, when asked to be that site', async () => {
    process.env.MOCK_QUERYSTRING_SEARCH = '1';
    try {
      const forked = await (await fetch(`${baseUrl}/@querystring`)).json();
      assert.deepEqual((forked.indexes.SearchableText.operations ?? []).slice().sort(), [
        'plone.app.querystring.operation.string.contains',
        'plone.app.querystring.operation.string.search',
      ]);
      assert.deepEqual(
        Object.keys(forked.indexes.SearchableText.operators ?? {}).sort(),
        (forked.indexes.SearchableText.operations ?? []).slice().sort(),
        'an advertised operation with no operator cannot be rendered',
      );
      for (const name of Object.keys(fixture.indexes)) {
        if (name === 'SearchableText') continue;
        assert.deepEqual(
          (forked.indexes[name].operations ?? []).slice().sort(),
          (served.indexes[name].operations ?? []).slice().sort(),
          `${name} changed when only SearchableText should have`,
        );
      }
    } finally {
      delete process.env.MOCK_QUERYSTRING_SEARCH;
    }
  });

  it('fills in its OWN vocabulary, not the captured site\'s', () => {
    assert.deepEqual(
      Object.keys(served.indexes.portal_type.values).sort(),
      ['Document', 'Event', 'File', 'Image', 'Link', 'News Item'],
    );
    // simple_publication_workflow's three states, which is what this mock runs.
    assert.deepEqual(
      Object.keys(served.indexes.review_state.values).sort(),
      ['pending', 'private', 'published'],
    );
  });

  /** The three specific wrong answers this file exists because of. */
  it('does not offer string.is on Creator, which Plone has never had', () => {
    assert.ok(
      !served.indexes.Creator.operations.includes('plone.app.querystring.operation.string.is'),
    );
  });

  it('does not claim Title is sortable', () => {
    assert.equal(served.indexes.Title.sortable, false);
  });

  it('offers the relative-date operations a real Plone does', () => {
    for (const field of ['created', 'modified', 'effective']) {
      const ops = served.indexes[field].operations.join(' ');
      for (const relative of ['date.afterToday', 'date.beforeToday', 'date.today']) {
        assert.ok(ops.includes(relative), `${field} is missing ${relative}`);
      }
    }
  });
});
