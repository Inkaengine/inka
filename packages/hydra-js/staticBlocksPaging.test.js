import { describe, test, expect } from 'vitest';
import { staticBlocks } from '@volto-hydra/helpers';

/**
 * staticBlocks computes the paging UI object listing/grid consumers render from.
 * Its return shape must be STABLE across "has results" and "no results" — a
 * consumer that reads `paging.pages` / `paging.totalPages` should never meet
 * `undefined` (which would throw on `paging.pages.map`). These tests pin that
 * contract (the empty case is the fix from #284).
 */
describe('staticBlocks — paging UI shape is stable whether or not there are results', () => {
  test('no results → a well-formed EMPTY paging object (never undefined fields)', () => {
    const { items, paging } = staticBlocks([]);
    expect(items).toEqual([]);
    // Every UI field is present, so `paging.pages.map(...)` / `totalPages > 1`
    // are safe without a consumer guard.
    expect(paging).toMatchObject({
      currentPage: 0,
      totalPages: 0,
      totalItems: 0,
      pages: [],
      prev: null,
      next: null,
    });
  });

  test('with results → populated paging (currentPage / totalPages / window / next)', () => {
    // 3 items, page size 2 → page 1 of 2, a next page, no prev.
    const { items, paging } = staticBlocks(
      [{ '@uid': 'a' }, { '@uid': 'b' }, { '@uid': 'c' }],
      { paging: { start: 0, size: 2 } },
    );
    expect(items.map((i) => i['@uid'])).toEqual(['a', 'b']);
    expect(paging).toMatchObject({
      currentPage: 0,
      totalPages: 2,
      totalItems: 3,
      prev: null,
      next: 1,
    });
    expect(paging.pages).toEqual([
      { start: 0, page: 1 },
      { start: 2, page: 2 },
    ]);
  });
});
