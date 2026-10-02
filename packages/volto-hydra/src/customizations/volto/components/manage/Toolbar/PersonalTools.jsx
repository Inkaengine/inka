import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { useDispatch, useSelector, shallowEqual } from 'react-redux';
import { Link, useLocation } from 'react-router-dom';
import jwtDecode from 'jwt-decode';
import cx from 'classnames';
import { FormattedMessage, useIntl, defineMessages } from 'react-intl';

import Icon from '@plone/volto/components/theme/Icon/Icon';
import Image from '@plone/volto/components/theme/Image/Image';
import { getUser } from '@plone/volto/actions/users/users';
import { Pluggable } from '@plone/volto/components/manage/Pluggable';
import { expandToBackendURL, getBaseUrl } from '@plone/volto/helpers/Url/Url';
import logoutSVG from '@plone/volto/icons/log-out.svg';
import config from '@plone/volto/registry';
import { nativeActionForPanel } from '../../../../../components/Toolbar/nativeActions';
import rightArrowSVG from '@plone/volto/icons/right-key.svg';
import backSVG from '@plone/volto/icons/back.svg';
import cameraSVG from '@plone/volto/icons/camera.svg';

const messages = defineMessages({
  back: {
    id: 'Back',
    defaultMessage: 'Back',
  },
  logout: {
    id: 'Logout',
    defaultMessage: 'Logout',
  },
  preferences: {
    id: 'Preferences',
    defaultMessage: 'Preferences',
  },
  profile: {
    id: 'Profile',
    defaultMessage: 'Profile',
  },
  userAvatar: {
    id: 'user avatar',
    defaultMessage: 'user avatar',
  },
});

const PersonalTools = (props) => {
  const dispatch = useDispatch();
  const intl = useIntl();
  const { pathname } = useLocation();
  const [, setPushed] = useState(false);
  const token = useSelector((state) => state.userSession.token, shallowEqual);
  const user = useSelector((state) => state.users.user);
  const userId = token ? jwtDecode(token).sub : '';
  const siteSetupAction = useSelector((state) =>
    state.actions?.actions?.user?.find(
      (action) => action?.id === 'plone_setup',
    ),
  );
  // HYDRA: two of these three screens belong to the CMS, not to the admin.
  //
  // Profile is an account — a name, an email, a password — and the admin holds
  // no credentials to change one. Site Setup is configuration, which every CMS
  // does differently and none of it translates into intents. So an adapter may
  // declare an action answering either screen, and we link there instead.
  //
  // Preferences stays. It is only the INTERFACE language (see Volto's
  // PersonalPreferences), which is the editor's choice about the admin and
  // deliberately not the language of the content. Handing it to the CMS would
  // re-couple the two.
  const actions = useSelector((state) => state.actions?.actions, shallowEqual);
  // `useBridgeBackend` is the flag the rest of the admin reads for this (see
  // Api.js, routes.js, AuthToken.js) — a bridge session has no CMS of its own
  // to answer Volto's control panels.
  const nativeProfile = nativeActionForPanel(actions, 'profile');
  const nativeSiteSetup = nativeActionForPanel(actions, 'site-setup');
  // Volto's own screens work against a CMS that speaks Plone's REST dialect.
  // Where neither is true the link is hidden rather than offered dead: a
  // control panel pointed at a CMS that has no such endpoint fails far from
  // its cause.
  const voltoScreensWork = !config.settings.useBridgeBackend;
  useEffect(() => {
    dispatch(getUser(userId));
  }, [dispatch, userId]);

  const push = (selector) => {
    setPushed(true);
    props.loadComponent(selector);
  };

  const pull = () => {
    props.unloadComponent();
  };

  return (
    <div
      className={cx('personal-tools pastanaga-menu', {
        'has-inner-actions': props.hasActions,
      })}
      style={{
        flex: props.theToolbar.current
          ? `0 0 ${props.theToolbar.current.getBoundingClientRect().width}px`
          : null,
      }}
    >
      <header className="header">
        <button className="back" onClick={pull}>
          <Icon
            name={backSVG}
            size="30px"
            title={intl.formatMessage(messages.back)}
          />
        </button>
        <div className="vertical divider" />
        <h2>{user.fullname ? user.fullname : user.username}</h2>
        <Link id="toolbar-logout" to={`${getBaseUrl(pathname)}/logout`}>
          <Icon
            className="logout"
            name={logoutSVG}
            size="30px"
            title={intl.formatMessage(messages.logout)}
          />
        </Link>
      </header>
      <div className={cx('avatar', { default: !user.portrait })}>
        {user.portrait ? (
          <Image
            src={expandToBackendURL(user.portrait)}
            alt={intl.formatMessage(messages.userAvatar)}
          />
        ) : (
          <Icon name={cameraSVG} size="96px" />
        )}
      </div>
      {/* <Stats /> Maybe we can find a good fit in the future for this visual element */}
      <div className="pastanaga-menu-list">
        {/* This (probably also) should be a Component by itself*/}
        <ul>
          {nativeProfile ? (
            <li>
              <a
                id={intl.formatMessage(messages.profile)}
                href={nativeProfile.url}
                target={nativeProfile.target === 'iframe' ? '_self' : '_blank'}
                rel="noopener noreferrer"
              >
                {nativeProfile.title || (
                  <FormattedMessage id="Profile" defaultMessage="Profile" />
                )}
                <Icon name={rightArrowSVG} size="24px" />
              </a>
            </li>
          ) : (
            voltoScreensWork && (
              <li>
                <Link
                  id={intl.formatMessage(messages.profile)}
                  to="/personal-information"
                >
                  <FormattedMessage id="Profile" defaultMessage="Profile" />
                  <Icon name={rightArrowSVG} size="24px" />
                </Link>
              </li>
            )
          )}
          <li>
            <button
              aria-label={intl.formatMessage(messages.preferences)}
              onClick={() => push('preferences')}
            >
              <FormattedMessage id="Preferences" defaultMessage="Preferences" />
              <Icon name={rightArrowSVG} size="24px" />
            </button>
          </li>

          {nativeSiteSetup ? (
            <li>
              <a
                href={nativeSiteSetup.url}
                target={nativeSiteSetup.target === 'iframe' ? '_self' : '_blank'}
                rel="noopener noreferrer"
              >
                {nativeSiteSetup.title || (
                  <FormattedMessage id="Site Setup" defaultMessage="Site Setup" />
                )}
                <Icon name={rightArrowSVG} size="24px" />
              </a>
            </li>
          ) : (
            voltoScreensWork &&
            siteSetupAction && (
              <li>
                <Link to="/controlpanel">
                  <FormattedMessage id="Site Setup" defaultMessage="Site Setup" />
                  <Icon name={rightArrowSVG} size="24px" />
                </Link>
              </li>
            )
          )}
          <Pluggable name="toolbar-user-menu" />
        </ul>
      </div>
    </div>
  );
};

PersonalTools.propTypes = {
  loadComponent: PropTypes.func.isRequired,
};
export default PersonalTools;
