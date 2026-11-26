import { ploneFetchItems } from './index.js';

// A search block's facet outside its listing's own criterion matches nothing
// (buildQuerystringSearchBody gives no query): the listing is empty, and
// nothing is asked of the API, whose answer to the nearest query it could be
// sent (an empty "any of") would be everything.
let calls;
beforeEach(() => {
  calls = [];
  globalThis.fetch = vi.fn(async (url) => {
    calls.push(url);
    return { ok: true, status: 200, json: async () => ({ items: [{ '@id': 'http://api/x' }], items_total: 1 }) };
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

const ANY = 'plone.app.querystring.operation.selection.any';
const block = { '@type': 'listing', querystring: { query: [{ i: 'portal_type', o: ANY, v: ['Document', 'News Item'] }] } };

describe('ploneFetchItems: a facet outside the listing', () => {
  test('lists nothing, and asks the API nothing', async () => {
    const fetchItems = ploneFetchItems({ apiUrl: 'http://api', contextPath: '/blog', extraCriteria: { 'facet.portal_type': 'Image' } });
    await expect(fetchItems(block, { start: 0, size: 10 })).resolves.toEqual({ items: [], total: 0 });
    expect(calls).toEqual([]);
  });

  test('a facet inside it still searches', async () => {
    const fetchItems = ploneFetchItems({ apiUrl: 'http://api', contextPath: '/blog', extraCriteria: { 'facet.portal_type': 'News Item' } });
    const result = await fetchItems(block, { start: 0, size: 10 });
    expect(result.total).toBe(1);
    expect(calls).toHaveLength(1);
  });
});
