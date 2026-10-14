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
 * A sort key the adapter never ADVERTISED is refused.
 *
 * This replaces two tests that asserted the opposite — that each adapter
 * TRANSLATES Plone's index names (`ModificationDate`, `sortable_title`)
 * because Volto's contents view hard-coded them. Their own note said the
 * proper fix was to drive that menu from the advertised indexes, and that is
 * now what happens: the rearrange menu is built from `sortable_indexes`, so
 * the admin sends names this CMS declared.
 *
 * Which makes the translation tables worse than redundant. Inka is generic and
 * is NOT customised per CMS; it is the adapter's job to tell Inka what it can
 * do. An adapter that quietly maps — or quietly substitutes, as WordPress did
 * by falling back to `menu_order` — answers a question nobody asked and hides
 * the fact that the sort did not happen. Refusing says so.
 *
 * `ModificationDate` is foreign to every target here, Plone included: its real
 * sort keys are `modified`, `created`, `effective`, `sortable_title`.
 */
describe('sort keys the adapter did not advertise', () => {
  it('refuses one, rather than translating or ignoring it', async () => {
    await expect(
      target.adapter.dispatch('querystringSearch', {
        query: [
          { i: target.queryIndexes.path, o: 'string.absolutePath', v: '/news' },
        ],
        sortOn: 'ModificationDate',
        sortOrder: 'descending',
      }),
    ).rejects.toThrow(/ModificationDate/);
  });

  it('still sorts by the ones it does advertise', async () => {
    const res: any = await target.adapter.dispatch(
      'querystring.getIndexes',
      {},
    );
    const key = Object.keys(res.sortable_indexes)[0];
    const sorted: any = await target.adapter.dispatch('querystringSearch', {
      query: [
        { i: target.queryIndexes.path, o: 'string.absolutePath', v: '/news' },
      ],
      sortOn: key,
      sortOrder: 'ascending',
    });
    expect(sorted.items.length).toBeGreaterThan(0);
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

  it('names its own sort keys', async () => {
    // `sortable_indexes` is a SEPARATE key in a real @querystring response, and
    // a separate VOCABULARY — not the queryable indexes filtered on a flag.
    // Plone proves it: the index is `Title` while the sort key is
    // `sortable_title`, and `getObjPositionInParent` is a sort key that is no
    // queryable index at all. So a sort menu cannot be derived from `indexes`;
    // the CMS has to say what it can be ordered BY, in its own names.
    //
    // Volto's own consumers read it: `indexChoices` builds the listing block's
    // "sort by" from `state.querystring.sortable_indexes`, and the contents
    // view's rearrange menu has nothing else to drive it from. An adapter that
    // answered only `indexes` left those menus EMPTY on every CMS but Plone,
    // which reads as a CMS that cannot sort rather than an adapter that never
    // said so.
    const res: any = await target.adapter.dispatch(
      'querystring.getIndexes',
      {},
    );
    expect(typeof res.sortable_indexes).toBe('object');
    expect(Object.keys(res.sortable_indexes).length).toBeGreaterThan(0);

    for (const [name, index] of Object.entries<any>(res.sortable_indexes)) {
      expect(typeof name).toBe('string');
      expect(typeof index.title, `${name} title`).toBe('string');
    }
  });

  it('really sorts by every key it advertises', async () => {
    // Advertising a key the CMS cannot order by is worse than advertising
    // none: the menu offers it, the editor picks it, and the order comes back
    // untouched with nothing reporting a problem. That is how the contents
    // view came to offer six hard-coded PLONE index names to every CMS — four
    // of which quietly did nothing on anything but Plone.
    const res: any = await target.adapter.dispatch(
      'querystring.getIndexes',
      {},
    );

    for (const key of Object.keys(res.sortable_indexes)) {
      const up: any = await target.adapter.dispatch('querystringSearch', {
        query: [
          {
            i: target.queryIndexes.type,
            o: 'selection.any',
            v: [target.types.page],
          },
        ],
        sortOn: key,
        sortOrder: 'ascending',
      });
      const down: any = await target.adapter.dispatch('querystringSearch', {
        query: [
          {
            i: target.queryIndexes.type,
            o: 'selection.any',
            v: [target.types.page],
          },
        ],
        sortOn: key,
        sortOrder: 'descending',
      });

      expect(up.items.length, `${key} ascending`).toBeGreaterThan(1);
      const ascending = up.items.map((i: any) => i['@id']);
      const descending = down.items.map((i: any) => i['@id']);
      // Reversed, not merely different: a sort that honours the key but
      // ignores the direction would pass a weaker check.
      expect(descending, `sorting by '${key}'`).toEqual(
        [...ascending].reverse(),
      );
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
