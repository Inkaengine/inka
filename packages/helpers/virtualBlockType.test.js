import { buildBlockPathMap } from './buildBlockPathMap.js';

/**
 * An UNTYPED object_list (a table's `rows`, whose items are uniform and carry no
 * `@type`) gets a virtual `parent:field` label as its pathMap blockType. That
 * label is a SIDEBAR DISPLAY name — no blocksConfig registers it and nothing
 * renders it — so it must be marked, or a consumer that reads `blockType` as a
 * real `@type` reports every table as an unregistered `table:rows` block.
 *
 * A TYPED object_list (a form's `subblocks`, typed by `field_type`) is the case
 * the fallback exists for: those items have a real type and must NOT be marked.
 */
const blocksConfig = {
  table: {
    id: 'table',
    schema: {
      properties: {
        rows: {
          widget: 'object_list',
          idField: '@id',
          schema: { properties: { cells: { widget: 'object_list', idField: '@id' } } },
        },
      },
    },
  },
  form: {
    id: 'form',
    schema: {
      properties: {
        subblocks: {
          widget: 'object_list',
          idField: 'field_id',
          typeField: 'field_type',
          allowedBlocks: ['text', 'select'],
        },
      },
    },
  },
};

const pathMapFor = (blocks) =>
  buildBlockPathMap(
    { blocks, blocks_layout: { items: Object.keys(blocks) } },
    blocksConfig,
  );

test('an untyped object_list item is flagged as carrying a virtual block type', () => {
  const map = pathMapFor({
    'tbl-1': {
      '@type': 'table',
      rows: [{ '@id': 'row-1', cells: [{ '@id': 'cell-1' }] }],
    },
  });

  expect(map['row-1'].blockType).toBe('table:rows');
  expect(map['row-1'].isVirtualBlockType).toBe(true);
  // Nested one level down the label is built from the parent's virtual type.
  expect(map['cell-1'].isVirtualBlockType).toBe(true);
});

test('a typed object_list item keeps its real type and is not flagged', () => {
  const map = pathMapFor({
    'form-1': {
      '@type': 'form',
      subblocks: [{ field_id: 'fld-1', field_type: 'text' }],
    },
  });

  expect(map['fld-1'].blockType).toBe('text');
  expect(map['fld-1'].isVirtualBlockType).toBeUndefined();
});
