import { describe, test, expect } from 'vitest';
import { expandTemplatesSync, insertSnippetBlocks } from '@volto-hydra/helpers';

/**
 * Regression test for the gap that let #234 (blocks_layout regions) merge green
 * while the SSR render-merge silently couldn't handle a nested container in the
 * regions shape.
 *
 * The existing merge tests (applyLayoutTemplate.test.js) use only FLAT layouts
 * (top-level slate blocks), and regions.test.js covers the admin path
 * (buildBlockPathMap), not the render-merge. So nothing ran a nested container
 * in the new `blocks_layout.<region>` shape through expandTemplatesSync — the
 * exact path a branded footer (a `columns` block forced layout) takes on SSR.
 */
describe('expandTemplatesSync — nested container in blocks_layout region (#234)', () => {
  // A branded footer layout: a columns block (regions shape) with one column
  // holding a slate, all fixed+readOnly+slotId, like a real all-fixed layout.
  const template = {
    '@id': '/templates/footer-layout',
    blocks: {
      cols: {
        '@type': 'columns',
        fixed: true,
        readOnly: true,
        templateId: '/templates/footer-layout',
        slotId: 'cols',
        blocks: {
          'col-1': {
            '@type': 'column',
            fixed: true,
            readOnly: true,
            templateId: '/templates/footer-layout',
            slotId: 'col-1',
            blocks: {
              'txt-1': {
                '@type': 'slate',
                fixed: true,
                readOnly: true,
                templateId: '/templates/footer-layout',
                slotId: 'txt-1',
                value: [{ text: 'Footer text' }],
              },
            },
            // column's content region (default `items`)
            blocks_layout: { items: ['txt-1'] },
          },
        },
        // #234 regions shape: the `columns` region is a sub-key of the block's
        // own blocks_layout dict — NOT a separate `columns` field with `.items`.
        blocks_layout: { columns: ['col-1'] },
      },
    },
    blocks_layout: { items: ['cols'] },
  };

  test('forced layout preserves the columns block and its nested column content', () => {
    const result = expandTemplatesSync([], {
      blocks: {},
      templates: { '/templates/footer-layout': template },
      templateState: {},
      allowedLayouts: ['/templates/footer-layout'],
    });

    const cols = result.find((b) => b['@type'] === 'columns');
    expect(cols).toBeDefined();

    // The nested `columns` region must survive the merge (currently it's dropped
    // / throws because findBlocksLayoutField only recognizes a `.items` field).
    // Nested ids are instance-scoped, so assert structure, not the exact template ids.
    const colIds = cols.blocks_layout?.columns;
    expect(colIds).toHaveLength(1);
    const col = cols.blocks?.[colIds[0]];
    expect(col).toBeDefined();

    // And the column's own content must survive.
    const txtIds = col.blocks_layout?.items;
    expect(txtIds).toHaveLength(1);
    expect(col.blocks?.[txtIds[0]]?.['@type']).toBe('slate');
  });
});

/**
 * The render-merge path (above) is not the only one that walks a container's
 * children. Inserting a snippet goes through cloneBlocksWithNewIds ->
 * cloneBlockFilteringNested, which (pre-fix) only recognised a `.items` region.
 * A nested-region container (a columns block) therefore kept its template
 * blocks AND their original ids — an id collision waiting to happen on the
 * second insert. This is the gap a region-only fix to expandTemplatesSync left
 * behind; both paths must walk every region.
 */
describe('insertSnippetBlocks — nested container in blocks_layout region (#234)', () => {
  const snippet = {
    '@id': '/snippets/cols-snippet',
    blocks: {
      cols: {
        '@type': 'columns',
        slotId: 'cols',
        blocks: {
          'col-1': {
            '@type': 'column',
            slotId: 'col-1',
            blocks: {
              'txt-1': { '@type': 'slate', slotId: 'txt-1', value: [{ text: 'Snippet text' }] },
            },
            blocks_layout: { items: ['txt-1'] },
          },
        },
        // regions shape: children live under the `columns` region, not `.items`
        blocks_layout: { columns: ['col-1'] },
      },
    },
    blocks_layout: { items: ['cols'] },
  };

  test('preserves and re-ids the nested column content', () => {
    const page = { blocks: {}, blocks_layout: { items: [] } };
    let n = 0;
    const uuid = () => `new-${++n}`;

    const result = insertSnippetBlocks(page, snippet, 0, uuid);

    // The columns block lands in the page with a fresh id.
    expect(result.blocks_layout.items).toHaveLength(1);
    const cols = result.blocks[result.blocks_layout.items[0]];
    expect(cols['@type']).toBe('columns');

    // The `columns` region survives — and is re-ided (pre-fix it kept 'col-1',
    // because cloneBlockFilteringNested only walked `.items`).
    expect(cols.blocks_layout.columns).toHaveLength(1);
    const colId = cols.blocks_layout.columns[0];
    expect(colId).not.toBe('col-1');
    expect(cols.blocks[colId]['@type']).toBe('column');

    // The column's own content survives and is re-ided too.
    expect(cols.blocks[colId].blocks_layout.items).toHaveLength(1);
    const txtId = cols.blocks[colId].blocks_layout.items[0];
    expect(txtId).not.toBe('txt-1');
    expect(cols.blocks[colId].blocks[txtId]['@type']).toBe('slate');
  });
});
