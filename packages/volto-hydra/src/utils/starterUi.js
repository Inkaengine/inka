/**
 * Whether the starter UI's link picker (a block's empty required link) takes the
 * keyboard when it appears: only when the block was selected without a field.
 * A click into one of the block's text fields on the canvas is the author
 * choosing where to type; a picker that then focused itself took their keys.
 */
export function starterPickerTakesFocus(blockUI) {
  return !blockUI?.focusedFieldName;
}
