/**
 * plone.restapi's @querystring-search leaves out the page it is asked from
 * (unless that is the site root). A listing in a page usually wants that; a
 * navigation does not — it must show the page you are on. `includeContext`
 * asks from the site root instead, so the page is a result like any other.
 *
 * Asked from the root, a Relative path would count from the root, so Inka
 * resolves each one against the page first and sends an Absolute path.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

import { ploneFetchItems } from './index.js';

const RELATIVE = 'plone.app.querystring.operation.string.relativePath';
const ABSOLUTE = 'plone.app.querystring.operation.string.absolutePath';
const TYPE = { i: 'portal_type', o: 'plone.app.querystring.operation.selection.any', v: ['Document'] };

let calls;
beforeEach(() => {
  calls = [];
  globalThis.fetch = vi.fn(async (url, init) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    return { ok: true, status: 200, json: async () => ({ items: [], items_total: 0 }) };
  });
});
afterEach(() => vi.restoreAllMocks());

const fetchFor = (contextPath, v, options = {}) =>
  ploneFetchItems({ apiUrl: 'http://api', contextPath, ...options })(
    { querystring: { query: [TYPE, { i: 'path', o: RELATIVE, v }] } },
    { start: 0, size: 10 },
  );

describe('ploneFetchItems with includeContext', () => {
  test('asks from the site root', async () => {
    await fetchFor('/news/2024/bridge', '/*', { includeContext: true });
    expect(calls[0].url).toBe('http://api/++api++/@querystring-search');
  });

  test('sends each relative path as the absolute path it is for the page', async () => {
    const cases = [
      ['..', '/news/2024'],
      ['.', '/news/2024/bridge'],
      ['.::1', '/news/2024/bridge::1'],
      ['../..::2', '/news::2'],
      ['../../2023', '/news/2023'],
      ['/*', '/news'],
    ];
    for (const [v] of cases) await fetchFor('/news/2024/bridge', v, { includeContext: true });
    expect(calls.map((c) => c.body.query[1])).toEqual(
      cases.map(([, path]) => ({ i: 'path', o: ABSOLUTE, v: path })),
    );
    // The other criteria go as they were.
    expect(calls[0].body.query[0]).toEqual(TYPE);
  });

  test('.. stops at the site root, as Plone stops at the navigation root', async () => {
    await fetchFor('/news', '../..', { includeContext: true });
    expect(calls[0].body.query[1].v).toBe('/');
  });

  test('without it, the search is asked from the page and a relative path is sent as it is', async () => {
    await fetchFor('/news/2024/bridge', '..');
    expect(calls[0].url).toBe('http://api/news/2024/bridge/++api++/@querystring-search');
    expect(calls[0].body.query[1]).toEqual({ i: 'path', o: RELATIVE, v: '..' });
  });
});
