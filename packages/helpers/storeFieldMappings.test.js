/**
 * Content not saved through the editor (a conversion, a fixture, a migration)
 * gets the field mapping the editor would have stored: the widget's default
 * for the item type when there is none, every entry with its conversion, the
 * address under `getURL`. What `plone-content field-mappings` runs.
 */
import { describe, expect, test } from 'vitest';

import { withFieldMappings } from './storeFieldMappings.js';

const blocksConfig = {
  listing: {
    blockSchema: {
      properties: {
        variation: { title: 'Item type', widget: 'blockTypeSelect', filterConvertibleFrom: '@default' },
        fieldMapping: {
          title: 'Field mapping',
          widget: 'field_mapping',
          sourceFields: {
            getURL: { title: 'URL', type: 'string' },
            title: { title: 'Title', type: 'string' },
            Subject: { title: 'Categories', type: 'array' },
          },
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
        tags: { title: 'Tags', type: 'array' },
      },
    },
  },
  grid: {
    blockSchema: {
      properties: { blocks: { title: 'Items', widget: 'blocks_layout', allowedBlocks: ['listing'] } },
    },
  },
};
const intl = { formatMessage: (m) => m?.defaultMessage ?? m?.id };
const page = (listing) => ({
  blocks: {
    g: { '@type': 'grid', blocks: { l: { '@type': 'listing', ...listing } }, blocks_layout: { items: ['l'] } },
  },
  blocks_layout: { items: ['g'] },
});
const stored = (out) => out.blocks.g.blocks.l.fieldMapping;

describe('withFieldMappings', () => {
  test("a block with none gets the widget's default for its item type", () => {
    expect(stored(withFieldMappings(page({ variation: 'card' }), blocksConfig, intl))).toEqual({
      getURL: { field: 'url', type: 'link' },
      title: { field: 'title', type: 'string' },
    });
  });

  test('a stored mapping keeps its choices, each given its conversion', () => {
    const out = withFieldMappings(
      page({ variation: 'card', fieldMapping: { title: 'title', Subject: { field: 'tags' } } }),
      blocksConfig,
      intl,
    );
    expect(stored(out)).toEqual({
      title: { field: 'title', type: 'string' },
      Subject: { field: 'tags', type: 'array' },
    });
  });

  test("the address's old name becomes getURL", () => {
    const out = withFieldMappings(page({ variation: 'card', fieldMapping: { '@id': { field: 'url' } } }), blocksConfig, intl);
    expect(stored(out)).toEqual({ getURL: { field: 'url', type: 'link' } });
  });

  test('a conversion already stored is kept', () => {
    const fieldMapping = { Subject: { field: 'title', type: 'string' } };
    expect(stored(withFieldMappings(page({ variation: 'card', fieldMapping }), blocksConfig, intl))).toEqual(fieldMapping);
  });

  test('a block with no item type has nothing to default from, and says so', () => {
    expect(() => withFieldMappings(page({}), blocksConfig, intl)).toThrow(/item type/);
  });

  test('an entry no conversion fits is refused, not guessed', () => {
    expect(() =>
      withFieldMappings(page({ variation: 'card', fieldMapping: { Subject: { field: 'url' } } }), blocksConfig, intl),
    ).toThrow(/Subject.*url/);
  });

  test('the page passed in is not changed', () => {
    const input = page({ variation: 'card' });
    withFieldMappings(input, blocksConfig, intl);
    expect(input.blocks.g.blocks.l.fieldMapping).toBeUndefined();
  });
});
