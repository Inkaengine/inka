import { jest } from '@jest/globals';
import { BridgeRPC } from './bridgeRpc.js';

test('resolves a request when the matching response arrives', async () => {
  const sent = [];
  const rpc = new BridgeRPC({ send: (msg) => sent.push(msg) });

  const promise = rpc.request('content.get', { path: '/news' });

  expect(sent).toHaveLength(1);
  expect(sent[0].type).toBe('BACKEND_REQUEST');
  expect(sent[0].intent).toBe('content.get');
  expect(sent[0].args).toEqual({ path: '/news' });
  expect(typeof sent[0].requestId).toBe('string');

  rpc.handleMessage({
    type: 'BACKEND_RESPONSE',
    requestId: sent[0].requestId,
    ok: true,
    result: { title: 'News' },
  });

  await expect(promise).resolves.toEqual({ title: 'News' });
});

test('ignores a response with an unknown requestId', () => {
  const rpc = new BridgeRPC({ send: () => {} });
  expect(() =>
    rpc.handleMessage({ type: 'BACKEND_RESPONSE', requestId: 'nope', ok: true }),
  ).not.toThrow();
});

test('rejects when no response arrives before the timeout', async () => {
  jest.useFakeTimers();
  const rpc = new BridgeRPC({ send: () => {} });
  const promise = rpc.request('content.get', {}, { timeoutMs: 1000 });
  const assertion = expect(promise).rejects.toMatchObject({
    code: 'TIMEOUT',
    intent: 'content.get',
  });
  jest.advanceTimersByTime(1001);
  await assertion;
  jest.useRealTimers();
});

test('clears the timer when a response arrives', async () => {
  jest.useFakeTimers();
  const sent = [];
  const rpc = new BridgeRPC({ send: (m) => sent.push(m) });
  const promise = rpc.request('content.get', {}, { timeoutMs: 1000 });
  rpc.handleMessage({
    type: 'BACKEND_RESPONSE',
    requestId: sent[0].requestId,
    ok: true,
    result: 1,
  });
  await expect(promise).resolves.toBe(1);
  expect(rpc.pending.size).toBe(0);
  jest.advanceTimersByTime(5000); // must not throw an unhandled rejection
  jest.useRealTimers();
});

test('asset.upload gets a longer default timeout than content.get', () => {
  const rpc = new BridgeRPC({ send: () => {} });
  expect(rpc.timeoutFor('asset.upload')).toBeGreaterThan(
    rpc.timeoutFor('content.get'),
  );
});

test('rejects with a structured error when ok is false', async () => {
  const sent = [];
  const rpc = new BridgeRPC({ send: (m) => sent.push(m) });
  const promise = rpc.request('content.get', { path: '/missing' });
  rpc.handleMessage({
    type: 'BACKEND_RESPONSE',
    requestId: sent[0].requestId,
    ok: false,
    error: { code: 'NOT_FOUND', status: 404, message: 'No such resource' },
  });
  await expect(promise).rejects.toMatchObject({
    code: 'NOT_FOUND',
    status: 404,
    message: 'No such resource',
  });
});

test('resolves a passthrough response with its result untouched', async () => {
  const sent = [];
  const rpc = new BridgeRPC({ send: (m) => sent.push(m) });
  const promise = rpc.request('http', { op: 'get', path: '/news' });
  rpc.handleMessage({
    type: 'BACKEND_RESPONSE',
    requestId: sent[0].requestId,
    ok: true,
    raw: true,
    result: { '@id': 'http://x/news' },
  });
  const res = await promise;
  // The payload is handed back exactly as the adapter sent it. There is
  // deliberately no side-channel flag saying "that one was raw": see
  // handleMessage.
  expect(res).toEqual({ '@id': 'http://x/news' });
  expect(rpc.lastResponseWasRaw).toBeUndefined();
});

const fakeAdapter = {
  name: 'fake',
  capabilities: ['content'],
  async dispatch(intent, args) {
    if (intent === 'content.get') return { title: 'ok', path: args.path };
    const e = new Error('unsupported');
    e.code = 'NOT_IMPLEMENTED';
    throw e;
  },
};

test('serves a request from the registered adapter', async () => {
  const sent = [];
  const rpc = new BridgeRPC({ send: (m) => sent.push(m) });
  rpc.serve(fakeAdapter);

  await rpc.handleMessage({
    type: 'BACKEND_REQUEST',
    requestId: 'r1',
    intent: 'content.get',
    args: { path: '/a' },
  });

  expect(sent[0]).toEqual({
    type: 'BACKEND_RESPONSE',
    requestId: 'r1',
    ok: true,
    raw: false,
    result: { title: 'ok', path: '/a' },
  });
});

test('converts an adapter throw into an error response', async () => {
  const sent = [];
  const rpc = new BridgeRPC({ send: (m) => sent.push(m) });
  rpc.serve(fakeAdapter);

  await rpc.handleMessage({
    type: 'BACKEND_REQUEST',
    requestId: 'r2',
    intent: 'workflow.get',
    args: {},
  });

  expect(sent[0].ok).toBe(false);
  expect(sent[0].error.code).toBe('NOT_IMPLEMENTED');
});

test('replies NO_ADAPTER when nothing is registered', async () => {
  const sent = [];
  const rpc = new BridgeRPC({ send: (m) => sent.push(m) });
  await rpc.handleMessage({
    type: 'BACKEND_REQUEST',
    requestId: 'r3',
    intent: 'content.get',
    args: {},
  });
  expect(sent[0].error.code).toBe('NO_ADAPTER');
});

describe('readiness gate', () => {
  test('holds requests until an adapter is serving', async () => {
    const sent = [];
    const rpc = new BridgeRPC({ send: (m) => sent.push(m), gated: true });

    const promise = rpc.request('content.get', { path: '/a' });

    // Nothing may go out yet: the iframe that would answer it has not
    // announced an adapter, so the message would be dropped on the floor.
    expect(sent).toHaveLength(0);

    rpc.markReady();
    expect(sent).toHaveLength(1);
    expect(sent[0].intent).toBe('content.get');

    rpc.handleMessage({
      type: 'BACKEND_RESPONSE',
      requestId: sent[0].requestId,
      ok: true,
      result: 'ok',
    });
    await expect(promise).resolves.toBe('ok');
  });

  test('re-gates when the iframe navigates away', async () => {
    const sent = [];
    const rpc = new BridgeRPC({ send: (m) => sent.push(m), gated: true });
    rpc.markReady();

    // Held so an eventual timeout has a handler and cannot crash the runner.
    const a = rpc.request('content.get', { path: '/a' }).catch(() => {});
    expect(sent).toHaveLength(1);

    // A full iframe page load tears down the adapter that was serving us.
    rpc.markNotReady();
    const b = rpc.request('content.get', { path: '/b' }).catch(() => {});
    expect(sent).toHaveLength(1);

    rpc.markReady();
    expect(sent).toHaveLength(2);
    expect(sent[1].args).toEqual({ path: '/b' });

    // Settle both so no timer outlives the test.
    for (const msg of sent) {
      rpc.handleMessage({
        type: 'BACKEND_RESPONSE',
        requestId: msg.requestId,
        ok: true,
        result: null,
      });
    }
    await Promise.all([a, b]);
  });

  test('does not start the timeout clock while a request is queued', async () => {
    jest.useFakeTimers();
    const sent = [];
    const rpc = new BridgeRPC({ send: (m) => sent.push(m), gated: true });

    const promise = rpc.request('content.get', {}, { timeoutMs: 1000 });
    const settled = promise.catch((err) => err);
    // Waiting for the iframe must not consume the request's own budget.
    jest.advanceTimersByTime(5000);
    expect(sent).toHaveLength(0);
    void settled;

    rpc.markReady();
    rpc.handleMessage({
      type: 'BACKEND_RESPONSE',
      requestId: sent[0].requestId,
      ok: true,
      result: 1,
    });
    await expect(promise).resolves.toBe(1);
    jest.useRealTimers();
  });

  test('ungated by default, so the iframe side is unaffected', () => {
    const sent = [];
    const rpc = new BridgeRPC({ send: (m) => sent.push(m) });
    rpc.request('content.get', {});
    expect(sent).toHaveLength(1);
  });
});

describe('no adapter is an error, not a silent wait', () => {
  test('queued requests reject once the adapter deadline passes', async () => {
    jest.useFakeTimers();
    const rpc = new BridgeRPC({
      send: () => {},
      gated: true,
      adapterTimeoutMs: 5000,
    });

    const promise = rpc.request('content.get', { path: '/a' });
    const settled = expect(promise).rejects.toMatchObject({
      code: 'NO_ADAPTER',
    });

    jest.advanceTimersByTime(5001);
    await settled;
    jest.useRealTimers();
  });

  test('the deadline is cancelled once an adapter announces', async () => {
    jest.useFakeTimers();
    const sent = [];
    const rpc = new BridgeRPC({
      send: (m) => sent.push(m),
      gated: true,
      adapterTimeoutMs: 5000,
    });

    const promise = rpc.request('content.get', { path: '/a' });
    rpc.markReady();
    jest.advanceTimersByTime(10_000);

    rpc.handleMessage({
      type: 'BACKEND_RESPONSE',
      requestId: sent[0].requestId,
      ok: true,
      result: 'ok',
    });
    await expect(promise).resolves.toBe('ok');
    jest.useRealTimers();
  });
});

describe('readiness means an adapter AND somewhere to send', () => {
  test('holds a request when there is no transport, even while ready', () => {
    const sent = [];
    let haveIframe = false;
    const rpc = new BridgeRPC({
      send: (m) => sent.push(m),
      gated: true,
      canSend: () => haveIframe,
    });

    rpc.markReady();
    rpc.request('content.get', { path: '/a' }).catch(() => {});

    // Ready, but nothing to send to: during a route change the old host is
    // gone and the new one has not mounted. Dispatching here loses the
    // request entirely.
    expect(sent).toHaveLength(0);

    haveIframe = true;
    rpc.markReady();
    expect(sent).toHaveLength(1);
  });

  test('flushing is a no-op while no transport exists', () => {
    const sent = [];
    const rpc = new BridgeRPC({
      send: (m) => sent.push(m),
      gated: true,
      canSend: () => false,
    });
    rpc.request('content.get', {}).catch(() => {});
    rpc.markReady();
    expect(sent).toHaveLength(0);
    expect(rpc.queue.length).toBe(1);
  });
});

describe('a replaced peer', () => {
  const clientFor = (canSend = () => true) => {
    const sent = [];
    const rpc = new BridgeRPC({ send: (m) => sent.push(m), canSend });
    return { rpc, sent };
  };

  it('rejects an in-flight WRITE instead of letting it expire', async () => {
    const { rpc } = clientFor();
    const inFlight = rpc.request('content.update', { path: '/news' });

    rpc.peerReplaced();

    // A write may already have been applied by the old adapter, so re-sending
    // it would be this layer deciding on its own to do it twice.
    await expect(inFlight).rejects.toMatchObject({ code: 'PEER_GONE' });
  });

  it('re-sends an in-flight READ to the new window', async () => {
    const { rpc, sent } = clientFor();
    const inFlight = rpc.request('content.get', { path: '/news' });
    expect(sent).toHaveLength(1);

    rpc.peerReplaced();

    // Idempotent, so asking again is what a browser does when a connection
    // drops mid-GET — and the caller never learns anything went wrong.
    expect(sent).toHaveLength(2);
    expect(sent[1].intent).toBe('content.get');

    rpc.handleMessage({
      type: 'BACKEND_RESPONSE',
      requestId: sent[1].requestId,
      ok: true,
      result: { path: '/news' },
    });
    await expect(inFlight).resolves.toMatchObject({ path: '/news' });
  });

  it('rejects a read when there is nowhere to re-send it', async () => {
    let alive = true;
    const { rpc } = clientFor(() => alive);
    const inFlight = rpc.request('content.get', { path: '/news' });

    alive = false;
    rpc.peerReplaced();

    await expect(inFlight).rejects.toMatchObject({ code: 'PEER_GONE' });
  });
});

/**
 * Concurrency: the admin has several reads in flight at once — the object
 * browser's listing, the type schema, breadcrumbs — and against a slow CMS
 * they finish in a different order than they were sent. Correlation is by
 * requestId, so this must hold regardless of arrival order; resolving "the
 * oldest pending" would hand the object browser the schema's payload.
 */
test('settles concurrent requests by id, whatever order they arrive in', async () => {
  const sent = [];
  const rpc = new BridgeRPC({ send: (msg) => sent.push(msg) });

  const listing = rpc.request('tree.list', { parent: '/news' });
  const schema = rpc.request('types.getSchema', { type: 'page' });
  const crumbs = rpc.request('breadcrumbs.get', { path: '/news' });

  expect(sent).toHaveLength(3);
  const ids = sent.map((m) => m.requestId);
  expect(new Set(ids).size).toBe(3); // ids are unique, or nothing else matters

  // Reverse order: last sent settles first.
  rpc.handleMessage({
    type: 'BACKEND_RESPONSE',
    requestId: ids[2],
    ok: true,
    result: { items: ['crumb'] },
  });
  rpc.handleMessage({
    type: 'BACKEND_RESPONSE',
    requestId: ids[0],
    ok: true,
    result: { items: ['first-post', 'draft-post'] },
  });
  rpc.handleMessage({
    type: 'BACKEND_RESPONSE',
    requestId: ids[1],
    ok: true,
    result: { properties: { title: {} } },
  });

  await expect(listing).resolves.toEqual({
    items: ['first-post', 'draft-post'],
  });
  await expect(schema).resolves.toEqual({ properties: { title: {} } });
  await expect(crumbs).resolves.toEqual({ items: ['crumb'] });
});

/**
 * A failure among concurrent requests settles only its own caller. One CMS
 * call 401ing must not reject the listing that was in flight beside it.
 */
test('an error settles only the request it belongs to', async () => {
  const sent = [];
  const rpc = new BridgeRPC({ send: (msg) => sent.push(msg) });

  const listing = rpc.request('tree.list', { parent: '/news' });
  const actions = rpc.request('state.get', { path: '/news' });
  const ids = sent.map((m) => m.requestId);

  rpc.handleMessage({
    type: 'BACKEND_RESPONSE',
    requestId: ids[1],
    ok: false,
    error: { code: 'UNAUTHORIZED', message: 'Unauthorized' },
  });
  rpc.handleMessage({
    type: 'BACKEND_RESPONSE',
    requestId: ids[0],
    ok: true,
    result: { items: ['first-post'] },
  });

  await expect(actions).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  await expect(listing).resolves.toEqual({ items: ['first-post'] });
});

describe('discarding abandoned work', () => {
  test('rejects in-flight reads and ignores their late replies', async () => {
    const sent = [];
    const rpc = new BridgeRPC({ send: (m) => sent.push(m) });

    const listing = rpc.request('tree.list', { parent: '/news' });
    rpc.discardReads('the preview navigated away');

    await expect(listing).rejects.toMatchObject({ code: 'DISCARDED' });

    // The adapter still answers; nobody is listening, so it must be ignored
    // rather than resolving a promise that has already been settled.
    const handled = rpc.handleMessage({
      type: 'BACKEND_RESPONSE',
      requestId: sent[0].requestId,
      ok: true,
      result: { items: ['first-post'] },
    });
    expect(handled).toBe(false);
  });

  test('leaves writes alone — the adapter may already have applied one', async () => {
    const sent = [];
    const rpc = new BridgeRPC({ send: (m) => sent.push(m) });

    const save = rpc.request('content.update', { path: '/news', data: {} });
    const listing = rpc.request('tree.list', { parent: '/news' });

    rpc.discardReads();

    await expect(listing).rejects.toMatchObject({ code: 'DISCARDED' });

    rpc.handleMessage({
      type: 'BACKEND_RESPONSE',
      requestId: sent[0].requestId,
      ok: true,
      result: { saved: true },
    });
    await expect(save).resolves.toEqual({ saved: true });
  });

  test('drops queued reads that were never sent', async () => {
    const sent = [];
    const rpc = new BridgeRPC({ send: (m) => sent.push(m), gated: true });

    const listing = rpc.request('tree.list', { parent: '/news' });
    expect(sent).toHaveLength(0); // still gated: nothing went out

    rpc.discardReads();
    await expect(listing).rejects.toMatchObject({ code: 'DISCARDED' });

    // Releasing the gate must not resurrect it.
    rpc.markReady();
    expect(sent).toHaveLength(0);
  });

  test('a discarded read is not re-sent when the peer is replaced', async () => {
    const sent = [];
    const rpc = new BridgeRPC({ send: (m) => sent.push(m) });

    const listing = rpc.request('tree.list', { parent: '/news' });
    expect(sent).toHaveLength(1);

    rpc.discardReads();
    await expect(listing).rejects.toMatchObject({ code: 'DISCARDED' });

    rpc.peerReplaced();
    expect(sent).toHaveLength(1); // no redispatch
  });
});
