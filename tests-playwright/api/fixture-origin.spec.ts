import { test, expect } from '@playwright/test';
import { fork, type ChildProcess } from 'child_process';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * The mock API must speak its OWN origin, never a baked-in one.
 *
 * Content fixtures on disk write absolute URLs against the canonical
 * `http://localhost:8888` — `@id`s, image `url`s, hrefs. That is fine as a
 * storage convention, but every port in this suite is overridable
 * (`HYDRA_MOCK_API_PORT`, see tests-playwright/ports.ts), and a parent project
 * running this checkout alongside its own servers has to move them. When the
 * API runs anywhere else, a URL it serves still pointing at 8888 sends the
 * browser to a port that is dead or — worse — belongs to someone else.
 *
 * This is not hypothetical: block-sanity's "all images loaded" check failed on
 * the `slider (image)` block for exactly this reason, and only under a port
 * override, so a default-port CI run never saw it.
 *
 * A test on the default port can't catch this — 8888 is trivially correct
 * there — so this spawns the server on a port the OS hands us.
 */

const SPEC_DIR = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(SPEC_DIR, '../fixtures/mock-api-server.cjs');

// A fixture whose block data carries a baked absolute image URL
// (blocks['gallery-slider'].slides[1].url).
const PAGE = '/++api++/gallery-test-page';

/** Ask the OS for a free port, then hand it to the child. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, () => {
      const address = probe.address();
      if (typeof address === 'string' || address === null) {
        reject(new Error(`Unexpected address: ${address}`));
        return;
      }
      const { port } = address;
      probe.close(() => resolve(port));
    });
  });
}

test.describe('mock API origin', () => {
  let child: ChildProcess | undefined;

  test.afterEach(() => {
    child?.kill();
    child = undefined;
  });

  test('serves fixture URLs on the port it is running on', async ({ request }) => {
    const port = await freePort();
    child = fork(SERVER, [], {
      env: { ...process.env, PORT: String(port) },
      stdio: 'pipe',
    });

    await expect
      .poll(
        async () => {
          const res = await request
            .get(`http://localhost:${port}/health`)
            .catch(() => null);
          return res?.status();
        },
        { timeout: 20000, message: `mock API never came up on ${port}` },
      )
      .toBe(200);

    const res = await request.get(`http://localhost:${port}${PAGE}`);
    expect(res.ok()).toBeTruthy();
    const body = await res.text();

    // The whole response, not just the fields we happen to look at below:
    // an origin the client can't reach is wrong wherever it appears.
    expect(body).not.toContain('localhost:8888');

    const data = JSON.parse(body);
    expect(data['@id']).toBe(`http://localhost:${port}/gallery-test-page`);
    expect(data.blocks['gallery-slider'].slides[1].url).toBe(
      `http://localhost:${port}/images/penguin1.jpg/@@images/image`,
    );
  });
});
