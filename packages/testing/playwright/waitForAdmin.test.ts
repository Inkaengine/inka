import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { describe, expect, test } from 'vitest';
import { waitForAdmin } from './global-setup';

/** A port nothing is listening on: bound, read, and closed again. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

/**
 * An admin that isn't listening yet is one still starting: waitForAdmin keeps
 * asking until its timeout. Node's fetch reports a refused connection as
 * `TypeError: fetch failed` with the ECONNREFUSED on its `cause`, not on the
 * error, so waitForAdmin took it for some other failure and gave up on the
 * first try — a run whose servers were started outside Playwright failed with
 * "fetch failed" whenever setup got there first.
 */
describe('waitForAdmin', () => {
  test('an admin not listening yet is waited for, until the timeout', async () => {
    const healthUrl = `http://127.0.0.1:${await closedPort()}/health`;
    await expect(
      waitForAdmin({ healthUrl, prebuilt: false, timeoutMs: 1 }),
    ).rejects.toThrow(`Timeout waiting for Volto webpack compilation to complete. Check ${healthUrl}`);
  }, 30_000);

  test('an admin that starts listening while it is being waited for is ready', async () => {
    const port = await closedPort();
    const admin = createHttpServer((_req, res) => res.end('OK'));
    // Starts after the first, refused, try: waitForAdmin must still be asking.
    const starting = new Promise<void>((resolve) =>
      setTimeout(() => admin.listen(port, '127.0.0.1', resolve), 1000),
    );
    try {
      await waitForAdmin({
        healthUrl: `http://127.0.0.1:${port}/health`,
        prebuilt: false,
        timeoutMs: 20_000,
      });
    } finally {
      await starting;
      await new Promise<void>((resolve) => admin.close(() => resolve()));
    }
  }, 30_000);
});
