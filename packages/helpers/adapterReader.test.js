import { describe, it, expect, vi } from 'vitest';
import { adapterGetContent, adapterFetchItems } from './index.js';

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
