import { describe, it, expect } from 'vitest';
import { sentryOptions, reporter, reportTheseTools } from './sentry.mjs';

/** The @sentry/node calls this uses, recorded. */
function fakeSdk() {
  const calls = { init: [], captureException: [] };
  return {
    calls,
    init: (options) => calls.init.push(options),
    captureException: (error, hint) => calls.captureException.push([error, hint]),
  };
}

/** A server that records what registerTool was given, and can call the handler. */
function fakeServer() {
  const registered = new Map();
  return {
    registered,
    registerTool(name, config, handler) {
      registered.set(name, { config, handler });
    },
  };
}

describe('sentryOptions', () => {
  it('is nothing without a DSN', () => {
    expect(sentryOptions({})).toBe(null);
    expect(sentryOptions({ SENTRY_ENVIRONMENT: 'prod' })).toBe(null);
  });

  it('carries only what the environment sets', () => {
    expect(sentryOptions({ SENTRY_DSN: 'https://k@o.example/1' })).toEqual({
      dsn: 'https://k@o.example/1',
    });
    expect(
      sentryOptions({ SENTRY_DSN: 'https://k@o.example/1', SENTRY_ENVIRONMENT: 'mcp', SENTRY_RELEASE: 'abc123' }),
    ).toEqual({ dsn: 'https://k@o.example/1', environment: 'mcp', release: 'abc123' });
  });
});

describe('reporter', () => {
  it('does nothing, and starts nothing, without a DSN', () => {
    const sdk = fakeSdk();
    const r = reporter({}, sdk);
    expect(r.reporting).toBe(false);
    r.report('get_page', new Error('boom'));
    expect(sdk.calls.init).toEqual([]);
    expect(sdk.calls.captureException).toEqual([]);
  });

  it('starts the SDK once, with those options', () => {
    const sdk = fakeSdk();
    const r = reporter({ SENTRY_DSN: 'https://k@o.example/1', SENTRY_ENVIRONMENT: 'mcp' }, sdk);
    expect(r.reporting).toBe(true);
    expect(sdk.calls.init).toEqual([{ dsn: 'https://k@o.example/1', environment: 'mcp' }]);
  });

  it('tags what it sends with the tool it came from', () => {
    const sdk = fakeSdk();
    const r = reporter({ SENTRY_DSN: 'https://k@o.example/1' }, sdk);
    const error = new Error('no such page');
    r.report('edit_blocks', error);
    expect(sdk.calls.captureException).toEqual([[error, { tags: { tool: 'edit_blocks' } }]]);
  });
});

describe('reportTheseTools', () => {
  it('sends a tool that throws, and still throws it', async () => {
    const sdk = fakeSdk();
    const server = fakeServer();
    reportTheseTools(server, reporter({ SENTRY_DSN: 'https://k@o.example/1' }, sdk));
    const error = new Error('the admin never answered');
    server.registerTool('create_page', { title: 'Create' }, async () => {
      throw error;
    });
    await expect(server.registered.get('create_page').handler({ path: '/x' })).rejects.toThrow(error);
    expect(sdk.calls.captureException).toEqual([[error, { tags: { tool: 'create_page' } }]]);
  });

  it('sends nothing for a tool that answers, and answers what it answered', async () => {
    const sdk = fakeSdk();
    const server = fakeServer();
    reportTheseTools(server, reporter({ SENTRY_DSN: 'https://k@o.example/1' }, sdk));
    server.registerTool('search', {}, async (args, extra) => ({ got: [args, extra] }));
    const answer = await server.registered.get('search').handler({ q: 'onyx' }, 'extra');
    expect(answer).toEqual({ got: [{ q: 'onyx' }, 'extra'] });
    expect(sdk.calls.captureException).toEqual([]);
  });

  it('leaves the tool\'s config alone', async () => {
    const sdk = fakeSdk();
    const server = fakeServer();
    reportTheseTools(server, reporter({ SENTRY_DSN: 'https://k@o.example/1' }, sdk));
    const config = { title: 'Search', inputSchema: {} };
    server.registerTool('search', config, async () => 'ok');
    expect(server.registered.get('search').config).toBe(config);
  });
});
