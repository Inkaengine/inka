import { describe, it, expect, vi } from 'vitest';
import {
  adapterGetContent,
  adapterFetchItems,
  relatedItemsFetcher,
  searchShortcutsFetcher,
} from './index.js';

/**
 * Reading a CMS through an adapter, for a FRONTEND.
 *
 * A frontend renders from its CMS directly when it is not being edited, and its
 * renderers were written against Plone's REST shape. These two functions let a
 * frontend on WordPress or Drupal keep those renderers: the adapter reads the
 * CMS, plonify turns the canonical answer into the shape the renderers expect.
 * They take an adapter INSTANCE, so helpers stays free of any adapter
 * dependency — a Plone frontend that fetches Plone itself never loads one.
 */

const fakeAdapter = (answers) => ({
  dispatch: vi.fn(async (intent) => {
    if (!(intent in answers)) throw new Error(`unexpected intent ${intent}`);
    return answers[intent];
  }),
});

const doc = (path, title) => ({
  id: `${path}-uid`,
  path,
  type: 'page',
  title,
  blocks: { b1: { '@type': 'slate', value: [{ type: 'p', children: [{ text: 'Hello' }] }] } },
  blocksLayout: { items: ['b1'] },
  fields: {},
});

describe('adapterGetContent', () => {
  it('reads a page through the adapter, in the shape Plone returns', async () => {
    const adapter = fakeAdapter({ 'content.get': doc('/news/first-post', 'First Post') });

    const content = await adapterGetContent(adapter, '/news/first-post');

    expect(adapter.dispatch).toHaveBeenCalledWith('content.get', { path: '/news/first-post' });
    expect(content['@id']).toBe('/news/first-post');
    expect(content.title).toBe('First Post');
    expect(content.blocks_layout).toEqual({ items: ['b1'] });
    expect(content.blocks.b1['@type']).toBe('slate');
  });

  it('passes an expansion through, and returns it as @components', async () => {
    const adapter = fakeAdapter({
      'content.get': { ...doc('/news', 'News'), context: { breadcrumbs: [] } },
    });

    const content = await adapterGetContent(adapter, '/news', { expand: ['breadcrumbs'] });

    expect(adapter.dispatch).toHaveBeenCalledWith('content.get', {
      path: '/news',
      expand: ['breadcrumbs'],
    });
    expect(content['@components']).toHaveProperty('breadcrumbs');
  });

  it('refuses to run without an adapter', async () => {
    await expect(adapterGetContent(undefined, '/x')).rejects.toThrow(/adapter/);
  });
});

describe('adapterFetchItems', () => {
  const results = (n) => ({
    items: Array.from({ length: n }, (_, i) => doc(`/news/p${i}`, `P${i}`)),
    total: n,
  });

  it('answers the same fetchItems contract as ploneFetchItems', async () => {
    const adapter = fakeAdapter({ querystringSearch: results(3) });
    const fetchItems = adapterFetchItems({ adapter });

    const page = await fetchItems({ querystring: { query: [] } }, { start: 0, size: 10 });

    expect(page.total).toBe(3);
    expect(page.items.map((i) => i.title)).toEqual(['P0', 'P1', 'P2']);
  });

  it('pages locally, because the intent takes no offset', async () => {
    const adapter = fakeAdapter({ querystringSearch: results(7) });
    const fetchItems = adapterFetchItems({ adapter });

    const page = await fetchItems({ querystring: { query: [] } }, { start: 3, size: 2 });

    // Asked for enough to reach the end of the page, then sliced.
    expect(adapter.dispatch.mock.calls[0][1].limit).toBe(5);
    expect(page.items.map((i) => i.title)).toEqual(['P3', 'P4']);
    expect(page.total).toBe(7);
  });

  it('passes the query and sort through as the intent expects them', async () => {
    const adapter = fakeAdapter({ querystringSearch: results(1) });
    const fetchItems = adapterFetchItems({ adapter });
    const query = [
      { i: 'portal_type', o: 'plone.app.querystring.operation.selection.any', v: ['Document'] },
    ];

    await fetchItems(
      { querystring: { query, sort_on: 'effective', sort_order: 'descending' } },
      { start: 0, size: 5 },
    );

    const args = adapter.dispatch.mock.calls[0][1];
    expect(args.query).toEqual(query);
    expect(args.sortOn).toBe('effective');
    expect(args.sortOrder).toBe('descending');
  });

  it('refuses to be built without an adapter', () => {
    expect(() => adapterFetchItems({})).toThrow(/adapter/);
  });
});

/**
 * The example listing variants read the CMS too. With only an apiUrl they
 * could only ever read Plone, so on WordPress or Drupal a Related Items or
 * Search Shortcuts block rendered from the wrong server. Given an adapter they
 * read through it, like adapterFetchItems.
 */
describe('relatedItemsFetcher with an adapter', () => {
  it("pages the context page's relation field, read through the adapter", async () => {
    const page = doc('/news/first-post', 'First Post');
    page.fields.relatedItems = [
      { '@id': '/a', title: 'A' },
      { '@id': '/b', title: 'B' },
      { '@id': '/c', title: 'C' },
    ];
    const adapter = fakeAdapter({ 'content.get': page });

    const fetchItems = relatedItemsFetcher({ adapter, contextPath: '/news/first-post' });
    const { items, total } = await fetchItems({}, { start: 1, size: 1 });

    expect(adapter.dispatch).toHaveBeenCalledWith('content.get', { path: '/news/first-post' });
    expect(items.map((i) => i.title)).toEqual(['B']);
    expect(total).toBe(3);
  });

  it('refuses both an apiUrl and an adapter — which CMS would it read?', () => {
    expect(() =>
      relatedItemsFetcher({ apiUrl: 'http://cms', adapter: fakeAdapter({}) }),
    ).toThrow(/exactly one/);
  });
});

describe('searchShortcutsFetcher with an adapter', () => {
  it("links each of the CMS vocabulary's terms into the search, by the CMS's own vocabulary name", async () => {
    const adapter = fakeAdapter({
      'vocabulary.get': {
        items: [
          { token: 'news', title: 'News' },
          { token: 'events', title: 'Events' },
        ],
        total: 2,
      },
    });

    const fetchItems = searchShortcutsFetcher({
      adapter,
      vocabularies: { Subject: 'tags' },
    });
    const { items, total } = await fetchItems(
      { index: 'Subject', searchUrl: '/search' },
      { start: 0, size: 10 },
    );

    expect(adapter.dispatch).toHaveBeenCalledWith('vocabulary.get', { name: 'tags' });
    expect(items.map((i) => i['@id'])).toEqual([
      '/search?facet.Subject=news',
      '/search?facet.Subject=events',
    ]);
    expect(total).toBe(2);
  });

  it("uses the context page's own values when the block links a page field", async () => {
    const page = doc('/p', 'P');
    page.fields.subjects = ['red', 'blue'];
    const adapter = fakeAdapter({ 'content.get': page });

    const fetchItems = searchShortcutsFetcher({ adapter, contextPath: '/p' });
    const { items } = await fetchItems(
      { index: 'Subject', pageField: 'subjects', searchUrl: '/search' },
      { start: 0, size: 10 },
    );

    expect(items.map((i) => i.title)).toEqual(['red', 'blue']);
  });
});
