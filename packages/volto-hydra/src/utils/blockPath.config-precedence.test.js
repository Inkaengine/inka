import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import config from '@plone/volto/registry';
import {
  buildBlockPathMap,
  getContainerFieldConfig,
  getAllContainerFields,
  getEmptyBlockType,
  resolveRegionConstraints,
} from './blockPath.js';

describe('resolveRegionConstraints — field → block → page precedence', () => {
  const page = { allowedBlocks: ['slate', 'image'], defaultBlockType: 'slate' };

  test('field def wins over block and page', () => {
    const rc = resolveRegionConstraints(
      { allowedBlocks: ['teaser'], defaultBlockType: 'teaser', maxLength: 3 },
      { defaultBlockType: 'x' },
      page,
    );
    expect(rc).toEqual({
      allowedBlocks: ['teaser'],
      defaultBlockType: 'teaser',
      maxLength: 3,
      allowedLayouts: null,
    });
  });

  // A forced region's layout is a constraint like the others, and it has to
  // survive this resolution: ensureEmptyBlockIfEmpty reads it off the resolved
  // config to stamp a seeded placeholder with the template's membership. When it
  // was dropped here, a region re-seeded after a delete came back as ordinary
  // page content and the author had nothing left to lock.
  test('carries a forced region\'s allowedLayouts', () => {
    expect(
      resolveRegionConstraints(
        { allowedLayouts: ['/templates/site-announcement'] },
        {},
        page,
      ).allowedLayouts,
    ).toEqual(['/templates/site-announcement']);
    // From the block config when the field is silent, and null when neither says.
    expect(
      resolveRegionConstraints({}, { allowedLayouts: ['/templates/site-footer'] }, page)
        .allowedLayouts,
    ).toEqual(['/templates/site-footer']);
    expect(resolveRegionConstraints({}, {}, page).allowedLayouts).toBeNull();
  });

  test('block config wins when the field is silent', () => {
    const rc = resolveRegionConstraints({}, { allowedBlocks: ['image'], defaultBlockType: 'image' }, page);
    expect(rc.allowedBlocks).toEqual(['image']);
    expect(rc.defaultBlockType).toBe('image');
  });

  test('inherits page allowed + default when neither field nor block restricts', () => {
    const rc = resolveRegionConstraints({}, {}, page);
    expect(rc.allowedBlocks).toEqual(['slate', 'image']);
    expect(rc.defaultBlockType).toBe('slate');
  });

  test('does NOT inherit the page default when the container restricts allowedBlocks', () => {
    // Lists allowedBlocks but no default → 'empty' picker, not the page default.
    const rc = resolveRegionConstraints({ allowedBlocks: ['a', 'b'] }, {}, page);
    expect(rc.allowedBlocks).toEqual(['a', 'b']);
    expect(rc.defaultBlockType).toBe(null);
  });
});

/**
 * The field → block → page precedence for a container's defaultBlockType/allowedBlocks is
 * built in two places — getContainerFieldConfig (per block, the add/insert path) and
 * getAllContainerFields (per field, the sidebar). They must agree, or the seeded empty-block
 * type differs depending on which builder ran.
 *
 * The divergence today: getAllContainerFields inherits the page default when a container
 * restricts nothing (documented "inherits the page's allowed list — and so should its
 * empty-block default"); getContainerFieldConfig does not (`?? null`).
 */
describe('container config precedence — getContainerFieldConfig vs getAllContainerFields agree', () => {
  const PAGE_DEFAULT = 'slate';
  let prev;
  beforeAll(() => {
    config.settings = config.settings || {};
    prev = config.settings.defaultBlockType;
    config.settings.defaultBlockType = PAGE_DEFAULT;
  });
  afterAll(() => {
    config.settings.defaultBlockType = prev;
  });

  const intl = { formatMessage: (m) => m?.defaultMessage || m?.id || '' };
  const blocksConfig = {
    _page: { id: '_page', schema: () => ({ properties: { items: { widget: 'blocks_layout' } } }) },
    slate: { id: 'slate' },
    // an unrestricted blocks_layout field (no allowedBlocks/defaultBlockType) → inherits the
    // page default; the schema makes buildBlockPathMap map its children.
    mycontainer: {
      id: 'mycontainer',
      schema: () => ({ properties: { items: { widget: 'blocks_layout' } } }),
    },
  };
  const form = {
    '@type': 'Document',
    blocks: {
      c1: {
        '@type': 'mycontainer',
        blocks: { ch: { '@type': 'slate' } },
        blocks_layout: { items: ['ch'] },
      },
    },
    blocks_layout: { items: ['c1'] },
  };

  test('both builders resolve the same defaultBlockType for a page-inheriting container', () => {
    const map = buildBlockPathMap(form, blocksConfig, intl);
    const perBlock = getContainerFieldConfig('ch', map, form, blocksConfig, intl);
    const itemsField = getAllContainerFields('c1', map, form, blocksConfig, intl).find(
      (f) => f.region === 'items',
    );

    // getAllContainerFields already inherits the page default...
    expect(itemsField.defaultBlockType).toBe(PAGE_DEFAULT);
    // ...getContainerFieldConfig must too (this is the divergence).
    expect(perBlock.defaultBlockType).toBe(PAGE_DEFAULT);
    // ...so the seeded empty-block type is the same by either path.
    expect(getEmptyBlockType(perBlock)).toBe(getEmptyBlockType(itemsField));
  });
});
