import { describe, it, expect } from 'vitest';
import { nestedStatus, untranslatedBlockIds } from './index.js';

/**
 * What a sidebar blind should say about the blocks it hides.
 *
 * A container's blind is collapsed: the editor sees "GridBlock", not the
 * teaser three levels down that is refusing to save, or still holding the
 * language it was copied from. Both are the same question — "does anything in
 * here need me?" — so this answers it once, over any per-block status, and the
 * blind renders whatever comes back.
 *
 * Severity decides which marker wins when a container holds both.
 */
const page = {
  grid: {
    '@type': 'gridBlock',
    blocks: {
      t1: { '@type': 'teaser', '@canonical': 'src-t1' },
      inner: {
        '@type': 'accordion',
        blocks: { leaf: { '@type': 'slate' } },
        blocks_layout: { items: ['leaf'] },
      },
    },
    blocks_layout: { items: ['t1', 'inner'] },
  },
  lonely: { '@type': 'slate' },
};

describe('nestedStatus', () => {
  it('says nothing when nothing inside needs attention', () => {
    expect(nestedStatus(page.grid, { statuses: {} })).toBeNull();
    expect(nestedStatus(page.lonely, { statuses: { lonely: 'error' } })).toBeNull();
  });

  it('reports a child that needs attention, and how many', () => {
    expect(nestedStatus(page.grid, { statuses: { t1: 'error' } })).toEqual({
      status: 'error',
      count: 1,
    });
  });

  it('reaches a block nested further down than its own children', () => {
    expect(nestedStatus(page.grid, { statuses: { leaf: 'untranslated' } })).toEqual({
      status: 'untranslated',
      count: 1,
    });
  });

  it('counts every affected descendant, and the worst one decides', () => {
    expect(
      nestedStatus(page.grid, {
        statuses: { t1: 'untranslated', leaf: 'error' },
      }),
    ).toEqual({ status: 'error', count: 2 });
  });

  it('ranks an untranslated block above one that is merely out of date', () => {
    // What the reader gets decides: untranslated shows them English on a German
    // page; stale shows them German that is a revision behind.
    expect(
      nestedStatus(page.grid, { statuses: { t1: 'stale', leaf: 'untranslated' } }),
    ).toEqual({ status: 'untranslated', count: 2 });
  });

  it('is about what is INSIDE — a block\'s own status is the blind\'s own business', () => {
    expect(nestedStatus(page.grid, { statuses: { grid: 'error' } })).toBeNull();
  });
});

describe('untranslatedBlockIds', () => {
  it('names the copies that still read as the page they came from', () => {
    const source = {
      'src-t1': { '@type': 'teaser', title: 'Design' },
      'src-s1': { '@type': 'slate', value: [{ type: 'p', children: [{ text: 'Hello' }] }] },
    };
    const translation = {
      t1: { '@type': 'teaser', '@canonical': 'src-t1', title: 'Design' },
      s1: {
        '@type': 'slate',
        '@canonical': 'src-s1',
        value: [{ type: 'p', children: [{ text: 'Hallo' }] }],
      },
      own: { '@type': 'slate', value: [{ type: 'p', children: [{ text: 'Neu' }] }] },
    };

    // t1 is untouched since the copy; s1 has been translated; `own` was never
    // a copy at all.
    expect(untranslatedBlockIds(translation, source)).toEqual(['t1']);
  });

  it('looks inside containers, where most of a page lives', () => {
    const source = {
      'src-grid': {
        '@type': 'gridBlock',
        blocks: { 'src-t1': { '@type': 'teaser', title: 'Design' } },
        blocks_layout: { items: ['src-t1'] },
      },
    };
    const translation = {
      grid: {
        '@type': 'gridBlock',
        '@canonical': 'src-grid',
        blocks: { t1: { '@type': 'teaser', '@canonical': 'src-t1', title: 'Design' } },
        blocks_layout: { items: ['t1'] },
      },
    };

    expect(untranslatedBlockIds(translation, source)).toEqual(['grid', 't1']);
  });
});
