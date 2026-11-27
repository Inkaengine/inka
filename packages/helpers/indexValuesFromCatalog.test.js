/**
 * `indexValuesFromCatalog` is the catalog read a shortcuts strip uses for "what
 * values does this index hold?" (#762), exported so a frontend can ask the same
 * question for anything else a visitor sees, such as a search facet on an
 * index whose values Plone doesn't declare to an anonymous visitor (`Subject`).
 * The frontend passes its own fetch, so a server render can cache it.
 */
import { describe, test, expect, vi } from 'vitest';

import { indexValuesFromCatalog } from './index.js';

const BRAINS = [
  { '@id': '/a', Subject: ['gov-security', 'workflow'] },
  { '@id': '/b', Subject: ['workflow'] },
  { '@id': '/c', Subject: ['accessibility', 'gov-security'] },
  { '@id': '/d' },
];

describe('indexValuesFromCatalog', () => {
  test('asks the given fetch for the site-wide catalog, and gives each value once, in order', async () => {
    const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ items: BRAINS }) }));
    const values = await indexValuesFromCatalog({ apiUrl: 'http://site', index: 'Subject', fetch });
    expect(values).toEqual(['gov-security', 'workflow', 'accessibility']);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('http://site/++api++/@querystring-search');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body).query).toEqual([
      { i: 'path', o: 'plone.app.querystring.operation.string.absolutePath', v: '/' },
    ]);
  });

  test('a failed request is an error naming the index, not an empty list', async () => {
    const fetch = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    await expect(
      indexValuesFromCatalog({ apiUrl: 'http://site', index: 'Subject', fetch }),
    ).rejects.toThrow(/503.*Subject/);
  });
});
