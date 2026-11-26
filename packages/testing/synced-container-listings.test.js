/**
 * A synced container (a grid of one item type, chosen by its `itemTypeField`)
 * may hold only that type, and listings: each expands into items of the
 * synced type. A listing is any block whose schema maps its results onto
 * items (a `fieldMapping` field), not only the block named `listing` — a
 * frontend's related-items or search-shortcuts source is one too.
 */
import { describe, test, expect } from 'vitest';
import { collectWidgetShapeIssues } from './discover-blocks.js';

const gridSchema = {
  properties: {
    variation: { title: 'Item type', widget: 'blockTypeSelect' },
    items: { title: 'Items', widget: 'blocks_layout', itemTypeField: 'variation', allowedBlocks: ['card', 'listing', 'related'] },
  },
};
const blocksConfig = {
  card: { blockSchema: { properties: { title: { title: 'Title' } } } },
  listing: { blockSchema: { properties: { fieldMapping: { title: 'Fields' }, querystring: { title: 'Criteria' } } } },
  related: { blockSchema: { properties: { fieldMapping: { title: 'Fields' }, relationField: { title: 'Relation' } } } },
  note: { blockSchema: { properties: { text: { title: 'Text' } } } },
};

const issuesFor = (childType) => {
  const out = [];
  const grid = {
    '@type': 'cards',
    variation: 'card',
    blocks: { c1: { '@type': 'card', title: 'One' }, c2: { '@type': childType } },
    blocks_layout: { items: ['c1', 'c2'] },
  };
  collectWidgetShapeIssues(grid, gridSchema, '/page', 'g1', out, 'cards', undefined, undefined, blocksConfig);
  return out.flatMap((r) => r.issues).filter((i) => i.includes('synced container'));
};

describe('a synced container', () => {
  test('may hold the plain listing', () => {
    expect(issuesFor('listing')).toEqual([]);
  });

  test('may hold any other listing: a block whose schema maps its results onto items', () => {
    expect(issuesFor('related')).toEqual([]);
  });

  test('may not hold a block of another type that is not a listing', () => {
    expect(issuesFor('note')).toEqual([expect.stringContaining('holds a "note" child')]);
  });
});
