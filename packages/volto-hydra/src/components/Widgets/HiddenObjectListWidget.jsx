/**
 * HiddenObjectListWidget - the sidebar widget for `widget: 'object_list'`.
 *
 * An object_list is a region by default: its items (like facets, slides, rows)
 * are sub-blocks, edited by clicking them in the preview iframe, so the field
 * itself draws nothing here.
 *
 * With `subBlocks: false` it is a plain list of objects — items that cannot be
 * edited where they are drawn, like a dropdown's options — so Volto's own
 * object-list widget edits it here: add, remove, reorder, and each item's
 * fields.
 */
import React from 'react';
import ObjectListWidget from '@plone/volto/components/manage/Widgets/ObjectListWidget';

const HiddenObjectListWidget = (props) => {
  if (props.subBlocks === false) {
    return <ObjectListWidget {...props} />;
  }
  return null;
};

export default HiddenObjectListWidget;
