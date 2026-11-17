import { describe, test, expect, vi } from 'vitest';

// blockSync.js pulls in the React context barrel (JSX in a .js file, which
// vite won't parse). These are pure functions that never touch it.
vi.mock('../context/index.js', () => ({
  getHydraSchemaContext: () => null,
  setHydraSchemaContext: () => {},
  getLiveBlockData: () => null,
}));

import { getConvertTargets } from './blockSync.js';

// -----------------------------------------------------------------------------
// One list of targets for every place an editor changes a block's type (the
// toolbar's "Convert to…", the sidebar header's type dropdown, the sidebar's
// block menu).
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
