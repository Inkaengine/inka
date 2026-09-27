import { describe, test, expect } from 'vitest';
import { ensureAllContainersHaveBlocks, getContainerRegionDescriptors, initializeContainerBlock } from './blockPath';

/**
 * `subBlocks: false` makes an object_list a plain list of objects (edited in
 * the sidebar with Volto's object-list widget), not a region: it is never
 * seeded — neither when its block is added nor when a page loads with it empty
 * — and it is not one of the block's regions.
 */
describe('object_list subBlocks: false is not a region', () => {
  const intl = { formatMessage: (m) => m?.defaultMessage || m?.id || '' };
  let c = 0;
  const uuid = () => `u-${++c}`;
  const options = {
    widget: 'object_list',
    subBlocks: false,
    schema: { properties: { value: { type: 'string' }, label: { type: 'string' } } },
  };
  const blocksConfig = {
    plainq: { blockSchema: { properties: { label: { type: 'string' }, options } } },
  };

  test('it is not one of the block\'s regions', () => {
    const regions = getContainerRegionDescriptors('plainq', blocksConfig, intl, {});
    expect(regions.map((r) => r.region)).not.toContain('options');
  });

  test('adding the block does not seed an item into it', () => {
    const schema = { properties: { label: { type: 'string' }, options } };
    const result = initializeContainerBlock({ '@type': 'plainq' }, {}, uuid, { intl, blockType: 'plainq' }, schema);
    expect(result.options).toBeUndefined();
  });

  test('a page loading with it empty does not seed an item into it', () => {
    const formData = { blocks: { q: { '@type': 'plainq', label: 'Q' } }, blocks_layout: { items: ['q'] } };
    const out = ensureAllContainersHaveBlocks(formData, blocksConfig, intl, uuid);
    expect(out.blocks.q.options).toBeUndefined();
  });
});
