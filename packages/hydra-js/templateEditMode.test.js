import { describe, test, expect } from 'vitest';
import { isBlockInEditedTemplate, isBlockReadonly } from '@volto-hydra/helpers';

/**
 * Template edit mode (v2) is a SET of unlocked template instance ids: multiple
 * templates can be unlocked and edited on one page at once, and unlocking a
 * template does NOT lock the rest of the page. `templateEditMode` is threaded as
 * a string[] (postMessage-friendly). A block is unlocked via the FLAT predicate
 * (its stamped templateInstanceId is a member of the set).
 *
 * The merge STAMPS every block with its RESOLVED instance id: same-template nested
 * content keeps the instance's id, a foreign embedded template starts its OWN id.
 * So the flat membership check is equivalent to an ancestry walk at every depth.
 */
describe('isBlockInEditedTemplate — flat membership on stamped data (v2)', () => {
  test('a direct child of an unlocked instance is inside it', () => {
    expect(isBlockInEditedTemplate({ templateInstanceId: 'X' }, ['X'])).toBe(true);
  });

  test('nested same-template content is inside it (stamped same id)', () => {
    expect(isBlockInEditedTemplate({ templateInstanceId: 'X' }, ['X'])).toBe(true);
  });

  test('a block inside a foreign embedded template is NOT inside it', () => {
    expect(isBlockInEditedTemplate({ templateInstanceId: 'B' }, ['X'])).toBe(false);
  });

  test('multiple unlocked instances: membership is by the whole set', () => {
    expect(isBlockInEditedTemplate({ templateInstanceId: 'B' }, ['X', 'B'])).toBe(true);
    expect(isBlockInEditedTemplate({ templateInstanceId: 'X' }, ['X', 'B'])).toBe(true);
  });

  test('nothing unlocked -> false (empty set or null)', () => {
    expect(isBlockInEditedTemplate({ templateInstanceId: 'X' }, [])).toBe(false);
    expect(isBlockInEditedTemplate({ templateInstanceId: 'X' }, null)).toBe(false);
  });
});

describe('isBlockReadonly — v2: own readOnly flag unless the block’s instance is unlocked', () => {
  test('a readOnly block inside an unlocked instance becomes editable', () => {
    expect(isBlockReadonly({ templateInstanceId: 'X', readOnly: true }, ['X'])).toBe(false);
  });

  test('a readOnly block in a locked (foreign / not-unlocked) template stays locked', () => {
    expect(isBlockReadonly({ templateInstanceId: 'B', readOnly: true }, ['X'])).toBe(true);
  });

  test('a page block stays editable even while a template is unlocked (no page lock)', () => {
    // The v2 headline: unlocking a template does NOT lock the rest of the page.
    expect(isBlockReadonly({}, ['X'])).toBe(false);
    // A non-readOnly block belonging to some other (locked) template also stays editable.
    expect(isBlockReadonly({ templateInstanceId: 'B' }, ['X'])).toBe(false);
  });

  test('normal mode: falls back to the block.readOnly flag', () => {
    expect(isBlockReadonly({ readOnly: true }, [])).toBe(true);
    expect(isBlockReadonly({ readOnly: false }, [])).toBe(false);
  });
});
