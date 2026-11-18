import {
  relatedItemsFetcher,
  searchShortcutsFetcher,
  rssFetcher,
} from '@volto-hydra/helpers';

const API = 'http://api.test';

function mockContent(fields) {
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ '@id': `${API}/page`, ...fields }),
  });
}

describe('relatedItemsFetcher', () => {
  test('returns the current page relation field items, paged', async () => {
    mockContent({
      relatedItems: [
        { '@id': `${API}/a`, title: 'A' },
        { '@id': `${API}/b`, title: 'B' },
        { '@id': `${API}/c`, title: 'C' },
      ],
    });
    const fetcher = relatedItemsFetcher({ apiUrl: API, contextPath: '/page' });
    const { items, total } = await fetcher(
      { relationField: 'relatedItems' },
      { start: 1, size: 1 },
    );
    expect(total).toBe(3);
    expect(items.map((i) => i.title)).toEqual(['B']);
  });

  test('defaults to the relatedItems field', async () => {
    mockContent({ relatedItems: [{ '@id': `${API}/a`, title: 'A' }] });
    const fetcher = relatedItemsFetcher({ apiUrl: API, contextPath: '/page' });
    const { items, total } = await fetcher({}, { start: 0, size: 10 });
    expect(total).toBe(1);
    expect(items).toHaveLength(1);
  });

  test('empty relation field → no items', async () => {
    mockContent({ relatedItems: [] });
    const fetcher = relatedItemsFetcher({ apiUrl: API, contextPath: '/page' });
    const { items, total } = await fetcher({}, { start: 0, size: 10 });
    expect(total).toBe(0);
    expect(items).toEqual([]);
  });
});

describe('searchShortcutsFetcher', () => {
  // Fetchers return RAW result objects; expandListingBlocks maps @id→href by
  // default, so setting @id to the facet URL yields a shortcut link — no
  // special item type or fieldMapping needed.
  test('this-page mode: values from the content field, @id = facet URL', async () => {
    mockContent({ subjects: ['news', 'plone'] });
    const fetcher = searchShortcutsFetcher({ apiUrl: API, contextPath: '/page' });
    const { items, total } = await fetcher(
      { pageField: 'subjects', index: 'Subject', searchUrl: [{ '@id': '/search' }] },
      { start: 0, size: 10 },
    );
    expect(total).toBe(2);
    expect(items).toEqual([
      { '@id': '/search?facet.Subject=news', title: 'news' },
      { '@id': '/search?facet.Subject=plone', title: 'plone' },
    ]);
  });

  test('site-wide mode (no pageField): unique values from the index vocabulary', async () => {
    global.fetch = async (url) => ({
      ok: true,
      json: async () =>
        String(url).includes('Keywords')
          ? { items: [{ token: 'a', title: 'a' }, { token: 'b', title: 'b' }] }
          : {},
    });
    const fetcher = searchShortcutsFetcher({ apiUrl: API, contextPath: '/page' });
    const { items, total } = await fetcher(
      { index: 'Subject', searchUrl: [{ '@id': '/search' }] },
      { start: 0, size: 10 },
    );
    expect(total).toBe(2);
    expect(items.map((i) => i.title)).toEqual(['a', 'b']);
    expect(items[0]['@id']).toBe('/search?facet.Subject=a');
  });

  test('values are URL-encoded in the facet param', async () => {
    mockContent({ subjects: ['a b & c'] });
    const fetcher = searchShortcutsFetcher({ apiUrl: API, contextPath: '/page' });
    const { items } = await fetcher(
      { pageField: 'subjects', index: 'Subject', searchUrl: [{ '@id': '/search' }] },
      { start: 0, size: 10 },
    );
    expect(items[0]['@id']).toBe('/search?facet.Subject=a%20b%20%26%20c');
  });

  test('a search page stored as a string is refused', async () => {
    // A link field holds [{'@id'}]; a string would be a second shape to read.
    mockContent({ subjects: ['news'] });
    const fetcher = searchShortcutsFetcher({ apiUrl: API, contextPath: '/page' });
    await expect(fetcher(
      { pageField: 'subjects', index: 'Subject', searchUrl: '/search' },
      { start: 0, size: 10 },
    )).rejects.toThrow(/\[\{"@id"/);
  });
});

describe('rssFetcher', () => {
  const RSS = `<?xml version="1.0"?><rss><channel>
    <title>Feed</title>
    <item><title>First</title><link>http://x/1</link><description>d1</description><pubDate>Mon, 01 Jan 2026</pubDate></item>
    <item><title>Second</title><link>http://x/2</link><description>d2</description></item>
  </channel></rss>`;

  test('parses feed items into raw results (@id = entry link), paged', async () => {
    global.fetch = async () => ({ ok: true, text: async () => RSS });
    const { items, total } = await rssFetcher()(
      { feedUrl: [{ '@id': 'http://x/feed' }], count: 10 },
      { start: 0, size: 10 },
    );
    expect(total).toBe(2);
    expect(items[0]).toEqual({
      '@id': 'http://x/1',
      title: 'First',
      description: 'd1',
      pubDate: 'Mon, 01 Jan 2026',
    });
    expect(items[1]).toMatchObject({ '@id': 'http://x/2', title: 'Second' });
  });

  test('honours block.count as an upper bound', async () => {
    global.fetch = async () => ({ ok: true, text: async () => RSS });
    const { items, total } = await rssFetcher()(
      { feedUrl: [{ '@id': 'http://x/feed' }], count: 1 },
      { start: 0, size: 10 },
    );
    expect(total).toBe(1);
    expect(items).toHaveLength(1);
  });

  test('a bug in reading the feed is not swallowed as an empty feed', async () => {
    global.fetch = async () => ({ ok: true, text: async () => { throw new RangeError('boom'); } });
    await expect(rssFetcher()({ feedUrl: [{ '@id': 'http://x/feed' }] }, { start: 0, size: 10 }))
      .rejects.toThrow('boom');
  });

  test('a feed address stored as a string is refused', async () => {
    global.fetch = async () => ({ ok: true, text: async () => RSS });
    await expect(rssFetcher()({ feedUrl: 'http://x/feed' }, { start: 0, size: 10 }))
      .rejects.toThrow(/\[\{"@id"/);
  });

  test('degrades to empty on fetch failure (best-effort CORS)', async () => {
    global.fetch = async () => {
      throw new TypeError('Failed to fetch');
    };
    const { items, total } = await rssFetcher()(
      { feedUrl: [{ '@id': 'http://x/feed' }] },
      { start: 0, size: 10 },
    );
    expect(items).toEqual([]);
    expect(total).toBe(0);
  });
});
