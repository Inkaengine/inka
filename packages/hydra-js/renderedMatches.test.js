import { renderedMatches } from './hydra.src.js';

/**
 * Has the frontend drawn the value it was given? Compared as the author sees
 * it (zero-width spaces don't count) — except that the leaf the admin puts the
 * caret in, when it is ONLY a caret target in the render data, must have been
 * drawn: the caret goes into that text node, and before it is there the bridge
 * would make one of its own. The DOM side is read with zero-width spaces kept.
 */
describe('renderedMatches', () => {
  const p = (...children) => [{ type: 'p', nodeId: '0', children }];
  const strong = (text) => ({ type: 'strong', nodeId: '0.1', children: [{ text }] });

  it('ignores zero-width spaces next to visible text', () => {
    expect(renderedMatches(p({ text: '﻿Hello​' }), p({ text: 'Hello' }))).toBe(true);
  });

  it("waits for the caret's leaf to be drawn when it is only a caret target", () => {
    const expected = p({ text: 'a' }, strong('​'), { text: '​' });
    // the new bold inline, caret at [0, 1, 0]
    expect(renderedMatches(p({ text: 'a' }, strong(''), { text: '' }), expected, [0, 1, 0])).toBe(false);
    expect(renderedMatches(p({ text: 'a' }, strong('​'), { text: '' }), expected, [0, 1, 0])).toBe(true);
    // the leaf after it, caret at [0, 2] (toggled off)
    expect(renderedMatches(p({ text: 'a' }, strong('​'), { text: '' }), expected, [0, 2])).toBe(false);
    expect(renderedMatches(p({ text: 'a' }, strong(''), { text: '​' }), expected, [0, 2])).toBe(true);
  });

  it('does not wait for a caret target anywhere else', () => {
    // After the author clears a field, the browser deletes the frontend's node
    // and the frontend can't redraw it; nothing puts the caret there.
    expect(renderedMatches(p({ text: '' }), p({ text: '​' }))).toBe(true);
    expect(
      renderedMatches(p({ text: 'a' }, strong(''), { text: '' }), p({ text: 'a' }, strong('​'), { text: '' }), [0, 0]),
    ).toBe(true);
  });

  it("accepts the bridge's own zero-width space in the caret's leaf", () => {
    expect(renderedMatches(p({ text: '﻿' }), p({ text: '​' }), [0, 0])).toBe(true);
  });

  it('accepts a zero-width space in the DOM where the data has an empty leaf', () => {
    expect(renderedMatches(p({ text: '﻿' }), p({ text: '' }))).toBe(true);
  });

  it('still tells different text apart', () => {
    expect(renderedMatches(p({ text: 'Hello' }), p({ text: 'Help' }))).toBe(false);
    expect(renderedMatches(p({ text: ' ' }), p({ text: '​' }))).toBe(false);
  });

  it('still tells different structure apart', () => {
    expect(renderedMatches(p({ text: 'a' }), p({ text: 'a' }, strong('b'), { text: '' }))).toBe(false);
    expect(renderedMatches([{ type: 'h2', nodeId: '0', children: [{ text: 'a' }] }], p({ text: 'a' }))).toBe(false);
  });
});
