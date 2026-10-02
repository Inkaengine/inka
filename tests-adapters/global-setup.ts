import { spawn, type ChildProcess } from 'node:child_process';

/**
 * Boot the backing CMS ONCE per run, not once per spec file.
 *
 * WordPress Playground takes ~40s to come up. Booting it in each file's
 * beforeAll would both multiply that by the number of files and collide on the
 * port, because the previous file's server is still shutting down. Plone's mock
 * is cheap enough that it stays per-file.
 */

const PORT = 8790;
const BASE = `http://127.0.0.1:${PORT}`;

let wp: ChildProcess | null = null;

async function isUp(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/`, { redirect: 'manual' });
    return res.status < 500;
  } catch (err) {
    if (err instanceof TypeError) return false;
    throw err;
  }
}

export async function setup(): Promise<void> {
  if (process.env.TARGET !== 'wordpress') return;

  if (await isUp()) {
    throw new Error(
      `Port ${PORT} is already serving. Stop it before running the contract ` +
        `suite — reusing a WordPress we did not seed would test unknown content.`,
    );
  }

  wp = spawn(
    'pnpm',
    [
      'dlx',
      // Pinned; see the note in playwright.config.ts.
      '@wp-playground/cli@3.1.51',
      'server',
      '--port',
      String(PORT),
      '--login',
      // Bulk-seeds the vocabulary in one PHP pass; 10k REST posts would
      // dominate the run time.
      '--blueprint',
      'tests-adapters/fixtures/wp-blueprint.json',
    ],
    { stdio: 'pipe' },
  );
  wp.stderr?.on('data', (d) => process.stderr.write(`[wp] ${d}`));

  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    if (await isUp()) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`WordPress Playground never came up on ${BASE}`);
}

export async function teardown(): Promise<void> {
  wp?.kill('SIGTERM');
  wp = null;
}
