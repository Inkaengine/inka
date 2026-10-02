/**
 * A listing that asks for exactly this folder's children, in folder order, is
 * asking the question Plone already answers for every folderish page: the
 * content response's `items` (plone.restapi's folder serializer queries
 * `path` depth 1, `getObjPositionInParent`, nothing else). So it is answered
 * from the content endpoint — a GET a CDN can cache — rather than a
 * @querystring-search POST it cannot; and from the page's own content, when
 * the caller already has it and it covers the page asked for, with no request
 * at all.
 *
 * Any other question — a type filter, search text, a facet, another sort, a
 * limit — still goes to @querystring-search.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

import { ploneFetchItems } from './index.js';

const CONTENTS = {
  query: [
    {
      i: 'path',
      o: 'plone.app.querystring.operation.string.relativePath',
      v: '.::1',
    },
  ],
  sort_on: 'getObjPositionInParent',
};

const child = (n) => ({
  '@id': `http://api/images/pictograms/p${n}.png`,
  '@type': 'Image',
  title: `p${n}.png`,
  description: '',
  review_state: null,
  image_field: 'image',
  image_scales: { image: [{ download: `@@images/image-${n}.png`, scales: {} }] },
});

let calls;
beforeEach(() => {
  calls = [];
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', body: init.body });
    const u = new URL(url);
    const start = Number(u.searchParams.get('b_start') ?? 0);
    const size = Number(u.searchParams.get('b_size') ?? 25);
    const all = Array.from({ length: 62 }, (_, i) => child(i));
    return {
      ok: true,
      status: 200,
      json: async () => ({ items: all.slice(start, start + size), items_total: 62 }),
    };
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

const fetcher = (options = {}) =>
  ploneFetchItems({ apiUrl: 'http://api', contextPath: '/images/pictograms', ...options });

describe('ploneFetchItems: a folder-contents listing', () => {
  test('asks the content endpoint with a GET, not a search POST', async () => {
    const { items, total } = await fetcher()({ querystring: CONTENTS }, { start: 25, size: 25 });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('GET');
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe('/images/pictograms/++api++');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      b_start: '25',
      b_size: '25',
      metadata_fields: '_all',
    });
    expect(total).toBe(62);
    expect(items).toHaveLength(25);
    expect(items[0]['@id']).toBe('http://api/images/pictograms/p25.png');
  });

  test('an unconfigured listing is the same question (hydra defaults it to .::1)', async () => {
    await fetcher()({}, { start: 0, size: 10 });
    expect(calls[0].method).toBe('GET');
  });

  test("page 1 comes from the page's own content, with no request", async () => {
    const contextContent = {
      '@id': 'http://api/images/pictograms',
      items: Array.from({ length: 25 }, (_, i) => child(i)),
      items_total: 62,
    };
    const { items, total } = await fetcher({ contextContent })(
      { querystring: CONTENTS },
      { start: 0, size: 25 },
    );
    expect(calls).toHaveLength(0);
    expect(total).toBe(62);
    expect(items).toHaveLength(25);
    // Normalised like any catalog result: the image packaged for rendering.
    expect(items[0].image).toBeDefined();
  });

  test("a page beyond the content's batch is fetched", async () => {
    const contextContent = { items: Array.from({ length: 25 }, (_, i) => child(i)), items_total: 62 };
    await fetcher({ contextContent })({ querystring: CONTENTS }, { start: 25, size: 25 });
    expect(calls).toHaveLength(1);
  });

  test("a listing mapping a field the content's items lack is fetched with all fields", async () => {
    // The page's content carries the default summary; a listing that maps
    // Subject (tags) needs `metadata_fields=_all`.
    const contextContent = { items: Array.from({ length: 25 }, (_, i) => child(i)), items_total: 62 };
    await fetcher({ contextContent })(
      { querystring: CONTENTS, fieldMapping: { '@id': 'href', title: 'title', Subject: { field: 'tags', type: 'array' } } },
      { start: 0, size: 25 },
    );
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0].url).searchParams.get('metadata_fields')).toBe('_all');
  });

  test('an empty folder answers from the content too', async () => {
    const { items, total } = await fetcher({ contextContent: { items: [], items_total: 0 } })(
      { querystring: CONTENTS },
      { start: 0, size: 25 },
    );
    expect(calls).toHaveLength(0);
    expect({ items, total }).toEqual({ items: [], total: 0 });
  });
});

describe('ploneFetchItems: any other question is still a search', () => {
  const searched = () => calls.length === 1 && calls[0].method === 'POST' && calls[0].url.endsWith('/@querystring-search');

  test.each([
    ['a type filter', { query: [...CONTENTS.query, { i: 'portal_type', o: 'plone.app.querystring.operation.selection.any', v: ['News Item'] }], sort_on: 'getObjPositionInParent' }],
    ['the whole subtree', { query: [{ ...CONTENTS.query[0], v: '.' }], sort_on: 'getObjPositionInParent' }],
    ['another sort', { ...CONTENTS, sort_on: 'effective' }],
    ['folder order reversed', { ...CONTENTS, sort_order: 'descending' }],
    ['a limit', { ...CONTENTS, limit: 5 }],
  ])('%s', async (_, querystring) => {
    await fetcher()({ querystring }, { start: 0, size: 25 });
    expect(searched()).toBe(true);
  });

  test('search text from a search block', async () => {
    await fetcher({ extraCriteria: { SearchableText: 'png' } })({ querystring: CONTENTS }, { start: 0, size: 25 });
    expect(searched()).toBe(true);
  });

  test('a facet from a search block', async () => {
    await fetcher({ extraCriteria: { 'facet.portal_type': ['Image'] } })({ querystring: CONTENTS }, { start: 0, size: 25 });
    expect(searched()).toBe(true);
  });
});
