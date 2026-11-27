/**
 * A list holds only list items and sub-lists (volto-slate's own rule: its
 * normalizeNode "enforce[s] list rules ... only ol/ul/li as possible
 * children"). The rule never fired, so a list item given a block format stayed
 * inside its list as that block (a heading or paragraph directly in a `ul`),
 * which no list renders as one, and Markdown can't write.
 */
import { describe, it, expect } from 'vitest';
import { Editor } from 'slate';
import { makeEditor } from '@plone/volto-slate/utils';
import { toggleBlock } from '@plone/volto-slate/utils/blocks';

const li = (text) => ({ type: 'li', children: [{ text }] });

describe('a list holds only list items and sub-lists', () => {
  it('a list item given a block format splits the list, as toggleFormatAsListItem says', () => {
    const editor = makeEditor();
    editor.children = [{ type: 'ul', children: [li('one'), li('two'), li('three')] }];
    editor.selection = { anchor: { path: [0, 1, 0], offset: 0 }, focus: { path: [0, 1, 0], offset: 3 } };
    toggleBlock(editor, 'h2');
    expect(editor.children).toEqual([
      { type: 'ul', children: [li('one')] },
      { type: 'h2', children: [{ text: 'two' }] },
      { type: 'ul', children: [li('three')] },
    ]);
  });

  it('a stored paragraph inside a list is lifted out of it', () => {
    const editor = makeEditor();
    editor.children = [{ type: 'ul', children: [li('one'), { type: 'p', children: [{ text: '' }] }] }];
    Editor.normalize(editor, { force: true });
    expect(editor.children).toEqual([
      { type: 'ul', children: [li('one')] },
      { type: 'p', children: [{ text: '' }] },
    ]);
  });

  it('leaves list items and sub-lists where they are', () => {
    const editor = makeEditor();
    const value = [{ type: 'ul', children: [li('one'), { type: 'ul', children: [li('sub')] }, li('two')] }];
    editor.children = structuredClone(value);
    Editor.normalize(editor, { force: true });
    expect(editor.children).toEqual(value);
  });
});
