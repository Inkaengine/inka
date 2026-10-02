import { afterEach, describe, expect, test, vi } from 'vitest';
import { PloneAdapter } from './index.js';

/**
 * The http passthrough carries the admin's OWN requests, verbatim. Volto keeps
 * its own store and decides when to ask again — when it does, it means it: the
 * template re-fetch on unlock exists precisely to replace a stale copy. The
 * adapter's read cache answering that from memory hands back the stale copy.
 */
describe('PloneAdapter http passthrough', () => {
  afterEach(() => vi.unstubAllGlobals());

  const adapterWithFetch = async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ '@id': '/x', title: 'X' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new PloneAdapter({ cmsBaseUrl: 'http://cms', getAuthToken: () => 't' });
    await adapter.init({ cmsBaseUrl: 'http://cms', emit: () => {} });
    return { adapter, fetchMock };
  };

  test('a repeated GET reaches the CMS each time', async () => {
    const { adapter, fetchMock } = await adapterWithFetch();
    await adapter.dispatch('http', { op: 'get', path: '/templates/layout' });
    await adapter.dispatch('http', { op: 'get', path: '/templates/layout' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
