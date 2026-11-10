import { buildQuerystringSearchBody } from './index.js';

// What the builder sends for a listing whose query is these criteria together
// (as a site's frontend adds its own to a listing's query).
const combineQueries = (...queries) => buildQuerystringSearchBody({ query: queries.flat() }, {}, {}).query;

// plone.app.querystring builds ONE catalog query keyed by index, so a second
// criterion on an index replaces the first: "type is any of [Document]" then
// "any of [Image]" returns exactly the Images (real Plone 6.2, 2026-11-10).
// buildQuerystringSearchBody makes the criteria from several sources (a
// listing's own query, a search block's facets, a site's exclusions) one valid
// query.
// Two date bounds on one index, and several paths, Plone merges itself
// (after 2024 + before 2026 is the same 1 item as "between" them), so they stay.

const ANY = 'plone.app.querystring.operation.selection.any';
const NONE = 'plone.app.querystring.operation.selection.none';
const AFTER = 'plone.app.querystring.operation.date.largerThan';
const BEFORE = 'plone.app.querystring.operation.date.lessThan';
const REL = 'plone.app.querystring.operation.string.relativePath';
const ABS = 'plone.app.querystring.operation.string.absolutePath';
const CONTAINS = 'plone.app.querystring.operation.string.contains';

describe('buildQuerystringSearchBody: one criterion per index', () => {
  test('criteria on different indexes are all kept, in order', () => {
    expect(
      combineQueries(
        [{ i: 'path', o: ABS, v: '/' }],
        [{ i: 'SearchableText', o: CONTAINS, v: 'dog' }],
      ),
    ).toEqual([
      { i: 'path', o: ABS, v: '/' },
      { i: 'SearchableText', o: CONTAINS, v: 'dog' },
    ]);
  });

  test('"none of" and "none of" on an index leave out every value', () => {
    expect(
      combineQueries([{ i: 'portal_type', o: NONE, v: ['Image', 'File'] }], [{ i: 'portal_type', o: NONE, v: ['File', 'Template'] }]),
    ).toEqual([{ i: 'portal_type', o: NONE, v: ['Image', 'File', 'Template'] }]);
  });

  test('"any of" and "any of" on an index keep the values both allow', () => {
    expect(
      combineQueries(
        [{ i: 'portal_type', o: ANY, v: ['Document', 'News Item', 'File'] }],
        [{ i: 'portal_type', o: ANY, v: ['News Item', 'Image'] }],
      ),
    ).toEqual([{ i: 'portal_type', o: ANY, v: ['News Item'] }]);
  });

  test('"any of" less "none of" on an index, whichever comes first', () => {
    const expected = [{ i: 'portal_type', o: ANY, v: ['Document', 'File'] }];
    expect(
      combineQueries([{ i: 'portal_type', o: ANY, v: ['Document', 'Template', 'File'] }], [{ i: 'portal_type', o: NONE, v: ['Template'] }]),
    ).toEqual(expected);
    expect(
      combineQueries([{ i: 'portal_type', o: NONE, v: ['Template'] }], [{ i: 'portal_type', o: ANY, v: ['Document', 'Template', 'File'] }]),
    ).toEqual(expected);
  });

  test('"any of" with nothing left matches nothing, and says so rather than matching everything', () => {
    // An empty "any of" is no constraint to the catalog: the opposite of what
    // two disjoint restrictions mean.
    expect(() =>
      combineQueries([{ i: 'portal_type', o: ANY, v: ['Document'] }], [{ i: 'portal_type', o: ANY, v: ['Image'] }]),
    ).toThrow(/portal_type/);
  });

  test('a "from" and a "to" on one date index stay: Plone makes them a range', () => {
    const q = [
      { i: 'effective', o: AFTER, v: '2024-01-01' },
      { i: 'effective', o: BEFORE, v: '2026-01-01' },
    ];
    expect(combineQueries(q.slice(0, 1), q.slice(1))).toEqual(q);
  });

  test('several paths stay: Plone searches them all', () => {
    const q = [
      { i: 'path', o: ABS, v: '/news' },
      { i: 'path', o: REL, v: '.::1' },
    ];
    expect(combineQueries(q.slice(0, 1), q.slice(1))).toEqual(q);
  });

  test('the same criterion twice is one', () => {
    const c = { i: 'review_state', o: ANY, v: ['published'] };
    expect(combineQueries([c], [{ ...c }])).toEqual([c]);
  });

  test('any other second criterion on an index fails, naming it, instead of one silently replacing the other', () => {
    expect(() =>
      combineQueries([{ i: 'Title', o: CONTAINS, v: 'a' }], [{ i: 'Title', o: CONTAINS, v: 'b' }]),
    ).toThrow(/Title/);
  });

  test('never changes the queries it was given', () => {
    const a = [{ i: 'portal_type', o: NONE, v: ['Image'] }];
    const b = [{ i: 'portal_type', o: NONE, v: ['File'] }];
    combineQueries(a, b);
    expect(a).toEqual([{ i: 'portal_type', o: NONE, v: ['Image'] }]);
    expect(b).toEqual([{ i: 'portal_type', o: NONE, v: ['File'] }]);
  });
});

describe('buildQuerystringSearchBody combines a facet with the listing\'s own criterion', () => {
  test('a type facet within a listing restricted to types keeps both restrictions', () => {
    // Pushed as a second portal_type criterion, the facet replaced the listing's
    // own: picking "News Item" on a search limited to Document and News Item
    // was fine, but a listing that excluded Image saw Images again.
    const body = buildQuerystringSearchBody(
      { query: [{ i: 'portal_type', o: NONE, v: ['Image'] }] },
      {},
      { 'facet.portal_type': ['Document', 'Image'] },
    );
    expect(body.query.filter((c) => c.i === 'portal_type')).toEqual([
      { i: 'portal_type', o: ANY, v: ['Document'] },
    ]);
  });
});
