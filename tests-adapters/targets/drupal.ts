import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DrupalAdapter } from '@volto-hydra/hydra-adapters-drupal';
import type { Target } from './index';
import seed from '../fixtures/seed.json';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

const PORT = 8793;
const BASE = `http://127.0.0.1:${PORT}`;

let proc: ChildProcess | null = null;

const adapter = new DrupalAdapter({
  cmsBaseUrl: BASE,
  credentials: { username: 'admin', password: 'admin' },
});

async function waitForHealth(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
      last = new Error(`status ${res.status}`);
    } catch (err) {
      if (!(err instanceof TypeError)) throw err;
      last = err;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`mock Drupal never came up on ${BASE}: ${String(last)}`);
}

async function assertPortFree(): Promise<void> {
  try {
    await fetch(`${BASE}/health`);
    throw new Error(
      `Port ${PORT} is already serving. Reusing a Drupal we did not seed ` +
        `would test unknown content.`,
    );
  } catch (err) {
    if (err instanceof TypeError) return;
    throw err;
  }
}

const target: Target = {
  name: 'drupal',
  capabilities: [
    'content',
    // JSON:API filter groups match on title OR stored block content without
    // search_api, so this is real search over the document, not a title trick.
    'search-fulltext',
    'search-filter',
    'vocabulary',
    'schema',
    'asset',
    'state',
  ],
  // Assets are media entities, not bare files: a file has no name, no state and
  // no listing, so it is not something an editor can browse or relocate.
  types: { folder: 'page', page: 'page', image: 'image' },
  vocabularies: { categories: 'categories' },
  vocabularySize: seed.vocabularies.categories.generate,
  imageScale: 'large',
  queryIndexes: {
    type: 'node_type',
    path: 'menu_parent',
    title: 'title',
    state: 'status',
    modified: 'changed',
  },
  adapter,

  async start() {
    await assertPortFree();
    proc = spawn('node', ['tests-adapters/fixtures/mock-drupal-api.cjs'], {
      cwd: REPO_ROOT,
      env: { ...process.env, PORT: String(PORT) },
      stdio: 'pipe',
    });
    proc.stderr?.on('data', (d) => process.stderr.write(`[drupal] ${d}`));
    await waitForHealth();
    await adapter.init({ cmsBaseUrl: BASE, emit: () => {} });
  },

  async stop() {
    proc?.kill('SIGTERM');
    proc = null;
  },

  /**
   * The CSRF token is what Drupal checks on every write, so invalidating it
   * reproduces an expired session exactly as a real one would fail.
   */
  async expireSession(onEvent) {
    // Invalidate the CREDENTIALS, not just the CSRF token: an expired Drupal
    // session fails reads as well as writes, and only invalidating the token
    // would leave every GET succeeding — a test that proves nothing.
    adapter.credentials = { username: 'expired', password: 'expired' };
    adapter.csrfToken = 'expired-token';
    await adapter.init({
      cmsBaseUrl: BASE,
      emit: (event, payload) => onEvent(event, payload),
    });
    adapter.credentials = { username: 'expired', password: 'expired' };
    adapter.csrfToken = 'expired-token';
  },

  async fetchAsSession(url: string) {
    return fetch(url, {
      headers: { Authorization: `Basic ${btoa('admin:admin')}` },
    });
  },

  async seed() {
    adapter.credentials = { username: 'admin', password: 'admin' };
    // Must carry the SAME credentials the adapter uses: the mock scopes
    // content per session, so an unauthenticated reset would clear a
    // different world and leave the adapter's own state untouched.
    await fetch(`${BASE}/_reset`, {
      method: 'POST',
      headers: { Authorization: `Basic ${btoa('admin:admin')}` },
    });
    adapter.csrfToken = null;
    await adapter.init({ cmsBaseUrl: BASE, emit: () => {} });
  },
};

export default target;
