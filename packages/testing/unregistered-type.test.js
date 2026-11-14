/**
 * A block @type the frontend doesn't register renders as "Not implemented", so
 * discovery fails it. `empty` is the editor's placeholder for an empty region:
 * a frontend renders it but never registers it.
 */
import { describe, test, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { isUnregisteredType } = require('./discover-blocks.cjs');

const registered = new Set(['slate', 'teaser']);

describe('isUnregisteredType', () => {
  test('a type the frontend does not register is unregistered', () => {
    expect(isUnregisteredType('carousel', registered)).toBe(true);
  });

  test('a registered type is not', () => {
    expect(isUnregisteredType('teaser', registered)).toBe(false);
  });

  test('the empty placeholder is not', () => {
    expect(isUnregisteredType('empty', registered)).toBe(false);
  });

  test('a Plone content type on the page root is not', () => {
    expect(isUnregisteredType('Document', registered)).toBe(false);
  });

  test('nothing is, when the frontend registered nothing', () => {
    expect(isUnregisteredType('carousel', new Set())).toBe(false);
  });
});
