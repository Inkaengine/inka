/**
 * Unit tests for multi-region blocks_layout.
 *
 * A container declares one BLOCKS FIELD per region — a schema property with
 * widget 'blocks_layout', each with its own allowedBlocks. The field name IS
 * the key under the container's shared `blocks_layout` dict (default 'items'):
 *   schema:  { items: {widget:'blocks_layout'}, footer: {widget:'blocks_layout'} }
 *   data:    blocks_layout: { items: [...], footer: [...] }
 * No `regions` map, no synthesised 'items'.
 */

import { getBlocksFieldNames, buildBlockPathMap, getPageAllowedBlocksFromRestricted, addableSiblingTypes } from './buildBlockPathMap.js';
import { mapLayoutItems } from './containerOps.js';

describe('getBlocksFieldNames', () => {
  test('returns the schema properties with widget blocks_layout', () => {
    const schema = {
      properties: {
        title: { type: 'string' },
        items: { widget: 'blocks_layout' },
        footer: { widget: 'blocks_layout' },
        slides: { widget: 'object_list' },
      },
    };
    expect(getBlocksFieldNames(schema)).toEqual(['items', 'footer']);
  });

  test('returns [] when no blocks field is declared (not a container)', () => {
    expect(getBlocksFieldNames({ properties: { title: { type: 'string' } } })).toEqual([]);
    expect(getBlocksFieldNames(undefined)).toEqual([]);
  });
});

describe('mapLayoutItems — multi-region', () => {
  test('carries every region of the source blocks_layout into the target', () => {
    const sourceBlock = {
      blocks: { a: {}, h: {}, f: {} },
      cols: { items: ['a'], header: ['h'], footer: ['f'] },
    };
    const result = mapLayoutItems(
      { fieldName: 'cols' },
      { fieldName: 'blocks_layout' },
      sourceBlock,
    );
    expect(result.blocks).toBe(sourceBlock.blocks);
    expect(result.blocks_layout).toEqual({
      items: ['a'],
      header: ['h'],
      footer: ['f'],
    });
  });

  test('defaults to empty items region when source has no layout', () => {
    const result = mapLayoutItems(
      { fieldName: 'cols' },
      { fieldName: 'blocks_layout' },
      { blocks: {} },
    );
    expect(result.blocks_layout).toEqual({ items: [] });
  });
});

describe('buildBlockPathMap — page blocks fields', () => {
  // Page declares two blocks fields: items (default) + footer. Data lives in the
  // shared blocks_layout dict keyed by field name.
  const blocksConfig = {
    _page: {
      id: '_page',
      schema: () => ({
        properties: {
          items: { widget: 'blocks_layout' },
          footer: { widget: 'blocks_layout', allowedBlocks: ['slate'] },
        },
      }),
    },
    slate: { id: 'slate' },
  };

  const formData = {
    '@type': 'Document',
    blocks: {
      'hero-1': { '@type': 'slate' },
      'body-1': { '@type': 'slate' },
      'footer-1': { '@type': 'slate' },
    },
    blocks_layout: {
      items: ['hero-1', 'body-1'],
      footer: ['footer-1'],
    },
  };

  test('records the blocks field (region) each block lives in', () => {
    const map = buildBlockPathMap(formData, blocksConfig);
    expect(map['hero-1'].region).toBe('items');
    expect(map['body-1'].region).toBe('items');
    expect(map['footer-1'].region).toBe('footer');
  });

  test('a region that names no allowedBlocks marks its list as derived', () => {
    // `items` names none, so its list is "every type not restricted" — its add
    // menu, which a listing's item-type picker must not mistake for the only
    // types allowed there. `footer` names its own, so it decides alone.
    const map = buildBlockPathMap(formData, blocksConfig);
    expect(map['hero-1'].allowedSiblingTypesDerived).toBe(true);
    expect(map['footer-1'].allowedSiblingTypesDerived).toBeUndefined();
  });

  test('all blocks-field children share the one blocks dict', () => {
    const map = buildBlockPathMap(formData, blocksConfig);
    // Every blocks-field child (any region) lives in the shared `blocks` dict;
    // the region (field name) is the single container identifier — there is no
    // separate `containerField`.
    expect(map['footer-1'].path).toEqual(['blocks', 'footer-1']);
    expect(map['hero-1'].path).toEqual(['blocks', 'hero-1']);
    expect(map['footer-1'].containerField).toBeUndefined();
  });

  test('siblingCount is per blocks field', () => {
    const map = buildBlockPathMap(formData, blocksConfig);
    expect(map['hero-1'].siblingCount).toBe(2);
    expect(map['footer-1'].siblingCount).toBe(1);
  });

  test('per-field allowedBlocks applies to its blocks', () => {
    const map = buildBlockPathMap(formData, blocksConfig);
    expect(map['footer-1'].allowedSiblingTypes).toEqual(['slate']);
  });

  test('the default (items) region with no per-region allowedBlocks falls back to the page-level list', () => {
    // Compat: a page's single "top-level" allowed-blocks list (derived from `restricted`) must
    // apply to the default `items` region when that region declares no allowedBlocks of its own.
    // effectiveAllowedBlocks is null → allowedSiblingTypes is `defaultPageAllowedBlocks`, NOT
    // undefined and NOT the footer's ['slate']. (Guards the removal of the page-level intersect:
    // that filter was a no-op; this fallback is the actual page-level application.)
    const map = buildBlockPathMap(formData, blocksConfig);
    const pageLevel = getPageAllowedBlocksFromRestricted(blocksConfig, { properties: formData });
    expect(map['hero-1'].allowedSiblingTypes).toEqual(pageLevel);
    // and it is NOT the footer region's per-region list
    expect(map['hero-1'].allowedSiblingTypes).not.toEqual(['slate']);
  });

  test('a page with data only in a non-default field is still processed', () => {
    const map = buildBlockPathMap(
      {
        '@type': 'Document',
        blocks: { 'footer-1': { '@type': 'slate' } },
        blocks_layout: { items: [], footer: ['footer-1'] },
      },
      blocksConfig,
    );
    expect(map['footer-1']?.region).toBe('footer');
  });
});

describe('addableSiblingTypes — synced container add restriction', () => {
  const blocksConfig = {
    grid: {
      blockSchema: {
        properties: {
          items: {
            widget: 'blocks_layout',
            itemTypeField: 'variation',
            allowedBlocks: ['card', 'contentBlock', 'image', 'listing'],
          },
          variation: { widget: 'blockTypeSelect' },
        },
      },
    },
    // Convertible item types (have an @default mapping).
    card: { fieldMappings: { '@default': { '@id': 'url', title: 'title' } } },
    contentBlock: { fieldMappings: { '@default': { '@id': 'url', title: 'title' } } },
    image: { fieldMappings: { '@default': { '@id': 'url', image: 'image' } } },
    // Structural child — no @default mapping.
    listing: {},
  };

  test('restricts convertible item types to the synced one, keeps structural', () => {
    const allowed = ['card', 'contentBlock', 'image', 'listing'];
    const grid = { '@type': 'grid', variation: 'card' };
    expect(addableSiblingTypes(allowed, 'variation', grid, blocksConfig)).toEqual([
      'card',
      'listing',
    ]);
  });

  test('a plain field (no itemTypeField) is unchanged', () => {
    expect(
      addableSiblingTypes(['slate', 'image'], undefined, {}, blocksConfig),
    ).toEqual(['slate', 'image']);
  });

  test('an unset synced type leaves the full list (no over-restriction)', () => {
    const grid = { '@type': 'grid' };
    expect(
      addableSiblingTypes(['card', 'listing'], 'variation', grid, blocksConfig),
    ).toEqual(['card', 'listing']);
  });

  test('buildBlockPathMap: a card grid child can only add the card + listing, not another item type', () => {
    const formData = {
      '@type': 'Document',
      blocks: {
        'grid-1': {
          '@type': 'grid',
          variation: 'card',
          blocks: { 'card-1': { '@type': 'card' } },
          blocks_layout: { items: ['card-1'] },
        },
      },
      blocks_layout: { items: ['grid-1'] },
    };
    const map = buildBlockPathMap(formData, blocksConfig);
    expect(map['card-1'].allowedSiblingTypes).toEqual(['card', 'listing']);
    expect(map['card-1'].allowedSiblingTypes).not.toContain('contentBlock');
    expect(map['card-1'].allowedSiblingTypes).not.toContain('image');
  });
});

describe('addableSiblingTypes — ancestor disallowDescendantBlocks', () => {
  test('subtracts disallowed types from a plain field', () => {
    expect(
      addableSiblingTypes(['slate', 'section', 'columns'], undefined, {}, {}, [
        'columns',
      ]),
    ).toEqual(['slate', 'section']);
  });

  test('accepts a Set as well as an array', () => {
    expect(
      addableSiblingTypes(
        ['slate', 'columns'],
        undefined,
        {},
        {},
        new Set(['columns']),
      ),
    ).toEqual(['slate']);
  });

  test('empty/absent disallow leaves the list unchanged (back-compat)', () => {
    expect(
      addableSiblingTypes(['slate', 'columns'], undefined, {}, {}),
    ).toEqual(['slate', 'columns']);
    expect(
      addableSiblingTypes(['slate', 'columns'], undefined, {}, {}, []),
    ).toEqual(['slate', 'columns']);
  });

  test('composes with synced-field narrowing (both applied, in one call)', () => {
    const blocksConfig = {
      card: { fieldMappings: { '@default': {} } },
      contentBlock: { fieldMappings: { '@default': {} } },
      listing: {},
    };
    const grid = { variation: 'card' };
    // Sync narrows convertible types to `card` (+ structural `listing`); the
    // disallow set then drops `listing`. One function, both effects.
    expect(
      addableSiblingTypes(
        ['card', 'contentBlock', 'listing'],
        'variation',
        grid,
        blocksConfig,
        ['listing'],
      ),
    ).toEqual(['card']);
  });
});

describe('buildBlockPathMap — disallowDescendantBlocks (ancestor restriction)', () => {
  // Mirrors the columns/section setup: a `columns` block whose cells are
  // `section`s, `section` allows `columns` (columns-in-section), and `columns`
  // forbids `columns` in its whole subtree — so columns-in-columns is impossible
  // at any depth while columns-in-a-top-level-section still works.
  const blocksConfig = {
    _page: {
      id: '_page',
      schema: () => ({
        properties: {
          items: {
            widget: 'blocks_layout',
            allowedBlocks: ['slate', 'section', 'columns'],
          },
        },
      }),
    },
    slate: { id: 'slate' },
    columns: {
      id: 'columns',
      disallowDescendantBlocks: ['columns'],
      blockSchema: {
        properties: {
          items: { widget: 'blocks_layout', allowedBlocks: ['section'] },
        },
      },
    },
    section: {
      id: 'section',
      blockSchema: {
        properties: {
          items: {
            widget: 'blocks_layout',
            allowedBlocks: ['slate', 'section', 'columns'],
          },
        },
      },
    },
  };

  const sec = (id, childId) => ({
    '@type': 'section',
    blocks: { [childId]: { '@type': 'slate' } },
    blocks_layout: { items: [childId] },
  });

  test('columns IS addable in a top-level section (no disallowing ancestor)', () => {
    const formData = {
      '@type': 'Document',
      blocks: { 'sec-1': sec('sec-1', 'slate-1') },
      blocks_layout: { items: ['sec-1'] },
    };
    const map = buildBlockPathMap(formData, blocksConfig);
    expect(map['slate-1'].allowedSiblingTypes).toContain('columns');
  });

  test('columns is NOT addable inside a columns cell section', () => {
    const formData = {
      '@type': 'Document',
      blocks: {
        'columns-1': {
          '@type': 'columns',
          blocks: { 'cell-1': sec('cell-1', 'slate-1') },
          blocks_layout: { items: ['cell-1'] },
        },
      },
      blocks_layout: { items: ['columns-1'] },
    };
    const map = buildBlockPathMap(formData, blocksConfig);
    expect(map['slate-1'].allowedSiblingTypes).toEqual(
      expect.arrayContaining(['slate', 'section']),
    );
    expect(map['slate-1'].allowedSiblingTypes).not.toContain('columns');
  });

  test('the restriction reaches arbitrary depth (grandchild)', () => {
    const formData = {
      '@type': 'Document',
      blocks: {
        'columns-1': {
          '@type': 'columns',
          blocks: {
            'cell-1': {
              '@type': 'section',
              blocks: { 'sec-2': sec('sec-2', 'slate-deep') },
              blocks_layout: { items: ['sec-2'] },
            },
          },
          blocks_layout: { items: ['cell-1'] },
        },
      },
      blocks_layout: { items: ['columns-1'] },
    };
    const map = buildBlockPathMap(formData, blocksConfig);
    expect(map['sec-2'].allowedSiblingTypes).not.toContain('columns');
    expect(map['slate-deep'].allowedSiblingTypes).not.toContain('columns');
    expect(map['slate-deep'].allowedSiblingTypes).toContain('section');
  });

  test('a sibling subtree outside the columns is unaffected', () => {
    const formData = {
      '@type': 'Document',
      blocks: {
        'columns-1': {
          '@type': 'columns',
          blocks: { 'cell-1': sec('cell-1', 'slate-in') },
          blocks_layout: { items: ['cell-1'] },
        },
        'sec-top': sec('sec-top', 'slate-out'),
      },
      blocks_layout: { items: ['columns-1', 'sec-top'] },
    };
    const map = buildBlockPathMap(formData, blocksConfig);
    expect(map['slate-in'].allowedSiblingTypes).not.toContain('columns');
    expect(map['slate-out'].allowedSiblingTypes).toContain('columns');
  });

  test('records descendantDisallowedTypes on the declaring container (for the type picker)', () => {
    const formData = {
      '@type': 'Document',
      blocks: {
        'columns-1': {
          '@type': 'columns',
          blocks: {
            'cell-1': { '@type': 'section', blocks: {}, blocks_layout: { items: [] } },
          },
          blocks_layout: { items: ['cell-1'] },
        },
      },
      blocks_layout: { items: ['columns-1'] },
    };
    const map = buildBlockPathMap(formData, blocksConfig);
    expect(map['columns-1'].descendantDisallowedTypes).toEqual(['columns']);
  });

  test('no declaration anywhere → allowedSiblingTypes unchanged (back-compat)', () => {
    const plainConfig = {
      ...blocksConfig,
      columns: {
        id: 'columns',
        blockSchema: {
          properties: {
            items: { widget: 'blocks_layout', allowedBlocks: ['section'] },
          },
        },
      },
    };
    const formData = {
      '@type': 'Document',
      blocks: {
        'columns-1': {
          '@type': 'columns',
          blocks: { 'cell-1': sec('cell-1', 'slate-1') },
          blocks_layout: { items: ['cell-1'] },
        },
      },
      blocks_layout: { items: ['columns-1'] },
    };
    const map = buildBlockPathMap(formData, plainConfig);
    expect(map['slate-1'].allowedSiblingTypes).toContain('columns');
    expect(map['columns-1'].descendantDisallowedTypes).toBeUndefined();
  });
});
