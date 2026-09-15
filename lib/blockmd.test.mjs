/**
 * slate <-> markdown round-trip. A slate value written to markdown and read back
 * must equal what was stored (order-insensitive; empty text leaves that Slate
 * requires around inline elements are normalised away by the engine's semantic
 * view, so the cases here avoid them).
 */
import { describe, it, expect } from 'vitest';
import { slateToMd, mdToSlate } from './blockmd.mjs';

const roundTrips = (value) => expect(mdToSlate(slateToMd(value))).toEqual(value);

describe('slate <-> markdown round-trip', () => {
  it('round-trips a plain paragraph', () => {
    roundTrips([{ type: 'p', children: [{ text: 'Hello world.' }] }]);
  });

  it('round-trips a blockquote whose children are inline (text + em)', () => {
    roundTrips([{ type: 'blockquote', children: [
      { text: 'One consequence: text typed into an ' },
      { type: 'em', children: [{ text: 'existing' }] },
      { text: ' heading updates the nav.' },
    ] }]);
  });

  it('round-trips a nested list (a list item containing a sub-list)', () => {
    roundTrips([{ type: 'ul', children: [
      { type: 'li', children: [
        { text: 'Parent item' },
        { type: 'ul', children: [
          { type: 'li', children: [{ text: 'Child one' }] },
          { type: 'li', children: [{ text: 'Child two' }] },
        ] },
      ] },
      { type: 'li', children: [{ text: 'Second parent' }] },
    ] }]);
  });

  it('round-trips a list item with a strong lead-in and a code span', () => {
    roundTrips([{ type: 'ul', children: [
      { type: 'li', children: [
        { type: 'strong', children: [{ text: 'Blocks fields' }] },
        { text: ' — use ' },
        { type: 'code', children: [{ text: 'widget' }] },
        { text: ' here.' },
      ] },
    ] }]);
  });

  it('round-trips an empty paragraph (via the mdToSlate fallback)', () => {
    roundTrips([{ type: 'p', children: [{ text: '' }] }]);
  });
});
