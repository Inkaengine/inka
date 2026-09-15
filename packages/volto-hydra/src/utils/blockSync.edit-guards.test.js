/**
 * May this edit happen here?
 *
 * Delete and move each guarded themselves; paste didn't, so pasting after locked
 * template chrome injected content into a template nobody had unlocked — the
 * iframe-side filter (hydra._filterMutableBlockUids) was the only gate, and a
 * backstop that only one caller carries is not a backstop.
 *
 * Two questions, not one: "may I change this block" is not "may I put something
 * beside it". Both are answered here rather than in the handlers, which is what
 * makes them testable at all — the paste guard used to live inside an event
 * handler in View.jsx, where nothing but a browser could reach it.
 */
import { describe, test, expect, vi } from 'vitest';

vi.mock('../context', () => ({
  getHydraSchemaContext: () => ({}),
  setHydraSchemaContext: () => () => {},
  getLiveBlockData: () => undefined,
}));

import { buildBlockPathMap } from './blockPath.js';
import { canInsertBesideBlock, canMutateBlock, deleteBlocks } from './blockSync.js';

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
const INSTANCE = 'tpl-instance-1';

// A page with three blocks: ordinary content, locked template chrome, and a
// slot member of the same template (editable content INSIDE a locked template).
const page = () => ({
  '@type': 'Document',
  blocks: {
    ordinary: { '@type': 'slate' },
    chrome: {
      '@type': 'slate',
      templateId: 't',
      templateInstanceId: INSTANCE,
      slotId: 'header',
      fixed: true,
      readOnly: true,
    },
    slotMember: {
      '@type': 'slate',
      templateId: 't',
      templateInstanceId: INSTANCE,
      slotId: 'body',
    },
  },
  blocks_layout: { items: ['ordinary', 'chrome', 'slotMember'], announcement: ['placeholder'] },
});

// A forced region holding nothing but its seeded, locked placeholder.
const withPlaceholder = () => {
  const formData = page();
  formData.blocks.placeholder = {
    '@type': 'empty',
    templateId: '/templates/site-announcement',
    templateInstanceId: '/templates/site-announcement',
    fixed: true,
    readOnly: true,
  };
  return formData;
};

const mapOf = (formData) => buildBlockPathMap(formData, cfg, intl);

describe('may I change this block', () => {
  test('ordinary content, yes', () => {
    const formData = page();
    expect(canMutateBlock(formData.blocks.ordinary, null)).toBe(true);
  });

  test('locked template chrome, no', () => {
    const formData = page();
    expect(canMutateBlock(formData.blocks.chrome, null)).toBe(false);
  });

  test('locked template chrome once the template is unlocked, yes', () => {
    const formData = page();
    expect(canMutateBlock(formData.blocks.chrome, [INSTANCE])).toBe(true);
  });

  test('a block that is not there, no', () => {
    expect(canMutateBlock(undefined, null)).toBe(false);
  });
});

describe('may I paste beside this block', () => {
  test('beside ordinary content, yes', () => {
    const formData = page();
    expect(
      canInsertBesideBlock('ordinary', mapOf(formData), formData.blocks.ordinary, null),
    ).toBe(true);
  });

  test('into a LOCKED forced region, no', () => {
    // The case the guard exists for. The announcement holds nothing but its
    // locked placeholder; pasting there would put content into a template
    // nobody has unlocked. Paste had no check at all before this.
    const formData = withPlaceholder();
    expect(
      canInsertBesideBlock(
        'placeholder',
        mapOf(formData),
        formData.blocks.placeholder,
        null,
      ),
    ).toBe(false);
  });

  test('into that region once its template is unlocked, yes', () => {
    const formData = withPlaceholder();
    expect(
      canInsertBesideBlock('placeholder', mapOf(formData), formData.blocks.placeholder, [
        '/templates/site-announcement',
      ]),
    ).toBe(true);
  });

  test('AFTER locked chrome, yes — and that is deliberate', () => {
    // Not an oversight, and worth pinning so it isn't "fixed" later: a block
    // added after a template's chrome lands OUTSIDE the template. It is page
    // content, and the membership recompute is what decides that — the lock
    // protects the template's own blocks, not the space after them.
    const formData = page();
    expect(
      canInsertBesideBlock('chrome', mapOf(formData), formData.blocks.chrome, null),
    ).toBe(true);
  });

  test('with no target block at all, yes — the region decides, not this guard', () => {
    const formData = page();
    expect(canInsertBesideBlock('nothing', mapOf(formData), undefined, null)).toBe(true);
  });
});

describe('the guards agree with what the edits do', () => {
  test('deleteBlocks refuses exactly what canMutateBlock refuses', () => {
    const formData = page();
    const { deleted } = deleteBlocks(
      formData,
      mapOf(formData),
      ['ordinary', 'chrome', 'slotMember'],
      { blocksConfig: cfg, intl, uuidGenerator: () => 'seed', templateEditMode: null },
    );
    // chrome is locked; the other two are not.
    expect(deleted).toEqual(['ordinary', 'slotMember']);
  });
});
