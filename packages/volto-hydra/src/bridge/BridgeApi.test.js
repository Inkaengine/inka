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
   * Renewal is the only thing that ever asks the site whether a token is still
   * good, and /connect-agent leans on it: it offers Allow only once renewal has
   * come back, because the browser can hold a token the site has stopped
   * accepting (a deploy that resets the site stops accepting every token it
   * issued) and the agent would be handed that one and fail on every call.
   *
   * Answering renewal out of the admin's own cookie made the bridge admin say
   * yes to a dead session, which is precisely what that page exists to prevent.
   */
  describe('@login-renew', () => {
    it('is relayed to a Plone-dialect site, which decides', async () => {
      // A real endpoint there: it answers 401 for a token it no longer accepts
      // and a FRESH token otherwise, which is what Volto asked for.
      const r = rpc({ token: 'a-fresh-one' });
      const api = passthroughApi(r);
      const res = await api.post('/@login-renew');
      expect(r.request).toHaveBeenCalledWith(
        'http',
        expect.objectContaining({ op: 'post', path: '/@login-renew' }),
      );
      expect(res).toEqual({ token: 'a-fresh-one' });
    });

    it('is not pressed as a login provider called "renew"', async () => {
      // `@login-renew` also matches the `@login-<option>` branch.
      const r = rpc({ token: 'a-fresh-one' });
      await passthroughApi(r).post('/@login-renew');
      expect(r.request).not.toHaveBeenCalledWith(
        'auth.loginWithOption',
        expect.anything(),
      );
    });

    it('asks any other adapter who the session belongs to', async () => {
      const r = rpc({ id: 'admin' });
      await semanticApi(r).post('/@login-renew');
      expect(r.request).toHaveBeenCalledWith('auth.whoami', {});
    });

    it('fails when the site no longer accepts the session', async () => {
      const dead = Object.assign(new Error('nope'), {
        code: 'UNAUTHORIZED',
        status: 401,
      });
      const api = semanticApi({ request: vi.fn().mockRejectedValue(dead) });
      // Volto's reducer drops the token on a failed renewal, which is how the
      // person is sent to sign in again.
      await expect(api.post('/@login-renew')).rejects.toMatchObject({
        status: 401,
      });
    });

    it('fails when the adapter answers with nobody', async () => {
      // The contract says whoami gives "the signed-in user, or null", so an
      // adapter may say so by answering rather than by throwing. Either way it
      // is not a session to hand an agent.
      const api = semanticApi(rpc(null));
      await expect(api.post('/@login-renew')).rejects.toThrow(/no longer/i);
    });
  });

  /**
   * Volto's reducers read `error.response` on a failure, because its Api helper
   * rejects with superagent's error and superagent always has one. A bridge
   * error that has none does not merely lose a message — the reducer THROWS
   * while reading it, the FAIL action never reaches the store, and the state it
   * was supposed to change is left exactly as it was.
   */
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
