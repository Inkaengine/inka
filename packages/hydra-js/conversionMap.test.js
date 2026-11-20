import { describe, test, expect } from 'vitest';
import { acceptableAt } from './conversionMap.js';

// cmap: a reaches {b,c}; d reaches {b}
const cmap = { a: ['b', 'c'], d: ['b'] };

describe('acceptableAt', () => {
  test('unrestricted container accepts anything', () => {
    expect(acceptableAt('a', null, false, cmap)).toBe(true);
    expect(acceptableAt('a', undefined, false, cmap)).toBe(true);
  });

  test('native fit', () => {
    expect(acceptableAt('a', ['a'], false, cmap)).toBe(true);
  });

  test('single block: one convertible option → accept', () => {
    expect(acceptableAt('d', ['b'], false, cmap)).toBe(true);
  });

  test('single block: multiple convertible options → accept (popup)', () => {
    expect(acceptableAt('a', ['b', 'c'], false, cmap)).toBe(true);
  });

  test('multi block: exactly one option → accept', () => {
    // only b is in allowed → single option → auto-convertible for a batch
    expect(acceptableAt('a', ['b'], true, cmap)).toBe(true);
  });

  test('multi block: multiple options → reject (no popup chains)', () => {
    expect(acceptableAt('a', ['b', 'c'], true, cmap)).toBe(false);
  });

  test('not reachable → reject', () => {
    expect(acceptableAt('a', ['z'], false, cmap)).toBe(false);
  });

  test('no conversion map → native only', () => {
    expect(acceptableAt('a', ['b'], false, undefined)).toBe(false);
    expect(acceptableAt('a', ['a'], false, undefined)).toBe(true);
  });
});
