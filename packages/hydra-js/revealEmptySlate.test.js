import { Bridge } from './hydra.src.js';

/**
 * Reveal treats a slate field's default empty paragraph as the empty field it is.
 *
 * Every slate field has a top node — the editor defaults it to one empty
 * paragraph — so an optional slate field the author has not written arrives as
 * that paragraph, never absent. A renderer hides it with `isEmptySlate`, and
 * reveal has to make that same check pass:
 *
 * - the field counts as revealable, though its array is not empty;
 * - revealed, the renderer is handed the SAME paragraph with a zero-width space
 *   in it, so `isEmptySlate` is false and the field draws — and it keeps the
 *   paragraph's `nodeId`, so the element it draws carries a `data-node-id` and
 *   the first keystroke maps back into the value.
 */
const Z = Bridge.REVEAL_ZWS;
const SCHEMA = {
  properties: {
    heading: { type: 'string' },
    summary: { type: 'array', widget: 'slate' },
  },
};
const EMPTY = [{ type: 'p', nodeId: 0, children: [{ text: '' }] }];
const WRITTEN = [{ type: 'p', nodeId: 0, children: [{ text: 'Roads closed' }] }];

function bridgeWith(summary) {
  const formData = { blocks: { b1: { '@type': 'teaser', heading: 'Hi', summary } } };
  return Object.assign(Object.create(Bridge.prototype), {
    formData,
    blockPathMap: { b1: { path: ['blocks', 'b1'] } },
    getBlockSchema: () => SCHEMA,
    getBlockData: () => formData.blocks.b1,
    getFieldType: (_uid, field) => (field === 'summary' ? 'array:slate' : 'string'),
  });
}

describe('reveal — a slate field holding its empty paragraph', () => {
  test('is revealable', () => {
    expect(bridgeWith(EMPTY).revealableFields('b1')).toEqual(['summary']);
  });

  test('is not revealable once written', () => {
    expect(bridgeWith(WRITTEN).revealableFields('b1')).toEqual([]);
  });

  test('revealed, the renderer gets the same paragraph, node id kept, holding a zero-width space', () => {
    const bridge = bridgeWith(EMPTY);
    bridge.revealedBlocks.add('b1');
    const projected = bridge._projectForRender(bridge.formData);
    expect(projected.blocks.b1.summary).toEqual([
      { type: 'p', nodeId: 0, children: [{ text: Z }] },
    ]);
    // The projection is for the renderer only — state is untouched.
    expect(bridge.formData.blocks.b1.summary).toEqual(EMPTY);
  });

  test('not revealed, the renderer gets the empty paragraph as it is', () => {
    const bridge = bridgeWith(EMPTY);
    const projected = bridge._projectForRender(bridge.formData);
    expect(projected.blocks.b1.summary).toEqual(EMPTY);
  });
});
