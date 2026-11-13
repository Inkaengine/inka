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
      title: { field: 'title', type: 'string' },
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

// A result's address is mapped from `getURL`, not `@id`: Plone reads every
// `@id` in stored block data as a link, so a stored mapping keyed `@id` with a
// `{ field, type }` value crashed the save. One still keyed `@id` is content
// that wasn't migrated: refused, not quietly read.
describe('expandListingBlocks — the result address is getURL', () => {
  const fetchItems = {
    listing: async () => ({
      items: [{ '@id': 'http://site/news/a', title: 'A' }],
      total: 1,
    }),
  };
  const expand = (fieldMapping) =>
    expandListingBlocks(
      [{ '@uid': 'l', '@type': 'listing', variation: 'card', ...(fieldMapping && { fieldMapping }) }],
      { fetchItems, itemTypeField: 'variation' },
    ).then(({ items }) => items[0]);

  it('maps getURL from the result address', async () => {
    const item = await expand({ getURL: { field: 'url', type: 'link' }, title: { field: 'title', type: 'string' } });
    expect(item.url).toEqual([{ '@id': 'http://site/news/a' }]);
  });

  // The editor stores a mapping as soon as a listing's item type is picked;
  // there is no schema here to make one up from.
  it('refuses a listing with no stored mapping', async () => {
    await expect(expand()).rejects.toThrow(/no fieldMapping/);
    await expect(expand({})).rejects.toThrow(/no fieldMapping/);
  });

  it("refuses a mapping keyed '@id', the address's old name", async () => {
    await expect(expand({ '@id': { field: 'href', type: 'link' } })).rejects.toThrow(/getURL/);
  });

  // The renderer has no schema: it converts by what is stored, so an entry
  // that stores no conversion is refused rather than passed through.
  it('refuses a stored entry that carries no conversion', async () => {
    await expect(expand({ title: 'title' })).rejects.toThrow(/title.*conversion/);
  });
});
