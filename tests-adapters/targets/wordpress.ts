import { WordPressAdapter , serializeBlocks, parseBlocks } from '@volto-hydra/hydra-adapters-wordpress';
import type { Target } from './index';
import seed from '../fixtures/seed.json';

const PORT = 8790;
const BASE = `http://127.0.0.1:${PORT}`;

let nonce: string | null = null;
let cookie = '';

const adapter = new WordPressAdapter({ cmsBaseUrl: BASE });

/**
 * WordPress cookie auth is not enough for the REST API on its own, and node's
 * fetch has no cookie jar, so the session is carried by hand: log in once via
 * Playground's auto-login, keep the Set-Cookie values, and mint a nonce.
 */
async function login(): Promise<void> {
  const res = await fetch(`${BASE}/`, { redirect: 'manual' });
  const jar = res.headers.getSetCookie?.() ?? [];
  cookie = jar.map((c) => c.split(';')[0]).join('; ');

  const nonceRes = await fetch(
    `${BASE}/wp-admin/admin-ajax.php?action=rest-nonce`,
    { headers: { Cookie: cookie } },
  );
  nonce = (await nonceRes.text()).trim();
  if (!nonce) throw new Error('WordPress did not issue a REST nonce');
}

// The adapter runs in a browser where credentials ride on the cookie jar.
// Under node there isn't one, so the session headers are injected here rather
// than teaching the adapter about a test-only concern.
const originalFetch = globalThis.fetch;
function installSessionFetch(): void {
  globalThis.fetch = ((input: any, init: any = {}) => {
    const url = String(typeof input === 'string' ? input : input.url);
    if (!url.startsWith(BASE)) return originalFetch(input, init);
    return originalFetch(input, {
      ...init,
      headers: { ...(init.headers ?? {}), Cookie: cookie },
    });
  }) as typeof fetch;
}

async function waitForReady(timeoutMs = 180_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/`, { redirect: 'manual' });
      if (res.status < 500) return;
      last = new Error(`status ${res.status}`);
    } catch (err) {
      if (!(err instanceof TypeError)) throw err;
      last = err;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`WordPress Playground never came up on ${BASE}: ${last}`);
}

/** Create the seed tree as WordPress pages, parent before child. */
async function seedContent(): Promise<void> {
  const idByPath = new Map<string, number>();
  const docs = seed.documents
    .filter((d) => d.path !== '/')
    .sort((a, b) => a.path.split('/').length - b.path.split('/').length);

  for (const doc of docs) {
    const segments = doc.path.split('/').filter(Boolean);
    const parentPath = '/' + segments.slice(0, -1).join('/');
    const parent = segments.length === 1 ? 0 : (idByPath.get(parentPath) ?? 0);

    const res = await fetch(
      `${BASE}/?rest_route=/wp/v2/pages`,
      {
        method: 'POST',
        headers: {
          Cookie: cookie,
          'X-WP-Nonce': nonce!,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: doc.title,
          slug: segments[segments.length - 1],
          parent,
          status: doc.state === 'published' ? 'publish' : 'draft',
          content:
            serializeBlocks(
              (doc as any).blocks ?? {},
              (doc as any).blocksLayout ?? { items: [] },
            ),
        }),
      },
    );
    if (!res.ok) {
      throw new Error(
        `Seeding ${doc.path} failed: ${res.status} ${await res.text()}`,
      );
    }
    idByPath.set(doc.path, (await res.json()).id);
  }
}

const target: Target = {
  name: 'wordpress',
  capabilities: [
    'content',
    'search-fulltext',
    'search-filter',
    'vocabulary',
    'schema',
    'asset',
    'state',
  ],
  types: { folder: 'page', page: 'page', image: 'attachment' },
  vocabularies: { categories: 'categories' },
  // Filled in at start() from what the blueprint actually created — PHP
  // execution limits decide, not us.
  vocabularySize: 0,
  imageScale: 'medium',
  queryIndexes: {
    type: 'post_type',
    path: 'parent',
    title: 'title',
    state: 'status',
    modified: 'modified',
  },
  adapter,

  async start() {
    // The server is owned by global-setup.ts for the whole run — booting one
    // per spec file would cost ~40s each and collide on the port.
    await waitForReady();
    await login();
    installSessionFetch();
    await seedContent();
    await adapter.init({ cmsBaseUrl: BASE, emit: () => {} });
    adapter.nonce = nonce;

    const terms = await originalFetch(
      `${BASE}/?rest_route=/wp/v2/categories&per_page=1`,
      { headers: { Cookie: cookie, 'X-WP-Nonce': nonce! } },
    );
    this.vocabularySize = Number(terms.headers.get('X-WP-Total') ?? '0');
    if (this.vocabularySize < 100) {
      throw new Error(
        `Only ${this.vocabularySize} categories seeded; the type-ahead ` +
          `assertion needs a vocabulary large enough to be meaningful.`,
      );
    }
  },

  async stop() {
    globalThis.fetch = originalFetch;
  },

  async expireSession(onEvent) {
    adapter.nonce = 'invalid-nonce';
    await adapter.init({
      cmsBaseUrl: BASE,
      emit: (event, payload) => onEvent(event, payload),
    });
    adapter.nonce = 'invalid-nonce';
  },

  async fetchAsSession(url: string) {
    return originalFetch(url, {
      headers: { Cookie: cookie, 'X-WP-Nonce': nonce! },
    });
  },

  /**
   * WordPress has no per-session content isolation, so a reset means deleting
   * what the previous file left behind and re-seeding.
   */
  /**
   * Reset in ONE request.
   *
   * This runs before every test to keep them isolated. Doing it over REST cost
   * a listing, a DELETE per existing page and a POST per fixture — about
   * thirteen sequential round trips against single-threaded PHP-WASM, ~10s,
   * times sixty-odd tests. That was where the seventeen-minute run went; no
   * adapter change moved it, because none of it was adapter work.
   *
   * The documents still come from seed.json and travel in the body, so the
   * blueprint's PHP never becomes a second definition of the fixture.
   */
  async publicBlocks(path: string) {
    // No cookie, no nonce: a visitor's request. `context=edit` is deliberately
    // NOT passed — asking for it is what requires a session, and the whole
    // question is what is readable without one.
    const slug = path.split('/').filter(Boolean).pop() ?? '';
    const res = await fetch(
      `${BASE}/?rest_route=/wp/v2/pages&slug=${encodeURIComponent(slug)}&status=publish`,
    );
    if (!res.ok) return null;
    const [post]: any[] = await res.json();
    if (!post) return null; // not readable by an anonymous client
    // Whatever a public client can see, read with the adapter's own parser —
    // so this tests the real carrier rather than a second guess at the format.
    const rendered: string = post.content?.rendered ?? '';
    try {
      return parseBlocks(rendered).blocks ?? {};
    } catch {
      return {};
    }
  },

  async seed() {
    // Put the SESSION back too, not just the content.
    //
    // expireSession poisons adapter.nonce on purpose, to prove a CMS 401 becomes
    // UNAUTHORIZED. Nothing restored it, so every test after that one in the file
    // ran with a dead session — auth.logout's own whoami then failed before it
    // had signed out of anything. It went unnoticed because the CI step piped
    // vitest through tee and reported tee's exit status.
    adapter.nonce = nonce;

    const documents = seed.documents
      .filter((d) => d.path !== '/')
      .sort((a, b) => a.path.split('/').length - b.path.split('/').length)
      .map((doc) => ({
        path: doc.path,
        title: doc.title,
        state: doc.state,
        content: serializeBlocks(
          (doc as any).blocks ?? {},
          (doc as any).blocksLayout ?? { items: [] },
        ),
      }));

    const res = await originalFetch(
      `${BASE}/?rest_route=/hydra-test/v1/reset`,
      {
        method: 'POST',
        headers: {
          Cookie: cookie,
          'X-WP-Nonce': nonce!,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ documents }),
      },
    );
    if (!res.ok) {
      throw new Error(`Reset failed: ${res.status} ${await res.text()}`);
    }

    adapter.pathCache.clear();
    adapter.ancestorCache.clear();
  },
};

export default target;
