import { expandListingBlocks } from '@volto-hydra/helpers';

/**
 * A grid (or any container) pages ALL its children as ONE combined window, so a
 * MANUAL (static) block placed AFTER a listing lands on whatever page the
 * listing's item count pushes it to — the case block-sanity's grid/listing
 * fixture exercises (reveal must page PAST the listing to find the manual block).
 *
 * expandListingBlocks already does this in a single pass: it fetches each listing
 * and, for a non-listing child, windows it inline against the running position
 * (helpers/index.js — the `globalPos += 1` branch). So a frontend renders a grid
 * by handing the WHOLE layout to expandListingBlocks, not by paging static and
 * listing children separately. This test pins that: the manual block is OFF page
 * one and only appears once you page to where the listing's items end.
 */
describe('combined container paging — a manual block AFTER a listing', () => {
  // A listing that reports `total` items and returns the requested window.
  const fetchItemsFor = (total) => ({
    listing: async (_block, { start, size }) => ({
      items: Array.from(
        { length: Math.max(0, Math.min(size, total - start)) },
        (_unused, i) => ({ '@id': `/item-${start + i}`, title: `Item ${start + i}` }),
      ),
      total,
    }),
  });

  const blocks = {
    l1: { '@type': 'listing', variation: 'default', querystring: { query: [{ i: 'path' }] } },
    s1: {
      '@type': 'slate',
      value: [{ type: 'p', children: [{ text: 'manual after listing' }] }],
    },
  };
  const layout = ['l1', 's1']; // listing THEN manual block

  const LISTING_TOTAL = 7; // fills page 1 (size 6) and spills item 7 to page 2

  test('page 1: only listing items render; the manual block is off-page', async () => {
    const { items, paging } = await expandListingBlocks(layout, {
      blocks,
      fetchItems: fetchItemsFor(LISTING_TOTAL),
      paging: { start: 0, size: 6 },
      itemTypeField: 'variation',
    });
    // 7 listing items + 1 manual block are counted as one combined window.
    expect(paging.totalItems).toBe(LISTING_TOTAL + 1);
    expect(paging.totalPages).toBe(2);
    // The manual block is item #8 → not on page one.
    expect(items.some((it) => it['@uid'] === 's1')).toBe(false);
  });

  test('page 2: the manual block appears after the listing spillover', async () => {
    const { items, paging } = await expandListingBlocks(layout, {
      blocks,
      fetchItems: fetchItemsFor(LISTING_TOTAL),
      paging: { start: 6, size: 6 },
      itemTypeField: 'variation',
    });
    expect(paging.totalPages).toBe(2);
    const manual = items.find((it) => it['@uid'] === 's1');
    expect(manual).toBeTruthy(); // reachable only by paging past the listing
    expect(manual['@type']).toBe('slate');
  });

  test('a pure-static container (no listing) pages the same way through the same call', async () => {
    const staticBlocksDict = Object.fromEntries(
      Array.from({ length: 8 }, (_unused, i) => [
        `c${i}`,
        { '@type': 'slate', value: [{ type: 'p', children: [{ text: `card ${i}` }] }] },
      ]),
    );
    const { items, paging } = await expandListingBlocks(Object.keys(staticBlocksDict), {
      blocks: staticBlocksDict,
      fetchItems: fetchItemsFor(0), // no listing children match; all windowed as static
      paging: { start: 0, size: 6 },
      itemTypeField: 'variation',
    });
    expect(paging.totalItems).toBe(8);
    expect(paging.totalPages).toBe(2);
    expect(items).toHaveLength(6); // page 1 of an 8-card static grid
  });
});
