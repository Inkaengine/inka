import { describe, test, expect, vi } from 'vitest';

// blockSync.js pulls in the React context barrel (JSX in a .js file, which
// vite won't parse). These are pure functions that never touch it.
vi.mock('../context/index.js', () => ({
  getHydraSchemaContext: () => null,
  setHydraSchemaContext: () => {},
  getLiveBlockData: () => null,
}));

import {
  convertBlockInPlace,
  getConversionLosses,
  getConvertTargets,
} from './blockSync.js';
import { buildBlockPathMap } from '@volto-hydra/helpers/buildBlockPathMap.js';

// -----------------------------------------------------------------------------
// One conversion for every place an editor changes a block's type (the toolbar's
// "Convert to…", the sidebar header's type dropdown, the sidebar's block menu),
// and what that conversion would lose: a field with a value that no field of
// the new type receives.
// -----------------------------------------------------------------------------

const intl = { formatMessage: (m) => m?.defaultMessage ?? '' };

const blocksConfig = {
  // Two value blocks: `note` reaches `banner` by renaming title → heading;
  // its `extra` has nowhere to go.
  note: {
    title: 'Note',
    blockSchema: {
      properties: {
        title: { title: 'Title', type: 'string' },
        href: { title: 'Link', widget: 'url' },
        extra: { title: 'Extra', type: 'string' },
        size: { title: 'Size', type: 'string', default: 'm' },
        // An object field whose sub-fields have defaults: holding only those
        // defaults (as the editor fills them in) is not content.
        styles: {
          title: 'Styling',
          widget: 'object',
          schema: {
            properties: {
              align: { title: 'Alignment', type: 'string', default: 'left' },
            },
          },
        },
      },
    },
    fieldMappings: { banner: { heading: 'title', link: 'href' } },
  },
  banner: {
    title: 'Banner',
    blockSchema: {
      properties: {
        heading: { title: 'Heading', type: 'string' },
        link: { title: 'Link', widget: 'url' },
        // Same name as the note's: kept as it is.
        size: { title: 'Size', type: 'string', default: 'm' },
      },
    },
    fieldMappings: { note: { title: 'heading', href: 'link' } },
  },

  // Two containers of items. `richList` has a heading and options a `plainList`
  // does not; its `richItem`s have a `tag` a `plainItem` does not.
  richItem: {
    title: 'Rich item',
    blockSchema: {
      properties: {
        title: { title: 'Title', type: 'string' },
        tag: { title: 'Tag', type: 'string' },
      },
    },
    fieldMappings: { plainItem: { title: 'title' } },
  },
  plainItem: {
    title: 'Plain item',
    blockSchema: { properties: { title: { title: 'Title', type: 'string' } } },
    fieldMappings: { richItem: { title: 'title' } },
  },
  richList: {
    title: 'Rich list',
    blockSchema: {
      properties: {
        heading: { title: 'List heading', type: 'string' },
        options: { title: 'Options', type: 'array', default: ['drag'] },
        items: {
          widget: 'blocks_layout',
          allowedBlocks: ['richItem'],
          defaultBlockType: 'richItem',
        },
      },
    },
    fieldMappings: { plainList: { items: 'items' } },
  },
  plainList: {
    title: 'Plain list',
    blockSchema: {
      properties: {
        items: {
          widget: 'blocks_layout',
          allowedBlocks: ['plainItem'],
          defaultBlockType: 'plainItem',
        },
      },
    },
    fieldMappings: { richList: { items: 'items' } },
  },
};

const page = (block) => ({
  '@type': 'Document',
  blocks: { b1: block },
  blocks_layout: { items: ['b1'] },
});

const convert = (formData, newType) => {
  const bpm = buildBlockPathMap(formData, blocksConfig, intl);
  const after = convertBlockInPlace(formData, bpm, 'b1', newType, blocksConfig, intl);
  return {
    after,
    losses: getConversionLosses(formData, after, 'b1', blocksConfig, intl),
  };
};

describe('getConversionLosses', () => {
  test('a field with a value that no field of the new type receives is lost', () => {
    const { after, losses } = convert(
      page({ '@type': 'note', title: 'Hi', href: '/a', extra: 'kept?' }),
      'banner',
    );
    expect(after.blocks.b1.heading).toBe('Hi');
    expect(losses).toEqual([
      {
        blockId: 'b1',
        from: 'Note',
        to: 'Banner',
        fields: [{ field: 'extra', title: 'Extra' }],
      },
    ]);
  });

  test('an object field holding only its sub-fields defaults is not lost', () => {
    const { losses } = convert(
      page({ '@type': 'note', title: 'Hi', styles: { align: 'left' } }),
      'banner',
    );
    expect(losses).toEqual([]);
  });

  test('an object field with a value of its own is lost', () => {
    const { losses } = convert(
      page({ '@type': 'note', title: 'Hi', styles: { align: 'right' } }),
      'banner',
    );
    expect(losses[0].fields).toEqual([{ field: 'styles', title: 'Styling' }]);
  });

  test('renamed, same-named, empty and default fields are not lost', () => {
    const { losses } = convert(
      page({ '@type': 'note', title: 'Hi', href: '/a', extra: '', size: 'l' }),
      'banner',
    );
    expect(losses).toEqual([]);
  });

  test("a container's own fields and its items' fields are both listed", () => {
    const formData = page({
      '@type': 'richList',
      heading: 'Pick one',
      options: ['drag'], // the default: nothing chosen
      blocks: {
        i1: { '@type': 'richItem', title: 'One', tag: 'New' },
        i2: { '@type': 'richItem', title: 'Two' },
      },
      blocks_layout: { items: ['i1', 'i2'] },
    });
    const { after, losses } = convert(formData, 'plainList');

    // The items are carried over, converted to the type the region allows.
    const out = after.blocks.b1;
    expect(out.blocks_layout.items).toEqual(['i1', 'i2']);
    expect(out.blocks.i1['@type']).toBe('plainItem');
    expect(out.blocks.i1.title).toBe('One');

    expect(losses).toEqual([
      {
        blockId: 'b1',
        from: 'Rich list',
        to: 'Plain list',
        fields: [{ field: 'heading', title: 'List heading' }],
      },
      {
        blockId: 'i1',
        from: 'Rich item',
        to: 'Plain item',
        fields: [{ field: 'tag', title: 'Tag' }],
      },
    ]);
  });

  test('converting the other way loses nothing', () => {
    const formData = page({
      '@type': 'plainList',
      blocks: { i1: { '@type': 'plainItem', title: 'One' } },
      blocks_layout: { items: ['i1'] },
    });
    const { after, losses } = convert(formData, 'richList');
    expect(after.blocks.b1.blocks.i1['@type']).toBe('richItem');
    expect(losses).toEqual([]);
  });
});

describe('getConvertTargets', () => {
  test('a value block is offered the types its fieldMappings reach', () => {
    const types = getConvertTargets({ '@type': 'note' }, blocksConfig, null, intl);
    expect(types.map((t) => t.type)).toEqual(['banner']);
    expect(types[0].title).toBe('Banner');
  });

  test('a container with items is offered the containers that take them', () => {
    const block = {
      '@type': 'richList',
      blocks: { i1: { '@type': 'richItem', title: 'One' } },
      blocks_layout: { items: ['i1'] },
    };
    const types = getConvertTargets(block, blocksConfig, null, intl);
    expect(types.map((t) => t.type)).toContain('plainList');
  });

  test('a target its place does not allow is not offered', () => {
    const types = getConvertTargets({ '@type': 'note' }, blocksConfig, ['note'], intl);
    expect(types).toEqual([]);
  });
});
