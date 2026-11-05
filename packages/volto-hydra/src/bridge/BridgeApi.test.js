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

/** An adapter that does NOT speak Plone's dialect: everything goes by intent. */
const semanticApi = (r) =>
  new BridgeApi(r, {
    getAdapterInfo: () => ({ capabilities: [] }),
    whenAdapterReady: () => Promise.resolve({ capabilities: [] }),
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

  /**
   * Renewal is answered from the admin's own cookie: in bridge mode the adapter
   * owns the CMS session, so there is nothing to renew, and a successful
   * renewal returns the token the admin already has.
   *
   * There is a known gap behind this, written up where the code is: renewal is
   * also the only thing that ever asks whether the site still ACCEPTS that
   * token, and /connect-agent depends on the answer. Confirming it with the
   * adapter was tried and reverted — it asks about the adapter's credential,
   * not the admin's cookie, and broke the sign-in flow for a good session.
   */
  describe('@login-renew', () => {
    it('answers with the token the admin already holds', async () => {
      const r = rpc({});
      await passthroughApi(r).post('/@login-renew');
      expect(r.request).not.toHaveBeenCalled();
    });

    it('is not pressed as a login provider called "renew"', async () => {
      // `@login-renew` also matches the `@login-<option>` branch, which would
      // ask the adapter to sign in with a provider that does not exist.
      const r = rpc({});
      await semanticApi(r).post('/@login-renew');
      expect(r.request).not.toHaveBeenCalledWith(
        'auth.loginWithOption',
        expect.anything(),
      );
    });
  });

  describe('a failed call', () => {
    const rejectingApi = (err) =>
      semanticApi({ request: vi.fn().mockRejectedValue(err) });

    it('carries a response, as Volto reducers read it', async () => {
      const err = Object.assign(new Error('nope'), {
        code: 'UNAUTHORIZED',
        status: 401,
      });
      await expect(rejectingApi(err).get('/news')).rejects.toMatchObject({
        status: 401,
        response: { status: 401, error: expect.anything() },
      });
    });

    it('keeps the code and status the caller decides on', async () => {
      const err = Object.assign(new Error('gone'), {
        code: 'NOT_FOUND',
        status: 404,
      });
      await expect(rejectingApi(err).get('/missing')).rejects.toMatchObject({
        code: 'NOT_FOUND',
        status: 404,
      });
    });

    it('leaves a response the adapter already gave alone', async () => {
      const err = Object.assign(new Error('nope'), {
        status: 400,
        response: { status: 400, error: { type: 'BadRequest', message: 'said so' } },
      });
      await expect(rejectingApi(err).get('/news')).rejects.toMatchObject({
        response: { error: { message: 'said so' } },
      });
    });
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
