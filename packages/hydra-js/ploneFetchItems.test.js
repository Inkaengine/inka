import { ploneFetchItems } from '@volto-hydra/helpers';

/**
 * ploneFetchItems must return exactly what Plone's @querystring-search
 * returns — same items, honouring `path::depth` — with only a
 * hierarchical *post-sort* applied (parent-before-children) when the
 * listing sorts on getObjPositionInParent. It must NOT inject the query
 * context page, and must NOT prune "orphan" items whose parent is absent
 * from the result set. Tree expansion / pruning for the context
 * navigation is the frontend ContextNavigationBlock's job, not this
 * fetcher's.
 */

const API = 'http://api.test';

function item(path, title, pos) {
  return {
    '@id': `${API}${path}`,
    '@type': 'Document',
    title,
    description: `${title} description`,
    getObjPositionInParent: pos,
  };
}

let fetchCalls;

function mockFetch(searchItems) {
  fetchCalls = [];
  global.fetch = async (url) => {
    fetchCalls.push(url);
    if (url.includes('/@querystring-search')) {
      return {
        ok: true,
        json: async () => ({
          items: searchItems,
          items_total: searchItems.length,
        }),
      };
    }
    // Any other fetch (e.g. a context-page GET) would be the old
    // self-injection — fail loudly so the test catches it.
    throw new Error(`unexpected fetch: ${url}`);
  };
}

afterEach(() => {
  delete global.fetch;
});

function run(query) {
  const fetchItems = ploneFetchItems({ apiUrl: API, contextPath: '/docs/examples' });
  return fetchItems(
    { querystring: { query, sort_on: 'getObjPositionInParent' } },
    { start: 0, size: 100 },
  );
}

const RELATIVE = 'plone.app.querystring.operation.string.relativePath';

describe('ploneFetchItems', () => {
  test('returns exactly the backend items — no self-injection', async () => {
    mockFetch([
      item('/docs/examples/accordion', 'Accordion', 0),
      item('/docs/examples/button', 'Button', 1),
    ]);

    const result = await run([{ i: 'path', o: RELATIVE, v: '.' }]);
    const paths = result.items.map((i) => new URL(i['@id']).pathname);

    expect(paths.sort()).toEqual([
      '/docs/examples/accordion',
      '/docs/examples/button',
    ]);
    // The query context must NOT be injected.
    expect(paths).not.toContain('/docs/examples');
    // Only the @querystring-search call — no context-page GET.
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]).toContain('/@querystring-search');
  });

  test('keeps items whose parent is absent — no orphan pruning', async () => {
    // /docs/examples/sub/leaf's parent /docs/examples/sub is NOT in the
    // result set. A pure post-sort must still return it.
    mockFetch([
      item('/docs/examples/accordion', 'Accordion', 0),
      item('/docs/examples/sub/leaf', 'Leaf', 0),
    ]);

    const result = await run([{ i: 'path', o: RELATIVE, v: '..' }]);
    const paths = result.items.map((i) => new URL(i['@id']).pathname);

    expect(paths.sort()).toEqual([
      '/docs/examples/accordion',
      '/docs/examples/sub/leaf',
    ]);
  });

  test('post-sorts into parent-before-children order', async () => {
    // Backend returns child before its parent (flat position order).
    mockFetch([
      item('/docs/examples/grid/grid-image', 'Grid image', 0),
      item('/docs/examples/grid', 'Grid', 0),
      item('/docs/examples/accordion', 'Accordion', 1),
    ]);

    const result = await run([{ i: 'path', o: RELATIVE, v: '.' }]);
    const paths = result.items.map((i) => new URL(i['@id']).pathname);

    expect(paths).toHaveLength(3);
    expect(paths.indexOf('/docs/examples/grid')).toBeLessThan(
      paths.indexOf('/docs/examples/grid/grid-image'),
    );
  });

  test('an error response fails loudly, not as zero results', async () => {
    // A stock Plone 6.2 answers an operation it lacks (string.search) with
    // 400 {"message": "Invalid query."}. That body has no `items`, so it was
    // read as an empty result: the LECC search page said "No results found"
    // for every term and nothing anywhere said why.
    global.fetch = async () => ({
      ok: false,
      status: 400,
      json: async () => ({ message: 'Invalid query.', type: 'BadRequest' }),
    });

    await expect(run([{ i: 'path', o: RELATIVE, v: '.' }])).rejects.toThrow(
      /400.*Invalid query\./,
    );
  });
});
