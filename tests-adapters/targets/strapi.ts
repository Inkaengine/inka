import { StrapiAdapter } from '@volto-hydra/hydra-adapters-strapi';
import type { Target } from './index';
import seed from '../fixtures/seed.json';
import { readFileSync } from 'node:fs';

const PORT = 1337;
const BASE = `http://127.0.0.1:${PORT}`;
const APP = process.env.STRAPI_APP ?? 'tests-adapters/fixtures/strapi-app/app';

/**
 * The token src/index.js writes on boot. Read lazily: global-setup starts Strapi,
 * and the file does not exist until its bootstrap has run.
 */
const token = () => readFileSync(`${APP}/.hydra-api-token`, 'utf8').trim();

const adapter = new StrapiAdapter({ cmsBaseUrl: BASE });

/** An authenticated request, outside the adapter. */
const authed = (path: string, init: RequestInit = {}) =>
  fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${adapter.token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });

/** A VISITOR's request: no Authorization header at all. */
const anon = (path: string) => fetch(`${BASE}${path}`);

async function deleteEverything() {
  const payload = await authed(
    '/api/pages?pagination[pageSize]=200&status=draft',
  ).then((r) => r.json());
  for (const entry of payload?.data ?? []) {
    await authed(`/api/pages/${entry.documentId}`, { method: 'DELETE' });
  }
}

const target: Target = {
  name: 'strapi',
  capabilities: [
    'content',
    'search-filter',
    'schema',
    'asset',
    'reference',
    'vocabulary',
  ],
  // Strapi has no portal types: one collection holds everything the fixture
  // describes, so every canonical type maps to the same collection.
  types: { folder: 'page', page: 'page', image: 'file' },
  // A plain collection, which is Strapi's taxonomy: the name is its route
  // segment, and the fixture's bootstrap seeds it.
  vocabularies: { categories: 'categories' },
  vocabularySize: 10_000,
  // No menu entity, no nav flag, nowhere to put membership. See Target.menus.
  menus: false,
  imageScale: 'thumbnail',
  queryIndexes: {
    type: 'collection',
    path: 'parent',
    title: 'title',
    state: 'publishedAt',
    modified: 'updatedAt',
  },
  adapter,

  async start() {
    adapter.token = token();
    await adapter.init({ cmsBaseUrl: BASE, emit: () => {} });
    adapter.token = token();
    await this.seed();
  },

  async stop() {},

  /**
   * Rebuild the fixture tree.
   *
   * Parents before children, because a child is attached by its parent's
   * documentId and Strapi has no way to express a tree in one write.
   */
  async seed() {
    adapter.token = token();
    await deleteEverything();

    const docs = seed.documents
      .filter((d) => d.path !== '/')
      .sort((a, b) => a.path.split('/').length - b.path.split('/').length);

    const idByPath = new Map<string, string>();
    for (const doc of docs) {
      const segments = doc.path.split('/').filter(Boolean);
      const parentPath = `/${segments.slice(0, -1).join('/')}`;
      const parent = segments.length === 1 ? null : idByPath.get(parentPath);

      const body = {
        data: {
          title: doc.title,
          slug: segments[segments.length - 1],
          ...(parent ? { parent } : {}),
          hydraBlocks: {
            blocks: (doc as any).blocks ?? {},
            blocksLayout: (doc as any).blocksLayout ?? { items: [] },
          },
        },
      };
      // `status=draft` writes the draft version WITHOUT publishing it. A plain
      // POST sets publishedAt immediately, which would make the fixture's
      // draft-post public and silently break the "a visitor cannot read a draft"
      // test.
      const query = doc.state === 'published' ? '' : '?status=draft';
      const res = await authed(`/api/pages${query}`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new Error(
          `Seeding ${doc.path} failed: ${res.status} ${(await res.text()).slice(0, 200)}`,
        );
      }
      idByPath.set(doc.path, (await res.json()).data.documentId);
    }
  },

  async expireSession(onEvent) {
    adapter.token = 'invalid-token';
    await adapter.init({
      cmsBaseUrl: BASE,
      emit: (event, payload) => onEvent(event, payload),
    });
    adapter.token = 'invalid-token';
  },

  async fetchAsSession(url: string) {
    return fetch(url, { headers: { Authorization: `Bearer ${adapter.token}` } });
  },

  async publicBlocks(path: string) {
    // Anonymous, and deliberately NOT asking for status=draft: Strapi serves only
    // published documents to the public role, which is what makes the draft case
    // answer honestly rather than by our filtering.
    const slug = path.split('/').filter(Boolean).pop() ?? '';
    const res = await anon(
      `/api/pages?filters[slug][$eq]=${encodeURIComponent(slug)}`,
    );
    if (!res.ok) return null;
    const entry = (await res.json())?.data?.[0];
    if (!entry) return null;
    return entry.hydraBlocks?.blocks ?? {};
  },

  async publicNavigation() {
    const res = await anon(
      '/api/pages?filters[parent][id][$null]=true&pagination[pageSize]=100',
    );
    if (!res.ok) return null;
    const entries = (await res.json())?.data ?? [];
    return entries.map((entry: any) => ({
      path: `/${entry.slug}`,
      title: entry.title,
    }));
  },

  async publicMenuEntries() {
    // Strapi has NO menu feature — not a tree, not a menu entity, nothing. This
    // is a fact about the CMS rather than an unimplemented adapter, and it is
    // what makes Strapi the sharpest test of whether the contract degrades
    // gracefully. Until the collection view shape lands there is nothing to read.
    return null;
  },
};

export default target;
