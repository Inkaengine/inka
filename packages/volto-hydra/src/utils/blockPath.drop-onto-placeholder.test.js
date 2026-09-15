/**
 * Dropping a block onto a forced region's empty placeholder.
 *
 * A forced region — a site announcement, a site footer — IS its template, and
 * when it is empty the only thing in it is a seeded placeholder carrying the
 * template's membership. A block dropped onto that placeholder has to come out
 * belonging to the template, or the author cannot lock what they just placed.
 *
 * The order matters, and it is the whole point of these tests: the placeholder
 * is the block's ONLY neighbour, so membership has to be derived BEFORE the
 * placeholder is removed. Two paths did this (drag, and the chooser's ask-first
 * drop) and only one of them got the order right — which is why both now call
 * the same two functions in the same order.
 */
import { describe, test, expect, vi } from 'vitest';

// HydraSchemaContext.js is JSX inside a .js file — esbuild (vitest) can't parse
// it, and nothing here touches the live schema context.
vi.mock('../context', () => ({
  getHydraSchemaContext: () => ({}),
  setHydraSchemaContext: () => () => {},
  getLiveBlockData: () => undefined,
}));

import { PAGE_BLOCK_UID } from '@volto-hydra/hydra-js';
import {
  buildBlockPathMap,
  ensureEmptyBlockIfEmpty,
  moveBlockBetweenContainers,
  removeReplacedPlaceholder,
} from './blockPath.js';
import { applyMembershipAfterMove } from './blockSync.js';

const intl = { formatMessage: (m) => m?.defaultMessage || m?.id || '' };
const cfg = {
  _page: {
    id: '_page',
    schema: () => ({
      properties: {
        items: {
          widget: 'blocks_layout',
          allowedBlocks: ['slate'],
          defaultBlockType: 'slate',
        },
        announcement: {
          widget: 'blocks_layout',
          title: 'Announcement',
          allowedLayouts: ['/templates/site-announcement'],
          allowedBlocks: ['slate'],
          defaultBlockType: 'empty',
        },
      },
    }),
  },
  slate: { id: 'slate' },
  empty: { id: 'empty' },
};

/** A page with a block in `items` and an EMPTY forced announcement region. */
function pageWithSeededRegion() {
  const page = {
    '@type': 'Document',
    blocks: { dragged: { '@type': 'slate' } },
    blocks_layout: { items: ['dragged'], announcement: [] },
  };
  const seeded = ensureEmptyBlockIfEmpty(
    page,
    { parentId: PAGE_BLOCK_UID },
    buildBlockPathMap(page, cfg, intl),
    () => 'placeholder',
    cfg,
    { intl, properties: page },
  );
  return { formData: seeded, placeholderId: seeded.blocks_layout.announcement[0] };
}

/** The drop, in the order both paths now use. */
function drop({ removeFirst = false } = {}) {
  const { formData, placeholderId } = pageWithSeededRegion();
  const instanceId = formData.blocks[placeholderId].templateInstanceId;
  let out = moveBlockBetweenContainers(
    formData,
    buildBlockPathMap(formData, cfg, intl),
    'dragged',
    placeholderId,
    false,
    PAGE_BLOCK_UID,
    PAGE_BLOCK_UID,
    cfg,
    intl,
  );
  const derive = (data) =>
    applyMembershipAfterMove(data, buildBlockPathMap(data, cfg, intl), 'dragged', {
      blocksConfig: cfg,
      intl,
    });
  const remove = (data) =>
    removeReplacedPlaceholder(
      data,
      buildBlockPathMap(data, cfg, intl),
      placeholderId,
      { blocksConfig: cfg, intl },
    );
  // The bug this pins: removing the placeholder first leaves nothing to derive
  // membership from.
  out = removeFirst ? derive(remove(out)) : remove(derive(out));
  return { out, instanceId };
}

describe('a block dropped onto a forced region placeholder', () => {
  test('belongs to the template it landed in', () => {
    const { out, instanceId } = drop();
    expect(instanceId, 'the seeded placeholder had no instance to inherit').toBeTruthy();
    expect(
      out.blocks.dragged.templateInstanceId,
      'the dropped block does not belong to the region it was dropped into — nothing to lock',
    ).toBe(instanceId);
  });

  test('takes the placeholder\'s position, not a seat beside it', () => {
    const { out } = drop();
    expect(out.blocks_layout.announcement).toEqual(['dragged']);
  });

  test('loses the template if the placeholder is removed FIRST', () => {
    // Not a wish — a record of why the order is fixed. This is exactly what the
    // chooser's drop did.
    const { out } = drop({ removeFirst: true });
    expect(out.blocks.dragged.templateInstanceId).toBeUndefined();
  });
});
