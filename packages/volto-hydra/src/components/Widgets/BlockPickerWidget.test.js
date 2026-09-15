/**
 * Picking another BLOCK, and storing a field of it.
 *
 * The motivating case is a form's skip logic: an author picks the question this
 * one depends on. What must be stored is that question's `field_id` — the thing
 * the rule is evaluated against. Storing a uid would look right in the sidebar
 * and never match, which is the failure this widget exists to prevent.
 */
import { describe, test, expect, vi } from 'vitest';

vi.mock('../../context/HydraSchemaContext', () => ({
  useHydraSchemaContext: () => ({}),
}));

import { candidateBlockIds, labelFor } from './BlockPickerWidget';

// form → three questions, in order.
const MAP = {
  form: { path: ['blocks', 'form'], parentId: null, region: null },
  q1: {
    path: ['blocks', 'form', 'subblocks', '0'],
    parentId: 'form',
    region: 'subblocks',
  },
  q2: {
    path: ['blocks', 'form', 'subblocks', '1'],
    parentId: 'form',
    region: 'subblocks',
  },
  q3: {
    path: ['blocks', 'form', 'subblocks', '2'],
    parentId: 'form',
    region: 'subblocks',
  },
};

describe('candidateBlockIds', () => {
  test('offers my siblings, never myself', () => {
    const ids = candidateBlockIds({ blockPathMap: MAP, currentBlockId: 'q2' });
    expect(ids).toEqual(['q1', 'q3']);
  });

  test('an anchor that is not among its siblings offers nothing', () => {
    // `direction` is relative to me. If I cannot be found, "before" has no
    // meaning — and answering with the whole list is the failure that hides
    // itself: the menu looks right, and the rule it builds can never be met.
    const ids = candidateBlockIds({
      blockPathMap: MAP,
      currentBlockId: 'not-in-this-form',
      direction: 'before',
    });
    expect(ids).toEqual([]);
  });

  test('"before" offers only what comes earlier — a question cannot depend on a later one', () => {
    const ids = candidateBlockIds({
      blockPathMap: MAP,
      currentBlockId: 'q3',
      direction: 'before',
    });
    expect(ids).toEqual(['q1', 'q2']);
  });

  test('"after" is the mirror', () => {
    const ids = candidateBlockIds({
      blockPathMap: MAP,
      currentBlockId: 'q1',
      direction: 'after',
    });
    expect(ids).toEqual(['q2', 'q3']);
  });

  test('the first question has nothing earlier to depend on', () => {
    expect(
      candidateBlockIds({
        blockPathMap: MAP,
        currentBlockId: 'q1',
        direction: 'before',
      }),
    ).toEqual([]);
  });

  test('a region scope offers that region only', () => {
    const mixed = {
      ...MAP,
      other: {
        path: ['blocks', 'form', 'footer', '0'],
        parentId: 'form',
        region: 'footer',
      },
    };
    const ids = candidateBlockIds({
      blockPathMap: mixed,
      currentBlockId: 'q2',
      scope: 'subblocks',
    });
    expect(ids).toEqual(['q1', 'q3']);
  });

  test('an unknown block offers nothing rather than everything', () => {
    expect(
      candidateBlockIds({ blockPathMap: MAP, currentBlockId: 'nope' }),
    ).toEqual([]);
  });
});

describe('labelFor', () => {
  test('prefers the named field, so a question reads as its question', () => {
    expect(labelFor({ label: 'Your topic', title: 'x' }, 'label')).toBe(
      'Your topic',
    );
  });

  test('falls back through title, label, type', () => {
    expect(labelFor({ title: 'Titled' })).toBe('Titled');
    expect(labelFor({ '@type': 'text' })).toBe('text');
  });
});
