/**
 * A block with a mapping widget (a listing, a feed) always has a mapping, and
 * it is valid: the renderer converts its results by what is stored and has no
 * schema to fall back on. Picking the item type stores the widget's default;
 * content written another way must carry one too.
 */
import { describe, expect, test } from 'vitest';

import { fieldMappingErrors } from './fieldMappingErrors.js';

const listingSchema = {
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
};
const blocksConfig = {
  listing: { blockSchema: listingSchema },
  card: {
    blockSchema: {
      properties: {
        title: { title: 'Title', type: 'string' },
        url: { title: 'Link', widget: 'object_browser', mode: 'link' },
        tags: { title: 'Tags', type: 'array' },
      },
    },
  },
};
const errorsFor = (fieldMapping, extra = {}) =>
  fieldMappingErrors({
    schema: listingSchema,
    blockData: { '@type': 'listing', variation: 'card', ...(fieldMapping !== undefined && { fieldMapping }), ...extra },
    blocksConfig,
  });

describe('fieldMappingErrors', () => {
  test('a stored mapping that fits has none', () => {
    expect(
      errorsFor({
        getURL: { field: 'url', type: 'link' },
        title: { field: 'title', type: 'string' },
        Subject: { field: 'tags', type: 'array' },
      }),
    ).toEqual({});
  });

  test.each([
    ['none at all', undefined],
    ['an empty one', {}],
  ])('a block with a mapping widget and %s', (_label, mapping) => {
    const errors = errorsFor(mapping);
    expect(Object.keys(errors)).toEqual(['fieldMapping']);
    expect(errors.fieldMapping[0]).toMatch(/no field mapping/i);
  });

  test.each([
    ['an entry with no conversion', { title: 'title' }, /conversion/],
    ['an entry with no conversion, as an object', { title: { field: 'title' } }, /conversion/],
    ['a conversion that gives the wrong shape', { getURL: { field: 'url', type: 'string' } }, /can't/],
    ['a field the item type lacks', { title: { field: 'heading', type: 'string' } }, /no field "heading"/],
    ['a source the widget doesn\'t offer', { Creator: { field: 'title', type: 'string' } }, /Creator/],
    ['the address under its old name', { '@id': { field: 'url', type: 'link' } }, /getURL/],
  ])('%s', (_label, mapping, message) => {
    const errors = errorsFor(mapping);
    expect(Object.keys(errors)).toEqual(['fieldMapping']);
    expect(errors.fieldMapping.join(' ')).toMatch(message);
  });

  test("a vocabulary column maps as text", () => {
    const schema = {
      properties: {
        ...listingSchema.properties,
        fieldMapping: { ...listingSchema.properties.fieldMapping, vocabulary: { '@id': 'plone.app.vocabularies.MetadataFields' } },
      },
    };
    const blockData = { '@type': 'listing', variation: 'card', fieldMapping: { Creator: { field: 'title', type: 'string' } } };
    expect(fieldMappingErrors({ schema, blockData, blocksConfig })).toEqual({});
  });

  // In a container that picks the item type, the parent controls `variation`
  // and the effective schema drops it; the block still stores it.
  test("the item type is found when the effective schema hides its field", () => {
    const { variation, ...rest } = listingSchema.properties;
    const config = { ...blocksConfig, listing: { blockSchema: listingSchema } };
    expect(
      fieldMappingErrors({
        schema: { properties: rest },
        blockData: { '@type': 'listing', variation: 'card', fieldMapping: { title: { field: 'title', type: 'string' } } },
        blocksConfig: config,
      }),
    ).toEqual({});
  });

  test('a block with no mapping widget has none to check', () => {
    expect(fieldMappingErrors({ schema: { properties: { title: { title: 'T' } } }, blockData: {}, blocksConfig })).toEqual({});
  });
});
