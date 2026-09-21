import { describe, it, expect } from 'vitest';
import { cloneBlocksForTranslation } from './index.js';

/**
 * Copying a page's blocks into a translation.
 *
 * Volto's own copy walks blocks_layout and gives each block it finds a new
 * uid. That is only the top level: a container's children keep the ids they
 * had, so the same uid names a block on two different pages, and everything
 * that addresses a block by uid — selection, inline editing, the bridge —
 * cannot tell which page is meant.
 *
 * Every block gets a new id here, at every depth, reached through the same
 * container API the rest of the editor uses (regions AND object_list
 * children). `@canonical` records where each copy came from, which is what
 * tells a translator later which blocks still hold the original language.
 */
const ids = () => {
  let n = 0;
  return () => `new-${++n}`;
};

describe('cloneBlocksForTranslation', () => {
  it('renames a flat page, remembering where each block came from', () => {
    const { blocks, layout } = cloneBlocksForTranslation(
      {
        t1: { '@type': 'title' },
        s1: { '@type': 'slate', value: [{ type: 'p', children: [{ text: 'Hello' }] }] },
      },
      ['t1', 's1'],
      ids(),
    );

    expect(layout).toEqual(['new-1', 'new-2']);
    expect(blocks['new-1']).toMatchObject({ '@type': 'title', '@canonical': 't1' });
    expect(blocks['new-2']).toMatchObject({ '@type': 'slate', '@canonical': 's1' });
    expect(blocks['new-2'].value).toEqual([
      { type: 'p', children: [{ text: 'Hello' }] },
    ]);
  });

  it('renames blocks nested in a region, not just the container', () => {
    const { blocks, layout } = cloneBlocksForTranslation(
      {
        grid: {
          '@type': 'gridBlock',
          blocks: {
            c1: { '@type': 'slate', value: [{ type: 'p', children: [{ text: 'One' }] }] },
            c2: { '@type': 'image', url: '/img.png' },
          },
          blocks_layout: { items: ['c1', 'c2'] },
        },
      },
      ['grid'],
      ids(),
    );

    const grid = blocks[layout[0]];
    expect(grid['@canonical']).toBe('grid');
    const childIds = grid.blocks_layout.items;
    expect(childIds).not.toContain('c1');
    expect(childIds).not.toContain('c2');
    expect(Object.keys(grid.blocks)).toEqual(childIds);
    expect(grid.blocks[childIds[0]]).toMatchObject({
      '@type': 'slate',
      '@canonical': 'c1',
    });
    expect(grid.blocks[childIds[1]]).toMatchObject({
      '@type': 'image',
      url: '/img.png',
      '@canonical': 'c2',
    });
  });

  it('renames blocks held in an object_list, which is a container too', () => {
    const { blocks, layout } = cloneBlocksForTranslation(
      {
        slider: {
          '@type': 'slider',
          slides: [
            { '@id': 'sl1', '@type': 'slide', title: 'First' },
            { '@id': 'sl2', '@type': 'slide', title: 'Second' },
          ],
        },
      },
      ['slider'],
      ids(),
      // Which fields hold children, per block type — the same hint the rest of
      // the container API takes (a slider's slides are keyed by '@id').
      { slider: { slides: '@id' } },
    );

    const slider = blocks[layout[0]];
    const slideIds = slider.slides.map((s) => s['@id']);
    expect(slideIds).not.toContain('sl1');
    expect(slideIds).not.toContain('sl2');
    expect(slider.slides[0]).toMatchObject({ title: 'First', '@canonical': 'sl1' });
    expect(slider.slides[1]).toMatchObject({ title: 'Second', '@canonical': 'sl2' });
  });

  it('goes all the way down, however deep the containers nest', () => {
    const { blocks, layout } = cloneBlocksForTranslation(
      {
        outer: {
          '@type': 'gridBlock',
          blocks: {
            inner: {
              '@type': 'accordion',
              blocks: { leaf: { '@type': 'slate' } },
              blocks_layout: { items: ['leaf'] },
            },
          },
          blocks_layout: { items: ['inner'] },
        },
      },
      ['outer'],
      ids(),
    );

    const outer = blocks[layout[0]];
    const inner = outer.blocks[outer.blocks_layout.items[0]];
    const leafId = inner.blocks_layout.items[0];
    expect(leafId).not.toBe('leaf');
    expect(inner.blocks[leafId]).toMatchObject({ '@type': 'slate', '@canonical': 'leaf' });
  });

  it('leaves the page it copied from untouched', () => {
    const original = {
      grid: {
        '@type': 'gridBlock',
        blocks: { c1: { '@type': 'slate' } },
        blocks_layout: { items: ['c1'] },
      },
    };
    cloneBlocksForTranslation(original, ['grid'], ids());
    expect(Object.keys(original.grid.blocks)).toEqual(['c1']);
    expect(original.grid['@canonical']).toBeUndefined();
  });
});

describe('what a copy records about its source', () => {
  it('stamps the fingerprint of the block it was copied from, at every depth', () => {
    // `@canonical` pairs a copy with its source; the fingerprint is what later
    // says that source has CHANGED. Without it a translator has no way to know
    // which blocks to revisit short of re-reading the page.
    const source = {
      grid: {
        '@type': 'gridBlock',
        headline: 'What we do',
        blocks: { t1: { '@type': 'teaser', title: 'Design' } },
        blocks_layout: { items: ['t1'] },
      },
    };
    let n = 0;
    const { blocks, layout } = cloneBlocksForTranslation(
      source,
      ['grid'],
      () => `new-${(n += 1)}`,
      null,
      (block, id) => `fp-${id}`,
    );

    const grid = blocks[layout[0]];
    expect(grid['@translation']).toEqual({ fingerprint: 'fp-grid' });
    const childId = grid.blocks_layout.items[0];
    expect(grid.blocks[childId]['@translation']).toEqual({ fingerprint: 'fp-t1' });
  });

  it('records nothing when it cannot fingerprint, rather than a wrong one', () => {
    const source = { s1: { '@type': 'slate', value: [] } };
    const { blocks, layout } = cloneBlocksForTranslation(
      source,
      ['s1'],
      () => 'new-1',
      null,
      // A block type this frontend has no schema for.
      () => null,
    );
    expect(blocks[layout[0]]['@canonical']).toBe('s1');
    expect(blocks[layout[0]]['@translation']).toBeUndefined();
  });
});
