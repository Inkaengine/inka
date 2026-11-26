/**
 * The region a move takes its blocks out of, for the re-seed a move owes it
 * (settleBlockStructure's `emptiedContainers`), and the slot the moved block
 * held there (inka#708).
 *
 * A move used to report its source only when the block changed PARENT, so a
 * move between two regions of one container (a layout's hero to its main) left
 * the region it emptied with nothing in it. And it never said which slot the
 * block held, so the region's placeholder stood in for no slot: a template
 * region with no slot, which the merge then moves on every save.
 */
import { describe, test, expect } from 'vitest';
import { emptiedByMove, leftBehind } from './blockSync.js';

const layoutHero = { parentId: 'layout', region: 'hero' };
const layoutMain = { parentId: 'layout', region: 'main' };
const column = { parentId: 'col-1', region: 'items' };
const title = { '@type': 'title', templateId: '/templates/plain', slotId: 'hero' };

describe('emptiedByMove', () => {
  test('a move between two regions of one container empties the region it left', () => {
    expect(emptiedByMove(layoutHero, layoutMain, title)).toEqual([{ ...layoutHero, vacatedSlotId: 'hero' }]);
  });

  test('a move to another container empties the region it left, with the slot', () => {
    expect(emptiedByMove(layoutHero, column, title)).toEqual([{ ...layoutHero, vacatedSlotId: 'hero' }]);
  });

  test('a move within one region empties nothing', () => {
    expect(emptiedByMove(layoutMain, { ...layoutMain }, title)).toEqual([]);
  });

  test('a block with no slot leaves no slot behind', () => {
    expect(emptiedByMove(column, layoutMain, { '@type': 'slate' })).toEqual([column]);
  });

  test('no source region, nothing to re-seed', () => {
    expect(emptiedByMove(null, layoutMain, title)).toEqual([]);
  });
});

describe('leftBehind', () => {
  test('the region a block leaves, with the slot it held', () => {
    expect(leftBehind(column, { slotId: 'tips' })).toEqual({ ...column, vacatedSlotId: 'tips' });
    expect(leftBehind(column, { '@type': 'slate' })).toBe(column);
  });
});
