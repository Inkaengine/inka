import { Bridge } from './hydra.src.js';

/**
 * addNodeIdsToAllSlateFields must reach slate fields nested inside
 * `object_list` widgets, not only `object` wrappers.
 *
 * slateTable stores its rich text at table.rows[].cells[].value, where `rows`
 * and `cells` are `object_list` widgets and `value` is `widget: 'slate'`. The
 * traversal previously descended into `widget: 'object'` only, so cell values
 * never received nodeIds — and selecting the block in edit mode tripped
 * hydra's "missing data-node-id" developer warning (Block: slateTable, Field:
 * value). Every cell is a real editable slate field per the schema, so it must
 * be stamped like any other.
 */

const slateTableSchema = {
  properties: {
    table: {
      widget: 'object',
      schema: {
        properties: {
          rows: {
            widget: 'object_list',
            idField: 'key',
            schema: {
              properties: {
                cells: {
                  widget: 'object_list',
                  idField: 'key',
                  schema: {
                    properties: {
                      value: { widget: 'slate' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

// A block wrapping a slate field on a plain `widget: 'object'` — the case that
// already worked (#245, content.headline). Guards against a regression.
const objectWrapperSchema = {
  properties: {
    content: {
      widget: 'object',
      schema: { properties: { headline: { widget: 'slate' } } },
    },
  },
};

/** Minimal bridge carrying only what addNodeIdsToAllSlateFields reads. */
function bridgeWith(blockId, block, schema) {
  const formData = { blocks: { [blockId]: block }, blocks_layout: { items: [blockId] } };
  return Object.assign(Object.create(Bridge.prototype), {
    formData,
    blockPathMap: { [blockId]: { path: [], blockType: block['@type'] } },
    getBlockData: (id) => formData.blocks[id],
    getBlockSchema: () => schema,
    // addNodeIds is the real prototype method.
  });
}

describe('addNodeIdsToAllSlateFields — object_list nesting', () => {
  test('slateTable cell values (table.rows[].cells[].value) get nodeIds', () => {
    const block = {
      '@type': 'slateTable',
      table: {
        rows: [
          { cells: [
            { value: [{ type: 'p', children: [{ text: 'Feature' }] }], type: 'header' },
            { value: [{ type: 'p', children: [{ text: 'Supported' }] }], type: 'header' },
          ] },
          { cells: [
            { value: [{ type: 'p', children: [{ text: 'Bold' }] }], type: 'data' },
            { value: [{ type: 'p', children: [{ text: 'Yes' }] }], type: 'data' },
          ] },
        ],
      },
    };
    const bridge = bridgeWith('st-1', block, slateTableSchema);

    bridge.addNodeIdsToAllSlateFields();

    const rows = bridge.formData.blocks['st-1'].table.rows;
    for (const row of rows) {
      for (const cell of row.cells) {
        expect(cell.value[0].nodeId).toBeDefined();
        // children get path-based ids too, so inline selection can resolve.
        expect(cell.value[0].children[0]).toBeDefined();
      }
    }
  });

  test('still stamps slate nested on a plain object wrapper (no regression)', () => {
    const block = {
      '@type': 'hero',
      content: { headline: [{ type: 'p', children: [{ text: 'Hi' }] }] },
    };
    const bridge = bridgeWith('hero-1', block, objectWrapperSchema);

    bridge.addNodeIdsToAllSlateFields();

    expect(bridge.formData.blocks['hero-1'].content.headline[0].nodeId).toBeDefined();
  });
});
