import { getChildBlockEntries } from '@volto-hydra/helpers';

/**
 * getChildBlockEntries is the one place that knows the two container STORAGES
 * (blocks_layout list-of-ids vs object_list array-of-objects) are the same thing —
 * an ordered region of child blocks. It normalises both to {id, block} entries so
 * callers (the add-path inheritance, the merge re-entry) never branch on storage.
 */
describe('getChildBlockEntries — uniform child access across blocks_layout & object_list', () => {
  test('blocks_layout: resolves region ids to {id, block} from the shared blocks dict', () => {
    const parent = {
      blocks: { a: { '@type': 'slate', value: 'A' }, b: { '@type': 'slate', value: 'B' } },
      blocks_layout: { columns: ['a', 'b'] },
    };
    expect(getChildBlockEntries(parent, { region: 'columns' })).toEqual([
      { id: 'a', block: { '@type': 'slate', value: 'A' } },
      { id: 'b', block: { '@type': 'slate', value: 'B' } },
    ]);
  });

  test('blocks_layout: region defaults to "items"', () => {
    const parent = { blocks: { a: { '@type': 'slate' } }, blocks_layout: { items: ['a'] } };
    expect(getChildBlockEntries(parent, {}).map((e) => e.id)).toEqual(['a']);
  });

  test('blocks_layout: drops ids with no block in the shared dict (no dangling entries)', () => {
    const parent = { blocks: { a: { '@type': 'slate' } }, blocks_layout: { items: ['a', 'ghost'] } };
    expect(getChildBlockEntries(parent, {}).map((e) => e.id)).toEqual(['a']);
  });

  test('object_list: returns array items as {id: item[idField], block: item}', () => {
    const parent = { slides: [{ '@id': 's1', title: 'One' }, { '@id': 's2', title: 'Two' }] };
    expect(getChildBlockEntries(parent, { isObjectList: true, region: 'slides', idField: '@id' })).toEqual([
      { id: 's1', block: { '@id': 's1', title: 'One' } },
      { id: 's2', block: { '@id': 's2', title: 'Two' } },
    ]);
  });

  test('object_list: reads the array at a nested regionPath (e.g. table/rows)', () => {
    const parent = { table: { rows: [{ '@id': 'r1' }, { '@id': 'r2' }] } };
    expect(
      getChildBlockEntries(parent, { isObjectList: true, regionPath: ['table'], region: 'rows', idField: '@id' }).map((e) => e.id),
    ).toEqual(['r1', 'r2']);
  });

  test('object_list: honours a custom idField', () => {
    const parent = { items: [{ id: 'x' }, { id: 'y' }] };
    expect(
      getChildBlockEntries(parent, { isObjectList: true, region: 'items', idField: 'id' }).map((e) => e.id),
    ).toEqual(['x', 'y']);
  });

  test('object_list: no idField throws — the key is never guessed', () => {
    const parent = { slides: [{ '@id': 's1' }] };
    expect(() => getChildBlockEntries(parent, { isObjectList: true, region: 'slides' })).toThrow(
      /"slides" has no idField/,
    );
  });

  test('empty / missing region → []', () => {
    expect(getChildBlockEntries({ blocks: {}, blocks_layout: {} }, { region: 'nope' })).toEqual([]);
    expect(getChildBlockEntries({}, { isObjectList: true, region: 'slides', idField: '@id' })).toEqual([]);
  });
});
