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
          { i: target.queryIndexes.path, o: target.queryOps.under, v: '/news' },
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
        { i: target.queryIndexes.path, o: target.queryOps.under, v: '/news' },
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

  it('says what KIND of value each index holds', async () => {
    // The contents view shows indexes as COLUMNS, and how a cell is drawn
    // depends on the kind of value: a date is formatted, a boolean becomes a
    // tick, a list is joined. Volto carried a hard-coded table of PLONE index
    // names to answer that — `Subject` is an array, `ModificationDate` a date —
    // which is CMS knowledge living in the generic admin, and which said
    // nothing at all about any other backend's fields.
    //
    // So each adapter says it. `type` is not inferrable from `operations`:
    // Plone's `Subject` (a list of keywords) and `portal_type` (one token)
    // advertise the same `selection.any`, and a column drawn with the wrong
    // kind renders a list as "abc" with no sign anything is wrong.
    const res: any = await target.adapter.dispatch(
      'querystring.getIndexes',
      {},
    );
    const kinds = ['string', 'date', 'boolean', 'array', 'number'];
    for (const [name, index] of Object.entries<any>(res.indexes)) {
      expect(kinds, `${name} declares a kind of value`).toContain(index.type);
    }
  });

  it('says what each operation is called and which widget draws it', async () => {
    // A criterion is `{i, o, v}`, and the sidebar needs two things before it
    // can draw one: a label for the operation, and WHICH INPUT collects the
    // value. The CMS is the only thing that knows — Plone's /@querystring says
    // it per operation, and the other adapters state it themselves — so the
    // admin reads `operators[o].title` and `operators[o].widget` and derives
    // nothing. An advertised operation with no entry here is what broke the
    // listing sidebar outright: `operators[row.o]` of undefined.
    //
    // The widget names are the shared half of the contract: the inputs this
    // admin can draw (the cases in QueryWidget.getWidget). `null` means the
    // operation takes no value at all — "today", "current logged-in user".
    // Needing an input that is not on this list is the one thing an adapter
    // cannot declare its way out of.
    const WIDGETS = [
      null,
      'StringWidget',
      'DateWidget',
      'DateRangeWidget',
      'RelativeDateWidget',
      'MultipleSelectionWidget',
      'autocomplete',
      'ReferenceWidget',
      'RelativePathWidget',
    ];
    const res: any = await target.adapter.dispatch(
      'querystring.getIndexes',
      {},
    );
    for (const [name, index] of Object.entries<any>(res.indexes)) {
      expect(
        (index.operations ?? []).length,
        `${name} says what can be done with it`,
      ).toBeGreaterThan(0);
      for (const op of index.operations) {
        const operator = index.operators?.[op];
        expect(operator, `${name} describes its operation ${op}`).toBeTruthy();
        expect(operator.title, `${name}/${op} has a label`).toBeTruthy();
        expect(
          WIDGETS,
          `${name}/${op} asks for a widget this admin can draw`,
        ).toContain(operator.widget ?? null);
      }
    }
  });

  it('offers something to choose, wherever it offers a choice', async () => {
    // A selection operation draws a multi-select, and a multi-select has to
    // have something IN it. The choices come from the index: `values` when the
    // list is short enough to send (a handful of types, a handful of states),
    // a `vocabulary` to look up when it is not (every keyword on the site).
    //
    // Declaring the operation and neither of those renders an empty picker:
    // the editor opens the facet, finds nothing to tick, and cannot tell
    // whether the site has no categories or the adapter forgot to say. That is
    // how WordPress's taxonomy and author facets shipped — the operations were
    // right and there was nothing to pick.
    const res: any = await target.adapter.dispatch(
      'querystring.getIndexes',
      {},
    );
    const anyOf = target.queryOps.typeIsAnyOf;
    for (const [name, index] of Object.entries<any>(res.indexes)) {
      if (!(index.operations ?? []).includes(anyOf)) continue;
      expect(
        index.values || index.vocabulary,
        `${name} offers ${anyOf} and so must say what can be chosen`,
      ).toBeTruthy();
    }
  });

  it('accepts every operation it advertises', async () => {
    // Declaring an operation is a promise that a criterion using it can be
    // run. Three of them could not: WordPress advertised date comparisons it
    // turned into a parameter WordPress drops, Strapi advertised relative-date
    // operations no branch executed, and both advertised exclusions that were
    // applied as inclusions — all of them sidebar entries an editor could set
    // and nothing honoured.
    //
    // A plausible value per operation, taken from what the index itself says:
    // its `values`, a term from its `vocabulary`, or a value of its declared
    // `type`. An operation that refuses the value it asked for is the failure.
    const res: any = await target.adapter.dispatch(
      'querystring.getIndexes',
      {},
    );

    const refused: string[] = [];
    for (const [name, index] of Object.entries<any>(res.indexes)) {
      for (const op of index.operations ?? []) {
        const widget = index.operators[op].widget;
        let value: unknown = 'a';
        if (widget === null) value = undefined;
        // A picker's value is a real place: the fixture's /news, which every
        // target seeds. 'a' is a path that does not exist, and a location
        // operation is right to refuse it.
        else if (widget === 'ReferenceWidget') value = '/news';
        else if (widget === 'RelativePathWidget') value = './';
        else if (index.values) value = [Object.keys(index.values)[0]];
        else if (index.vocabulary) {
          const vocab: any = await target.adapter.dispatch('vocabulary.get', {
            name: index.vocabulary,
            limit: 1,
          });
          // A vocabulary that answers nothing is its own failure: the facet
          // would offer an empty type-ahead.
          expect(
            vocab.items.length,
            `${name} points at vocabulary ${index.vocabulary}`,
          ).toBeGreaterThan(0);
          value = [vocab.items[0].token];
        } else if (index.type === 'date') value = '2020-01-01';
        else if (index.type === 'number') value = '1';

        try {
          await target.adapter.dispatch('querystringSearch', {
            query: [{ i: name, o: op, v: value }],
            limit: 5,
          });
        } catch (err: any) {
          // Collected rather than thrown one at a time, so a run names every
          // operation that cannot be applied instead of only the first.
          refused.push(`${name}/${op}: ${err.message}`);
        }
      }
    }
    expect(refused, 'operations advertised but not accepted').toEqual([]);
  });

  it('says which indexes a listing should SHOW by default', async () => {
    // The contents view starts with some columns already chosen. Volto chose
    // them from a hard-coded list of three PLONE index names, which named
    // nothing on any other backend — so a WordPress listing opened with no
    // columns but the title.
    //
    // At least one, because a table of nothing but titles tells an editor
    // less than the CMS knows, and the adapter is the only thing that knows
    // which of its fields are worth a column.
    const res: any = await target.adapter.dispatch(
      'querystring.getIndexes',
      {},
    );
    const columns = Object.entries<any>(res.indexes)
      .filter(([, index]) => index.column)
      .map(([name]) => name);
    expect(columns.length, 'indexes marked as default columns').toBeGreaterThan(
      0,
    );
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
            o: target.queryOps.typeIsAnyOf,
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
            o: target.queryOps.typeIsAnyOf,
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
          o: target.queryOps.typeIsAnyOf,
          v: [target.types.page],
        },
      ],
    });
    expect(res.items.length).toBeGreaterThan(0);
    for (const item of res.items) {
      expect(item.type).toBe(target.types.page);
    }
  });

  it('filters by location, and nothing outside it comes back', async () => {
    // How DEEP a location criterion reaches is the CMS's own: Plone's
    // `string.absolutePath` matches the whole subtree, WordPress's `?parent=`
    // the pages directly under one page, and Drupal's hierarchy is its menu.
    // That difference is not papered over here — each adapter advertises the
    // operation it really has and titles it accordingly ("Absolute path",
    // "Directly under"), so the editor reads what they will get.
    //
    // What every one of them must get right is containment: a location filter
    // that returns something from outside the location is wrong on any CMS.
    const res: any = await target.adapter.dispatch('querystringSearch', {
      query: [
        { i: target.queryIndexes.path, o: target.queryOps.under, v: '/news' },
      ],
    });
    expect(res.items.length).toBeGreaterThan(0);
    for (const item of res.items) {
      expect(item.path.startsWith('/news')).toBe(true);
    }

    // And it is a FILTER, not a passthrough: the fixture has content outside
    // /news, so a query that returned everything would also satisfy a test
    // that only counted what came back.
    const all: any = await target.adapter.dispatch('querystringSearch', {
      query: [],
    });
    expect(
      all.items.length,
      'the fixture has content outside /news to be excluded',
    ).toBeGreaterThan(res.items.length);
  });

  it("answers what a visitor asked a search block for", async () => {
    // The other half of a search block. Its stored criteria come from the
    // sidebar, in this backend's own spelling; what the VISITOR types or ticks
    // has no stored form at all and arrives NAMED — text, a set of values, a
    // date window, a location — because no frontend can know which operation
    // means "contains" here. The adapter turns each into its own operations.
    //
    // This used to be done on the frontend, which wrote PLONE's ids for every
    // backend: a WordPress search block sent `string.contains` and
    // `selection.any`, WordPress ignored both, and the visitor got an
    // unfiltered listing that read as "this is everything we have".
    const all: any = await target.adapter.dispatch('querystringSearch', {
      query: [],
    });

    const byText: any = await target.adapter.dispatch('querystringSearch', {
      query: [],
      text: 'First',
    });
    expect(byText.items.length).toBeGreaterThan(0);
    expect(byText.items.length).toBeLessThan(all.items.length);

    const byValue: any = await target.adapter.dispatch('querystringSearch', {
      query: [],
      filters: [{ i: target.queryIndexes.type, values: [target.types.page] }],
    });
    expect(byValue.items.length).toBeGreaterThan(0);
    for (const item of byValue.items) {
      expect(item.type).toBe(target.types.page);
    }
  });

  it("lists what is IN a page when a listing names no criteria", async () => {
    // An unconfigured listing means "the contents of this page", which is a
    // location question each CMS answers its own way — a path query with a
    // depth in Plone, `?parent=` in WordPress, the menu in Drupal. The
    // frontend used to name Plone's `relativePath` for all of them.
    const res: any = await target.adapter.dispatch('querystringSearch', {
      query: [],
      under: { path: '/news', depth: 1 },
    });

    expect(res.items.length).toBeGreaterThan(0);
    const paths = res.items.map((i: any) => i.path);
    // Its children, and not the page itself: a listing that included its own
    // page would show the reader the page they are standing on.
    expect(paths).not.toContain('/news');
    for (const path of paths) {
      expect(path.startsWith('/news/')).toBe(true);
      expect(
        path.slice('/news/'.length).includes('/'),
        `${path} is deeper than the children`,
      ).toBe(false);
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
        { i: target.queryIndexes.title, o: target.queryOps.titleContains, v: 'First' },
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
          o: target.queryOps.titleContains,
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
          o: target.queryOps.typeIsAnyOf,
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
          o: target.queryOps.typeIsAnyOf,
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
          o: target.queryOps.typeIsAnyOf,
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
        { i: target.queryIndexes.title, o: target.queryOps.titleContains, v: 'post' },
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
          o: target.queryOps.typeIsAnyOf,
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
          o: target.queryOps.typeIsAnyOf,
          v: [target.types.page],
        },
      ],
    });
    const paged: any = await target.adapter.dispatch('querystringSearch', {
      query: [
        {
          i: target.queryIndexes.type,
          o: target.queryOps.typeIsAnyOf,
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
        { i: target.queryIndexes.type, o: target.queryOps.typeIsAnyOf, v: ['NoSuchType'] },
      ],
    });
    expect(res.items).toEqual([]);
    expect(res.total).toBe(0);
  });
});
