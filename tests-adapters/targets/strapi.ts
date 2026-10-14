import { StrapiAdapter } from '@volto-hydra/hydra-adapters-strapi';
import type { Target } from './index';
import { seedStrapi } from '../fixtures/seed-strapi';
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


const target: Target = {
  name: 'strapi',
  capabilities: [
    'content',
    'search-filter',
    'schema',
    'asset',
    'reference',
    'vocabulary',
    'state',
    'search-fulltext',
  ],
  // Strapi has no portal types: one collection holds everything the fixture
  // describes, so every canonical type maps to the same collection.
  types: { folder: 'page', page: 'page', image: 'file' },
  // A plain collection, which is Strapi's taxonomy: the name is its route
  // segment, and the fixture's bootstrap seeds it.
  vocabularies: { categories: 'categories' },
  vocabularySize: 10_000,
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
    // One implementation, shared with the journey. See seed-strapi.ts.
    await seedStrapi({ baseUrl: BASE, token: adapter.token });
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
    // Strapi's menu IS its one hierarchy, as in Plone — so a visitor reads the
    // top of the tree, honouring excludeFromNav. Deliberately NOT asking the
    // adapter: the point of this read is that the edit reached the CMS, not
    // that the adapter agrees with itself.
    //
    // The $or is load-bearing: a row whose excludeFromNav was never written
    // holds NULL, and `$ne true` in SQL drops NULLs — which would hide every
    // untouched page from the menu. Unset means not excluded.
    const res = await anon(
      '/api/pages?filters[parent][id][$null]=true' +
        '&filters[$or][0][excludeFromNav][$null]=true' +
        '&filters[$or][1][excludeFromNav][$eq]=false' +
        '&pagination[pageSize]=100',
    );
    if (!res.ok) return null;
    const entries = (await res.json())?.data ?? [];
    return entries.map((entry: any) => ({
      label: entry.title,
      path: `/${entry.slug}`,
    }));
  },
};

export default target;
