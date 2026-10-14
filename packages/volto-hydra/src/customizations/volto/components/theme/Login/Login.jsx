import { useEffect } from 'react';
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

import { Helmet } from '@plone/volto/helpers';
import config from '@plone/volto/registry';
import { Icon } from '@plone/volto/components';
import { login, resetLoginRequest } from '@plone/volto/actions';
import { toast } from 'react-toastify';
import { Toast } from '@plone/volto/components';
import aheadSVG from '@plone/volto/icons/ahead.svg';
import clearSVG from '@plone/volto/icons/clear.svg';
import { getURlsFromEnv } from '../../../../../utils/getSavedURLs';
import getDomainInitials from '../../../../../utils/getDomainInitials';
import { demoAccount } from '../../../../../utils/demoAccount';
import { runtimeConfig } from '@plone/volto/runtime_config';

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
  const query = qs.parse(props.location?.search ?? location.search);
  // HYDRA: a demo site's "try editing" link (/login?demo&return_url=…) signs in
  // with the site's demo account, so the visitor never sees this form.
  const demoRequested = 'demo' in query;
  const demo = demoRequested ? demoAccount(runtimeConfig) : null;
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

  const demoLogin = demo?.login;
  const demoPassword = demo?.password;
  useEffect(() => {
    if (demoLogin && !token && !loading && !error) {
      dispatch(login(demoLogin, demoPassword));
    }
  }, [demoLogin, demoPassword, token, loading, error, dispatch]);

  const onLogin = (event) => {
    dispatch(
      login(
        document.getElementsByName('login')[0].value,
        document.getElementsByName('password')[0].value,
      ),
    );
    event.preventDefault();
  };
  // Signing in with the demo account: say so instead of showing the form.
  if (demo && !error) {
    return (
      <div id="page-login">
        <Container>
          <p style={{ margin: '3em 0', textAlign: 'center' }}>Opening the editor…</p>
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
                <a href="https://github.com/collective/volto-hydra" style={{ color: 'inherit' }}>
                  Hydra
                </a>
                <Header.Subheader>Headless Visual Editor</Header.Subheader>
              </Header>
              {demoRequested && !demo ? (
                <p role="alert" style={{ margin: '1em 0', color: '#a00' }}>
                  This editor has no demo account to sign in with (RAZZLE_DEMO_LOGIN and
                  RAZZLE_DEMO_PASSWORD are not set).
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
                      <span style={{
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
                      }}>
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
          </Grid.Column>
        </Grid>
      </Container>
    </div>
  );
};

export default Login;
