/**
 * Container <-> value conversion via a region-crossing fieldMappings path
 * (`<region>/<type|*>/<field>`). Collapse merges a region of slate blocks into a
 * single value; expand wraps a value in one child block. See
 * proposals/container-value-conversion.md.
 */
import { describe, test, expect, vi } from 'vitest';

vi.mock('../context', () => ({
  getHydraSchemaContext: () => ({}),
  setHydraSchemaContext: () => () => {},
  getLiveBlockData: () => undefined,
}));

import { convertValueContainer, parseRegionPath } from './blockPath.js';

const intl = { formatMessage: (m) => m?.defaultMessage || m?.id || '' };
const slate = (text) => [{ type: 'p', children: [{ text }] }];

const cfg = {
  slate: { id: 'slate' },
  image: { id: 'image' },
  tableCell: {
    id: 'tableCell',
    blockSchema: {
      properties: {
        blocks: {
          widget: 'object_list', idField: '@id',
          typeField: '@type',
          allowedBlocks: ['slate', 'image'],
        },
      },
    },
  },
  tableHeaderCell: {
    id: 'tableHeaderCell',
    blockSchema: { properties: { value: { widget: 'slate' } } },
    // The bridge, declared once on the value block:
    fieldMappings: { tableCell: { value: 'blocks/slate/value' } },
  },
};

describe('parseRegionPath', () => {
  test('a 3-segment path is a region path; * means any type', () => {
    expect(parseRegionPath('blocks/slate/value')).toEqual({
      region: 'blocks',
      type: 'slate',
      field: 'value',
    });
    expect(parseRegionPath('blocks/*/value')).toEqual({
      region: 'blocks',
      type: null,
      field: 'value',
    });
  });

  test('scalar / object-descent paths are NOT region paths', () => {
    expect(parseRegionPath('value')).toBeNull();
    expect(parseRegionPath('content/headline')).toBeNull(); // object descent, 2 segments
    expect(parseRegionPath(undefined)).toBeNull();
  });
});

describe('convertValueContainer — container <-> value bridge', () => {
  test('collapse: a tableCell of slate blocks -> a tableHeaderCell value (merged; key/width preserved)', () => {
    const cell = {
      '@type': 'tableCell',
      key: 'c0',
      width: '20%',
      blocks: [
        { '@type': 'slate', '@id': 's1', value: slate('Hello ') },
        { '@type': 'slate', '@id': 's2', value: slate('world') },
      ],
    };
    const out = convertValueContainer(cell, 'tableCell', 'tableHeaderCell', cfg, intl);
    expect(out['@type']).toBe('tableHeaderCell');
    expect(out.key).toBe('c0'); // unmapped scalar survives
    expect(out.width).toBe('20%');
    expect(out.blocks).toBeUndefined(); // region storage dropped
    expect(out.value).toHaveLength(1); // merged into one node
    const txt = JSON.stringify(out.value);
    expect(txt).toContain('Hello');
    expect(txt).toContain('world');
  });

  test('collapse: an image sibling is skipped by the slate filter', () => {
    const cell = {
      '@type': 'tableCell',
      key: 'c0',
      blocks: [
        { '@type': 'slate', '@id': 's1', value: slate('Text') },
        { '@type': 'image', '@id': 'i1', url: '/x.jpg' },
      ],
    };
    const out = convertValueContainer(cell, 'tableCell', 'tableHeaderCell', cfg, intl);
    const txt = JSON.stringify(out.value);
    expect(txt).toContain('Text');
    expect(txt).not.toContain('x.jpg');
  });

  test('expand: a tableHeaderCell value -> a tableCell with one slate child (key preserved)', () => {
    const hcell = { '@type': 'tableHeaderCell', key: 'c0', value: slate('Method') };
    const out = convertValueContainer(hcell, 'tableHeaderCell', 'tableCell', cfg, intl);
    expect(out['@type']).toBe('tableCell');
    expect(out.key).toBe('c0');
    expect(out.value).toBeUndefined();
    expect(out.blocks).toHaveLength(1);
    expect(out.blocks[0]['@type']).toBe('slate');
    expect(JSON.stringify(out.blocks[0].value)).toContain('Method');
  });

  test('no bridge declared -> null (caller falls back to region funnel)', () => {
    expect(
      convertValueContainer({ '@type': 'slate' }, 'slate', 'image', cfg, intl),
    ).toBeNull();
  });
});
