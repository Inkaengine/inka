import React, { useState } from 'react';
import { Node } from 'slate';
import { Slate } from 'slate-react';

/** Whether every point of `range` is in `value`. */
const fits = (range, value) =>
  !range ||
  (Node.has({ children: value }, range.anchor.path) &&
    Node.has({ children: value }, range.focus.path));

/**
 * <Slate> for the toolbar's one long-lived editor.
 *
 * When <Slate> mounts it puts `initialValue` into `editor.children` and leaves
 * `editor.selection` alone. The toolbar draws its buttons only while the
 * selected block has rich text, so each time they are drawn again the editor
 * gets a new block's value under the caret of the block edited before. A caret
 * the new value has no point for is dropped here, as the value goes in, before
 * anything inside reads it.
 */
export default function SlateForValue({ editor, initialValue, children, ...rest }) {
  useState(() => {
    if (!fits(editor.selection, initialValue)) editor.selection = null;
    if (!fits(editor.savedSelection, initialValue)) editor.savedSelection = null;
  });
  return (
    <Slate editor={editor} initialValue={initialValue} {...rest}>
      {children}
    </Slate>
  );
}
