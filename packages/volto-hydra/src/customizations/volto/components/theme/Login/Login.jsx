import { useEffect, useState } from 'react';
import { useDispatch, useSelector, shallowEqual } from 'react-redux';
import { Link, useHistory, useLocation } from 'react-router-dom';
import {
  Container,
  Button,
  Form,
  Input,
  Segment,
  Grid,
  Header,
  List,
} from 'semantic-ui-react';
import { FormattedMessage, defineMessages, useIntl } from 'react-intl';
import qs from 'query-string';

import Helmet from '@plone/volto/helpers/Helmet/Helmet';
import { useClient } from '@plone/volto/hooks/client/useClient';
import config from '@plone/volto/registry';
import Icon from '@plone/volto/components/theme/Icon/Icon';
import {
  login,
  resetLoginRequest,
} from '@plone/volto/actions/userSession/userSession';
import { toast } from 'react-toastify';
import Toast from '@plone/volto/components/manage/Toast/Toast';
import aheadSVG from '@plone/volto/icons/ahead.svg';
import clearSVG from '@plone/volto/icons/clear.svg';
import { getURlsFromEnv } from '../../../../../utils/getSavedURLs';
import getDomainInitials from '../../../../../utils/getDomainInitials';
import { LOGIN } from '@plone/volto/constants/ActionTypes';

const messages = defineMessages({
  login: {
    id: 'Log in',
    defaultMessage: 'Log in',
  },
  loginName: {
    id: 'Login Name',
    defaultMessage: 'Login Name',
  },
  Login: {
    id: 'Login',
    defaultMessage: 'Login',
  },
  password: {
    id: 'Password',
    defaultMessage: 'Password',
  },
  cancel: {
    id: 'Cancel',
    defaultMessage: 'Cancel',
  },
  error: {
    id: 'Error',
    defaultMessage: 'Error',
  },
  loginFailed: {
    id: 'Login Failed',
    defaultMessage: 'Login Failed',
  },
  loginFailedContent: {
    id: 'Both email address and password are case sensitive, check that caps lock is not enabled.',
    defaultMessage:
      'Both email address and password are case sensitive, check that caps lock is not enabled.',
  },
  register: {
    id: 'Register',
    defaultMessage: 'Register',
  },
  forgotPassword: {
    id: 'box_forgot_password_option',
    defaultMessage: 'Forgot your password?',
  },
});

const Login = (props) => {
  const intl = useIntl();
  const history = useHistory();
  const location = useLocation();
  const dispatch = useDispatch();
  const token = useSelector((state) => state.userSession.token, shallowEqual);
  const error = useSelector((state) => state.userSession.login.error);
  const loading = useSelector((state) => state.userSession.login.loading);
  // Upstream 42883aba6: the submit button must not be clickable before
  // hydration, or the form posts unhandled and the server 404s.
  const isClient = useClient();
  const query = qs.parse(props.location?.search ?? location.search);
  // HYDRA: the site's own sign-in options beside the form (GET @login, which
  // a bridge session answers from the ADAPTER as auth.loginOptions, so the
  // question works on a CMS that has never heard of Plone's login providers).
  // One of them may sign in with no password — a demo editor, where the site
  // has one (plone.demoeditor). A demo site's "try editing" link
  // (/login?demo&return_url=…) presses it for the visitor, who never sees
  // this form.
  //
  // Chosen by what the option CAN do (`passwordFree`), not by which CMS
  // plugin produced it: keying on `plugin === 'demo'` asked the admin to
  // recognise one Plone add-on's name, which is the knowledge the adapter
  // contract exists to move out of here.
  const demoRequested = 'demo' in query;
  const [signInOptions, setSignInOptions] = useState(null);
  const [optionsError, setOptionsError] = useState(null);
  useEffect(() => {
    dispatch({ type: 'GET_SIGN_IN_OPTIONS', request: { op: 'get', path: '@login' } })
      .then((result) => setSignInOptions(result.options))
      .catch((failure) => setOptionsError(failure?.message || String(failure?.status)));
  }, [dispatch]);
  const demo = signInOptions?.find((option) => option.passwordFree) ?? null;
  // The id travels in the path, as the CMS puts it there (@login-demo), so
  // this one request shape reaches either transport.
  const signInAsDemo = () =>
    dispatch({
      type: LOGIN,
      request: { op: 'post', path: `@login-${demo.id}` },
    });
  const returnUrl =
    query.return_url ||
    location.pathname.replace(/\/login\/?$/, '').replace(/\/logout\/?$/, '') ||
    '/';

  useEffect(() => {
    if (token && !(props.isLogout || location?.state?.isLogout)) {
      history.push(returnUrl || '/');
      if (toast.isActive('loggedOut')) {
        toast.dismiss('loggedOut');
      }
      if (toast.isActive('loginFailed')) {
        toast.dismiss('loginFailed');
      }
    }
    if (error) {
      if (toast.isActive('loggedOut')) {
        toast.dismiss('loggedOut');
      }
      if (!toast.isActive('loginFailed')) {
        toast.error(
          <Toast
            error
            title={intl.formatMessage(messages.loginFailed)}
            content={intl.formatMessage(messages.loginFailedContent)}
          />,
          { autoClose: false, toastId: 'loginFailed' },
        );
      }
    }
    return () => {
      if (toast.isActive('loginFailed')) {
        toast.dismiss('loginFailed');
        dispatch(resetLoginRequest());
      }
    };
  }, [
    dispatch,
    token,
    error,
    intl,
    history,
    returnUrl,
    props.isLogout,
    location?.state?.isLogout,
  ]);

  const demoOffered = !!demo;
  useEffect(() => {
    if (demoRequested && demoOffered && !token && !loading && !error) {
      dispatch({ type: LOGIN, request: { op: 'post', path: '@login-demo' } });
    }
  }, [demoRequested, demoOffered, token, loading, error, dispatch]);

  const onLogin = (event) => {
    dispatch(
      login(
        document.getElementsByName('login')[0].value,
        document.getElementsByName('password')[0].value,
      ),
    );
    event.preventDefault();
  };
  // Signing in with the demo account (or finding out whether the site has
  // one): say so instead of showing the form.
  if (demoRequested && !error && !optionsError && (signInOptions === null || demo)) {
    return (
      <div id="page-login">
        <Container>
          <p style={{ margin: '3em 0', textAlign: 'center' }}>
            Opening the editor…
          </p>
        </Container>
      </div>
    );
  }
  /**
   * Updated the Login Component to show a message about the Hydra project
   */
  return (
    <div id="page-login">
      <Helmet title={intl.formatMessage(messages.Login)} />
      <Container>
        <Grid centered style={{ marginTop: '10px' }}>
          <Grid.Column>
            <Segment raised>
              <Header as="h2">
                <a
                  href="https://github.com/collective/volto-hydra"
                  style={{ color: 'inherit' }}
                >
                  Hydra
                </a>
                <Header.Subheader>Headless Visual Editor</Header.Subheader>
              </Header>
              {demoRequested && signInOptions && !demo ? (
                <p role="alert" style={{ margin: '1em 0', color: '#a00' }}>
                  This site offers no demo sign-in (no demo editor, such as
                  plone.demoeditor, on the CMS).
                </p>
              ) : null}
              {optionsError ? (
                <p role="alert" style={{ margin: '1em 0', color: '#a00' }}>
                  Could not read the site's sign-in options: {optionsError}
                </p>
              ) : null}
              <p style={{ margin: '1em 0 0.5em' }}>Editor for</p>
              <div style={{ display: 'flex', gap: '0.75em', flexWrap: 'wrap' }}>
                {getURlsFromEnv().map(({ url, name }) => {
                  const displayUrl = url.replace(/#.*$/, '');
                  return (
                    <a
                      key={url}
                      href={displayUrl}
                      target="_blank"
                      rel="noreferrer"
                      title={displayUrl}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.4em',
                        padding: '0.3em 0.7em',
                        borderRadius: '4px',
                        background: '#f0f0f0',
                        color: '#333',
                        textDecoration: 'none',
                        fontSize: '0.9em',
                      }}
                    >
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: '1.8em',
                          height: '1.8em',
                          borderRadius: '3px',
                          background: '#007bb5',
                          color: '#fff',
                          fontWeight: 'bold',
                          fontSize: '0.75em',
                        }}
                      >
                        {getDomainInitials(url)}
                      </span>
                      {name || new URL(displayUrl).hostname}
                    </a>
                  );
                })}
              </div>
            </Segment>
          </Grid.Column>
        </Grid>
        <Grid centered>
          <Grid.Column largeScreen={4} computer={4} tablet={6} mobile={16}>
            <Form method="post" onSubmit={onLogin}>
              <Segment.Group raised>
                <Segment className="primary">
                  <FormattedMessage id="Log In" defaultMessage="Login" />
                </Segment>
                <Segment secondary>
                  <FormattedMessage
                    id="Sign in to start session"
                    defaultMessage="Sign in to start session"
                  />
                </Segment>
                <Segment className="form">
                  <Form.Field inline className="help">
                    <Grid>
                      <Grid.Row stretched>
                        <Grid.Column width="4">
                          <div className="wrapper">
                            <label htmlFor="login">
                              <FormattedMessage
                                id="Login Name"
                                defaultMessage="Login Name"
                              />
                            </label>
                          </div>
                        </Grid.Column>
                        <Grid.Column width="8">
                          {/* eslint-disable jsx-a11y/no-autofocus */}
                          <Input
                            id="login"
                            name="login"
                            placeholder={intl.formatMessage(messages.loginName)}
                            autoFocus
                          />
                        </Grid.Column>
                      </Grid.Row>
                    </Grid>
                  </Form.Field>
                  <Form.Field inline className="help">
                    <Grid>
                      <Grid.Row stretched>
                        <Grid.Column stretched width="4">
                          <div className="wrapper">
                            <label htmlFor="password">
                              <FormattedMessage
                                id="Password"
                                defaultMessage="Password"
                              />
                            </label>
                          </div>
                        </Grid.Column>
                        <Grid.Column stretched width="8">
                          <Input
                            type="password"
                            id="password"
                            autoComplete="current-password"
                            name="password"
                            placeholder={intl.formatMessage(messages.password)}
                            tabIndex={0}
                          />
                        </Grid.Column>
                      </Grid.Row>
                    </Grid>
                  </Form.Field>
                  <Form.Field inline className="help">
                    <Grid>
                      <Grid.Row stretched>
                        {config.settings.showSelfRegistration && (
                          <Grid.Column stretched width="12">
                            <p className="help">
                              <Link to="/register">
                                {intl.formatMessage(messages.register)}
                              </Link>
                            </p>
                          </Grid.Column>
                        )}
                        <Grid.Column stretched width="12">
                          <p className="help">
                            <Link to="/passwordreset">
                              {intl.formatMessage(messages.forgotPassword)}
                            </Link>
                          </p>
                        </Grid.Column>
                      </Grid.Row>
                    </Grid>
                  </Form.Field>
                </Segment>
                <Segment className="actions" clearing>
                  <Button
                    basic
                    primary
                    icon
                    floated="right"
                    type="submit"
                    id="login-form-submit"
                    aria-label={intl.formatMessage(messages.login)}
                    title={intl.formatMessage(messages.login)}
                    loading={loading}
                    disabled={!isClient}
                  >
                    <Icon className="circled" name={aheadSVG} size="30px" />
                  </Button>

                  <Button
                    basic
                    secondary
                    icon
                    floated="right"
                    id="login-form-cancel"
                    as={Link}
                    to="/"
                    aria-label={intl.formatMessage(messages.cancel)}
                    title={intl.formatMessage(messages.cancel)}
                  >
                    <Icon className="circled" name={clearSVG} size="30px" />
                  </Button>
                </Segment>
              </Segment.Group>
            </Form>
            {demo ? (
              <Segment basic textAlign="center">
                <Button type="button" onClick={signInAsDemo} disabled={!isClient || loading}>
                  {demo.title}
                </Button>
              </Segment>
            ) : null}
          </Grid.Column>
        </Grid>
      </Container>
    </div>
  );
};

export default Login;
