/**
 * An image offering several widths gets drawn by the sanity suite.
 *
 * The image-size rule judges a render only when the image's data offers more
 * than one width. Block discovery takes a few examples per block type, and
 * when none of them carries a multi-width image the rule judges nothing, while
 * an example that has one sits on a page no test opens.
 */
import { describe, test, expect } from 'vitest';
import { offersSeveralWidths } from './imageSizes.mjs';
import { scaleExampleCases } from './discover-blocks.js';

const schema = { properties: { url: { widget: 'image' }, link: { widget: 'object_browser', mode: 'link' } } };
const scales = (...widths) => ({
  image_field: 'image',
  image_scales: {
    image: [{
      width: widths[0],
      scales: Object.fromEntries(widths.slice(1).map((w, i) => [`s${i}`, { width: w }])),
    }],
  },
});

describe('offersSeveralWidths', () => {
  test('an image field whose scales hold two widths', () => {
    expect(offersSeveralWidths(schema, { url: '/a', ...scales(1200, 400) })).toBe(true);
  });

  test('one width, however many scale names', () => {
    expect(offersSeveralWidths(schema, { url: '/a', ...scales(120, 120, 120) })).toBe(false);
  });

  test('a path with no scale data offers nothing to judge', () => {
    expect(offersSeveralWidths(schema, { url: '/a' })).toBe(false);
  });

  test('only image fields count', () => {
    expect(offersSeveralWidths({ properties: { url: { widget: 'url' } } }, { url: '/a', ...scales(1200, 400) })).toBe(false);
  });
});

const block = (blockId) => ({ blockType: 'image', variation: 'default', blockId, pagePath: '/page', blockData: { '@type': 'image' } });

describe('scaleExampleCases', () => {
  test('when no case offers several widths, the first block that does is added', () => {
    const several = { a: false, b: true };
    const cases = [{ ...block('a'), kind: 'simple', isListing: false }];
    expect(scaleExampleCases(cases, block('b'), (c) => several[c.blockId])).toEqual([
      { ...block('b'), kind: 'image-widths', isListing: false },
    ]);
  });

  test('a case that already offers several widths needs nothing more', () => {
    const cases = [{ ...block('a'), kind: 'simple', isListing: false }];
    expect(scaleExampleCases(cases, block('b'), () => true)).toEqual([]);
  });

  test('no block in the content offers several widths: nothing to add', () => {
    const cases = [{ ...block('a'), kind: 'simple', isListing: false }];
    expect(scaleExampleCases(cases, undefined, () => false)).toEqual([]);
  });
});
