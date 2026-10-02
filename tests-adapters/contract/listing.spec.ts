import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { resolveTarget, type Target } from '../targets';

let target: Target;

beforeAll(async () => {
  target = await resolveTarget();
  await target.start();
}, 240_000);

afterAll(async () => {
  await target.stop();
});

beforeEach(async () => {
  await target.seed();
});

/**
 * Listings.
 *
 * Measured over a real editing session, the query-index endpoint is the second
 * busiest call after schema — every listing, search and teaser block consults
 * it. It is also the surface most likely to be quietly Plone-shaped, because
 * Plone's querystring DSL is idiosyncratic and it is tempting to pass it
 * straight through.
 */

/**
 * Sorting by the index names the ADMIN actually sends.
 *
 * Volto's contents view offers sorting from a hard-coded list of PLONE index
 * names — ModificationDate, sortable_title and friends — rather than from
 * querystring.getIndexes, which is what its own query builder uses and what
 * every adapter answers with its real indexes. So `ModificationDate` arrives
 * at a WordPress adapter that knows only `modified`, and at a Drupal one that
 * knows only `changed`.
 *
 * Each adapter translates the six as an interim measure; the proper fix is to
 * drive that menu from the advertised indexes. Tested HERE rather than through
 * the contents UI because this is a claim about the adapter, and driving
 * Volto's sort popup tests the popup.
 */
describe('sorting by the admin\'s index names', () => {
  it('orders by modification date under Plone\'s name for it', async () => {
    const descending: any = await target.adapter.dispatch('querystringSearch', {
      query: [
        { i: target.queryIndexes.path, o: 'string.absolutePath', v: '/news' },
      ],
      // The name the ADMIN sends, not the one this CMS uses.
      sortOn: 'ModificationDate',
      sortOrder: 'descending',
    });
    const ascending: any = await target.adapter.dispatch('querystringSearch', {
      query: [
        { i: target.queryIndexes.path, o: 'string.absolutePath', v: '/news' },
      ],
      sortOn: 'ModificationDate',
      sortOrder: 'ascending',
    });

    const down = descending.items.map((i: any) => i.path);
    const up = ascending.items.map((i: any) => i.path);
    expect(down.length).toBeGreaterThan(1);

    // Reversed, not merely different: an index name the CMS does not
    // understand is typically ignored, and then both orders come back
    // identical — which is exactly what happened before the translation.
    expect(down).toEqual([...up].reverse());
  });

  it('orders by title under Plone\'s name for it', async () => {
    const ascending: any = await target.adapter.dispatch('querystringSearch', {
      query: [
        { i: target.queryIndexes.path, o: 'string.absolutePath', v: '/news' },
      ],
      sortOn: 'sortable_title',
      sortOrder: 'ascending',
    });
    const descending: any = await target.adapter.dispatch('querystringSearch', {
      query: [
        { i: target.queryIndexes.path, o: 'string.absolutePath', v: '/news' },
      ],
      sortOn: 'sortable_title',
      sortOrder: 'descending',
    });

    const up = ascending.items.map((i: any) => i.title);
    const down = descending.items.map((i: any) => i.title);
    expect(up.length).toBeGreaterThan(1);

    // Sorted by TITLE, and reversed. Checking it is actually alphabetical
    // catches an adapter that reverses a list it never ordered.
    expect(up).toEqual([...up].sort((a: string, b: string) => a.localeCompare(b)));
    expect(down).toEqual([...up].reverse());
  });
});

describe('querystring.getIndexes', () => {
  it('describes each queryable index', async () => {
    const res: any = await target.adapter.dispatch(
      'querystring.getIndexes',
      {},
    );
    expect(typeof res.indexes).toBe('object');
    expect(Object.keys(res.indexes).length).toBeGreaterThan(0);

    for (const [name, index] of Object.entries<any>(res.indexes)) {
      expect(typeof name).toBe('string');
      expect(typeof index.title).toBe('string');
      expect(typeof index.enabled).toBe('boolean');
      expect(typeof index.sortable).toBe('boolean');
      expect(Array.isArray(index.operations)).toBe(true);
    }
  });

  it('offers the indexes the target says it supports', async () => {
    const res: any = await target.adapter.dispatch(
      'querystring.getIndexes',
      {},
    );
    for (const index of Object.values(target.queryIndexes)) {
      expect(Object.keys(res.indexes)).toContain(index);
    }
  });
});

describe('querystringSearch', () => {
  it('filters by content type', async () => {
    const res: any = await target.adapter.dispatch('querystringSearch', {
      query: [
        {
          i: target.queryIndexes.type,
          o: 'selection.any',
          v: [target.types.page],
        },
      ],
    });
    expect(res.items.length).toBeGreaterThan(0);
    for (const item of res.items) {
      expect(item.type).toBe(target.types.page);
    }
  });

  it('filters by path, returning only the subtree', async () => {
    const res: any = await target.adapter.dispatch('querystringSearch', {
      query: [
        { i: target.queryIndexes.path, o: 'string.absolutePath', v: '/news' },
      ],
    });
    expect(res.items.length).toBeGreaterThan(0);
    for (const item of res.items) {
      expect(item.path.startsWith('/news')).toBe(true);
    }
  });

  it('filters by title substring', async () => {
    // Every adapter advertises a contains-style operation on title, and the
    // query builder offers it, but nothing exercised it. Drupal's shorthand
    // filter[title][operator]=CONTAINS was silently downgraded to an equality
    // match by a mock that ignored the operator; the CMS and the fixture
    // disagreed and no test could tell.
    const res: any = await target.adapter.dispatch('querystringSearch', {
      query: [
        { i: target.queryIndexes.title, o: 'string.contains', v: 'First' },
      ],
    });
    expect(res.items.length).toBeGreaterThan(0);
    expect(res.items.map((i: any) => i.path)).toContain('/news/first-post');

    // Prove the filter was APPLIED, not ignored. WordPress has no title query
    // param, so setting one returns the whole collection — which satisfies the
    // assertions above and looks like a working filter. Only a query that must
    // match nothing can tell the two apart.
    const none: any = await target.adapter.dispatch('querystringSearch', {
      query: [
        {
          i: target.queryIndexes.title,
          o: 'string.contains',
          v: 'zzzz-no-such-title-zzzz',
        },
      ],
    });
    expect(none.items).toEqual([]);
  });

  it('filters by a multi-value selection', async () => {
    // selection.any means "any of these", and most indexes advertise it. Drupal
    // was emitting filter[x]=a,b — a single equality against the literal "a,b",
    // which matches nothing — because no test ever passed more than one value.
    const res: any = await target.adapter.dispatch('querystringSearch', {
      query: [
        {
          i: target.queryIndexes.type,
          o: 'selection.any',
          v: [target.types.page, target.types.folder],
        },
      ],
    });
    expect(res.items.length).toBeGreaterThan(0);
    for (const item of res.items) {
      expect([target.types.page, target.types.folder]).toContain(item.type);
    }
  });

  it('offers a sortable last-edited index', async () => {
    // The listing block's "most recently edited first" is only offerable if the
    // index EXISTS and says it is sortable. Drupal advertised no such index at
    // all, so the query builder could not present the ordering — the sort was
    // not merely broken, it was absent.
    const res: any = await target.adapter.dispatch('querystring.getIndexes', {});
    const index = res.indexes[target.queryIndexes.modified];
    expect(index, `${target.queryIndexes.modified} index`).toBeDefined();
    expect(index.sortable).toBe(true);
  });

  it('sorts by last edited, most recent first', async () => {
    const res: any = await target.adapter.dispatch('querystringSearch', {
      query: [
        {
          i: target.queryIndexes.type,
          o: 'selection.any',
          v: [target.types.page],
        },
      ],
      sortOn: target.queryIndexes.modified,
      sortOrder: 'descending',
    });
    expect(res.items.length).toBeGreaterThan(1);

    // Assert the ORDER, not just that results came back. Drupal ignored the
    // sort parameter entirely, which an unordered assertion would have passed.
    const seen = res.items.map((i: any) => i.path);
    const reversed: any = await target.adapter.dispatch('querystringSearch', {
      query: [
        {
          i: target.queryIndexes.type,
          o: 'selection.any',
          v: [target.types.page],
        },
      ],
      sortOn: target.queryIndexes.modified,
      sortOrder: 'ascending',
    });
    expect(reversed.items.map((i: any) => i.path)).toEqual([...seen].reverse());
  });

  it('filters by keyword AND sorts in one query', async () => {
    // What the listing block actually does: narrow, then order. Exercised
    // together because an adapter can honour either alone and drop the other
    // when both are present.
    const res: any = await target.adapter.dispatch('querystringSearch', {
      query: [
        { i: target.queryIndexes.title, o: 'string.contains', v: 'post' },
      ],
      sortOn: target.queryIndexes.modified,
      sortOrder: 'descending',
    });
    expect(res.items.length).toBeGreaterThan(0);
    for (const item of res.items) {
      expect(item.path).toMatch(/post/i);
    }
  });

  it('returns canonical Documents, not CMS-shaped brains', async () => {
    const res: any = await target.adapter.dispatch('querystringSearch', {
      query: [
        {
          i: target.queryIndexes.type,
          o: 'selection.any',
          v: [target.types.page],
        },
      ],
    });
    for (const item of res.items) {
      expect(item.path.startsWith('/')).toBe(true);
      expect(item.path).not.toMatch(/^https?:/);
      expect(typeof item.id).toBe('string');
    }
  });

  it('limits the page without misreporting the total', async () => {
    const all: any = await target.adapter.dispatch('querystringSearch', {
      query: [
        {
          i: target.queryIndexes.type,
          o: 'selection.any',
          v: [target.types.page],
        },
      ],
    });
    const paged: any = await target.adapter.dispatch('querystringSearch', {
      query: [
        {
          i: target.queryIndexes.type,
          o: 'selection.any',
          v: [target.types.page],
        },
      ],
      limit: 1,
    });

    expect(paged.items.length).toBe(1);
    // A listing block renders "showing 1 of N"; reporting the page size as
    // the total makes every listing claim it is complete when it is not.
    expect(paged.total).toBe(all.total);
  });

  it('returns an empty result set rather than throwing on no match', async () => {
    const res: any = await target.adapter.dispatch('querystringSearch', {
      query: [
        { i: target.queryIndexes.type, o: 'selection.any', v: ['NoSuchType'] },
      ],
    });
    expect(res.items).toEqual([]);
    expect(res.total).toBe(0);
  });
});
