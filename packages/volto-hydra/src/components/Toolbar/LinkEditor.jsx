/**
 * The text (slate) link editor, as volto-slate's Link plugin draws it, except
 * that a link picked from the object browser keeps the picked item beside its
 * address: `{ type: 'link', data: { url, item } }` (utils/linkItem: the item's
 * catalog metadata, without its address or the people who made it). `data.url`
 * is unchanged, so Volto's link rendering and Plone's resolveuid handling of it
 * are untouched.
 *
 * volto-slate installs its plugins by relative import (editor/plugins/index.js
 * → './Link'), which a file shadow cannot reach, so installLinkEditor swaps
 * the plugin's editor in the config instead.
 */
import React from 'react';
import { ReactEditor } from 'slate-react';
import { useSelector, useDispatch } from 'react-redux';
import AddLinkForm from '@plone/volto/components/manage/AnchorPlugin/components/LinkButton/AddLinkForm';
import {
  _insertElement,
  _unwrapElement,
  _isActiveElement,
  _getActiveElement,
} from '@plone/volto-slate/elementEditor/utils';
import { SIMPLELINK } from '@plone/volto-slate/constants';
import { setPluginOptions } from '@plone/volto-slate/actions/plugins';
import PositionedToolbar from '@plone/volto-slate/editor/ui/PositionedToolbar';
import { useSelectionPosition } from '@plone/volto-slate/hooks/useSelectionPosition';

function getPositionStyle(rect) {
  return {
    style: {
      opacity: 1,
      top: rect.top + window.pageYOffset - 6,
      left: rect.left + window.pageXOffset + rect.width / 2,
    },
  };
}

const LinkEditor = (props) => {
  const { editor, pluginId, getActiveElement, unwrapElement, insertElement } =
    props;
  const pid = `${editor.uid}-${pluginId}`;
  const showEditor = useSelector((state) => {
    return state['slate_plugins']?.[pid]?.show_sidebar_editor;
  });
  const savedPosition = React.useRef();
  const rect = useSelectionPosition();

  const dispatch = useDispatch();

  const active = getActiveElement(editor);
  // console.log('active', active);
  const [node] = active || [];

  if (showEditor && !savedPosition.current) {
    savedPosition.current = getPositionStyle(rect);
  }

  return showEditor ? (
    <PositionedToolbar className="add-link" position={savedPosition.current}>
      <AddLinkForm
        block="draft-js"
        placeholder={'Add link'}
        data={{ url: node?.data?.url || '', item: node?.data?.item }}
        theme={{}}
        onChangeValue={(url, item) => {
          // HYDRA: the picked item rides beside the url (AddLinkForm passes it
          // only while the url is still the picked one).
          const data = item ? { url, item } : { url };
          if (!active) {
            if (!editor.selection) editor.selection = editor.savedSelection;
            insertElement(editor, data);
          } else {
            const selection = unwrapElement(editor);
            editor.selection = selection;
            insertElement(editor, data);
          }
          ReactEditor.focus(editor);
          dispatch(setPluginOptions(pid, { show_sidebar_editor: false }));
          savedPosition.current = null;
        }}
        onClear={() => {
          // clear button was pressed in the link edit popup
          const newSelection = JSON.parse(
            JSON.stringify(unwrapElement(editor)),
          );
          editor.selection = newSelection;
          editor.savedSelection = newSelection;
        }}
        onOverrideContent={(c) => {
          dispatch(setPluginOptions(pid, { show_sidebar_editor: false }));
        }}
      />
    </PositionedToolbar>
  ) : null;
};

/**
 * Replace volto-slate's link editor with this one. Its helper is
 * `(props) => <LinkEditor {...props} pluginId="link" … />`: calling it makes
 * that element without rendering anything, which is how it is found.
 */
export function installLinkEditor(config) {
  const { slate } = config.settings;
  const pluginOptions = {
    insertElement: _insertElement(SIMPLELINK),
    getActiveElement: _getActiveElement(SIMPLELINK),
    isActiveElement: _isActiveElement(SIMPLELINK),
    unwrapElement: _unwrapElement(SIMPLELINK),
  };
  const index = slate.persistentHelpers.findIndex(
    (helper) => helper({})?.props?.pluginId === SIMPLELINK,
  );
  if (index === -1) {
    throw new Error("volto-slate's link editor is not among slate.persistentHelpers");
  }
  slate.persistentHelpers[index] = (props) => (
    <LinkEditor {...props} pluginId={SIMPLELINK} {...pluginOptions} />
  );
  return config;
}
