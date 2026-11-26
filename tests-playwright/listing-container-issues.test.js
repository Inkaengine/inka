/**
 * When does a listing "pin" an item type its container forbids?
 *
 * A listing's item type is either PINNED (choices, or a default nothing ties
 * to the container) or DERIVED (a default on a type field with `blocksField`,
 * which blockSync resolves against the container's allowed types). Only a pin can land outside what the container allows, so only a pin
 * is reported. Getting this wrong fails silently either way: miss a pin and a
 * listing renders blank items; call a derived default a pin and the check cries
 * wolf about the one configuration that is correct.
 */
import { describe, expect, test } from 'vitest';
import { collectListingContainerIssues } from '@inka/testing/discover-blocks';

const withListing = ({ variation = {} }) => ({
  listing: {
    blockSchema: { properties: { variation: { widget: 'blockTypeSelect', ...variation } } },
    schemaEnhancer: {
      inheritSchemaFrom: { typeField: 'variation', mappingField: 'fieldMapping' },
    },
  },
  summary: { fieldMappings: { '@default': { title: 'title' } } },
  navItem: { fieldMappings: { '@default': { title: 'label' } } },
  contextNavigation: {
    blockSchema: {
      properties: { items: { widget: 'blocks_layout', allowedBlocks: ['navItem', 'listing'] } },
    },
  },
});

// An example that puts a listing in the nav, so `no-example` stays quiet and
// each test is about pins alone.
const example = [
  {
    blockType: 'contextNavigation',
    blockData: {
      items: { items: ['l1'] },
      blocks: { l1: { '@type': 'listing' } },
    },
  },
];

const pins = (blocksConfig) =>
  collectListingContainerIssues(blocksConfig, example)
    .filter((i) => i.kind === 'pinned-type-not-allowed')
    .map((i) => i.itemType);

describe('pinned-type-not-allowed', () => {
  test('a default tied to the container is derived, not a pin', () => {
    expect(
      pins(withListing({ variation: { blocksField: '..', default: 'summary' } })),
    ).toEqual([]);
  });

  test('a default with nothing tying it to the container is a pin', () => {
    expect(pins(withListing({ variation: { default: 'summary' } }))).toEqual(['summary']);
  });

  test('a pin the container DOES allow is fine', () => {
    expect(pins(withListing({ variation: { default: 'navItem' } }))).toEqual([]);
  });
});

describe('no-example', () => {
  const config = withListing({ variation: { blocksField: '..', default: 'summary' } });
  const noExample = (blocks) =>
    collectListingContainerIssues(config, blocks).filter((i) => i.kind === 'no-example');

  test('a listing in the region, stored the way content stores it, counts as an example', () => {
    // A blocks_layout field named `items` is a REGION: ids at
    // `blocks_layout.items`, into the shared `blocks` dict. Real context-nav
    // content is stored this way; reading only `blockData.items` reported it as
    // having no listing example while two pages had one.
    expect(
      noExample([
        {
          blockType: 'contextNavigation',
          blockData: {
            blocks: { l1: { '@type': 'listing' } },
            blocks_layout: { items: ['l1'] },
          },
        },
      ]),
    ).toEqual([]);
  });

  test('with no listing anywhere in the region, the pairing is reported', () => {
    expect(
      noExample([
        {
          blockType: 'contextNavigation',
          blockData: {
            blocks: { n1: { '@type': 'navItem' } },
            blocks_layout: { items: ['n1'] },
          },
        },
      ]),
    ).toHaveLength(1);
  });
});
