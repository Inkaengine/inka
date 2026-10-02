import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PloneAdapter } from '@volto-hydra/hydra-adapters-plone';
import type { Target } from './index';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

// Deliberately not 8888: a developer's mock API is usually already on that
// port, and silently reusing it would make the suite depend on whatever
// content that instance happens to be serving.
const PORT = 8899;
const BASE = `http://localhost:${PORT}`;

let proc: ChildProcess | null = null;
let sessionCounter = 0;

const adapter = new PloneAdapter({ cmsBaseUrl: BASE });

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64').replace(/=/g, '');
}

function mintToken(sub: string, jti: number): string {
  const header = b64url({ alg: 'HS256', typ: 'JWT' });
  const payload = b64url({
    sub,
    jti,
    exp: Math.floor(Date.now() / 1000) + 86_400,
  });
  return `${header}.${payload}.contract-signature`;
}

async function waitForHealth(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
      lastError = new Error(`/health returned ${res.status}`);
    } catch (err) {
      // Connection refused while the server is still binding is the only
      // failure we tolerate here; anything else is recorded and surfaces
      // below rather than being swallowed.
      if (!(err instanceof TypeError)) throw err;
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(
    `mock Plone API did not become healthy on ${BASE}: ${String(lastError)}`,
  );
}

/**
 * Throw if anything is already listening on PORT.
 */
async function assertPortFree(): Promise<void> {
  try {
    const res = await fetch(`${BASE}/health`);
    throw new Error(
      `Port ${PORT} is already serving (status ${res.status}). ` +
        `Stop the stale mock API before running the contract suite — ` +
        `reusing it would test against unknown content.`,
    );
  } catch (err) {
    // ECONNREFUSED surfaces as a TypeError from fetch: that is the good case.
    if (err instanceof TypeError) return;
    throw err;
  }
}

const target: Target = {
  name: 'plone',
  capabilities: [
    'content',
    'search-fulltext',
    'search-filter',
    'vocabulary',
    'schema',
    'asset',
  ],
  types: { folder: 'Document', page: 'Document', image: 'Image' },
  vocabularies: { categories: 'hydra.test.categories' },
  vocabularySize: 10_000,
  imageScale: 'preview',
  queryIndexes: {
    type: 'portal_type',
    path: 'path',
    title: 'Title',
    state: 'review_state',
    modified: 'modified',
  },
  adapter,

  async start() {
    // Refuse to reuse a server we did not start. A stale instance on this port
    // would answer /health and then silently serve someone else's content, so
    // the suite would pass or fail for reasons that have nothing to do with
    // the adapter. Fail loudly instead.
    await assertPortFree();

    proc = spawn('node', ['tests-playwright/fixtures/mock-api-server.cjs'], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        PORT: String(PORT),
        CONTENT_MOUNTS: '/:tests-adapters/fixtures/content',
        // Generate the seed's large vocabularies in-process rather than
        // committing 10 000 JSON objects to the repo.
        VOCAB_SPEC: 'tests-adapters/fixtures/seed.json',
        VOCAB_PREFIX: 'hydra.test.',
      },
      stdio: 'pipe',
    });
    proc.stderr?.on('data', (d) => process.stderr.write(`[mock-api] ${d}`));
    await waitForHealth();
    await this.seed();
  },

  async stop() {
    proc?.kill('SIGTERM');
    proc = null;
  },

  /**
   * The mock keys all mutations off the Bearer token (getSessionId in
   * mock-plone-api.cjs) and serves everything else from disk, so handing the
   * adapter a fresh token IS a full reset — there is nothing to tear down.
   */
  /**
   * The mock treats EXPIRED_TOKEN as a revoked session (see isAuthenticated in
   * mock-plone-api.cjs). Swapping the adapter's token for it reproduces a real
   * mid-edit expiry without stubbing the adapter's own fetch.
   */
  async expireSession(onEvent) {
    adapter.authToken = 'EXPIRED_TOKEN';
    await adapter.init({
      cmsBaseUrl: BASE,
      emit: (event, payload) => onEvent(event, payload),
    });
  },

  async fetchAsSession(url: string) {
    return fetch(url, {
      headers: { Authorization: `Bearer ${adapter.authToken}` },
    });
  },

  async seed() {
    sessionCounter += 1;
    // A JWT-shaped token, because that is what Plone issues and what the
    // adapter reads `sub` out of. The unique jti also makes each test file's
    // token a distinct string, which is what isolates its session in the mock
    // (getSessionId keys on the whole token).
    adapter.authToken = mintToken('admin', sessionCounter);
    await adapter.init({ cmsBaseUrl: BASE, emit: () => {} });
  },
};

export default target;
