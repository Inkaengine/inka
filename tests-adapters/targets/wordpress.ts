import { WordPressAdapter, serializeBlocks } from '@volto-hydra/hydra-adapters-wordpress';
import { createPublicReader } from '@volto-hydra/hydra-adapters-wordpress/public';
import type { Target } from './index';
import seed from '../fixtures/seed.json';

const PORT = 8790;
const BASE = `http://127.0.0.1:${PORT}`;

let nonce: string | null = null;
let cookie = '';
/**
 * The same jar with WordPress's session removed.
 *
 * A visitor's request cannot simply send no cookies at all: the Playground CLI
 * sets its own cookie on the first request and 302s to the same URL to pick it
 * up, so a client with no cookie jar follows that redirect to itself forever
 * ("redirect count exceeded"). That is the harness's transport, not WordPress
 * auth — so public reads keep it and drop only the login cookies.
 */
let publicCookie = '';

// `locking: true` because the mounted companion plugin exposes WordPress's
// own edit lock over REST. See packages/hydra-adapters-wordpress/companion-plugin.
const adapter = new WordPressAdapter({
  cmsBaseUrl: BASE,
  locking: true,
  multilingual: true,
});

/**
 * WordPress cookie auth is not enough for the REST API on its own, and node's
 * fetch has no cookie jar, so the session is carried by hand: log in once via
 * Playground's auto-login, keep the Set-Cookie values, and mint a nonce.
 */
async function login(): Promise<void> {
  const res = await fetch(`${BASE}/`, { redirect: 'manual' });
  const jar = res.headers.getSetCookie?.() ?? [];
  const pairs = jar.map((c) => c.split(';')[0]);
  cookie = pairs.join('; ');
  // WordPress names every auth/preference cookie with one of these prefixes;
  // anything else in the jar belongs to the Playground server itself.
  const isWordPressSession = (pair: string) =>
    /^(wordpress_|wp-settings)/.test(pair.trimStart());
  publicCookie = pairs.filter((pair) => !isWordPressSession(pair)).join('; ');

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

/**
 * Fill the blueprint's "Primary" menu with the fixture's pages.
 *
 * Runs AFTER the reset, not during start(). The reset's rebuild branch removes
 * pages with wp_delete_post, and WordPress's own `_wp_delete_post_menu_item`
 * hook deletes any menu item pointing at a deleted post — so a menu seeded at
 * startup came back empty the first time a test reset the content, and the
 * public menu read then looked like a CMS limitation rather than a fixture
 * being torn down underneath it.
 *
 * The menu itself is created by the blueprint, because assigning it to a theme
 * location needs set_theme_mod and no REST endpoint offers that — and WPGraphQL
 * only exposes a menu to anonymous callers once it is assigned to one. The ITEMS
 * live here instead: they point at page ids, and putting them in the blueprint
 * would pin them to pages that did not exist yet.
 *
 * Seeded once per boot rather than per reset: the fast reset restores
 * `page`/`attachment` rows under their original ids, so the item -> page links
 * stay valid, and `nav_menu_item` posts are not touched by it.
 *
 * Deliberately NOT the same shape as the page tree — `/news/first-post` is
 * lifted to the top level. A menu that merely mirrored the hierarchy could not
 * tell a real menu read apart from a page-tree read.
 */
async function seedMenu(): Promise<void> {
  const authed = (path: string, init: RequestInit = {}) =>
    originalFetch(`${BASE}${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Cookie: cookie,
        'X-WP-Nonce': nonce!,
        'Content-Type': 'application/json',
      },
    });

  const existingItems = await authed(
    '/?rest_route=/wp/v2/menu-items&per_page=100&status=publish,draft&context=edit',
  ).then((r) => r.json());

  // Rebuild when the menu is not EXACTLY the fixture — not merely when it is
  // empty.
  //
  // "Empty or leave it alone" was wrong: the navigation tests legitimately
  // exclude and rename menu items, the reset's raw SQL does not touch
  // nav_menu_item rows, so a dirtied menu survived into every later test. The
  // public-read tests then read a menu two of whose items had been hidden by a
  // test in another file. A signature comparison costs one request and rebuilds
  // only when something actually changed it.
  const pathOf = (url: string) =>
    url ? new URL(url, BASE).pathname.replace(/\/+$/, '') || '/' : '';
  const urlById = new Map<number, string>(
    (existingItems as any[]).map((i) => [i.id, pathOf(i.url ?? '')]),
  );
  const signature = (existingItems as any[])
    .slice()
    .sort((a, b) => (a.menu_order ?? 0) - (b.menu_order ?? 0))
    .map(
      (i) =>
        `${i.title?.rendered ?? ''}|${pathOf(i.url ?? '')}|` +
        `${i.parent ? (urlById.get(i.parent) ?? '?') : ''}|${i.status}`,
    )
    .join(' ,');

  const menus = await authed('/?rest_route=/wp/v2/menus&per_page=100').then(
    (r) => r.json(),
  );
  const menu = (menus as any[]).find((m) => m.name === 'Primary');
  if (!menu) {
    throw new Error(
      `The blueprint's "Primary" menu is missing; found: ` +
        `${(menus as any[]).map((m) => m.name).join(', ') || 'none'}`,
    );
  }

  // Parents before children, so a parent's id exists when the child needs it.
  const wanted: Array<{ path: string; parent?: string }> = [
    { path: '/news' },
    { path: '/about' },
    { path: '/news/first-post' },
    { path: '/archive', parent: '/about' },
  ];

  const wantedSignature = wanted
    .map(
      (entry) =>
        `${entry.path.split('/').filter(Boolean).pop()}|${entry.path}|` +
        `${entry.parent ?? ''}|publish`,
    )
    .join(' ,');
  if (signature === wantedSignature) return;

  // Something changed it, so start from nothing rather than trying to patch the
  // difference — the fixture is small and this keeps one definition of it.
  for (const item of existingItems as any[]) {
    await authed(`/?rest_route=/wp/v2/menu-items/${item.id}&force=true`, {
      method: 'DELETE',
    });
  }

  const itemIdByPath = new Map<string, number>();

  for (const [index, entry] of wanted.entries()) {
    const slug = entry.path.split('/').filter(Boolean).pop()!;
    const [page] = await authed(
      `/?rest_route=/wp/v2/pages&slug=${encodeURIComponent(slug)}&status=publish,draft`,
    ).then((r) => r.json());
    const pageId = page?.id;
    if (!pageId) {
      throw new Error(`Menu fixture names ${entry.path}, which was not seeded`);
    }
    const res = await authed('/?rest_route=/wp/v2/menu-items', {
      method: 'POST',
      body: JSON.stringify({
        menus: menu.id,
        title: entry.path.split('/').filter(Boolean).pop(),
        type: 'post_type',
        object: 'page',
        object_id: pageId,
        parent: entry.parent ? (itemIdByPath.get(entry.parent) ?? 0) : 0,
        menu_order: index + 1,
        status: 'publish',
      }),
    });
    if (!res.ok) {
      throw new Error(
        `Seeding menu item ${entry.path} failed: ${res.status} ${await res.text()}`,
      );
    }
    itemIdByPath.set(entry.path, (await res.json()).id);
  }
}

/**
 * Give the site two languages, through Polylang's own REST route.
 *
 * Over HTTP, and not from a blueprint step, because Polylang only boots in one of
 * a few CONTEXTS — admin, settings, a REST request, or a frontend request on a
 * site that already HAS languages (Polylang::init_context). A bare PHP script is
 * none of them, so with no languages yet it defines POLYLANG_ACTIVE and stops
 * without ever loading src/api.php or registering its own REST routes: there is
 * no way to create the first language from one. A real REST request is.
 *
 * The language slugs here must match the ones the blueprint assigns menu
 * locations for; the check below is what catches them drifting apart.
 */
async function configureLanguages(): Promise<void> {
  const wanted = [
    { name: 'English', slug: 'en', locale: 'en_US' },
    { name: 'Deutsch', slug: 'de', locale: 'de_DE' },
  ];

  const listed = await originalFetch(`${BASE}/?rest_route=/pll/v1/languages`, {
    headers: { Cookie: cookie, 'X-WP-Nonce': nonce! },
  }).then((r) => r.json());
  const have = new Set(
    (Array.isArray(listed) ? listed : []).map((l: any) => l.slug),
  );

  for (const language of wanted) {
    if (have.has(language.slug)) continue;
    const res = await originalFetch(`${BASE}/?rest_route=/pll/v1/languages`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'X-WP-Nonce': nonce!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(language),
    });
    if (!res.ok) {
      throw new Error(
        `Could not create the ${language.slug} language: ` +
          `${res.status} ${(await res.text()).slice(0, 300)}`,
      );
    }
  }

  const now = await originalFetch(`${BASE}/?rest_route=/pll/v1/languages`, {
    headers: { Cookie: cookie, 'X-WP-Nonce': nonce! },
  }).then((r) => r.json());
  const slugs = (Array.isArray(now) ? now : []).map((l: any) => l.slug);
  for (const language of wanted) {
    if (!slugs.includes(language.slug)) {
      throw new Error(
        `Polylang still has no ${language.slug} language; it reports: ` +
          `${slugs.join(', ') || 'none'}. The blueprint assigns menu locations ` +
          `for en and de, so these have to stay in step.`,
      );
    }
  }
}

/**
 * A request as a visitor: Playground's transport cookie, no WordPress session.
 *
 * fetch-SHAPED on purpose, so it can be handed to the shipped public reader. The
 * cookie is Playground's, not WordPress's — see publicCookie — and it is a
 * property of this harness, which is exactly why the reader takes an injectable
 * fetch instead of knowing about it.
 */
const publicFetch: typeof globalThis.fetch = (input, init = {}) =>
  originalFetch(input, {
    ...init,
    headers: { ...(init.headers ?? {}), Cookie: publicCookie },
  });

const publicReader = createPublicReader({
  cmsBaseUrl: BASE,
  fetch: publicFetch,
});

/**
 * Confirm the blueprint's plugins actually came up.
 *
 * The suite's plugins are MOUNTED into the Playground from `tests-adapters/fixtures/
 * wp-plugins` and activated here, over REST, once WordPress is up.
 *
 * Not a blueprint step. `installPlugin` fetches from wordpress.org and fails
 * SILENTLY under PHP-WASM — you get a healthy WordPress with the plugin simply
 * absent, which is how three probes drew conclusions from an endpoint that was
 * never there. `activatePlugin` is no better: the mount is not in place when
 * blueprint steps run, so there is nothing for it to activate. Activating after
 * boot is ordering-independent, and it throws when the plugin is missing rather
 * than leaving the suite to report a false negative on the CMS.
 */
async function verifyPluginsActive() {
  const list = (await originalFetch(`${BASE}/?rest_route=/wp/v2/plugins`, {
    headers: { Cookie: cookie, 'X-WP-Nonce': nonce! },
  }).then((r) => r.json())) as Array<{ plugin: string; status: string }>;
  for (const slug of [
    'wp-graphql',
    'polylang',
    ...(process.env.WP_BRIDGE === '0' ? [] : ['wp-graphql-polylang']),
  ]) {
    const found = list.find((p) => p.plugin.startsWith(`${slug}/`));
    if (!found || found.status !== 'active') {
      throw new Error(
        `${slug} is not active in the Playground. Plugins are mounted from ` +
          `tests-adapters/fixtures/wp-plugins (run \`pnpm wp:plugins\` to ` +
          `fetch them) and activated by a blueprint step. Installed: ` +
          `${list.map((p) => `${p.plugin}=${p.status}`).join(', ') || 'none'}`,
      );
    }
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
    'locking',
    'multilingual',
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
    await verifyPluginsActive();
    await configureLanguages();
    await seedContent();
    await adapter.init({ cmsBaseUrl: BASE, emit: () => {} });
    adapter.nonce = nonce;

    const terms = await originalFetch(
      `${BASE}/?rest_route=/wp/v2/categories&per_page=1`,
      { headers: { Cookie: cookie, 'X-WP-Nonce': nonce! } },
    );
    // The number GENERATED, from the fixture — the same meaning the Plone and
    // Drupal targets give it, so a contract test can name `Category <n>`.
    //
    // It used to be X-WP-Total, which counts WordPress's pre-existing
    // "Uncategorized" as well, making the count one HIGHER than the largest
    // generated term. `Category ${vocabularySize - 1}` then named a term that
    // did not exist. That went unnoticed only because the vocabulary was read
    // while the blueprint was still inserting: the count was some partial
    // number whose predecessor did happen to exist.
    this.vocabularySize = seed.vocabularies.categories.generate;

    const present = Number(terms.headers.get('X-WP-Total') ?? '0');
    if (present < this.vocabularySize) {
      throw new Error(
        `Only ${present} categories exist but the fixture generates ` +
          `${this.vocabularySize}. The blueprint's vocabulary step did not ` +
          `finish — the suite would measure type-ahead against a partial ` +
          `vocabulary and name terms that do not exist.`,
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


  // Delegated to the SHIPPED public reader, so these tests exercise the code a
  // frontend would import rather than a parallel implementation of it. All the
  // per-CMS knowledge — the blocks carrier, status filtering, the navigation meta
  // fields, the GraphQL menu — lives there, documented.
  // See packages/hydra-adapters-wordpress/publicRead.js.
  async publicBlocks(path: string) {
    return publicReader.blocks(path);
  },

  async publicMenuEntries() {
    const items = await publicReader.menu();
    return items
      ? items.map((i: any) => ({ label: i.label, path: i.path }))
      : null;
  },

  async publicMenu() {
    return publicReader.menu();
  },

  async publicNavigation() {
    return publicReader.navigation();
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

    await seedMenu();

    adapter.pathCache.clear();
    adapter.ancestorCache.clear();
  },
};

export default target;
