/**
 * Rules that know the page's READING ORDER and the structure of slate text.
 *
 *   <field>@styles   — the element types in a slate field, in document order
 *   @stylesBefore    — the element types of all text BEFORE this block in page
 *   @stylesAfter       reading order / AFTER it, nearest first
 *   @typesBefore     — the block types before / after this block in reading
 *   @typesAfter        order, nearest first (a container precedes its contents)
 *   firstOf: [...]   — narrows a list to its first item in the set; the other
 *                      operators then apply to that item (unset when none)
 *
 * Reading order is the order the page lays out: regions in the order the
 * parent's data lists them, each region's blocks in order, a container before
 * the blocks inside it.
 */
import { describe, test, expect } from '@jest/globals';

import { evaluateWhenCondition } from './fieldRules.js';
import { buildBlockPathMap } from './buildBlockPathMap.js';

const node = (type, ...children) => ({
  type,
  children: children.length ? children : [{ text: 'x' }],
});
const slate = (...nodes) => ({ '@type': 'slate', value: nodes });

const blocksConfig = {
  _page: {
    id: '_page',
    schema: () => ({ properties: { items: { widget: 'blocks_layout' } } }),
  },
  slate: {
    id: 'slate',
    blockSchema: { properties: { value: { widget: 'slate' } } },
  },
  image: {
    id: 'image',
    blockSchema: { properties: { url: { type: 'string' } } },
  },
  group: {
    id: 'group',
    blockSchema: { properties: { items: { widget: 'blocks_layout' } } },
  },
};

// heading (h2) · paragraph with bold · group[ h3 · list ] · image · heading (h4)
const page = {
  '@type': 'Document',
  blocks: {
    a: slate(node('h2')),
    b: slate(node('p', { text: 'plain ' }, node('strong'))),
    g: {
      '@type': 'group',
      blocks: {
        g1: slate(node('h3')),
        g2: slate(node('ul', node('li'))),
      },
      blocks_layout: { items: ['g1', 'g2'] },
    },
    i: { '@type': 'image', url: '/pic.png' },
    z: slate(node('h4')),
  },
  blocks_layout: { items: ['a', 'b', 'g', 'i', 'z'] },
};

const blockPathMap = buildBlockPathMap(page, blocksConfig, {});
const holds = (blockId, when) => {
  const formData = blockPathMap[blockId].path.reduce((n, k) => n[k], page);
  return evaluateWhenCondition(when, formData, {
    blockId,
    blockPathMap,
    pageFormData: page,
  });
};

describe('<field>@styles', () => {
  test('lists the element types in a slate field, in document order', () => {
    expect(
      holds('b', { 'value@styles': { containsAll: ['p', 'strong'] } }),
    ).toBe(true);
    expect(holds('b', { 'value@styles': { contains: 'h2' } })).toBe(false);
    expect(
      holds('g2', { 'value@styles': { firstOf: ['ul', 'li'], is: 'ul' } }),
    ).toBe(true);
  });
});

describe('@stylesBefore / @stylesAfter', () => {
  test('the nearest heading before a block, across containers', () => {
    // z (h4) comes after the group's h3, which is the nearest heading before it.
    expect(
      holds('z', {
        '@stylesBefore': { firstOf: ['h2', 'h3', 'h4'], is: 'h3' },
      }),
    ).toBe(true);
    // g1 (h3, first in the group) — the nearest heading before it is a's h2.
    expect(
      holds('g1', {
        '@stylesBefore': { firstOf: ['h2', 'h3', 'h4'], is: 'h2' },
      }),
    ).toBe(true);
  });

  test('nearest first, the block itself excluded', () => {
    // Before z, nearest first: the list's li, ul, then the h3, then b's strong, p …
    expect(
      holds('z', { '@stylesBefore': { firstOf: ['li', 'ul'], is: 'li' } }),
    ).toBe(true);
    expect(holds('z', { '@stylesBefore': { contains: 'h4' } })).toBe(false);
  });

  test('nothing before the first block', () => {
    expect(
      holds('a', {
        '@stylesBefore': { firstOf: ['h2', 'h3', 'h4'], isSet: false },
      }),
    ).toBe(true);
    expect(holds('a', { '@stylesBefore': { gte: 1 } })).toBe(false);
  });

  test('after, nearest first', () => {
    expect(
      holds('a', { '@stylesAfter': { firstOf: ['h2', 'h3', 'h4'], is: 'h3' } }),
    ).toBe(true);
    expect(holds('z', { '@stylesAfter': { gte: 1 } })).toBe(false);
  });
});

describe('@typesBefore / @typesAfter', () => {
  test('block types in reading order, nearest first; a container precedes its contents', () => {
    expect(
      holds('g1', {
        '@typesBefore': { firstOf: ['group', 'slate', 'image'], is: 'group' },
      }),
    ).toBe(true);
    expect(
      holds('i', {
        '@typesBefore': { firstOf: ['group', 'slate', 'image'], is: 'slate' },
      }),
    ).toBe(true);
    expect(
      holds('b', {
        '@typesAfter': { firstOf: ['group', 'slate', 'image'], is: 'group' },
      }),
    ).toBe(true);
    expect(
      holds('z', { '@typesBefore': { firstOf: ['image'], is: 'image' } }),
    ).toBe(true);
  });

  test('the first block on the page has nothing before it', () => {
    expect(holds('a', { '@typesBefore': { isSet: false } })).toBe(true);
  });
});

describe('a heading-order rule needs nothing more', () => {
  const headings = ['h2', 'h3', 'h4'];
  const h4WithoutH3 = {
    'value@styles': { contains: 'h4' },
    '@stylesBefore': { firstOf: headings, oneOf: ['h2'] },
  };

  test('an h4 straight after an h2 is caught; after an h3 it is not', () => {
    const skipped = {
      ...page,
      blocks: { ...page.blocks, z: slate(node('h4')) },
      blocks_layout: { items: ['a', 'z'] },
    };
    const map = buildBlockPathMap(skipped, blocksConfig, {});
    const skippedHolds = evaluateWhenCondition(h4WithoutH3, skipped.blocks.z, {
      blockId: 'z',
      blockPathMap: map,
      pageFormData: skipped,
    });
    expect(skippedHolds).toBe(true);
    expect(holds('z', h4WithoutH3)).toBe(false);
  });
});

describe('firstOf', () => {
  test('works only on a list', () => {
    expect(() => holds('a', { value: { firstOf: ['h2'], is: 'h2' } })).toThrow(
      /firstOf/,
    );
  });
});
