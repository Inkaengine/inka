/**
 * Region-awareness of the blockPath operation funnel.
 *
 * The load-bearing guarantee: writing one region (reorder/move/insert/delete)
 * must PRESERVE the sibling regions of the same blocks_layout field.
 */
import { describe, test, expect } from 'vitest';
import {
  buildBlockPathMap,
  getContainerFieldConfig,
  getContainerItems,
  reorderBlocksInContainer,
  moveBlockBetweenContainers,
  ensureEmptyBlockIfEmpty,
  insertBlockInContainer,
  getAllContainerFields,
  listContainerChildren,
  convertContainerBlock,
} from './blockPath.js';

const PAGE = '_page';
const intl = { formatMessage: (m) => m?.defaultMessage || m?.id || '' };

const blocksConfig = {
  _page: {
    id: '_page',
    schema: () => ({
      properties: {
        items: { widget: 'blocks_layout' },
        footer: { widget: 'blocks_layout', title: 'Footer' },
      },
    }),
  },
  slate: { id: 'slate' },
};

const makeForm = () => ({
  '@type': 'Document',
  blocks: {
    a: { '@type': 'slate' },
    b: { '@type': 'slate' },
    f1: { '@type': 'slate' },
    f2: { '@type': 'slate' },
  },
  blocks_layout: {
    items: ['a', 'b'],
    footer: ['f1', 'f2'],
  },
});

describe('getContainerFieldConfig — region', () => {
  test('reports the region for a footer block and an items block', () => {
    const form = makeForm();
    const map = buildBlockPathMap(form, blocksConfig, intl);
    expect(
      getContainerFieldConfig('f1', map, form, blocksConfig, intl).region,
    ).toBe('footer');
    expect(
      getContainerFieldConfig('a', map, form, blocksConfig, intl).region,
    ).toBe('items');
  });
});

describe('getContainerItems — region-scoped read', () => {
  test('reads the requested region, not always items', () => {
    const form = makeForm();
    expect(
      getContainerItems(form, { region: 'footer' }),
    ).toEqual(['f1', 'f2']);
    expect(
      getContainerItems(form, { region: 'items' }),
    ).toEqual(['a', 'b']); // default region = items
  });
});

describe('reorderBlocksInContainer — sibling preservation', () => {
  test('reordering the footer region leaves items untouched', () => {
    const form = makeForm();
    const map = buildBlockPathMap(form, blocksConfig, intl);
    const result = reorderBlocksInContainer(
      form,
      map,
      PAGE,
      'footer',
      ['f2', 'f1'],
      blocksConfig,
      intl,
    );
    expect(result.blocks_layout.footer).toEqual(['f2', 'f1']);
    expect(result.blocks_layout.items).toEqual(['a', 'b']); // preserved
  });
});

describe('moveBlockBetweenContainers — cross-region within one field', () => {
  test('moving an items block into the footer region updates both lists', () => {
    const form = makeForm();
    const map = buildBlockPathMap(form, blocksConfig, intl);
    const result = moveBlockBetweenContainers(
      form,
      map,
      'b', // move this items block
      'f1', // before this footer block
      false,
      PAGE,
      PAGE,
      blocksConfig,
      intl,
    );
    expect(result).not.toBeNull();
    expect(result.blocks_layout.items).toEqual(['a']); // b left items
    expect(result.blocks_layout.footer).toContain('b'); // b entered footer
    expect(result.blocks_layout.footer).toContain('f1');
    expect(result.blocks_layout.footer).toContain('f2');
    // block data still in the shared dict
    expect(result.blocks.b).toBeTruthy();
  });

  test('same-region move is still a reorder (not a cross-container move)', () => {
    const form = makeForm();
    const map = buildBlockPathMap(form, blocksConfig, intl);
    const result = moveBlockBetweenContainers(
      form,
      map,
      'a',
      'b',
      true, // after b
      PAGE,
      PAGE,
      blocksConfig,
      intl,
    );
    expect(result).not.toBeNull();
    expect(result.blocks_layout.items).toEqual(['b', 'a']);
    expect(result.blocks_layout.footer).toEqual(['f1', 'f2']); // preserved
  });
});

describe('moveBlockBetweenContainers — disallowDescendantBlocks (DnD rejection)', () => {
  // The exact validation a drag runs: moveBlockBetweenContainers checks the
  // dragged block's type against the target's allowedSiblingTypes. With a
  // columns ancestor's disallowDescendantBlocks:['columns'], a cell's addable
  // set excludes columns, so dropping a columns block into the cell is rejected
  // (returns null). This is the deterministic counterpart to the admin DnD.
  const makeCfg = (disallow) => ({
    _page: {
      id: '_page',
      schema: () => ({
        properties: {
          items: { widget: 'blocks_layout', allowedBlocks: ['slate', 'columns'] },
        },
      }),
    },
    slate: { id: 'slate' },
    columns: {
      id: 'columns',
      ...(disallow ? { disallowDescendantBlocks: ['columns'] } : {}),
      blockSchema: {
        properties: {
          items: { widget: 'blocks_layout', allowedBlocks: ['column'] },
        },
      },
    },
    column: {
      id: 'column',
      blockSchema: {
        properties: {
          items: { widget: 'blocks_layout', allowedBlocks: ['slate', 'columns'] },
        },
      },
    },
  });

  const makeColsForm = () => ({
    '@type': 'Document',
    blocks: {
      outer: {
        '@type': 'columns',
        blocks: {
          cell: {
            '@type': 'column',
            blocks: { inner: { '@type': 'slate' } },
            blocks_layout: { items: ['inner'] },
          },
        },
        blocks_layout: { items: ['cell'] },
      },
      src: {
        '@type': 'columns',
        blocks: {
          scell: {
            '@type': 'column',
            blocks: { sinner: { '@type': 'slate' } },
            blocks_layout: { items: ['sinner'] },
          },
        },
        blocks_layout: { items: ['scell'] },
      },
    },
    blocks_layout: { items: ['outer', 'src'] },
  });

  test('rejects dragging a columns block into a columns cell', () => {
    const cfg = makeCfg(true);
    const form = makeColsForm();
    const map = buildBlockPathMap(form, cfg, intl);
    // The cell's addable set excludes columns (ancestor disallow).
    expect(map['inner'].allowedSiblingTypes).not.toContain('columns');
    // Drag `src` (a columns block) after `inner` (inside the cell) → rejected.
    const result = moveBlockBetweenContainers(
      form, map, 'src', 'inner', true, PAGE, 'cell', cfg, intl,
    );
    expect(result).toBeNull();
  });

  test('control: the same move is allowed without the disallow declaration', () => {
    const cfg = makeCfg(false);
    const form = makeColsForm();
    const map = buildBlockPathMap(form, cfg, intl);
    expect(map['inner'].allowedSiblingTypes).toContain('columns');
    const result = moveBlockBetweenContainers(
      form, map, 'src', 'inner', true, PAGE, 'cell', cfg, intl,
    );
    expect(result).not.toBeNull();
  });
});

describe('empty-region seeding', () => {
  const cfg = {
    _page: {
      id: '_page',
      schema: () => ({
        properties: {
          items: { widget: 'blocks_layout', allowedBlocks: ['slate'], defaultBlockType: 'slate' },
          footer: { widget: 'blocks_layout', title: 'Footer', allowedBlocks: ['slate'], defaultBlockType: 'slate' },
        },
      }),
    },
    slate: { id: 'slate' },
  };

  test('getAllContainerFields returns one entry per region', () => {
    const form = {
      '@type': 'Document',
      blocks: { a: { '@type': 'slate' } },
      blocks_layout: { items: ['a'], footer: [] },
    };
    const map = buildBlockPathMap(form, cfg, intl);
    const fields = getAllContainerFields(PAGE, map, form, cfg, intl);
    const regions = fields.filter((f) => !f.isObjectList).map((f) => f.region);
    expect(regions).toContain('items');
    expect(regions).toContain('footer');
  });

  test('seeds an empty block into an empty declared region, leaving siblings', () => {
    const form = {
      '@type': 'Document',
      blocks: { a: { '@type': 'slate' } },
      blocks_layout: { items: ['a'], footer: [] },
    };
    const map = buildBlockPathMap(form, cfg, intl);
    let n = 0;
    const uuid = () => `seed-${++n}`;
    const result = ensureEmptyBlockIfEmpty(form, { parentId: PAGE }, map, uuid, cfg, { intl });
    expect(result.blocks_layout.items).toEqual(['a']); // untouched
    expect(result.blocks_layout.footer.length).toBe(1); // seeded
    expect(result.blocks[result.blocks_layout.footer[0]]).toBeTruthy();
  });
});

describe('ensureEmptyBlockIfEmpty — auto-content joins the template instance', () => {
  // A container that IS a template instance, with an empty items region. When the
  // editor seeds its default child (e.g. a new column's auto-slate), that child
  // must join the SAME instance so it stays editable in template edit mode — the
  // flat readonly check is `isBlockReadonly = block.templateInstanceId === templateEditMode`.
  // If it isn't stamped, the seeded slate is read-only → no add-after "+" → you
  // can't add anything into a freshly-added column.
  const cfgTpl = {
    _page: { id: '_page', schema: () => ({ properties: { items: { widget: 'blocks_layout' } } }) },
    column: { id: 'column', schema: () => ({ properties: { items: { widget: 'blocks_layout', allowedBlocks: ['slate'], defaultBlockType: 'slate' } } }) },
    slate: { id: 'slate' },
  };

  test('a default block seeded into an empty template-instance container carries templateInstanceId', () => {
    const form = {
      '@type': 'Document',
      blocks: {
        col1: {
          '@type': 'column',
          templateId: 'resolveuid/x',
          templateInstanceId: 'inst-1',
          slotId: 'col1',
          blocks: {},
          blocks_layout: { items: [] },
        },
      },
      blocks_layout: { items: ['col1'] },
    };
    const map = buildBlockPathMap(form, cfgTpl, intl);
    let n = 0;
    const uuid = () => `seed-${++n}`;
    const result = ensureEmptyBlockIfEmpty(form, { parentId: 'col1' }, map, uuid, cfgTpl, { intl });

    const col = result.blocks.col1;
    const childId = col.blocks_layout.items[0];
    const child = col.blocks[childId];
    expect(child, 'empty template-instance column should be seeded with a default child').toBeTruthy();
    // Reproduces the bug: the seeded child currently has NO templateInstanceId, so
    // it renders read-only in template edit mode (no add-after "+").
    expect(child.templateInstanceId).toBe('inst-1');
  });
});

describe('ensureEmptyBlockIfEmpty — empty slot placeholders at fixed-anchor edges (next/prevSlotId)', () => {
  // A fixed anchor names its adjacent slot region even when that region is empty:
  //   nextSlotId → the slot AFTER it  (top-anchored layout / trailing slot)
  //   prevSlotId → the slot BEFORE it (bottom-anchored layout / leading slot)
  // Each empty region gets a seeded, editable placeholder carrying the slot membership so
  // it is clickable/droppable. The two cases are mirror images.
  const anchor = (extra) => ({
    '@type': 'slate',
    fixed: true,
    readOnly: true,
    templateId: 'resolveuid/x',
    templateInstanceId: 'inst-1',
    ...extra,
  });

  test('nextSlotId: an empty trailing slot after a fixed header seeds a placeholder AFTER it', () => {
    const form = {
      '@type': 'Document',
      blocks: { header: anchor({ slotId: 'header', nextSlotId: 'primary' }) },
      blocks_layout: { items: ['header'] },
    };
    const map = buildBlockPathMap(form, blocksConfig, intl);
    let n = 0;
    const result = ensureEmptyBlockIfEmpty(form, { parentId: PAGE }, map, () => `seed-${++n}`, blocksConfig, { intl });
    const items = result.blocks_layout.items;
    expect(items[0]).toBe('header');
    expect(items.length).toBe(2);
    const trailing = result.blocks[items[1]];
    expect(trailing.slotId).toBe('primary');
    expect(trailing.templateInstanceId).toBe('inst-1');
    expect(trailing.fixed).toBeFalsy();
  });

  test('prevSlotId: an empty leading slot before a fixed footer seeds a placeholder BEFORE it', () => {
    const form = {
      '@type': 'Document',
      blocks: { footer: anchor({ slotId: 'footer', prevSlotId: 'primary' }) },
      blocks_layout: { items: ['footer'] },
    };
    const map = buildBlockPathMap(form, blocksConfig, intl);
    let n = 0;
    const result = ensureEmptyBlockIfEmpty(form, { parentId: PAGE }, map, () => `seed-${++n}`, blocksConfig, { intl });
    const items = result.blocks_layout.items;
    expect(items[items.length - 1]).toBe('footer');
    expect(items.length).toBe(2);
    const leading = result.blocks[items[0]];
    expect(leading.slotId).toBe('primary');
    expect(leading.templateInstanceId).toBe('inst-1');
    expect(leading.fixed).toBeFalsy();
  });
});

describe('listContainerChildren — storage-agnostic read', () => {
  test('reads a blocks_layout region from the shared blocks dict', () => {
    const form = makeForm();
    const children = listContainerChildren(form, {
      region: 'footer',
    });
    expect(children).toEqual([
      { id: 'f1', type: 'slate', data: form.blocks.f1 },
      { id: 'f2', type: 'slate', data: form.blocks.f2 },
    ]);
  });

  test('defaults to the items region', () => {
    const form = makeForm();
    expect(
      listContainerChildren(form, { region: 'items' }).map((c) => c.id),
    ).toEqual(['a', 'b']);
  });

  test('reads an object_list container as inline items', () => {
    const parent = {
      slides: [
        { '@id': 's1', '@type': 'slide' },
        { '@id': 's2', '@type': 'slide' },
      ],
    };
    const children = listContainerChildren(parent, {
      region: 'slides',
      isObjectList: true,
      idField: '@id',
      typeField: '@type',
    });
    expect(children).toEqual([
      { id: 's1', type: 'slide', data: parent.slides[0] },
      { id: 's2', type: 'slide', data: parent.slides[1] },
    ]);
  });
});

describe('convertContainerBlock — region preservation', () => {
  const cfg = {
    _page: {
      id: '_page',
      schema: () => ({ properties: { items: { widget: 'blocks_layout' } } }),
    },
    slate: { id: 'slate' },
    colsA: {
      id: 'colsA',
      blockSchema: {
        properties: { items: { widget: 'blocks_layout' }, footer: { widget: 'blocks_layout' } },
      },
    },
    colsB: {
      id: 'colsB',
      blockSchema: { properties: { items: { widget: 'blocks_layout' } } },
    },
  };

  test('carries every region when changing a container block @type', () => {
    const form = {
      '@type': 'Document',
      blocks: {
        'cols-1': {
          '@type': 'colsA',
          blocks: { a: { '@type': 'slate' }, f: { '@type': 'slate' } },
          blocks_layout: { items: ['a'], footer: ['f'] },
        },
      },
      blocks_layout: { items: ['cols-1'] },
    };
    const map = buildBlockPathMap(form, cfg, intl);
    const result = convertContainerBlock(form, map, 'cols-1', 'colsB', cfg, intl);
    const converted = result.blocks['cols-1'];
    expect(converted['@type']).toBe('colsB');
    expect(converted.blocks_layout.items).toEqual(['a']);
    expect(converted.blocks_layout.footer).toEqual(['f']); // preserved
  });
});
