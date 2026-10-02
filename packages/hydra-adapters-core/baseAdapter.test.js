import { BaseAdapter, AdapterError } from './baseAdapter.js';

class Stub extends BaseAdapter {
  constructor(responses) {
    super({ name: 'stub', capabilities: ['content'] });
    this.responses = responses;
    this.calls = 0;
  }

  async fetchJson() {
    this.calls++;
    const r = this.responses.shift();
    if (r instanceof Error) throw r;
    return r;
  }

  async dispatch(intent) {
    return this.withAuthRetry(() => this.fetchJson(intent));
  }
}

test('re-runs the call once after a 401 and succeeds', async () => {
  const unauth = new AdapterError('Unauthorized', {
    code: 'UNAUTHORIZED',
    status: 401,
  });
  const a = new Stub([unauth, { ok: 1 }]);
  await a.init({ cmsBaseUrl: 'http://x', emit: () => {} });
  await expect(a.dispatch('content.get')).resolves.toEqual({ ok: 1 });
  expect(a.calls).toBe(2);
});

test('emits auth-required and rethrows when the retry also 401s', async () => {
  const events = [];
  const unauth = () =>
    new AdapterError('Unauthorized', { code: 'UNAUTHORIZED', status: 401 });
  const a = new Stub([unauth(), unauth()]);
  await a.init({ cmsBaseUrl: 'http://x', emit: (e, p) => events.push([e, p]) });
  await expect(a.dispatch('content.get')).rejects.toMatchObject({ status: 401 });
  expect(events.map(([e]) => e)).toContain('auth-required');
});

test('does not retry a non-401 error', async () => {
  const a = new Stub([
    new AdapterError('Boom', { code: 'SERVER_ERROR', status: 500 }),
  ]);
  await a.init({ cmsBaseUrl: 'http://x', emit: () => {} });
  await expect(a.dispatch('content.get')).rejects.toMatchObject({ status: 500 });
  expect(a.calls).toBe(1);
});

test('rejects an unsupported intent with NOT_IMPLEMENTED', async () => {
  const a = new BaseAdapter({ name: 'bare', capabilities: [] });
  await expect(a.dispatch('workflow.get', {})).rejects.toMatchObject({
    code: 'NOT_IMPLEMENTED',
  });
});

describe('an expansion the adapter cannot serve', () => {
  /**
   * The document is what was asked for; the bundle beside it is a convenience.
   *
   * The admin declares its expansion bundle STATICALLY — it cannot wait for an
   * adapter to announce what it supports, because the first content request
   * goes out while the announcement is still in flight (see bridge/client.js).
   * So every adapter is asked for the same bundle, and one that cannot serve a
   * member of it must not take the document down with it.
   *
   * `translations` is the case that forced this: only a CMS with a multilingual
   * story can answer it, and a WordPress content read must not fail because the
   * admin asked whether the page had a German version.
   */
  class HalfAdapter extends BaseAdapter {
    constructor() {
      super({ name: 'half', capabilities: ['content'] });
    }

    // `dispatchOnce` is the one adapters implement; BaseAdapter.dispatch wraps
    // it with retention and the 401 retry.
    async dispatchOnce(intent, args) {
      if (intent === 'breadcrumbs.get') return { items: [{ title: 'Home' }] };
      throw new AdapterError(`half does not implement '${intent}'`, {
        code: 'NOT_IMPLEMENTED',
        status: 501,
      });
    }
  }

  it('is omitted, and the rest of the bundle still arrives', async () => {
    const adapter = new HalfAdapter();
    const context = await adapter.expandContext('/news', [
      'breadcrumbs',
      'translations',
    ]);
    expect(context.breadcrumbs).toEqual({ items: [{ title: 'Home' }] });
    expect('translations' in context).toBe(false);
  });

  it('still refuses a name that is not an expansion at all', async () => {
    // A typo must fail: it is a bug in the caller, not a capability the CMS
    // lacks, and swallowing it would hide the mistake behind a missing key.
    const adapter = new HalfAdapter();
    await expect(adapter.expandContext('/news', ['nonesuch'])).rejects.toThrow(
      /unknown expansion/i,
    );
  });
});
