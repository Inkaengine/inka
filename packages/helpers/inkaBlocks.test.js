/**
 * Every block an allowedBlocks list names must be one the frontend declares
 * (or Inka's own): a name nobody declares is offered by nothing, and content
 * holding it is a block the editor can't edit and the site can't draw.
 */
import { describe, test, expect } from 'vitest';
import { undeclaredBlockProblems } from './inkaBlocks.js';

const block = (properties, extra = {}) => ({
  title: 'X', group: 'common', blockSchema: { properties }, ...extra,
});

describe('undeclaredBlockProblems', () => {
  test('a region naming a declared block, or Inka\'s text block, passes', () => {
    const config = {
      grid: block({ items: { widget: 'blocks_layout', allowedBlocks: ['card', 'slate'] } }),
      card: block({}),
    };
    expect(undeclaredBlockProblems(config)).toEqual([]);
  });

  test('a region naming an undeclared block is reported, with where', () => {
    const config = {
      grid: block({ items: { widget: 'blocks_layout', allowedBlocks: ['card', 'teaser'] } }),
      card: block({}),
    };
    expect(undeclaredBlockProblems(config)).toEqual([
      {
        rule: 'undeclared-block',
        types: ['grid'],
        message: 'grid: allowedBlocks at blockSchema.properties.items names "teaser", which the frontend doesn\'t declare',
      },
    ]);
  });

  test('at any depth, the block\'s own list and the page\'s regions too', () => {
    const config = {
      tabs: block(
        { tabs: { widget: 'object_list', schema: { properties: { body: { widget: 'blocks_layout', allowedBlocks: ['hero'] } } } } },
        { allowedBlocks: ['map'] },
      ),
    };
    const page = { properties: { items: { widget: 'blocks_layout', allowedBlocks: ['tabs', 'video'] } } };
    expect(undeclaredBlockProblems(config, page).map((p) => p.message)).toEqual([
      'tabs: allowedBlocks at blockSchema.properties.tabs.schema.properties.body names "hero", which the frontend doesn\'t declare',
      'tabs: allowedBlocks at the block names "map", which the frontend doesn\'t declare',
      'page: allowedBlocks at properties.items names "video", which the frontend doesn\'t declare',
    ]);
  });
});
