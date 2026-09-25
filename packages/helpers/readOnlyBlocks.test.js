import { describe, it, expect } from 'vitest';
import { withAllBlocksReadOnly } from './index.js';

/**
 * A page nobody may edit.
 *
 * Read-only is already a property of a BLOCK here — hydra.js collects no
 * editable fields for one, and the sidebar shows its settings as text. A page
 * that may be read but not changed is therefore not a new mode: it is every
 * block on it marked read-only, at every depth, which is what a compared
 * language or an old version is.
 */
describe('withAllBlocksReadOnly', () => {
  it('marks every block, including the ones inside containers', () => {
    const readOnly = withAllBlocksReadOnly({
      s1: { '@type': 'slate' },
      grid: {
        '@type': 'gridBlock',
        blocks: {
          t1: { '@type': 'teaser' },
          inner: {
            '@type': 'accordion',
            blocks: { leaf: { '@type': 'slate' } },
            blocks_layout: { items: ['leaf'] },
          },
        },
        blocks_layout: { items: ['t1', 'inner'] },
      },
    });

    expect(readOnly.s1.readOnly).toBe(true);
    expect(readOnly.grid.readOnly).toBe(true);
    expect(readOnly.grid.blocks.t1.readOnly).toBe(true);
    expect(readOnly.grid.blocks.inner.readOnly).toBe(true);
    expect(readOnly.grid.blocks.inner.blocks.leaf.readOnly).toBe(true);
  });

  it('marks object_list children too, given the field map', () => {
    const readOnly = withAllBlocksReadOnly(
      {
        slider: {
          '@type': 'slider',
          slides: [{ '@id': 'sl1', '@type': 'slide', title: 'First' }],
        },
      },
      { slider: { slides: '@id' } },
    );

    expect(readOnly.slider.readOnly).toBe(true);
    expect(readOnly.slider.slides[0].readOnly).toBe(true);
  });

  it('leaves the page it was given alone', () => {
    const original = { s1: { '@type': 'slate' } };
    withAllBlocksReadOnly(original);
    expect(original.s1.readOnly).toBeUndefined();
  });
});
