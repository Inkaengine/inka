import { describe, it, expect } from 'vitest';
import { resolveOrderPosition } from './baseAdapter.js';

// `count` is the number of OTHER siblings, so the slots are 0..count.
describe('resolveOrderPosition', () => {
  it('takes an absolute slot', () => {
    expect(resolveOrderPosition({ targetIndex: 0, from: 3, count: 4 })).toBe(0);
    expect(resolveOrderPosition({ targetIndex: 2, from: 0, count: 4 })).toBe(2);
  });

  it('counts a negative slot from the end, so -1 is last', () => {
    // The admin says "to the bottom" without knowing how many siblings there
    // are — it has no listing in hand when it sends the reorder.
    expect(resolveOrderPosition({ targetIndex: -1, from: 0, count: 4 })).toBe(
      4,
    );
    expect(resolveOrderPosition({ targetIndex: -2, from: 0, count: 4 })).toBe(
      3,
    );
  });

  it('takes a signed step from where it is now', () => {
    expect(resolveOrderPosition({ delta: -1, from: 2, count: 4 })).toBe(1);
    expect(resolveOrderPosition({ delta: 2, from: 1, count: 4 })).toBe(3);
  });

  it('accepts the two ends as a delta too, which is how Plone spells them', () => {
    expect(resolveOrderPosition({ delta: 'top', from: 3, count: 4 })).toBe(0);
    expect(resolveOrderPosition({ delta: 'bottom', from: 0, count: 4 })).toBe(
      4,
    );
  });

  it('clamps rather than falling off either end', () => {
    // Dragging the first row up is a real gesture and must not become -1, which
    // an array splice reads as "second from last".
    expect(resolveOrderPosition({ delta: -1, from: 0, count: 4 })).toBe(0);
    expect(resolveOrderPosition({ delta: 5, from: 3, count: 4 })).toBe(4);
    expect(resolveOrderPosition({ targetIndex: 99, from: 0, count: 4 })).toBe(
      4,
    );
  });

  it('prefers the step when both are given, because only a drag sends one', () => {
    expect(
      resolveOrderPosition({ targetIndex: 0, delta: 1, from: 1, count: 4 }),
    ).toBe(2);
  });
});
