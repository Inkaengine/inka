/**
 * What edit_blocks' `update` makes of a block (inka#674): the fields named
 * change and nothing else does. The block and the change are in stored shape.
 */
import { describe, it, expect } from 'vitest';
import { patchBlock } from './patchBlock.mjs';

const schema = {
  properties: {
    title: { title: 'Title' },
    styles: {
      widget: 'object',
      schema: { properties: { align: { title: 'Alignment' }, backgroundColor: { title: 'Background' } } },
    },
    content: {
      widget: 'object',
      schema: { properties: { headline: { widget: 'slate' }, body: { widget: 'blocks_layout' } } },
    },
    href: { widget: 'object_browser' },
    slides: { widget: 'object_list' },
  },
};

const p = (text) => [{ type: 'p', children: [{ text }] }];

describe('patchBlock', () => {
  it('changes the fields named and keeps the rest', () => {
    const block = { '@type': 'x', title: 'Old', styles: { align: 'left' } };
    expect(patchBlock(block, { title: 'New' }, schema)).toEqual({ '@type': 'x', title: 'New', styles: { align: 'left' } });
  });

  it('removes a field set to null, declared or not', () => {
    const block = { '@type': 'x', title: 'Old', backgroundColor: 'soft-blue' };
    expect(patchBlock(block, { title: null, backgroundColor: null }, schema)).toEqual({ '@type': 'x' });
  });

  it('merges into a field that is an object of fields, removing what is null there', () => {
    const block = { '@type': 'x', styles: { align: 'left', backgroundColor: 'grey' } };
    expect(patchBlock(block, { styles: { align: 'center' } }, schema).styles).toEqual({ align: 'center', backgroundColor: 'grey' });
    expect(patchBlock(block, { styles: { backgroundColor: null } }, schema).styles).toEqual({ align: 'left' });
  });

  it('starts an object of fields the block does not have yet', () => {
    expect(patchBlock({ '@type': 'x' }, { styles: { align: 'center' } }, schema).styles).toEqual({ align: 'center' });
  });

  it('replaces any other value whole: a link, a list of objects, rich text', () => {
    // A link's object is the target's summary: merging would keep the old target's facts.
    const block = { '@type': 'x', href: [{ '@id': '/a', title: 'A' }], slides: [{ '@id': 's1' }, { '@id': 's2' }], content: { headline: p('Old') } };
    const out = patchBlock(block, { href: [{ '@id': '/b' }], slides: [{ '@id': 's2' }], content: { headline: p('New') } }, schema);
    expect(out.href).toEqual([{ '@id': '/b' }]);
    expect(out.slides).toEqual([{ '@id': 's2' }]);
    expect(out.content.headline).toEqual(p('New'));
  });

  it('replaces a region named, and only that one: the others keep their blocks', () => {
    const block = {
      '@type': 'search',
      blocks: { q1: { '@type': 'slate' }, l1: { '@type': 'listing' } },
      blocks_layout: { quickAnswer: ['q1'], listing: ['l1'] },
    };
    const out = patchBlock(block, { blocks: { q2: { '@type': 'slate' } }, blocks_layout: { quickAnswer: ['q2'] } }, schema);
    expect(out.blocks).toEqual({ q2: { '@type': 'slate' }, l1: { '@type': 'listing' } });
    expect(out.blocks_layout).toEqual({ quickAnswer: ['q2'], listing: ['l1'] });
  });

  it('keeps a block the region still lists by its id, as sent', () => {
    const block = { '@type': 'x', blocks: { a: { '@type': 'slate', value: p('A') }, b: { '@type': 'slate' } }, blocks_layout: { items: ['a', 'b'] } };
    const out = patchBlock(block, { blocks: { b: { '@type': 'slate', value: p('B') } }, blocks_layout: { items: ['b'] } }, schema);
    expect(out.blocks).toEqual({ b: { '@type': 'slate', value: p('B') } });
    expect(out.blocks_layout).toEqual({ items: ['b'] });
  });

  it('does the same for the regions inside an object of fields', () => {
    const block = {
      '@type': 'objectBlocks',
      content: { headline: p('Old'), blocks: { c1: { '@type': 'slate' }, c2: { '@type': 'slate' } }, blocks_layout: { body: ['c1', 'c2'] } },
    };
    const out = patchBlock(block, { content: { headline: p('New') } }, schema);
    expect(out.content).toEqual({ headline: p('New'), blocks: block.content.blocks, blocks_layout: { body: ['c1', 'c2'] } });
  });

  it('leaves the block it was given as it was', () => {
    const block = { '@type': 'x', styles: { align: 'left' }, blocks: { a: {} }, blocks_layout: { items: ['a'] } };
    const copy = structuredClone(block);
    patchBlock(block, { styles: { align: null }, blocks: {}, blocks_layout: { items: [] } }, schema);
    expect(block).toEqual(copy);
  });
});
