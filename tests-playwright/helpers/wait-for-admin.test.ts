/**
 * global-setup waits for the admin to start listening.
 *
 * Node's global fetch reports a refused connection as `TypeError: fetch failed`
 * with the code on `error.cause`, not on the error. Setup used to read only
 * `error.code`, so a refused connection counted as a real failure and the run
 * died on the first attempt instead of waiting for the admin.
 */
import http from 'node:http';
import net from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { isConnectionRefused, waitForAdmin } from './wait-for-admin';

/** A port nothing is listening on: bind one, then release it. */
async function closedPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as net.AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

describe('isConnectionRefused', () => {
  it('reads the code from the error (Bun, node:http)', () => {
    expect(isConnectionRefused({ code: 'ECONNREFUSED' })).toBe(true);
  });

  it('reads the code from error.cause (Node fetch, undici)', () => {
    const error = new TypeError('fetch failed', {
      cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1'), {
        code: 'ECONNREFUSED',
      }),
    });
    expect(isConnectionRefused(error)).toBe(true);
  });

  it('reads the code from an AggregateError cause (localhost on IPv4 and IPv6)', () => {
    const refused = (address: string) =>
      Object.assign(new Error(`connect ECONNREFUSED ${address}`), {
        code: 'ECONNREFUSED',
      });
    const error = new TypeError('fetch failed', {
      cause: Object.assign(
        new AggregateError([refused('::1:1'), refused('127.0.0.1:1')]),
        { code: 'ECONNREFUSED' },
      ),
    });
    expect(isConnectionRefused(error)).toBe(true);
  });

  it('is false for other errors', () => {
    expect(isConnectionRefused(new TypeError('fetch failed'))).toBe(false);
    expect(isConnectionRefused({ code: 'ENOTFOUND' })).toBe(false);
    expect(
      isConnectionRefused(
        new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } }),
      ),
    ).toBe(false);
    expect(isConnectionRefused(undefined)).toBe(false);
  });
});

describe('waitForAdmin', () => {
  it('keeps waiting while nothing listens, then times out', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const port = await closedPort();
    try {
      await expect(
        waitForAdmin({
          healthUrl: `http://127.0.0.1:${port}/health`,
          maxRetries: 3,
          retryDelay: 5,
        }),
      ).rejects.toThrow(/Timeout waiting for Volto webpack compilation/);
      const waits = log.mock.calls.filter(([m]) =>
        String(m).includes('to start...'),
      );
      expect(waits).toHaveLength(3);
    } finally {
      log.mockRestore();
    }
  });

  it('succeeds once the admin starts listening', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const port = await closedPort();
    const server = http.createServer((_req, res) => res.end('OK'));
    // Start listening only after the first attempts have been refused.
    const started = new Promise<void>((resolve) =>
      setTimeout(() => server.listen(port, '127.0.0.1', resolve), 60),
    );
    try {
      await waitForAdmin({
        healthUrl: `http://127.0.0.1:${port}/health`,
        maxRetries: 100,
        retryDelay: 20,
      });
      await started;
    } finally {
      log.mockRestore();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('still fails at once when the compilation failed (HTTP 500)', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const server = http.createServer((_req, res) => {
      res.statusCode = 500;
      res.end('boom');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as net.AddressInfo;
    try {
      await expect(
        waitForAdmin({
          healthUrl: `http://127.0.0.1:${port}/health`,
          maxRetries: 3,
          retryDelay: 5,
        }),
      ).rejects.toThrow(/Webpack compilation failed: boom/);
    } finally {
      log.mockRestore();
      error.mockRestore();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
