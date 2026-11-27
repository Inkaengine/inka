import { describe, test, expect } from 'vitest';
import { Bridge } from './hydra.src.js';
import { getFieldTypeString } from '@volto-hydra/helpers';

/**
 * Reveal is opt-in (inka#765): only a field marked `optionalOnCanvas: true`
 * is revealed. Whether a frontend ever draws a field editable on the page can't
 * be told from its widget (alt text and a heading are both strings), so the
 * frontend says so, and the reveal button shows only where pressing it reveals
 * something.
 */
function bridgeWith(properties, block, { required = [] } = {}) {
  const formData = { blocks: { b1: { '@type': 'teaser', ...block } } };
  return Object.assign(Object.create(Bridge.prototype), {
    formData,
    blockPathMap: { b1: { path: ['blocks', 'b1'] } },
    getBlockSchema: () => ({ properties, required }),
    getBlockData: () => formData.blocks.b1,
    getFieldType: (_uid, field) => properties[field]?.type || 'string',
  });
}

describe('reveal — only a field marked optionalOnCanvas', () => {
  test('of two empty fields, only the marked one is revealable', () => {
    const bridge = bridgeWith(
      {
        heading: { type: 'string', optionalOnCanvas: true },
        alt: { type: 'string' },
      },
      {},
    );
    expect(bridge.revealableFields('b1')).toEqual(['heading']);
  });

  test('a block whose empty fields are all unmarked has nothing to reveal', () => {
    const bridge = bridgeWith({ alt: { type: 'string' }, credit: { type: 'string' } }, {});
    expect(bridge.revealableFields('b1')).toEqual([]);
  });

  test('a marked field with a value is not revealable', () => {
    const bridge = bridgeWith(
      { heading: { type: 'string', optionalOnCanvas: true } },
      { heading: 'Roads closed' },
    );
    expect(bridge.revealableFields('b1')).toEqual([]);
  });

  test('a field both required and optionalOnCanvas is refused, naming it', () => {
    const bridge = bridgeWith(
      { heading: { type: 'string', optionalOnCanvas: true } },
      {},
      { required: ['heading'] },
    );
    expect(() => bridge.revealableFields('b1')).toThrow(/teaser.*heading.*required.*optionalOnCanvas/);
  });

  test('optionalOnCanvas on a field the page cannot edit is refused, naming it', () => {
    const bridge = bridgeWith({ show: { type: 'boolean', optionalOnCanvas: true } }, {});
    expect(() => bridge.revealableFields('b1')).toThrow(/teaser.*show.*optionalOnCanvas/);
  });
});

/**
 * The admin wraps a field a block can fill from a link in `copyFromTargetField`,
 * keeping the field's own def under `baseWidget`. The wrapper is still that
 * field: a rich-text copy is rich text, so it reveals as an empty paragraph.
 */
describe('reveal — a field the admin wrapped to copy from a link', () => {
  const slate = { title: 'Copy', type: 'array', widget: 'slate', optionalOnCanvas: true };
  const wrapped = { ...slate, widget: 'copyFromTargetField', baseWidget: slate };

  function bridgeReadingTypes(properties, block) {
    const formData = { blocks: { b1: { '@type': 'teaser', ...block } } };
    return Object.assign(Object.create(Bridge.prototype), {
      formData,
      blockPathMap: { b1: { path: ['blocks', 'b1'] } },
      getBlockSchema: () => ({ properties, required: [] }),
      getBlockData: () => formData.blocks.b1,
      // As the bridge's own getFieldType: the type string of the def it is given.
      getFieldType: (_uid, field) => getFieldTypeString(properties[field]),
    });
  }

  test('an empty wrapped rich-text field is revealable, not refused', () => {
    const bridge = bridgeReadingTypes(
      { description: wrapped },
      { description: [{ type: 'p', children: [{ text: '' }] }] },
    );
    expect(bridge.revealableFields('b1')).toEqual(['description']);
  });

  test('a wrapped rich-text field with copy in it is not revealable', () => {
    const bridge = bridgeReadingTypes(
      { description: wrapped },
      { description: [{ type: 'p', children: [{ text: 'Roads closed' }] }] },
    );
    expect(bridge.revealableFields('b1')).toEqual([]);
  });
});

/**
 * An image picker (object_browser in image mode) stores the picked Image item:
 * its @id, and the image's field and scales, which carry its proportions. Its
 * reveal stand-in has the same shape, so a frontend that draws a picked image
 * from its proportions (a logo box sized to the image) draws the stand-in too.
 */
describe('reveal — an image picker stands in as a picked image', () => {
  test('its stand-in is the reveal image, with that image\'s field and proportions', () => {
    const bridge = Object.create(Bridge.prototype);
    const [picked] = bridge._revealSentinelFor(
      { widget: 'object_browser', mode: 'image', optionalOnCanvas: true },
      'string:object_browser',
    );
    expect(picked['@id']).toBe(Bridge.REVEAL_PIXEL);
    expect(picked.image_field).toBe('image');
    expect(picked.image_scales.image[0]).toMatchObject({ width: 400, height: 300 });
  });

  test('a link picker\'s stand-in is a link, with no image about it', () => {
    const bridge = Object.create(Bridge.prototype);
    const [picked] = bridge._revealSentinelFor(
      { widget: 'object_browser', mode: 'link', optionalOnCanvas: true },
      'string:object_browser',
    );
    expect(picked['@id']).toBe(Bridge.REVEAL_ZWS);
    expect(picked.image_scales).toBeUndefined();
  });
});
