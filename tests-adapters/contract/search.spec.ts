import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { resolveTarget, type Target } from '../targets';

/**
 * Resolved at module scope so capability gating can happen at describe() time
 * and show up as SKIPPED rather than as a silent pass. A test that quietly
 * returns early looks identical to one that ran.
 */
const resolved = await resolveTarget();

let target: Target;

beforeAll(async () => {
  target = await resolveTarget();
  await target.start();
});

afterAll(async () => {
  await target.stop();
});

beforeEach(async () => {
  await target.seed();
});

/**
 * Every target runs this. The gate stays because the contract allows a CMS
 * without search, but no adapter we ship uses it: Plone has its catalog,
 * WordPress has ?search=, and core Drupal answers with JSON:API filter groups
 * over title and stored block content. A skip here means a real capability
 * gap to close, not a CMS difference to accept.
 */
describe.skipIf(!resolved.capabilities.includes('search-fulltext'))(
  'search',
  () => {
    it('finds a seeded document by its title text', async () => {
      const res: any = await target.adapter.dispatch('search', {
        query: 'First',
      });
      expect(typeof res.total).toBe('number');
      expect(Array.isArray(res.items)).toBe(true);
      expect(res.items.map((i: any) => i.path)).toContain('/news/first-post');
    });

    it('returns canonical Documents, not CMS-shaped brains', async () => {
      const res: any = await target.adapter.dispatch('search', {
        query: 'First',
      });
      const hit = res.items.find((i: any) => i.path === '/news/first-post');
      expect(hit).toBeDefined();
      expect(hit.path).not.toMatch(/^https?:/);
      expect(typeof hit.id).toBe('string');
      // The SAME id the document answers with, not a different name for it.
      //
      // A listing and a read have to agree on identity or nothing can be matched
      // across them — selection, "is this the page I have open", the bridge's
      // block addressing. Plone's catalog only carries UID when the query ASKS
      // for it (metadata_fields), so an adapter that reads raw.UID off a default
      // search gets undefined and falls back to something else, and this is the
      // assertion that notices. Our mock used to hand out every catalog field
      // unasked, which hid it.
      const fetched: any = await target.adapter.dispatch('content.get', {
        path: hit.path,
      });
      expect(hit.id).toBe(fetched.id);
      expect(typeof hit.title).toBe('string');
    });

    it('searches inside a path, and only inside it', async () => {
      // The contents view's filter box is a search scoped to the folder it is
      // listing. Three of the four adapters ignored the scope entirely, so
      // filtering a folder answered with matches from the whole site; the
      // fourth honoured the path but not the depth, so it answered with
      // grandchildren the folder does not contain. Either way the listing
      // quietly stopped being a listing of that folder, and the only symptom
      // was a filter that did not narrow.
      const all: any = await target.adapter.dispatch('search', {
        query: 'First',
      });
      expect(all.items.map((i: any) => i.path)).toContain('/news/first-post');

      // The whole subtree: the grandchild is under /news, so it belongs.
      const under: any = await target.adapter.dispatch('search', {
        query: 'First',
        path: '/news',
      });
      for (const item of under.items) {
        expect(item.path.startsWith('/news/')).toBe(true);
      }
      expect(under.items.map((i: any) => i.path)).toContain(
        '/news/first-post/update',
      );

      // One level: the child, never the grandchild.
      const children: any = await target.adapter.dispatch('search', {
        query: 'First',
        path: '/news',
        depth: 1,
      });
      expect(children.items.map((i: any) => i.path)).toContain(
        '/news/first-post',
      );
      expect(children.items.map((i: any) => i.path)).not.toContain(
        '/news/first-post/update',
      );
    });

    it('returns an empty result set rather than throwing on no match', async () => {
      const res: any = await target.adapter.dispatch('search', {
        query: 'zzzz-no-such-content-zzzz',
      });
      expect(res.items).toEqual([]);
      expect(res.total).toBe(0);
    });
  },
);

describe('tree.list', () => {
  it('lists the children of a folder', async () => {
    const res: any = await target.adapter.dispatch('tree.list', {
      parent: '/news',
    });
    const paths = res.items.map((i: any) => i.path).sort();
    expect(paths).toEqual(['/news/draft-post', '/news/first-post']);
  });

  it('returns an empty list for a leaf', async () => {
    const res: any = await target.adapter.dispatch('tree.list', {
      parent: '/about',
    });
    expect(res.items).toEqual([]);
  });
});

describe('breadcrumbs.get', () => {
  it('returns the ancestor chain root-first, excluding the site root', async () => {
    const res: any = await target.adapter.dispatch('breadcrumbs.get', {
      path: '/news/first-post',
    });
    expect(res.items.map((i: any) => i.path)).toEqual([
      '/news',
      '/news/first-post',
    ]);
  });
});

describe('navigation.get', () => {
  it('returns top-level navigation entries as canonical paths', async () => {
    const res: any = await target.adapter.dispatch('navigation.get', {
      path: '/',
    });
    const paths = res.items.map((i: any) => i.path);
    expect(paths).toContain('/news');
    expect(paths).toContain('/about');
    for (const p of paths) {
      expect(p).not.toMatch(/^https?:/);
    }
  });
});
