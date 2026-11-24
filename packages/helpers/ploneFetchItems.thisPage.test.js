import { ploneFetchItems, THIS_PAGE } from './index.js';

// "Is the same as this page": a listing criterion whose value is the page's
// own (its tags, its type, its author, its language), for a "related" or
// "more like this" listing. The fetcher fills in the page's values as Plone's
// own "any of", and leaves the page itself out of what it lists.
const ANY = 'plone.app.querystring.operation.selection.any';
const NONE = 'plone.app.querystring.operation.selection.none';

let posted;
let gets;
const page = { '@id': 'http://api/news/a', UID: 'uid-a', '@type': 'News Item', subjects: ['Policing', 'Reports'], creators: ['jo'] };
beforeEach(() => {
  posted = [];
  gets = [];
  globalThis.fetch = vi.fn(async (url, init) => {
    if (init?.method === 'POST') {
      posted.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({ items: [{ '@id': 'http://api/news/b' }], items_total: 1 }) };
    }
    gets.push(url);
    return { ok: true, status: 200, json: async () => page };
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

const listing = (i) => ({ '@type': 'listing', querystring: { query: [{ i, o: THIS_PAGE }], sort_on: 'effective' } });

describe('ploneFetchItems: "is the same as this page"', () => {
  test("the page's tags, as any of them, and the page itself left out", async () => {
    const fetchItems = ploneFetchItems({ apiUrl: 'http://api', contextPath: '/news/a', contextContent: page });
    await fetchItems(listing('Subject'), { start: 0, size: 3 });
    expect(posted).toHaveLength(1);
    expect(posted[0].query).toEqual([
      { i: 'Subject', o: ANY, v: ['Policing', 'Reports'] },
      { i: 'UID', o: NONE, v: ['uid-a'] },
    ]);
    expect(gets).toEqual([]);
  });

  test("the page's type: more of the same kind", async () => {
    const fetchItems = ploneFetchItems({ apiUrl: 'http://api', contextPath: '/news/a', contextContent: page });
    await fetchItems(listing('portal_type'), { start: 0, size: 3 });
    expect(posted[0].query[0]).toEqual({ i: 'portal_type', o: ANY, v: ['News Item'] });
  });

  test('without the page to hand, it is read first', async () => {
    const fetchItems = ploneFetchItems({ apiUrl: 'http://api', contextPath: '/news/a' });
    await fetchItems(listing('Creator'), { start: 0, size: 3 });
    expect(gets).toHaveLength(1);
    expect(gets[0]).toContain('/news/a');
    expect(posted[0].query[0]).toEqual({ i: 'Creator', o: ANY, v: ['jo'] });
  });

  test('a page with no value for it lists nothing, and asks nothing', async () => {
    const fetchItems = ploneFetchItems({
      apiUrl: 'http://api',
      contextPath: '/news/a',
      contextContent: { ...page, subjects: [] },
    });
    await expect(fetchItems(listing('Subject'), { start: 0, size: 3 })).resolves.toEqual({ items: [], total: 0 });
    expect(posted).toEqual([]);
  });

  test('an index no page field answers is refused', async () => {
    const fetchItems = ploneFetchItems({ apiUrl: 'http://api', contextPath: '/news/a', contextContent: page });
    await expect(fetchItems(listing('review_state'), { start: 0, size: 3 })).rejects.toThrow(/review_state/);
  });
});

describe('withThisPageOperation: the admin offers it', () => {
  test('on the indexes a page has a value for, after their own operations, with no value to enter', async () => {
    const { withThisPageOperation } = await import('./index.js');
    const indexes = {
      Subject: { title: 'Tag', operations: [ANY], operators: { [ANY]: { title: 'Matches any of', widget: 'MultipleSelectionWidget' } } },
      review_state: { title: 'Review state', operations: [ANY], operators: { [ANY]: { title: 'Matches any of', widget: 'MultipleSelectionWidget' } } },
    };
    const out = withThisPageOperation(indexes);
    expect(out.Subject.operations).toEqual([ANY, THIS_PAGE]);
    expect(out.Subject.operators[THIS_PAGE]).toEqual({ title: 'Is the same as this page', widget: null });
    expect(out.review_state).toBe(indexes.review_state);
    expect(indexes.Subject.operations).toEqual([ANY]);
  });

  test('nothing to add to before the indexes have loaded', async () => {
    const { withThisPageOperation } = await import('./index.js');
    expect(withThisPageOperation({})).toEqual({});
  });
});
