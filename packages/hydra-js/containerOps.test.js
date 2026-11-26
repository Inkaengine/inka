/**
 * Unit tests for containerOps.js — shared predicates and transforms for the
 * container UX feature family (wrap, unwrap, edge-drag, convert).
 *
 * Strict TDD: each `it` below must fail before its implementation exists.
 */

import { describe, test, expect } from 'vitest';
import {
  canContain,
  findConversionPath,
  mapLayoutItems,
  expelAllowedTypes,
  findOnlyEmptyChildUid,
} from './containerOps.js';
import { canContainAll } from '@volto-hydra/helpers';

describe('containerOps', () => {
  describe('canContain', () => {
    test('accepts any block when allowedBlocks is undefined', () => {
      expect(canContain({}, 'slate', 0)).toBe(true);
      expect(canContain({}, 'image', 5)).toBe(true);
    });

    test('accepts any block when allowedBlocks is null', () => {
      expect(canContain({ allowedBlocks: null }, 'slate', 0)).toBe(true);
    });

    test('rejects block type not in allowedBlocks list', () => {
      const cfg = { allowedBlocks: ['slate', 'image'] };
      expect(canContain(cfg, 'slate', 0)).toBe(true);
      expect(canContain(cfg, 'image', 0)).toBe(true);
      expect(canContain(cfg, 'teaser', 0)).toBe(false);
    });

    test('rejects when at maxLength', () => {
      const cfg = { allowedBlocks: ['slate'], maxLength: 3 };
      expect(canContain(cfg, 'slate', 2)).toBe(true);
      expect(canContain(cfg, 'slate', 3)).toBe(false);
      expect(canContain(cfg, 'slate', 4)).toBe(false);
    });

    test('rejects a readOnly container', () => {
      const cfg = { allowedBlocks: ['slate'], readOnly: true };
      expect(canContain(cfg, 'slate', 0)).toBe(false);
    });

    test('rejects a fixed container', () => {
      const cfg = { allowedBlocks: ['slate'], fixed: true };
      expect(canContain(cfg, 'slate', 0)).toBe(false);
    });
  });

  describe('canContainAll', () => {
    test('returns true when every block type is accepted and count fits', () => {
      const cfg = { allowedBlocks: ['slate', 'image'], maxLength: 5 };
      expect(canContainAll(cfg, ['slate', 'image'], 2)).toBe(true);
    });

    test('returns false when any block type is rejected', () => {
      const cfg = { allowedBlocks: ['slate'] };
      expect(canContainAll(cfg, ['slate', 'teaser'], 0)).toBe(false);
    });

    test('returns false when combined count would exceed maxLength', () => {
      const cfg = { allowedBlocks: ['slate'], maxLength: 4 };
      expect(canContainAll(cfg, ['slate', 'slate', 'slate'], 2)).toBe(false);
      expect(canContainAll(cfg, ['slate', 'slate'], 2)).toBe(true);
    });

    test('returns true for an empty input list (nothing to add)', () => {
      const cfg = { allowedBlocks: ['slate'], maxLength: 0 };
      expect(canContainAll(cfg, [], 0)).toBe(true);
    });
  });

  describe('findConversionPath', () => {
    // Minimal blocksConfig using Volto's fieldMappings convention:
    // blocksConfig[target].fieldMappings[sourceType] = mapping → target is reachable
    // from sourceType. '@default' works when both types have canonical fields.

    test('returns null if source not in blocksConfig', () => {
      const cfg = {};
      expect(findConversionPath('slate', ['text'], cfg)).toBeNull();
    });

    test('returns single-step path for a direct conversion', () => {
      const cfg = {
        slate: {},
        text: { fieldMappings: { slate: {} } },
      };
      expect(findConversionPath('slate', ['text'], cfg)).toEqual([
        'slate',
        'text',
      ]);
    });

    test('returns the source itself if already in allowedTargets', () => {
      const cfg = { slate: {} };
      expect(findConversionPath('slate', ['slate', 'text'], cfg)).toEqual([
        'slate',
      ]);
    });

    test('returns multi-step path via intermediates', () => {
      const cfg = {
        slate: {},
        text: { fieldMappings: { slate: {} } },
        heading: { fieldMappings: { text: {} } },
      };
      expect(findConversionPath('slate', ['heading'], cfg)).toEqual([
        'slate',
        'text',
        'heading',
      ]);
    });

    test('returns null when no path exists', () => {
      const cfg = {
        slate: {},
        image: {}, // no fieldMappings from slate
      };
      expect(findConversionPath('slate', ['image'], cfg)).toBeNull();
    });

    test('returns null when path exceeds depth cap', () => {
      // Chain: a -> b -> c -> d -> e. depth=2 should only allow up to 2 edges.
      const cfg = {
        a: {},
        b: { fieldMappings: { a: {} } },
        c: { fieldMappings: { b: {} } },
        d: { fieldMappings: { c: {} } },
        e: { fieldMappings: { d: {} } },
      };
      // With default depth=3, a->b->c->d is reachable (3 edges) but a->b->c->d->e (4 edges) is not
      expect(findConversionPath('a', ['d'], cfg, 3)).toEqual([
        'a',
        'b',
        'c',
        'd',
      ]);
      expect(findConversionPath('a', ['e'], cfg, 3)).toBeNull();
      expect(findConversionPath('a', ['c'], cfg, 2)).toEqual(['a', 'b', 'c']);
      expect(findConversionPath('a', ['d'], cfg, 2)).toBeNull();
    });

    test('picks the shortest path when multiple targets match', () => {
      const cfg = {
        slate: {},
        quote: { fieldMappings: { slate: {} } }, // 1 hop
        heading: { fieldMappings: { quote: {} } }, // 2 hops from slate
      };
      expect(findConversionPath('slate', ['heading', 'quote'], cfg)).toEqual([
        'slate',
        'quote',
      ]);
    });
  });

  describe('mapLayoutItems (blocks_layout ↔ blocks_layout)', () => {
    // Two containers using the blocks_layout pattern:
    //   { blocks: {uid: data}, [fieldName]: { items: [uid] } }
    const sourceBlock = {
      '@type': 'columns',
      blocks: { 'c-1': { '@type': 'column' }, 'c-2': { '@type': 'column' } },
      columns: { items: ['c-1', 'c-2'] },
    };
    const sourceConfig = { fieldName: 'columns' };
    const targetConfig = { fieldName: 'blocks_layout' };

    test('returns target field with items preserving source order', () => {
      const result = mapLayoutItems(sourceConfig, targetConfig, sourceBlock);
      expect(result.blocks_layout).toEqual({ items: ['c-1', 'c-2'] });
    });

    test('preserves the blocks dict verbatim', () => {
      const result = mapLayoutItems(sourceConfig, targetConfig, sourceBlock);
      expect(result.blocks).toEqual(sourceBlock.blocks);
      // Same reference — caller can mutate a copy if it needs to
      expect(result.blocks).toBe(sourceBlock.blocks);
    });

    test('handles an empty source container', () => {
      const empty = { '@type': 'columns', blocks: {}, columns: { items: [] } };
      const result = mapLayoutItems(sourceConfig, targetConfig, empty);
      expect(result).toEqual({ blocks: {}, blocks_layout: { items: [] } });
    });

    test('handles a missing items array (returns empty items)', () => {
      const noItems = { '@type': 'columns', blocks: {} };
      const result = mapLayoutItems(sourceConfig, targetConfig, noItems);
      expect(result).toEqual({ blocks: {}, blocks_layout: { items: [] } });
    });

    test('same source and target field name round-trips cleanly', () => {
      const cfg = { fieldName: 'blocks_layout' };
      const block = {
        blocks: { a: {} },
        blocks_layout: { items: ['a'] },
      };
      expect(mapLayoutItems(cfg, cfg, block)).toEqual({
        blocks: { a: {} },
        blocks_layout: { items: ['a'] },
      });
    });
  });
});

describe('expelAllowedTypes', () => {
  // Blocks EXPELLED from a container become siblings of that container, so they
  // must satisfy the container's REGION constraints (allowedSiblingTypes, already
  // region-resolved by buildBlockPathMap) — not the raw field-level allowedBlocks.
  test('prefers the container region types over field-level allowedBlocks', () => {
    // Container lives in e.g. a footer region that only allows columns, while the
    // parent field-level list also allows slate. Expel must use the region.
    const containerInfo = { allowedSiblingTypes: ['columns'] };
    const parentFieldDef = {
      widget: 'blocks_layout',
      allowedBlocks: ['columns', 'slate'],
    };
    expect(expelAllowedTypes(containerInfo, parentFieldDef)).toEqual([
      'columns',
    ]);
  });

  test('falls back to field-level allowedBlocks only when the container has no resolved region types', () => {
    expect(
      expelAllowedTypes({}, { allowedBlocks: ['columns', 'slate'] }),
    ).toEqual(['columns', 'slate']);
    expect(expelAllowedTypes(null, { allowedBlocks: ['x'] })).toEqual(['x']);
  });

  test('returns null when neither is available', () => {
    expect(expelAllowedTypes(null, null)).toBeNull();
    expect(expelAllowedTypes({}, null)).toBeNull();
  });
});

describe('findOnlyEmptyChildUid — region-aware empty-container drop target', () => {
  test('finds the placeholder in an OBJECT_LIST container (a slider) — the blocks_layout.items read could not', () => {
    // A slider seeded empty: its one placeholder slide lives in the object_list `slides`, NOT in
    // blocks_layout.items. blockPathMap still records it with parentId=slider (region-aware).
    const slider = {
      '@type': 'slider',
      slides: [{ '@id': 'ph', '@type': 'empty' }],
    };
    const blockPathMap = {
      'slider-1': { blockType: 'slider' },
      ph: { parentId: 'slider-1', region: 'slides', blockType: 'empty' },
    };
    // The OLD approach (targetData.blocks_layout.items) would find nothing here:
    expect(slider.blocks_layout?.items ?? null).toBeNull();
    // The region-aware helper finds the placeholder via blockPathMap:
    expect(findOnlyEmptyChildUid(blockPathMap, 'slider-1')).toBe('ph');
  });

  test('finds the placeholder in a blocks_layout container', () => {
    const blockPathMap = {
      'grid-1': { blockType: 'gridBlock' },
      ph: { parentId: 'grid-1', region: 'items', blockType: 'empty' },
    };
    expect(findOnlyEmptyChildUid(blockPathMap, 'grid-1')).toBe('ph');
  });

  test('returns null when the container has more than one child', () => {
    const blockPathMap = {
      'grid-1': { blockType: 'gridBlock' },
      a: { parentId: 'grid-1', blockType: 'empty' },
      b: { parentId: 'grid-1', blockType: 'teaser' },
    };
    expect(findOnlyEmptyChildUid(blockPathMap, 'grid-1')).toBeNull();
  });

  test('returns null when the only child is not an empty placeholder', () => {
    const blockPathMap = {
      'grid-1': { blockType: 'gridBlock' },
      a: { parentId: 'grid-1', blockType: 'teaser' },
    };
    expect(findOnlyEmptyChildUid(blockPathMap, 'grid-1')).toBeNull();
  });
});
