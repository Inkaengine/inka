import { expandListingBlocks } from '@volto-hydra/helpers';

/**
 * A listing whose query returns nothing has no results to draw. While editing,
 * the author still needs something with the listing's uid to click — to select
 * the listing and fix its query — so expandListingBlocks emits ONE placeholder
 * item for it: `@type: 'empty'` (which frontends already draw as a clickable box
 * in any container) carrying the listing's own uid. Published, nothing: a
 * visitor sees no "no results" box.
 */
describe('a listing with no results', () => {
  const blocks = {
    l1: { '@type': 'listing', variation: 'summary', querystring: { query: [{ i: 'SearchableText' }] } },
  };
  const noResults = { listing: async () => ({ items: [], total: 0 }) };
  const expand = () => expandListingBlocks(['l1'], {
    blocks, fetchItems: noResults, paging: { start: 0, size: 6 }, itemTypeField: 'variation',
  });

  // These tests run in Node: the edit-mode check reads window.name/location only.
  const editing = (on) => {
    globalThis.window = { name: on ? 'hydra-edit:test' : '', location: { href: 'http://site.test/page' } };
  };
  afterEach(() => { delete globalThis.window; });

  test('while editing, yields one empty placeholder carrying the listing uid', async () => {
    editing(true);
    const { items, paging } = await expand();
    expect(items).toEqual([{ '@uid': 'l1', '@type': 'empty', readOnly: true }]);
    // The placeholder is not a result: paging still counts none.
    expect(paging.total).toBe(0);
  });

  test('while editing, a listing after static blocks in the same window still gets one', async () => {
    // A static block first makes the listing's (empty) results an [] rather than
    // unset, which once took the "has results" branch and emitted nothing.
    editing(true);
    const { items } = await expandListingBlocks(['s1', 'l1'], {
      blocks: { ...blocks, s1: { '@type': 'slate', value: [{ type: 'p', children: [{ text: 'x' }] }] } },
      fetchItems: noResults,
      paging: { start: 0, size: 6 },
      itemTypeField: 'variation',
    });
    expect(items.map((i) => [i['@uid'], i['@type']])).toEqual([['s1', 'slate'], ['l1', 'empty']]);
  });

  test('published, yields nothing', async () => {
    editing(false);
    const { items } = await expand();
    expect(items).toEqual([]);
  });

  test('a listing WITH results gets no placeholder, even while editing', async () => {
    editing(true);
    const { items } = await expandListingBlocks(['l1'], {
      blocks,
      fetchItems: { listing: async () => ({ items: [{ '@id': '/a', title: 'A' }], total: 1 }) },
      paging: { start: 0, size: 6 },
      itemTypeField: 'variation',
    });
    expect(items.map((i) => i['@type'])).toEqual(['summary']);
  });
});
