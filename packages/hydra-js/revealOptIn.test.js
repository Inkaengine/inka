import { describe, test, expect } from 'vitest';
import { Bridge } from './hydra.src.js';

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
