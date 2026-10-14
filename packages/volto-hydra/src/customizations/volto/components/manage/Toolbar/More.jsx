/**
 * Volto's More menu, shadowed for two reasons.
 *
 * **It crashes in bridge mode.** `content.title` is read unguarded while
 * `content` is `state.content?.data` — a value the selector itself
 * optional-chains. With SSR disabled there is no server render to fill the
 * store first, so it is legitimately null while a document loads and the whole
 * menu throws, taking every entry in it down. Our View was already written for
 * that ("whether content is null (loading) or loaded"); this was not.
 *
 * **It carried the split this design argues with.** `state`, `sharing` and four
 * working-copy buttons sat here as unrelated destinations. Sharing and working
 * copies are state changes, so they are entries in the state menu now, and
 * their old entries are gone rather than duplicated.
 *
 * Copied from core rather than patched there: core/ is a separate repository
 * and gitignored, so an edit to it would not travel with this work. Re-check on
 * each Volto upgrade.
 */
import React, { useState, useEffect } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import PropTypes from 'prop-types';
import { useDispatch, useSelector, shallowEqual } from 'react-redux';
import { Link, useHistory } from 'react-router-dom';
import find from 'lodash/find';
import { toast } from 'react-toastify';

import Toast from '@plone/volto/components/manage/Toast/Toast';
import { Pluggable, Plug } from '@plone/volto/components/manage/Pluggable';
import FormattedDate from '@plone/volto/components/theme/FormattedDate/FormattedDate';
import Icon from '@plone/volto/components/theme/Icon/Icon';
import Display from '@plone/volto/components/manage/Display/Display';
import Workflow from '@plone/volto/components/manage/Workflow/Workflow';
import {
  applyWorkingCopy,
  createWorkingCopy,
  removeWorkingCopy,
} from '@plone/volto/actions/workingcopy/workingcopy';
import { flattenToAppURL, getBaseUrl } from '@plone/volto/helpers/Url/Url';
import { usePrevious } from '@plone/volto/helpers/Utils/usePrevious';
import config from '@plone/volto/registry';
import { canTranslate } from '../../../../../components/Toolbar/translationsMode';
import useAdapterInfo from '../../../../../bridge/useAdapterInfo';
import rightArrowSVG from '@plone/volto/icons/right-key.svg';
import userSVG from '@plone/volto/icons/user.svg';
import applySVG from '@plone/volto/icons/ready.svg';
import removeSVG from '@plone/volto/icons/circle-dismiss.svg';

const messages = defineMessages({
  personalTools: {
    id: 'Personal tools',
    defaultMessage: 'Personal tools',
  },
  history: {
    id: 'History',
    defaultMessage: 'History',
  },
  sharing: {
    id: 'Sharing',
    defaultMessage: 'Sharing',
  },
  rules: {
    id: 'Rules',
    defaultMessage: 'Rules',
  },
  aliases: {
    id: 'URL Management',
    defaultMessage: 'URL Management',
  },
  linkstoitem: {
    id: 'Links and references',
    defaultMessage: 'Links and references',
  },
  ManageTranslations: {
    id: 'Manage Translations',
    defaultMessage: 'Manage Translations',
  },
  manageContent: {
    id: 'Manage content…',
    defaultMessage: 'Manage content…',
  },
  CreateWorkingCopy: {
    id: 'Create working copy',
    defaultMessage: 'Create working copy',
  },
  applyWorkingCopy: {
    id: 'Apply working copy',
    defaultMessage: 'Apply working copy',
  },
  removeWorkingCopy: {
    id: 'Remove working copy',
    defaultMessage: 'Remove working copy',
  },
  viewWorkingCopy: {
    id: 'View working copy',
    defaultMessage: 'View working copy',
  },
  workingAppliedTitle: {
    id: 'Changes applied.',
    defaultMessage: 'Changes applied',
  },
  workingCopyAppliedBy: {
    id: 'Made by {creator} on {date}. This is not a working copy anymore, but the main content.',
    defaultMessage:
      'Made by {creator} on {date}. This is not a working copy anymore, but the main content.',
  },
  workingCopyRemovedTitle: {
    id: 'The working copy was discarded',
    defaultMessage: 'The working copy was discarded',
  },
  Unauthorized: {
    id: 'Unauthorized',
    defaultMessage: 'Unauthorized',
  },
  workingCopyErrorUnauthorized: {
    id: 'workingCopyErrorUnauthorized',
    defaultMessage: 'You are not authorized to perform this operation.',
  },
  Error: {
    id: 'Error',
    defaultMessage: 'Error',
  },
  workingCopyGenericError: {
    id: 'workingCopyGenericError',
    defaultMessage: 'An error occurred while performing this operation.',
  },
});

const More = (props) => {
  const dispatch = useDispatch();
  const intl = useIntl();
  const history = useHistory();
  const [, setPushed] = useState(false);
  const pathname = props.pathname;

  const content = useSelector((state) => state.content?.data, shallowEqual);
  const workingCopy = useSelector((state) => state.workingCopy, shallowEqual);
  // HYDRA: multilingual is a site fact AND an adapter capability.
  //
  // Volto reads only the site's answer, which is right when it is the CMS's own
  // admin. Over an adapter it is half the question: a Drupal with two languages
  // reports multilingual: true and its adapter implements none of the
  // translation intents, so this entry opened a table whose every call rejects.
  const adapterInfo = useAdapterInfo();
  const siteData = useSelector((state) => state.site.data);
  const isMultilingual = canTranslate({
    siteData,
    adapterInfo,
    bridged: config.settings.useBridgeBackend,
  });

  const actions = useSelector((state) => state.actions.actions, shallowEqual);

  const workingCopyApply = workingCopy?.apply.loading;
  const workingCopyCreate = workingCopy?.create.loading;
  const workingCopyRemove = workingCopy?.remove.loading;

  const prevWorkingCopyApplyLoading = usePrevious(workingCopyApply);
  const prevWorkingCopyCreateLoading = usePrevious(workingCopyCreate);
  const prevWorkingCopyRemoveLoading = usePrevious(workingCopyRemove);

  const push = (selector) => {
    setPushed(true);
    props.loadComponent(selector);
    document.removeEventListener('mousedown', props.handleClickOutside, false);
  };
  useEffect(() => {
    let erroredAction = '';
    if (prevWorkingCopyApplyLoading && workingCopy.apply.error) {
      erroredAction = 'apply';
    } else if (prevWorkingCopyCreateLoading && workingCopy.create.error) {
      erroredAction = 'create';
    } else if (prevWorkingCopyRemoveLoading && workingCopy.remove.error) {
      erroredAction = 'remove';
    }

    if (erroredAction) {
      const errorStatus = workingCopy[erroredAction].error.status;
      if (errorStatus === 401 || errorStatus === 403) {
        toast.error(
          <Toast
            error
            title={intl.formatMessage(messages.Unauthorized)}
            content={intl.formatMessage(messages.workingCopyErrorUnauthorized)}
          />,
          {
            toastId: 'workingCopyErrorUnauthorized',
            autoClose: 10000,
          },
        );
      } else {
        toast.error(
          <Toast
            error
            title={intl.formatMessage(messages.Error)}
            content={intl.formatMessage(messages.workingCopyGenericError)}
          />,
          {
            toastId: 'workingCopyGenericError',
            autoClose: 10000,
          },
        );
      }
    }
  }, [
    workingCopy,
    prevWorkingCopyApplyLoading,
    prevWorkingCopyCreateLoading,
    prevWorkingCopyRemoveLoading,
    intl,
  ]);

  const path = getBaseUrl(pathname);
  const editAction = find(actions.object, { id: 'edit' });
  const historyAction = find(actions.object, { id: 'history' });
  const sharingAction = find(actions.object, {
    id: 'local_roles',
  });

  const rulesAction = find(actions.object, {
    id: 'contentrules',
  });

  const aliasesAction = find(actions.object_buttons, {
    id: 'redirection',
  });

  const workingCopyCheckoutAction = find(actions.object_buttons, {
    id: 'iterate_checkout',
  });
  const workingCopyCheckinAction = find(actions.object_buttons, {
    id: 'iterate_checkin',
  });

  const dateOptions = {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  };

  return (
    <div
      className="menu-more pastanaga-menu"
      style={{
        flex: props.theToolbar.current
          ? `0 0 ${props.theToolbar.current.getBoundingClientRect().width}px`
          : null,
      }}
    >
      <header>
        <h2>{content?.title}</h2>
        <button
          className="more-user"
          aria-label={intl.formatMessage(messages.personalTools)}
          onClick={() => push('personalTools')}
          tabIndex={0}
        >
          <Icon
            name={userSVG}
            size="30px"
            title={intl.formatMessage(messages.personalTools)}
          />
        </button>
      </header>
      <div className="pastanaga-menu-list">
        <ul>
          <Pluggable name="toolbar-more-menu-list" />
          <Plug pluggable="toolbar-more-menu-list" id="state">
            {content?.['@type'] !== 'Plone Site' && (
              // Plone Site does not have workflow
              <li className="state-select">
                <Workflow pathname={path} closeMenu={props.closeMenu} />
              </li>
            )}
          </Plug>
          <Plug pluggable="toolbar-more-menu-list" id="view">
            {content?.['@type'] !== 'Plone Site' && (
              // Plone Site does not have view (yet)
              <li className="display-select">
                {editAction && <Display pathname={path} />}
              </li>
            )}
          </Plug>
          <Plug pluggable="toolbar-more-menu-list" id="history">
            {content?.['@type'] !== 'Plone Site' && (
              // Plone Site does not have history (yet)
              <li>
                <Link to={`${path}/historyview`}>
                  <div>
                    <span className="pastanaga-menu-label">
                      {historyAction?.title ||
                        intl.formatMessage(messages.history)}
                    </span>
                    <span className="pastanaga-menu-value" />
                  </div>
                  <Icon name={rightArrowSVG} size="24px" />
                </Link>
              </li>
            )}
          </Plug>
          {/* `sharing` was here. Changing who can reach a document is a state
              change, so it is an entry in the state menu above instead — see
              components/Toolbar/StateMenu.jsx. */}
          <Plug pluggable="toolbar-more-menu-list" id="aliases">
            {aliasesAction && (
              <li>
                <Link to={`${path}/aliases`}>
                  {intl.formatMessage(messages.aliases)}
                  <Icon name={rightArrowSVG} size="24px" />
                </Link>
              </li>
            )}
          </Plug>
          {path !== '' &&
            !config.settings.excludeLinksAndReferencesMenuItem && (
              <Plug pluggable="toolbar-more-menu-list" id="linkstoitems">
                <li>
                  <Link to={`${path}/links-to-item`}>
                    {intl.formatMessage(messages.linkstoitem)}
                    <Icon name={rightArrowSVG} size="24px" />
                  </Link>
                </li>
              </Plug>
            )}
          <Plug pluggable="toolbar-more-menu-list" id="rules">
            {rulesAction && (
              <li>
                <Link to={`${path}/rules`}>
                  {intl.formatMessage(messages.rules)}
                  <Icon name={rightArrowSVG} size="24px" />
                </Link>
              </li>
            )}
          </Plug>
        </ul>
      </div>
      <Pluggable name="toolbar-more-manage-content">
        {(pluggables) => (
          <>
            {pluggables.length > 0 && (
              <>
                <header>
                  <h2>{intl.formatMessage(messages.manageContent)}</h2>
                </header>
                <div className="pastanaga-menu-list">
                  <ul>
                    {pluggables.map((p, index) => (
                      <React.Fragment key={index}>{p()}</React.Fragment>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </>
        )}
      </Pluggable>
      {/* Create / Apply / Remove / View working copy were here. Taking a draft
          copy IS a state change — the document gains a version only its author
          sees while the published one stays put — so they are transitions in
          the state menu, declared by whichever adapter supports them. */}
      {editAction && isMultilingual && (
        <Plug pluggable="toolbar-more-manage-content" id="multilingual">
          <li>
            <Link to={`${path}/manage-translations`}>
              {intl.formatMessage(messages.ManageTranslations)}

              <Icon name={rightArrowSVG} size="24px" />
            </Link>
          </li>
        </Plug>
      )}
    </div>
  );
};

More.propTypes = {
  loadComponent: PropTypes.func.isRequired,
  closeMenu: PropTypes.func.isRequired,
};

export default More;
