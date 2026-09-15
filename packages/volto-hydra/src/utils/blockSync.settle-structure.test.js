/**
 * What every structural edit owes afterwards.
 *
 * Adding, deleting, moving and dropping are different edits, but they all owe
 * the same three things when they finish — and each caller had implemented the
 * subset it happened to need, in whatever order it happened to pick:
 *
 *   - delete re-seeded an emptied region … in one of its two paths;
 *   - the drag re-derived a moved block's membership … the chooser's drop didn't;
 *   - both removed the placeholder a block was dropped onto … at different points
 *     relative to the membership recompute, and only one was right.
 *
 * Every one of those was a bug, and every one was the same bug. These tests are
 * about the settle pass rather than any one caller, so a NEW caller that forgets
 * one of the three has somewhere to fail.
 */
import { describe, test, expect, vi } from 'vitest';

vi.mock('../context', () => ({
  getHydraSchemaContext: () => ({}),
  setHydraSchemaContext: () => () => {},
  getLiveBlockData: () => undefined,
}));

import { PAGE_BLOCK_UID } from '@volto-hydra/hydra-js';
import {
  buildBlockPathMap,
  ensureEmptyBlockIfEmpty,
  getContainerFieldConfig,
  moveBlockBetweenContainers,
} from './blockPath.js';
import { deleteBlocks, settleBlockStructure } from './blockSync.js';

const intl = { formatMessage: (m) => m?.defaultMessage || m?.id || '' };
const cfg = {
  _page: {
    id: '_page',
    schema: () => ({
      properties: {
        items: { widget: 'blocks_layout', allowedBlocks: ['slate'], defaultBlockType: 'slate' },
        announcement: {
          widget: 'blocks_layout',
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
const INSTANCE = '/templates/site-announcement';

/** A page with content in `items` and a seeded, empty, FORCED announcement. */
function page() {
  const raw = {
    '@type': 'Document',
    blocks: { one: { '@type': 'slate' }, two: { '@type': 'slate' } },
    blocks_layout: { items: ['one', 'two'], announcement: [] },
  };
  let n = 0;
  const seeded = ensureEmptyBlockIfEmpty(
    raw,
    { parentId: PAGE_BLOCK_UID },
    buildBlockPathMap(raw, cfg, intl),
    () => `seed-${(n += 1)}`,
    cfg,
    { intl, properties: raw },
  );
  return { formData: seeded, placeholderId: seeded.blocks_layout.announcement[0] };
}

const opts = () => {
  let n = 0;
  return { blocksConfig: cfg, intl, uuidGenerator: () => `re-seed-${(n += 1)}` };
};

describe('a region a block was taken out of', () => {
  test('is re-seeded when the delete emptied it, with the template it belongs to', () => {
    const { formData, placeholderId } = page();
    const { formData: after } = deleteBlocks(
      formData,
      buildBlockPathMap(formData, cfg, intl),
      [placeholderId],
      { ...opts(), templateEditMode: [INSTANCE] },
    );
    const region = after.blocks_layout.announcement;
    expect(region, 'the forced region was emptied into nothing').toHaveLength(1);
    expect(after.blocks[region[0]].templateInstanceId).toBe(INSTANCE);
  });

  test('is re-seeded when a MOVE emptied it', () => {
    // The same invariant, reached by dragging the region's only block out rather
    // than deleting it — the path that had it, and the path that didn't.
    const filled = {
      '@type': 'Document',
      blocks: {
        one: { '@type': 'slate' },
        alert: {
          '@type': 'slate',
          templateId: INSTANCE,
          templateInstanceId: INSTANCE,
        },
      },
      blocks_layout: { items: ['one'], announcement: ['alert'] },
    };
    const map = buildBlockPathMap(filled, cfg, intl);
    const sourceConfig = getContainerFieldConfig('alert', map, filled, cfg, intl);
    const moved = moveBlockBetweenContainers(
      filled, map, 'alert', 'one', true, PAGE_BLOCK_UID, PAGE_BLOCK_UID, cfg, intl,
    );
    expect(moved, 'the move itself did not happen').not.toBeNull();
    const { formData: after } = settleBlockStructure(
      moved,
      buildBlockPathMap(moved, cfg, intl),
      { landed: ['alert'], emptiedContainers: [sourceConfig] },
      opts(),
    );
    expect(
      after.blocks_layout.announcement,
      'the forced region was emptied into nothing',
    ).toHaveLength(1);
    expect(after.blocks[after.blocks_layout.announcement[0]].templateInstanceId).toBe(
      INSTANCE,
    );
    // And the block that left is page content now — it is not in the template
    // any more, so it must not be saved back into it.
    expect(after.blocks.alert.templateInstanceId).toBeUndefined();
  });

  test('is left alone when the delete did NOT empty it', () => {
    const { formData } = page();
    const { formData: after } = deleteBlocks(
      formData,
      buildBlockPathMap(formData, cfg, intl),
      ['one'],
      opts(),
    );
    expect(after.blocks_layout.items).toEqual(['two']);
  });
});

describe('a block that landed somewhere new', () => {
  test('takes the membership of the region it landed in', () => {
    const { formData, placeholderId } = page();
    const map = buildBlockPathMap(formData, cfg, intl);
    const moved = moveBlockBetweenContainers(
      formData, map, 'one', placeholderId, false, PAGE_BLOCK_UID, PAGE_BLOCK_UID, cfg, intl,
    );
    const { formData: after } = settleBlockStructure(
      moved,
      buildBlockPathMap(moved, cfg, intl),
      { landed: ['one'], replacedPlaceholders: [placeholderId] },
      opts(),
    );
    expect(
      after.blocks.one.templateInstanceId,
      'the block does not belong to the region it landed in — nothing to lock',
    ).toBe(INSTANCE);
  });

  test('and the placeholder it landed on is gone', () => {
    const { formData, placeholderId } = page();
    const map = buildBlockPathMap(formData, cfg, intl);
    const moved = moveBlockBetweenContainers(
      formData, map, 'one', placeholderId, false, PAGE_BLOCK_UID, PAGE_BLOCK_UID, cfg, intl,
    );
    const { formData: after } = settleBlockStructure(
      moved,
      buildBlockPathMap(moved, cfg, intl),
      { landed: ['one'], replacedPlaceholders: [placeholderId] },
      opts(),
    );
    expect(after.blocks_layout.announcement).toEqual(['one']);
    expect(after.blocks[placeholderId]).toBeUndefined();
  });

  test('is settled in an order a caller cannot get wrong', () => {
    // The ordering bug, pinned from the outside: ask settle for BOTH the
    // membership and the placeholder removal and it does them in the order that
    // works, whichever way the caller lists them.
    const { formData, placeholderId } = page();
    const map = buildBlockPathMap(formData, cfg, intl);
    const moved = moveBlockBetweenContainers(
      formData, map, 'one', placeholderId, false, PAGE_BLOCK_UID, PAGE_BLOCK_UID, cfg, intl,
    );
    const { formData: after } = settleBlockStructure(
      moved,
      buildBlockPathMap(moved, cfg, intl),
      { replacedPlaceholders: [placeholderId], landed: ['one'] },
      opts(),
    );
    expect(after.blocks.one.templateInstanceId).toBe(INSTANCE);
  });
});

describe('the lock backstop', () => {
  test('a locked block is not deleted, even if asked', () => {
    // The iframe filters first; this is the guard behind it. The seeded
    // placeholder is fixed + readOnly while its template is locked.
    const { formData, placeholderId } = page();
    const { formData: after, deleted } = deleteBlocks(
      formData,
      buildBlockPathMap(formData, cfg, intl),
      [placeholderId],
      { ...opts(), templateEditMode: null },
    );
    expect(deleted).toEqual([]);
    expect(after.blocks_layout.announcement).toEqual([placeholderId]);
  });

  test('and IS deleted once its template is unlocked', () => {
    const { formData, placeholderId } = page();
    const { deleted } = deleteBlocks(
      formData,
      buildBlockPathMap(formData, cfg, intl),
      [placeholderId],
      { ...opts(), templateEditMode: [INSTANCE] },
    );
    expect(deleted).toEqual([placeholderId]);
  });
});
