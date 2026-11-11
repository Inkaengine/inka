import { describe, expect, it } from 'vitest';

import { expandListingBlocks } from './index.js';

// A listing result's field mapped through `fieldMapping` onto the item it
// becomes. A catalog brain carries `null` for a field the page never set (an
// unpublished page's `effective`); that is no value, like a field it lacks.
describe('expandListingBlocks — a result field that is null', () => {
  const listing = {
    '@uid': 'listing-1',
    '@type': 'listing',
    variation: 'item',
    fieldMapping: {
      title: 'title',
      effective: { field: 'date', type: 'string' },
    },
  };
  const fetchItems = {
    listing: async () => ({
      items: [
        { title: 'Published', effective: '2016-06-27T10:29:44+00:00' },
        { title: 'Never published', effective: null },
      ],
      total: 2,
    }),
  };

  it('leaves the mapped field unset, not the text "null"', async () => {
    const { items } = await expandListingBlocks([listing], {
      fetchItems,
      itemTypeField: 'variation',
    });
    expect(items.map((i) => i.title)).toEqual(['Published', 'Never published']);
    expect(items[0].date).toBe('2016-06-27T10:29:44+00:00');
    expect(items[1]).not.toHaveProperty('date');
  });
});

// A listing whose fetch fails is a failure, not an empty listing: drawn as "no
// results" it hides a broken API or a bad query from everyone who could fix it.
describe('expandListingBlocks — a listing whose fetch fails', () => {
  const listing = { '@uid': 'listing-1', '@type': 'listing', variation: 'item' };

  it('fails with the fetch error, rather than listing nothing', async () => {
    const fetchItems = {
      listing: async () => {
        throw new Error('http://api/@querystring-search answered 500: boom');
      },
    };
    await expect(
      expandListingBlocks([listing], { fetchItems, itemTypeField: 'variation' }),
    ).rejects.toThrow(/answered 500: boom/);
  });
});
