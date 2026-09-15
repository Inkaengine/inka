import { describe, it, expect } from 'vitest';
import { migrateContent } from './migrate-columns.mjs';

describe('migrateContent — mis-modelled multi-node slate', () => {
  it('converts a gridBlock of title+body cards into a columns block of stacked single-node slates', () => {
    const content = {
      '@id': '/p',
      blocks: {
        grid: {
          '@type': 'gridBlock',
          blocks: {
            c1: {
              '@type': 'slate',
              value: [
                { type: 'p', children: [{ type: 'strong', children: [{ text: 'Compliance' }] }] },
                { type: 'p', children: [{ text: 'Accessibility and the standards.' }] },
              ],
            },
          },
          blocks_layout: { items: ['c1'] },
        },
      },
      blocks_layout: { items: ['grid'] },
    };

    const out = migrateContent(content);
    // the grid keeps its uid but is now a columns block, ordered under blocks_layout.columns
    const cols = out.blocks.grid;
    expect(cols['@type']).toBe('columns');
    expect(cols.blocks_layout).toEqual({ columns: ['col-c1'] });
    // each cell became a column whose items are the split single-node slates
    const col = cols.blocks['col-c1'];
    expect(col['@type']).toBe('column');
    expect(col.blocks_layout).toEqual({ items: ['c1-1', 'c1-2'] });
    expect(col.blocks['c1-1']).toEqual({
      '@type': 'slate',
      value: [{ type: 'p', children: [{ type: 'strong', children: [{ text: 'Compliance' }] }] }],
      plaintext: 'Compliance',
    });
    expect(col.blocks['c1-2']).toEqual({
      '@type': 'slate',
      value: [{ type: 'p', children: [{ text: 'Accessibility and the standards.' }] }],
      plaintext: 'Accessibility and the standards.',
    });
  });

  it('splits a top-level multi-node slate into single-node slates in place', () => {
    const content = {
      '@id': '/f',
      blocks: {
        s: { '@type': 'slate', value: [
          { type: 'p', children: [{ text: 'Line one.' }] },
          { type: 'p', children: [{ text: 'Line two.' }] },
        ] },
        keep: { '@type': 'image' },
      },
      blocks_layout: { items: ['s', 'keep'] },
    };
    const out = migrateContent(content);
    expect(out.blocks_layout.items).toEqual(['s-1', 's-2', 'keep']);
    expect(out.blocks['s-1']).toEqual({ '@type': 'slate', value: [{ type: 'p', children: [{ text: 'Line one.' }] }], plaintext: 'Line one.' });
    expect(out.blocks['s-2']).toEqual({ '@type': 'slate', value: [{ type: 'p', children: [{ text: 'Line two.' }] }], plaintext: 'Line two.' });
    expect(out.blocks.keep).toEqual({ '@type': 'image' });
  });

  it('leaves single-node slate and non-slate blocks untouched', () => {
    const content = {
      '@id': '/ok',
      blocks: { a: { '@type': 'slate', value: [{ type: 'p', children: [{ text: 'One.' }] }] }, b: { '@type': 'image' } },
      blocks_layout: { items: ['a', 'b'] },
    };
    expect(migrateContent(content)).toEqual(content);
  });
});
