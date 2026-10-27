/**
 * Whether the starter UI's link picker takes the keyboard when it appears.
 *
 * It appears when a block with an empty required link is selected. Selected by
 * a click on the block itself, the picker is what the author is about to use,
 * so it takes focus. Selected by a click INTO one of the block's text fields on
 * the canvas, the author is typing there: a picker that focused itself ~50ms
 * later took every key after the first.
 */
import { describe, test, expect } from 'vitest';
import { starterPickerTakesFocus } from './starterUi';

describe('starterPickerTakesFocus', () => {
  test('takes focus when the block was selected without a field', () => {
    expect(starterPickerTakesFocus({ focusedFieldName: null })).toBe(true);
    expect(starterPickerTakesFocus({})).toBe(true);
  });

  test('leaves the caret where the author clicked: a field on the canvas', () => {
    expect(starterPickerTakesFocus({ focusedFieldName: 'text' })).toBe(false);
  });
});
