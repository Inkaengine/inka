/**
 * A page can ask the same question many times — a doc page showing eleven filter
 * arrangements over one query, a layout repeating a list. Each caller is its own
 * block with its own ids, so no layer above can tell they match; the request is
 * the only place where they are visibly identical.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

import { ploneFetchItems } from './index.js';

const block = (querystring) => ({ querystring });
const QUERY = { query: [{ i: 'Subject', o: 'any', v: ['x'] }] };

let calls;
beforeEach(() => {
  calls = [];
  globalThis.fetch = vi.fn(async (url, init) => {
    calls.push({ url, body: init.body, auth: init.headers.Authorization });
    // Resolve on a later tick so concurrent callers really do overlap.
    await new Promise((r) => setTimeout(r, 10));
    return { json: async () => ({ items: [{ '@id': '/a', title: 'A' }], items_total: 1 }) };
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('ploneFetchItems', () => {
  test('identical searches in flight together make ONE request', async () => {
    const fetchItems = ploneFetchItems({ apiUrl: 'http://api' });
    const results = await Promise.all([
      fetchItems(block(QUERY), { start: 0, size: 4 }),
      fetchItems(block(QUERY), { start: 0, size: 4 }),
      fetchItems(block(QUERY), { start: 0, size: 4 }),
    ]);
    expect(calls.length).toBe(1);
    // Every caller still gets its own answer.
    for (const r of results) expect(r.items).toHaveLength(1);
  });

  test('a different question is a different request', async () => {
    const fetchItems = ploneFetchItems({ apiUrl: 'http://api' });
    await Promise.all([
      fetchItems(block(QUERY), { start: 0, size: 4 }),
      // a different page of the same query is a different answer
      fetchItems(block(QUERY), { start: 4, size: 4 }),
      fetchItems(block({ query: [{ i: 'portal_type', o: 'any', v: ['Document'] }] }), { start: 0, size: 4 }),
    ]);
    expect(calls.length).toBe(3);
  });

  test('the next ask is a fresh request, not a cached answer', async () => {
    const fetchItems = ploneFetchItems({ apiUrl: 'http://api' });
    await fetchItems(block(QUERY), { start: 0, size: 4 });
    await fetchItems(block(QUERY), { start: 0, size: 4 });
    // Sharing is for requests in flight together. Content changes; an edited
    // query re-renders; neither may be answered from a finished request.
    expect(calls.length).toBe(2);
  });

});
