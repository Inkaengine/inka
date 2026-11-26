import React from 'react';
import { useSelector, shallowEqual } from 'react-redux';
import { Plug } from '@plone/volto/components/manage/Pluggable';
import { Icon } from '@plone/volto/components';
import worldSVG from '@plone/volto/icons/world.svg';
import { nativeActionsFrom } from './nativeActions';

export { nativeActionsFrom };

const NativeActionsButton = ({ onClickHandler }) => {
  const actions = useSelector((state) => state.actions?.actions, shallowEqual);
  if (nativeActionsFrom(actions).length === 0) return null;

  return (
    <button
      className="native-actions-btn"
      aria-label="Open in CMS"
      onClick={(e) => onClickHandler(e, 'nativeActions')}
      tabIndex={0}
      id="toolbar-native-actions"
    >
      <Icon name={worldSVG} size="30px" title="Open in CMS" />
    </button>
  );
};

const NativeActionsPlug = () => {
  if (typeof window === 'undefined') return null;
  return (
    <Plug pluggable="main.toolbar.bottom" id="native-actions">
      {(params) => <NativeActionsButton {...params} />}
    </Plug>
  );
};

export default NativeActionsPlug;
