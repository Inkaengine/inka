import { describe, it, expect, vi } from 'vitest';
import { BridgeApi } from './BridgeApi';

const rpc = (result) => ({ request: vi.fn().mockResolvedValue(result) });

/**
 * A BridgeApi wired to an adapter that has ANNOUNCED itself.
 *
 * These tests used to construct one with no adapter at all and still get
 * passthrough, because BridgeApi defaulted to it when nothing had announced.
 * That default is gone: passthrough now requires an adapter that claims
 * 'http-passthrough', so a test exercising passthrough has to say so. Stating
 * the capability is also what the test MEANS — it is about how a Plone-dialect
 * adapter is addressed, not about what happens before anyone answers.
 */
const passthroughApi = (r) =>
  new BridgeApi(r, {
    getAdapterInfo: () => ({ capabilities: ['http-passthrough'] }),
    whenAdapterReady: () =>
      Promise.resolve({ capabilities: ['http-passthrough'] }),
  });

describe('BridgeApi', () => {
  it('exposes exactly the five Api methods', () => {
    const api = passthroughApi(rpc({}));
    for (const m of ['get', 'post', 'put', 'patch', 'del']) {
      expect(typeof api[m]).toBe('function');
    }
  });

  it('maps a GET to the http passthrough intent', async () => {
    const r = rpc({ '@id': 'http://x/news' });
    const api = passthroughApi(r);
    const res = await api.get('/news', {
      headers: { Accept: 'application/json' },
    });
    expect(r.request).toHaveBeenCalledWith('http', {
      op: 'get',
      path: '/news',
      data: undefined,
      headers: { Accept: 'application/json' },
      params: undefined,
    });
    expect(res).toEqual({ '@id': 'http://x/news' });
  });

  it('passes the body through on a PATCH', async () => {
    const r = rpc({});
    const api = passthroughApi(r);
    await api.patch('/news', { data: { title: 'New' } });
    expect(r.request).toHaveBeenCalledWith(
      'http',
      expect.objectContaining({
        op: 'patch',
        path: '/news',
        data: { title: 'New' },
      }),
    );
  });

  it('propagates a bridge error unchanged', async () => {
    const err = Object.assign(new Error('nope'), {
      code: 'NOT_FOUND',
      status: 404,
    });
    const api = passthroughApi({ request: vi.fn().mockRejectedValue(err) });
    await expect(api.get('/missing')).rejects.toMatchObject({ status: 404 });
  });

  it('works when called with no options object', async () => {
    const r = rpc({});
    const api = passthroughApi(r);
    await api.get('/news');
    expect(r.request).toHaveBeenCalledWith(
      'http',
      expect.objectContaining({ op: 'get', path: '/news' }),
    );
  });
});
