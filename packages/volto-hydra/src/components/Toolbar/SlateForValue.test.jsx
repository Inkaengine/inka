/**
 * The toolbar's one Slate editor serves every block, and its buttons (the
 * <Slate> element) are drawn only while the selected block has rich text.
 * Each time they are drawn again, <Slate> puts the new block's value into the
 * editor and leaves its selection alone. A caret from the block edited before
 * — past a bold word, at [0,1] — then pointed into a one-line paragraph that
 * has no such point, and the first button to read the selection (the format
 * menu's block type) threw "Cannot find a descendant at path", taking the
 * whole admin down.
 */
import React from 'react';
import { describe, test, expect } from 'vitest';
import { render } from '@testing-library/react';
import { createEditor } from 'slate';
import { withReact, useSlate } from 'slate-react';

import { blockTypeAtCursor } from '../../utils/blockFormats';
import SlateForValue from './SlateForValue';

const boldThenText = [
  {
    type: 'p',
    children: [
      { type: 'strong', children: [{ text: 'Received' }] },
      { text: '. We will be in contact within 5 business days.' },
    ],
  },
];
const empty = [{ type: 'p', children: [{ text: '' }] }];
const at = (path, offset) => ({ anchor: { path, offset }, focus: { path, offset } });

const editorAt = (value, selection) => {
  const editor = withReact(createEditor());
  editor.children = value;
  editor.selection = selection;
  editor.savedSelection = selection;
  return editor;
};

// What the format menu reads while it draws.
const BlockType = () => (
  <span data-testid="type">{blockTypeAtCursor(useSlate()) ?? 'none'}</span>
);

describe('SlateForValue', () => {
  test('a caret the new value has no point for is dropped, not read', () => {
    const editor = editorAt(boldThenText, at([0, 1], 32));
    const { getByTestId } = render(
      <SlateForValue editor={editor} initialValue={empty}>
        <BlockType />
      </SlateForValue>,
    );
    expect(getByTestId('type').textContent).toBe('none');
    expect(editor.selection).toBeNull();
    expect(editor.savedSelection).toBeNull();
  });

  test('a caret the new value does have is kept', () => {
    const editor = editorAt(empty, at([0, 0], 0));
    const { getByTestId } = render(
      <SlateForValue editor={editor} initialValue={boldThenText}>
        <BlockType />
      </SlateForValue>,
    );
    expect(getByTestId('type').textContent).toBe('p');
    expect(editor.selection).toEqual(at([0, 0], 0));
  });
});
