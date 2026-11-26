/**
 * A shortcuts strip asks "what values does this index hold?", and it used to ask
 * the index's VOCABULARY. For the default index, `Subject`, that is
 * `plone.app.vocabularies.Keywords`, which a real Plone refuses to an anonymous
 * visitor with a 401 — so the strip worked in the editor, worked for a signed-in
 * user, and was empty for the visitor it exists for. Silently: `data.items` was
 * undefined, and `[]` renders as nothing (#762).
 *
 * These tests pin the two halves of the fix: it asks the CATALOG, and it refuses
 * to answer an empty strip when the request fails.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

import { searchShortcutsFetcher } from './index.js';

const BRAINS = [
  { '@id': '/a', Subject: ['gov-security', 'workflow'] },
  { '@id': '/b', Subject: ['workflow'] },
  { '@id': '/c', Subject: ['accessibility', 'gov-security'] },
  { '@id': '/d' },
  { '@id': '/e', Subject: [] },
];

let calls;
const respond = (payload, { ok = true, status = 200 } = {}) =>
  vi.fn(async (url, init) => {
    calls.push({ url, method: init?.method, body: init?.body ? JSON.parse(init.body) : undefined });
    return { ok, status, json: async () => payload };
  });

beforeEach(() => {
  calls = [];
  globalThis.fetch = respond({ items: BRAINS, items_total: BRAINS.length });
});
afterEach(() => {
  vi.restoreAllMocks();
});

const page = { start: 0, size: 10 };

// `searchUrl` is a LINK field, stored as [{ '@id': url }]; `_linkUrl` throws on
// anything else rather than guessing. Passing a bare string here failed all nine
// of these at once, which is the behaviour working as intended.

describe('searchShortcutsFetcher', () => {
  test('asks the catalog, never the vocabulary', async () => {
    const fetchItems = searchShortcutsFetcher({ apiUrl: 'http://api', contextPath: '/blog' });
    await fetchItems({ searchUrl: [{ '@id': '/search' }] }, page);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://api/blog/++api++/@querystring-search');
    expect(calls[0].method).toBe('POST');
    // The 401 that started this: nothing may reach @vocabularies.
    expect(calls.some((c) => c.url.includes('@vocabularies'))).toBe(false);
  });

  test('asks for the metadata the values live in', async () => {
    const fetchItems = searchShortcutsFetcher({ apiUrl: 'http://api' });
    await fetchItems({ searchUrl: [{ '@id': '/search' }] }, page);
    expect(calls[0].body.metadata_fields).toBe('_all');
  });

  test('one shortcut per distinct value, in result order, as links into the search', async () => {
    const fetchItems = searchShortcutsFetcher({ apiUrl: 'http://api' });
    const { items, total } = await fetchItems({ searchUrl: [{ '@id': '/case-studies' }] }, page);

    expect(items).toEqual([
      { '@id': '/case-studies?facet.Subject=gov-security', title: 'gov-security' },
      { '@id': '/case-studies?facet.Subject=workflow', title: 'workflow' },
      { '@id': '/case-studies?facet.Subject=accessibility', title: 'accessibility' },
    ]);
    expect(total).toBe(3);
  });

  test('an untagged item never becomes a blank shortcut', async () => {
    globalThis.fetch = respond({ items: [{ Subject: null }, { Subject: ['', 'real'] }, {}] });
    const fetchItems = searchShortcutsFetcher({ apiUrl: 'http://api' });
    const { items } = await fetchItems({ searchUrl: [{ '@id': '/s' }] }, page);
    expect(items.map((i) => i.title)).toEqual(['real']);
  });

  test('scopes to the search it points at, so a chip matches its destination', async () => {
    const fetchItems = searchShortcutsFetcher({ apiUrl: 'http://api', contextPath: '/blog' });
    await fetchItems({ searchUrl: [{ '@id': 'https://site.example/case-studies?x=1' }] }, page);
    expect(calls[0].body.query).toEqual([
      { i: 'path', o: 'plone.app.querystring.operation.string.absolutePath', v: '/case-studies' },
    ]);
  });

  test("when the search link names no path, scopes to this page's own subtree", async () => {
    const fetchItems = searchShortcutsFetcher({ apiUrl: 'http://api', contextPath: '/blog' });
    // A link to a site root: a real link, with nothing to scope to.
    await fetchItems({ searchUrl: [{ '@id': 'https://site.example/' }] }, page);
    expect(calls[0].body.query).toEqual([
      { i: 'path', o: 'plone.app.querystring.operation.string.relativePath', v: '.' },
    ]);
  });

  test('a non-default index is read from the same brains', async () => {
    globalThis.fetch = respond({ items: [{ portal_type: 'CaseStudy' }, { portal_type: 'Document' }] });
    const fetchItems = searchShortcutsFetcher({ apiUrl: 'http://api' });
    const { items } = await fetchItems({ index: 'portal_type', searchUrl: [{ '@id': '/s' }] }, page);
    expect(items.map((i) => i.title)).toEqual(['CaseStudy', 'Document']);
    expect(items[0]['@id']).toBe('/s?facet.portal_type=CaseStudy');
  });

  test('a failed request throws instead of rendering an empty strip', async () => {
    globalThis.fetch = respond({ error: { type: 'Not authenticated' } }, { ok: false, status: 401 });
    const fetchItems = searchShortcutsFetcher({ apiUrl: 'http://api' });
    await expect(fetchItems({ searchUrl: [{ '@id': '/s' }] }, page)).rejects.toThrow(/answered 401/);
  });

  test("pageField mode still reads the page's own field, with no search", async () => {
    globalThis.fetch = respond({ Subject: ['one', 'two'] });
    const fetchItems = searchShortcutsFetcher({ apiUrl: 'http://api', contextPath: '/blog' });
    const { items } = await fetchItems({ pageField: 'Subject', searchUrl: [{ '@id': '/s' }] }, page);

    expect(calls[0].url).toBe('http://api/blog/++api++');
    expect(items.map((i) => i.title)).toEqual(['one', 'two']);
  });
});
