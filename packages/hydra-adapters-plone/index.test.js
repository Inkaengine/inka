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

/**
 * A Hydra frontend is NEVER same-origin with the CMS.
 *
 * The adapter runs in the proxy frame, which is served by the frontend — a
 * different origin from the CMS by construction, in every deployment. So every
 * request it makes is cross-origin, and a browser refuses a credentialled
 * cross-origin request whose response carries `Access-Control-Allow-Origin: *`
 * — which is what a dev CMS, and this repo's own mock, send.
 *
 * Sending credentials only when there is no token therefore broke exactly the
 * case that has no token: the anonymous reads before sign-in. Driving the real
 * GDS frontend's proxy against the mock, `@site` and the registration read were
 * both blocked, and nothing said so out loud — `bridge.ready` resolved with no
 * user, so the frame reported "needs sign-in" when the truth was "could not
 * reach the CMS".
 */
describe('PloneAdapter cross-origin requests', () => {
  afterEach(() => vi.unstubAllGlobals());

  const captureInit = async ({ token }) => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ '@id': '/x' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new PloneAdapter({
      cmsBaseUrl: 'http://cms',
      ...(token ? { getAuthToken: () => token } : {}),
    });
    await adapter.init({ cmsBaseUrl: 'http://cms', emit: () => {} });
    fetchMock.mockClear();
    await adapter.dispatch('http', { op: 'get', path: '/@site' });
    return fetchMock.mock.calls.at(-1)?.[1] ?? {};
  };

  test('sends no credentials when it holds a token', async () => {
    expect((await captureInit({ token: 't' })).credentials).toBe('omit');
  });

  test('sends no credentials when it holds NO token either', async () => {
    // The case that was broken. Cookies would be useless here anyway: they are
    // the CMS's cookies, and this frame is not on the CMS's origin.
    expect((await captureInit({ token: null })).credentials).toBe('omit');
  });
});
