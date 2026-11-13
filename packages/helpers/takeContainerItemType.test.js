/**
 * A block placed in a container that picks its item type takes that type:
 * a listing added (or moved) into a card grid lists cards, with the card
 * mapping stored — what the container's type picker does to the listings
 * already in it (syncChildBlockTypes). Without it the new listing stored no
 * mapping, and the save refused it.
 */
import { describe, expect, test } from 'vitest';

import { buildBlockPathMap } from './buildBlockPathMap.js';
import { takeContainerItemType } from './blockSync.js';

const intl = { formatMessage: (m) => m?.defaultMessage ?? m?.id };
const blocksConfig = {
  grid: {
    schemaEnhancer: { inheritSchemaFrom: { typeField: 'variation' } },
    blockSchema: {
      properties: {
        variation: { title: 'Item type', widget: 'blockTypeSelect', filterConvertibleFrom: '@default' },
        items: { title: 'Items', widget: 'blocks_layout', itemTypeField: 'variation', allowedBlocks: ['card', 'listing'] },
      },
    },
  },
  listing: {
    schemaEnhancer: { inheritSchemaFrom: { typeField: 'variation', mappingField: 'fieldMapping' } },
    blockSchema: {
      properties: {
        variation: { title: 'Item type', widget: 'blockTypeSelect', filterConvertibleFrom: '@default' },
        fieldMapping: {
          title: 'Field mapping',
          widget: 'field_mapping',
          sourceFields: { getURL: { title: 'URL', type: 'string' }, title: { title: 'Title', type: 'string' } },
        },
      },
    },
  },
  card: {
    fieldMappings: { '@default': { getURL: 'url', title: 'title' } },
    blockSchema: {
      properties: {
        title: { title: 'Title', type: 'string' },
        url: { title: 'Link', widget: 'object_browser', mode: 'link' },
      },
    },
  },
  link: {
    fieldMappings: { '@default': { getURL: 'url', title: 'title' } },
    blockSchema: { properties: { title: { title: 'Title', type: 'string' }, url: { title: 'Link', widget: 'object_browser', mode: 'link' } } },
  },
};
const page = (listing) => ({
  blocks: {
    g: { '@type': 'grid', variation: 'card', blocks: { l: { '@type': 'listing', ...listing } }, blocks_layout: { items: ['l'] } },
  },
  blocks_layout: { items: ['g'] },
});
const run = (formData) => {
  const map = buildBlockPathMap(formData, blocksConfig, intl);
  return takeContainerItemType(formData, map, 'l', blocksConfig, intl);
};

describe('takeContainerItemType', () => {
  test('a listing landing in a card grid takes card, with its mapping', () => {
    const out = run(page({}));
    expect(out.blocks.g.blocks.l.variation).toBe('card');
    expect(out.blocks.g.blocks.l.fieldMapping).toEqual({
      getURL: { field: 'url', type: 'link' },
      title: { field: 'title', type: 'string' },
    });
  });

  test('a listing moved in with another item type takes the container\'s, and its mapping', () => {
    const out = run(page({ variation: 'link', fieldMapping: { getURL: { field: 'url', type: 'link' } } }));
    expect(out.blocks.g.blocks.l.variation).toBe('card');
    expect(out.blocks.g.blocks.l.fieldMapping.title).toEqual({ field: 'title', type: 'string' });
  });

  test('one that already has the container\'s type is left as it is', () => {
    const input = page({ variation: 'card', fieldMapping: { title: { field: 'title', type: 'string' } } });
    expect(run(input)).toBe(input);
  });

  test('a block in a container that picks no type is left as it is', () => {
    const input = page({});
    delete input.blocks.g.variation;
    expect(run(input)).toBe(input);
  });
});
