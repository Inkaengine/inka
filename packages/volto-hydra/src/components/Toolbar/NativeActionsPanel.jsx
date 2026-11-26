import React from 'react';
import { useSelector, shallowEqual } from 'react-redux';
import { nativeActionsFrom } from './nativeActions';

/**
 * The CMS's own screens, listed.
 *
 * Each entry opens where the ADAPTER said it should. That decision is not ours
 * to make at click time: whether a page can be framed is settled by headers we
 * cannot read from here — wp-admin sends X-Frame-Options: SAMEORIGIN, and a
 * Hydra admin is never on the CMS's origin — and a refused frame arrives blank,
 * with nothing to tell the user. So 'window' is the default and 'iframe' is the
 * adapter opting in for a CMS it knows allows it.
 *
 * rel="noopener": these open the CMS with the user's own session, and a page
 * that can reach back through window.opener is a page that can navigate the
 * admin out from under them.
 */
const NativeActionsPanel = ({ closeMenu }) => {
  const actions = useSelector((state) => state.actions?.actions, shallowEqual);
  const entries = nativeActionsFrom(actions);

  return (
    <div className="native-actions-panel">
      <header className="header">
        <h2>Open in CMS</h2>
      </header>
      <div className="content">
        <ul className="native-actions-list">
          {entries.map((action) => (
            <li key={action.id}>
              <a
                className="native-action"
                data-action-id={action.id}
                href={action.url}
                target={action.target === 'iframe' ? '_self' : '_blank'}
                rel="noopener noreferrer"
                onClick={() => closeMenu?.()}
              >
                {action.title}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default NativeActionsPanel;
