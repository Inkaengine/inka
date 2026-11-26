/**
 * inka#705 case 6: a move is checked against the target region's allowed
 * types, empty or not. The check read the target BLOCK's `allowedSiblingTypes`,
 * and an empty region's only block is its placeholder, which has none: a move
 * into an empty region was not checked at all.
 */
import { describe, test, expect, vi } from 'vitest';

// HydraSchemaContext.js is JSX inside a .js file — esbuild (vitest) can't parse it.
vi.mock('../context', () => ({
  getHydraSchemaContext: () => ({}),
  setHydraSchemaContext: () => () => {},
  getLiveBlockData: () => undefined,
}));

import { PAGE_BLOCK_UID } from '@volto-hydra/hydra-js';
import { buildBlockPathMap, ensureEmptyBlockIfEmpty, moveBlockBetweenContainers } from './blockPath.js';

const intl = { formatMessage: (m) => m?.defaultMessage || m?.id || '' };
const cfg = {
  _page: {
    id: '_page',
    schema: () => ({
      properties: {
        items: { widget: 'blocks_layout', allowedBlocks: ['slate', 'image'], defaultBlockType: 'slate' },
        aside: { widget: 'blocks_layout', title: 'Aside', allowedBlocks: ['slate'], defaultBlockType: 'empty' },
      },
    }),
  },
  slate: { id: 'slate' },
  image: { id: 'image' },
  empty: { id: 'empty' },
};

/** A page with an image and a paragraph in `items`, and an empty `aside` that takes paragraphs only. */
function page() {
  const data = {
    '@type': 'Document',
    blocks: { img: { '@type': 'image' }, para: { '@type': 'slate' } },
    blocks_layout: { items: ['img', 'para'], aside: [] },
  };
  const seeded = ensureEmptyBlockIfEmpty(data, { parentId: PAGE_BLOCK_UID }, buildBlockPathMap(data, cfg, intl), () => 'placeholder', cfg, { intl, properties: data });
  return { formData: seeded, placeholderId: seeded.blocks_layout.aside[0] };
}

const moveOnto = (blockId) => {
  const { formData, placeholderId } = page();
  return moveBlockBetweenContainers(formData, buildBlockPathMap(formData, cfg, intl), blockId, placeholderId, false, PAGE_BLOCK_UID, PAGE_BLOCK_UID, cfg, intl);
};

describe('a move into an empty region', () => {
  test('is refused for a type the region does not take', () => {
    expect(moveOnto('img')).toBeNull();
  });

  test('goes through for one it does', () => {
    expect(moveOnto('para')?.blocks_layout.aside).toContain('para');
  });
});
