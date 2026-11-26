/**
 * Removing a slot from a template asks first (inka#708): pages using the
 * template may hold content in it, and once the slot is gone the merge has
 * nowhere to put that content. There is no index of which pages use which
 * slots, so the ask can only say they may. removedSlots says which slots a new
 * version of a template no longer has.
 *
 * A slot is a place that holds a page's content: a block that is not locked —
 * an open slot, or a fixed block the page edits (a layout's title). Locked
 * chrome holds nothing of a page's.
 */
import { describe, test, expect } from 'vitest';
import { removedSlots } from './mergeTemplates.js';

const T = '/templates/t';
const doc = (blocks, items) => ({ '@id': T, blocks, blocks_layout: { items } });
const slot = (slotId) => ({ '@type': 'slate', templateId: T, slotId, fixed: false });
const chrome = (slotId) => ({ '@type': 'slate', templateId: T, slotId, fixed: true, readOnly: true });
const editable = (slotId) => ({ '@type': 'title', templateId: T, slotId, fixed: true, readOnly: false });

describe('removedSlots', () => {
  test('a slot the new version no longer has', () => {
    const before = doc({ h: chrome('head'), a: slot('aside'), m: slot('default') }, ['h', 'a', 'm']);
    const after = doc({ h: chrome('head'), m: slot('default') }, ['h', 'm']);
    expect(removedSlots(before, after)).toEqual(['aside']);
  });

  test('a fixed block the page edits is a slot too', () => {
    const before = doc({ t: editable('hero'), m: slot('default') }, ['t', 'm']);
    const after = doc({ m: slot('default') }, ['m']);
    expect(removedSlots(before, after)).toEqual(['hero']);
  });

  test('locked chrome is not', () => {
    const before = doc({ h: chrome('head'), m: slot('default') }, ['h', 'm']);
    const after = doc({ m: slot('default') }, ['m']);
    expect(removedSlots(before, after)).toEqual([]);
  });

  test('a slot kept as an empty slot is not removed', () => {
    const before = doc({ l: slot('links') }, ['l']);
    const after = doc({ l: { '@type': 'empty', templateId: T, slotId: 'links', fixed: false } }, ['l']);
    expect(removedSlots(before, after)).toEqual([]);
  });

  test('at any depth', () => {
    const container = (children) => ({
      '@type': 'columns', templateId: T, slotId: 'row', fixed: true, readOnly: true,
      blocks: children, blocks_layout: { items: Object.keys(children) },
    });
    const before = doc({ r: container({ a: slot('left'), b: chrome('sep'), c: slot('right') }) }, ['r']);
    const after = doc({ r: container({ a: slot('left') }) }, ['r']);
    expect(removedSlots(before, after)).toEqual(['right']);
  });
});
