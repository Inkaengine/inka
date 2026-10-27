import React from 'react';
import { Editor, Element, Range } from 'slate';
import { useSlate } from 'slate-react';
import config from '@plone/volto/registry';
import { clearFormatting } from '@plone/volto-slate/utils/blocks';
import ToolbarButton from '@plone/volto-slate/editor/ui/ToolbarButton';

/**
 * Whether Clear formatting would change anything in the selection: a block
 * that is not the default (a heading, a list) or an inline element (bold,
 * italic, a link) inside it — what volto-slate's clearFormatting resets.
 */
export function hasFormattingToClear(editor) {
  const { selection } = editor;
  if (!selection || Range.isCollapsed(selection)) return false;
  const { defaultBlockType } = config.settings.slate;
  const [found] = Editor.nodes(editor, {
    at: selection,
    match: (n) =>
      Element.isElement(n) && n.type && n.type !== defaultBlockType,
  });
  return Boolean(found);
}

/**
 * volto-slate's Clear formatting, disabled when there is nothing to clear.
 * Volto's is always enabled, so on plain text a click did nothing and said
 * nothing.
 */
const ClearFormattingButton = ({ icon, ...props }) => {
  const editor = useSlate();
  const handleMouseDown = React.useCallback(
    (event) => {
      event.preventDefault();
      clearFormatting(editor);
    },
    [editor],
  );
  return (
    <ToolbarButton
      {...props}
      disabled={!hasFormattingToClear(editor)}
      onMouseDown={handleMouseDown}
      icon={icon}
    />
  );
};

export default ClearFormattingButton;
