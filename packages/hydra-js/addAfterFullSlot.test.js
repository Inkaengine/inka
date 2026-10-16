/**
 * "+" on a block whose own region can take nothing after it — a layout's fixed
 * heading in a one-block region — adds at the top of the layout's DEFAULT slot,
 * where the page's content goes.
 *
 * Without this a page laid out with a heading region offered no "+" on its
 * heading at all: the region was full, and a fixed block has no slot after it.
 * Authors select the heading and add what comes under it.
 */
import { buildBlockPathMap } from './buildBlockPathMap.js';
import { getBlockAddability } from '@volto-hydra/helpers';

const blocksConfig = {
  frame: {
    id: 'frame',
    blockSchema: {
      properties: {
        heading: { widget: 'blocks_layout', allowedBlocks: ['title'], maxLength: 1 },
        side: { widget: 'blocks_layout', allowedBlocks: ['slate'] },
        main: { widget: 'blocks_layout', allowedBlocks: ['slate', 'title'] },
      },
    },
  },
  title: { id: 'title' },
  slate: { id: 'slate', blockSchema: { properties: { value: {} } } },
};

const page = (mainBlocks) => ({
  blocks: {
    frame: {
      '@type': 'frame',
      templateId: '/t',
      templateInstanceId: 'i',
      slotId: 'frame',
      fixed: true,
      readOnly: true,
      blocks: {
        h: { '@type': 'title', templateId: '/t', templateInstanceId: 'i', slotId: 'heading', fixed: true },
        s: { '@type': 'slate', templateId: '/t', templateInstanceId: 'i', slotId: 'side', fixed: true },
        ...mainBlocks,
      },
      blocks_layout: { heading: ['h'], side: ['s'], main: Object.keys(mainBlocks) },
    },
  },
  blocks_layout: { items: ['frame'] },
});

const content = (id) => ({ '@type': 'slate', templateId: '/t', templateInstanceId: 'i', slotId: 'default' });

describe('"+" on a block with no room after it', () => {
  test('adds at the top of the default slot, not the next region (a sidebar)', () => {
    const formData = page({ p1: content('p1'), p2: content('p2') });
    const bpm = buildBlockPathMap(formData, blocksConfig);
    const addability = getBlockAddability('h', bpm, formData.blocks.frame.blocks.h, undefined);

    expect(addability.canInsertAfter).toBe(true);
    expect(addability.insertAt).toEqual({ blockId: 'p1', action: 'before' });
  });

  test('a block that has room adds after itself, as before', () => {
    const formData = page({ p1: content('p1'), p2: content('p2') });
    const bpm = buildBlockPathMap(formData, blocksConfig);
    const addability = getBlockAddability('p1', bpm, formData.blocks.frame.blocks.p1, undefined);

    expect(addability.canInsertAfter).toBe(true);
    expect(addability.insertAt).toBeUndefined();
  });

  test('with no default slot to add to, there is still no "+"', () => {
    const formData = page({});
    const bpm = buildBlockPathMap(formData, blocksConfig);
    const addability = getBlockAddability('h', bpm, formData.blocks.frame.blocks.h, undefined);

    expect(addability.canInsertAfter).toBe(false);
  });
});
