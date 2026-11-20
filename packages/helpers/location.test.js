/**
 * A listing's location (the path criterion's value) says where to look and,
 * with its last character, whether the folder there is a result:
 *
 *   /news/     /news and everything under it
 *   /news/*    everything under /news, not /news
 *   ./  ./*    this page (and under it) / only what is under it
 *   ../ ../*   my parent (and under it) / only what is under it
 *   /*\/        Relative only: my level-1 section, and everything under it
 *   /*\/*\/     my level-2 section …; /*\/* my level-1 section's contents
 *
 * with Plone's `::depth` after it. A value with neither ending (`.`, `..`,
 * `/news`, `.::1`) means what it means to Plone.
 *
 * Plone can't say all of that in one search -- its folder is a result except
 * at depth 1 -- so Inka sends the search(es) that give it, asked from the site
 * root with the location resolved for the page: asked from a page, Plone also
 * leaves that page out. A Volto location is sent as it always was.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

import { ploneFetchItems, resolveLocation } from './index.js';

const RELATIVE = 'plone.app.querystring.operation.string.relativePath';
const ABSOLUTE = 'plone.app.querystring.operation.string.absolutePath';
const NONE = 'plone.app.querystring.operation.selection.none';
const TYPE = { i: 'portal_type', o: 'plone.app.querystring.operation.selection.any', v: ['Document'] };
const PAGE = '/news/2024/bridge';

describe('resolveLocation', () => {
  test.each([
    ['/*/', PAGE, { path: '/news', depth: null, top: 'include' }],
    ['/*/*', PAGE, { path: '/news', depth: null, top: 'exclude' }],
    ['/*/*/', PAGE, { path: '/news/2024', depth: null, top: 'include' }],
    ['/*/*::1', PAGE, { path: '/news', depth: 1, top: 'exclude' }],
    ['/*', PAGE, { path: '/', depth: null, top: 'exclude' }],
    ['./', PAGE, { path: PAGE, depth: null, top: 'include' }],
    ['./*::1', PAGE, { path: PAGE, depth: 1, top: 'exclude' }],
    ['../', PAGE, { path: '/news/2024', depth: null, top: 'include' }],
    ['../*', PAGE, { path: '/news/2024', depth: null, top: 'exclude' }],
    ['../../2023/', PAGE, { path: '/news/2023', depth: null, top: 'include' }],
    ['..', PAGE, { path: '/news/2024', depth: null, top: null }],
    ['.::1', PAGE, { path: PAGE, depth: 1, top: null }],
  ])('relative %s from %s', (value, page, expected) => {
    expect(resolveLocation(value, page, { relative: true })).toEqual(expected);
  });

  test('a page above a breadcrumb level resolves to itself', () => {
    expect(resolveLocation('/*/*/', '/news', { relative: true }).path).toBe('/news');
    expect(resolveLocation('/*/', '/', { relative: true }).path).toBe('/');
  });

  test('.. stops at the site root, as Plone stops at the navigation root', () => {
    expect(resolveLocation('../../../', '/news', { relative: true }).path).toBe('/');
  });

  test.each([
    ['/news/', { path: '/news', depth: null, top: 'include' }],
    ['/news/*', { path: '/news', depth: null, top: 'exclude' }],
    ['/news/*::2', { path: '/news', depth: 2, top: 'exclude' }],
    ['/news', { path: '/news', depth: null, top: null }],
  ])('absolute %s', (value, expected) => {
    expect(resolveLocation(value, PAGE, { relative: false })).toEqual(expected);
  });

  test('anything else is refused, not guessed', () => {
    expect(() => resolveLocation('/news/*/', PAGE, { relative: true })).toThrow(/only \* steps/);
    expect(() => resolveLocation('/*/x', PAGE, { relative: false })).toThrow(/\*/);
    expect(() => resolveLocation('/news/*::0', PAGE, { relative: false })).toThrow(/depth 0/);
  });
});

describe('ploneFetchItems sends the search(es) that give the location', () => {
  let calls;
  // A Plone answering by the path criterion it is sent: the folder /news
  // (UID news-uid) and two pages under it, in that order.
  const answer = (query) => {
    const path = query.find((c) => c.i === 'path').v;
    const not = query.find((c) => c.i === 'UID')?.v ?? [];
    const all = [
      { '@id': 'http://api/news', UID: 'news-uid' },
      { '@id': 'http://api/news/a', UID: 'a' },
      { '@id': 'http://api/news/b', UID: 'b' },
    ];
    const items = path.endsWith('::0') ? all.slice(0, 1) : path.endsWith('::1') ? all.slice(1) : all;
    return items.filter((i) => !not.includes(i.UID));
  };
  beforeEach(() => {
    calls = [];
    globalThis.fetch = vi.fn(async (url, init) => {
      const body = JSON.parse(init.body);
      calls.push({ url, body });
      const items = answer(body.query);
      const start = body.b_start ?? 0;
      return {
        ok: true,
        status: 200,
        json: async () => ({ items: items.slice(start, start + (body.b_size ?? 25)), items_total: items.length }),
      };
    });
  });
  afterEach(() => vi.restoreAllMocks());

  const fetchFor = (o, v, paging = { start: 0, size: 10 }) =>
    ploneFetchItems({ apiUrl: 'http://api', contextPath: PAGE })(
      { querystring: { query: [TYPE, { i: 'path', o, v }] } },
      paging,
    );
  const sentPaths = () => calls.map((c) => c.body.query.find((q) => q.i === 'path'));
  const ids = (r) => r.items.map((i) => i['@id'].replace('http://api', ''));

  test('a location that says whether its folder is in is asked from the site root, absolute', async () => {
    await fetchFor(RELATIVE, '../');
    expect(calls[0].url).toBe('http://api/++api++/@querystring-search');
    expect(sentPaths()).toEqual([{ i: 'path', o: ABSOLUTE, v: '/news/2024' }]);
    expect(calls[0].body.query[0]).toEqual(TYPE);
  });

  // Asked from a page, Plone leaves that page out; a Volto location (`.`, the
  // page and everything under it to Plone) has always relied on it.
  test("Volto's own location is sent as it was, asked from the page", async () => {
    await fetchFor(RELATIVE, '.');
    expect(calls[0].url).toBe(`http://api${PAGE}/++api++/@querystring-search`);
    expect(sentPaths()).toEqual([{ i: 'path', o: RELATIVE, v: '.' }]);
  });

  test('the folder and everything under it: one search, no depth', async () => {
    const r = await fetchFor(ABSOLUTE, '/news/');
    expect(sentPaths()).toEqual([{ i: 'path', o: ABSOLUTE, v: '/news' }]);
    expect(ids(r)).toEqual(['/news', '/news/a', '/news/b']);
  });

  test('without the folder: its UID left out', async () => {
    const r = await fetchFor(ABSOLUTE, '/news/*');
    expect(calls.at(-1).body.query).toContainEqual({ i: 'UID', o: NONE, v: ['news-uid'] });
    expect(ids(r)).toEqual(['/news/a', '/news/b']);
    expect(r.total).toBe(2);
  });

  test('without the folder at depth 1: Plone leaves it out already', async () => {
    const r = await fetchFor(ABSOLUTE, '/news/*::1');
    expect(calls).toHaveLength(1);
    expect(sentPaths()).toEqual([{ i: 'path', o: ABSOLUTE, v: '/news::1' }]);
    expect(ids(r)).toEqual(['/news/a', '/news/b']);
  });

  test('with the folder at depth 1: the folder first, then its children', async () => {
    const r = await fetchFor(ABSOLUTE, '/news/::1');
    expect(ids(r)).toEqual(['/news', '/news/a', '/news/b']);
    expect(r.total).toBe(3);
    // The folder is asked with the listing's other criteria too.
    const top = calls.find((c) => c.body.query.find((q) => q.i === 'path').v === '/news::0');
    expect(top.body.query).toContainEqual(TYPE);
  });

  test('with the folder at depth 1, a later page counts it', async () => {
    const r = await fetchFor(ABSOLUTE, '/news/::1', { start: 1, size: 1 });
    expect(ids(r)).toEqual(['/news/a']);
    expect(r.total).toBe(3);
  });
});
