import { getChildBlockEntries, setChildBlockEntries } from './index.js';
import { buildBlockPathMap } from './buildBlockPathMap.js';

/**
 * A blocks_layout region can live INSIDE a widget:'object' wrapper (#245): the
 * object holds its OWN `blocks` dict + `blocks_layout`, one level deeper than the
 * block root (e.g. block.table.blocks / block.table.blocks_layout.body). The
 * funnel navigates there via `regionPath` (the object-path prefix), the same
 * field object_list uses (its array is at [...regionPath, region]). regionPath
 * omitted / [] means the region lives directly on the parent block (the
 * ordinary case).
 */
describe('blocks_layout nested in a widget:object (regionPath)', () => {
  const nested = () => ({
    '@type': 'objectBlocks',
    table: {
      hideHeaders: true,
      blocks: {
        b1: { '@type': 'slate', value: 'One' },
        b2: { '@type': 'slate', value: 'Two' },
      },
      blocks_layout: { body: ['b1', 'b2'] },
    },
  });

  test('read: getChildBlockEntries resolves ids from the object-nested blocks dict', () => {
    expect(
      getChildBlockEntries(nested(), { region: 'body', regionPath: ['table'] }),
    ).toEqual([
      { id: 'b1', block: { '@type': 'slate', value: 'One' } },
      { id: 'b2', block: { '@type': 'slate', value: 'Two' } },
    ]);
  });

  test('write: setChildBlockEntries writes into the object, preserving sibling object keys', () => {
    const parent = nested();
    setChildBlockEntries(
      parent,
      { region: 'body', regionPath: ['table'] },
      [
        { id: 'b2', block: { '@type': 'slate', value: 'Two' } },
        { id: 'b3', block: { '@type': 'image' } },
      ],
    );
    // Ordering updated inside the object's own blocks_layout.
    expect(parent.table.blocks_layout.body).toEqual(['b2', 'b3']);
    // New block added to the object's own blocks dict.
    expect(parent.table.blocks.b3).toEqual({ '@type': 'image' });
    // Sibling object field untouched; nothing leaked to the block root.
    expect(parent.table.hideHeaders).toBe(true);
    expect(parent.blocks).toBeUndefined();
    expect(parent.blocks_layout).toBeUndefined();
  });

  test('write: preserves a sibling region inside the same object', () => {
    const parent = {
      '@type': 'objectBlocks',
      table: {
        blocks: { a: { '@type': 'slate' }, z: { '@type': 'slate' } },
        blocks_layout: { header: ['z'], body: ['a'] },
      },
    };
    setChildBlockEntries(
      parent,
      { region: 'body', regionPath: ['table'] },
      [{ id: 'a', block: { '@type': 'slate' } }, { id: 'n', block: { '@type': 'image' } }],
    );
    expect(parent.table.blocks_layout.header).toEqual(['z']); // untouched
    expect(parent.table.blocks_layout.body).toEqual(['a', 'n']);
  });

  test('regionPath omitted behaves exactly like the block-root case', () => {
    const parent = { blocks: { a: { '@type': 'slate' } }, blocks_layout: { items: ['a'] } };
    expect(getChildBlockEntries(parent, {}).map((e) => e.id)).toEqual(['a']);
  });
});

describe('buildBlockPathMap records regionPath for blocks-in-object', () => {
  const blocksConfig = {
    Document: {
      id: 'Document',
      blockSchema: { properties: { items: { widget: 'blocks_layout' } } },
    },
    objectBlocks: {
      id: 'objectBlocks',
      blockSchema: {
        properties: {
          table: {
            widget: 'object',
            schema: {
              properties: {
                body: { widget: 'blocks_layout', allowedBlocks: ['slate'] },
              },
            },
          },
        },
      },
    },
    slate: { id: 'slate' },
  };

  const formData = {
    '@type': 'Document',
    blocks: {
      'ob-1': {
        '@type': 'objectBlocks',
        table: {
          blocks: { c1: { '@type': 'slate' }, c2: { '@type': 'slate' } },
          blocks_layout: { body: ['c1', 'c2'] },
        },
      },
    },
    blocks_layout: { items: ['ob-1'] },
  };

  test('child path points at the object-nested blocks dict', () => {
    const map = buildBlockPathMap(formData, blocksConfig);
    expect(map['c1'].path).toEqual(['blocks', 'ob-1', 'table', 'blocks', 'c1']);
    expect(map['c2'].path).toEqual(['blocks', 'ob-1', 'table', 'blocks', 'c2']);
  });

  test('child parentId is the enclosing block; region is the field name', () => {
    const map = buildBlockPathMap(formData, blocksConfig);
    expect(map['c1'].parentId).toBe('ob-1');
    expect(map['c1'].region).toBe('body');
  });

  test('child carries regionPath = the object prefix (block-relative)', () => {
    const map = buildBlockPathMap(formData, blocksConfig);
    expect(map['c1'].regionPath).toEqual(['table']);
  });

  test('a top-level blocks field carries no regionPath (block-root)', () => {
    const map = buildBlockPathMap(formData, blocksConfig);
    // ob-1 lives directly in the page items region — no object nesting.
    expect(map['ob-1'].regionPath ?? []).toEqual([]);
  });
});
