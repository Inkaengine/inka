import { describe, test, expect } from 'vitest';
import { getBlockType, setBlockType, clearBlockType } from '@volto-hydra/helpers';

/**
 * A block's type lives in two places depending on storage: `@type` for blocks_layout, and a
 * `typeField` (e.g. `field_type`) for a typed object_list item — which DELETES `@type`.
 * getBlockType/setBlockType are the one read/write pair so callers never hardcode `@type`
 * (the recurring object_list-vs-blocks_layout asymmetry: dcd3114 taught the read, this is the
 * matching write).
 */
describe('getBlockType / setBlockType — storage-agnostic block type', () => {
  test('getBlockType reads @type (blocks_layout) or the typeField (object_list)', () => {
    expect(getBlockType({ '@type': 'slate' })).toBe('slate');
    expect(getBlockType({ field_type: 'from' }, 'field_type')).toBe('from');
    expect(getBlockType({ '@type': 'empty' }, 'field_type')).toBe('empty'); // @type wins when present
    expect(getBlockType({}, 'field_type')).toBeUndefined();
  });

  test('setBlockType writes @type for blocks_layout (no typeField)', () => {
    expect(setBlockType({ '@type': 'empty', x: 1 }, 'slate')).toEqual({ '@type': 'slate', x: 1 });
  });

  test('setBlockType writes the typeField and DROPS @type for a typed object_list item', () => {
    const r = setBlockType({ '@type': 'empty', x: 1 }, 'from', 'field_type');
    expect(r).toEqual({ x: 1, field_type: 'from' });
    expect(r['@type']).toBeUndefined();
  });

  test('round-trips: setBlockType then getBlockType returns the written type (both storages)', () => {
    const bl = setBlockType({}, 'slate');
    expect(getBlockType(bl)).toBe('slate');
    const ol = setBlockType({}, 'from', 'field_type');
    expect(getBlockType(ol, 'field_type')).toBe('from');
  });

  test('clearBlockType drops @type entirely (single-schema object_list item stores no type)', () => {
    expect(clearBlockType({ '@type': 'slateTable:rows:cells', x: 1 })).toEqual({ x: 1 });
    expect(clearBlockType({ x: 1 })).toEqual({ x: 1 }); // no @type → unchanged
  });
});
