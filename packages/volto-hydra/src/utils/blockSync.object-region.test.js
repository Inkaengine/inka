/**
 * A region can live inside a widget:'object' (#245). The pass every mutation
 * runs (`applySchemaDefaultsToFormData`) walks the object for its own fields'
 * defaults, and must leave the regions in it as they are: an object_list stays
 * an array, a blocks_layout keeps its blocks and its order.
 */
import { describe, test, expect, vi } from 'vitest';

vi.mock('../context', () => ({
  getHydraSchemaContext: () => ({}),
  setHydraSchemaContext: () => () => {},
  getLiveBlockData: () => undefined,
}));

import { applySchemaDefaultsToFormData } from './blockSync.js';
import { buildBlockPathMap } from '../../../hydra-js/buildBlockPathMap.js';

const intl = { formatMessage: (m) => m?.defaultMessage || m?.id || '' };

const blocksConfig = {
  Document: {
    id: 'Document',
    blockSchema: { properties: { items: { widget: 'blocks_layout' } } },
  },
  list: {
    id: 'list',
    blockSchema: {
      properties: {
        table: {
          widget: 'object',
          schema: {
            properties: {
              caption: { type: 'string', default: 'A caption' },
              rows: {
                widget: 'object_list',
                idField: 'key',
                schema: { properties: { label: { type: 'string' } } },
              },
            },
          },
        },
      },
    },
  },
  panels: {
    id: 'panels',
    blockSchema: {
      properties: {
        data: {
          widget: 'object',
          schema: {
            properties: {
              caption: { type: 'string', default: 'A caption' },
              items: { widget: 'blocks_layout', allowedBlocks: ['note'] },
            },
          },
        },
      },
    },
  },
  note: { id: 'note', blockSchema: { properties: { label: { type: 'string' } } } },
};

const page = (id, block) => ({
  '@type': 'Document',
  blocks: { [id]: block },
  blocks_layout: { items: [id] },
});

const normalize = (formData) =>
  applySchemaDefaultsToFormData(
    formData,
    buildBlockPathMap(formData, blocksConfig),
    blocksConfig,
    intl,
  );

describe('schema defaults with a region inside a widget:object', () => {
  test('an object_list stays the array it was, and the object gets its defaults', () => {
    const rows = [
      { key: 'r1', label: 'One' },
      { key: 'r2', label: 'Two' },
    ];
    const result = normalize(page('t', { '@type': 'list', table: { rows } }));

    expect(result.blocks.t.table.rows).toEqual(rows);
    expect(Array.isArray(result.blocks.t.table.rows)).toBe(true);
    expect(result.blocks.t.table.caption).toBe('A caption');
  });

  test('a blocks_layout keeps its blocks and order, and the object gets its defaults', () => {
    const blocks = {
      b: { '@type': 'note', label: 'B' },
      a: { '@type': 'note', label: 'A' },
    };
    const result = normalize(
      page('p', {
        '@type': 'panels',
        data: { blocks, blocks_layout: { items: ['b', 'a'] } },
      }),
    );

    expect(result.blocks.p.data.blocks_layout.items).toEqual(['b', 'a']);
    expect(result.blocks.p.data.blocks).toEqual(blocks);
    expect(result.blocks.p.data.caption).toBe('A caption');
  });
});
