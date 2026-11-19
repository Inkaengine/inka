import { describe, test, expect } from 'vitest';
import { findChangedUnit } from '@volto-hydra/helpers';

/**
 * findChangedUnit diffs prev/new form to the smallest changed unit so a pure
 * server-rendered frontend can do a targeted outerHTML swap instead of a
 * full-page innerHTML swap (which would destroy contenteditable cursors,
 * scroll, image loads).
 *
 * Pre-#234 it only scanned the `items` region. After #234 a page is multi-region
 * (`items`, `footer`, …) — so editing a block in a non-items region fell through
 * to `{ unit: 'page' }`, i.e. a full-page swap that destroys the cursor on every
 * keystroke in that region. It must scan every region.
 */
describe('findChangedUnit — multi-region pages (#234)', () => {
  const make = (footerText) => ({
    blocks: {
      'body-1': { '@type': 'slate', value: [{ text: 'body' }] },
      'foot-1': { '@type': 'slate', value: [{ text: footerText }] },
    },
    blocks_layout: { items: ['body-1'], footer: ['foot-1'] },
  });

  test('a data change in the footer region targets that block, not the whole page', () => {
    const prev = make('x');
    const next = make('xy'); // only the footer block changed

    // Pre-fix: { unit: 'page' } (footer region ignored) → full-page swap.
    expect(findChangedUnit(prev, next)).toEqual({ unit: 'block', blockId: 'foot-1' });
  });

  test('an items-region edit still targets its block (no regression)', () => {
    const prev = make('x');
    const next = make('x');
    next.blocks['body-1'] = { '@type': 'slate', value: [{ text: 'body!' }] };

    expect(findChangedUnit(prev, next)).toEqual({ unit: 'block', blockId: 'body-1' });
  });

  test('an id-list change in any region is still a page-level change', () => {
    const prev = make('x');
    const next = make('x');
    next.blocks['foot-2'] = { '@type': 'slate', value: [{ text: 'new' }] };
    next.blocks_layout.footer = ['foot-1', 'foot-2']; // region list grew

    expect(findChangedUnit(prev, next)).toEqual({ unit: 'page' });
  });
});
