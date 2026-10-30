/**
 * App container.
 * @module components/theme/App/App
 *
 * HYDRA: forked for TWO things, both of which upstream has no hook for.
 *
 * 1. `<AdapterHost />` on every route. The frontend's adapter has to be mounted
 *    even where there is no preview iframe — the contents view above all — or
 *    those routes have no way to reach the CMS at all.
 *
 * 2. The route's initial data fetched CLIENT-side in a bridge session. Volto
 *    loads content, breadcrumbs, navigation and the site on the server only,
 *    and the client inherits them through the serialised store. A
 *    bridge-backed admin has no server-side CMS to load them from: the adapter
 *    lives in an iframe that does not exist until the browser renders one. So
 *    `__SERVER__` becomes `loadsInThisEnvironment()` on the three the admin
 *    needs, and `site` is asked for here because Volto's own asyncProps
 *    extender for it is built for `loadOnServer` and never runs on the client.
 *
 * It does NOT fork to hide Volto's chrome. That is done in the Header,
 * Breadcrumbs and Footer shadows, which render null, and in admin-chrome.css
 * for the content area's padding — a shadow that renders nothing cannot drift.
 */

import React, { Component } from 'react';
import jwtDecode from 'jwt-decode';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { compose } from 'redux';
import AdapterHost from '../../../../../bridge/AdapterHost';
import { ensureSiteLoaded } from '../../../../../bridge/site';
import { asyncConnect } from '@plone/volto/helpers/AsyncConnect';
import Helmet from '@plone/volto/helpers/Helmet/Helmet';
import { Segment } from 'semantic-ui-react';
import { renderRoutes } from 'react-router-config';
import { Slide, ToastContainer, toast } from 'react-toastify';
import split from 'lodash/split';
import join from 'lodash/join';
import trim from 'lodash/trim';
import cx from 'classnames';
import config from '@plone/volto/registry';
import { PluggablesProvider } from '@plone/volto/components/manage/Pluggable';
import { visitBlocks } from '@plone/volto/helpers/Blocks/Blocks';
import { injectIntl } from 'react-intl';

import Error from '@plone/volto/error';

import Breadcrumbs from '@plone/volto/components/theme/Breadcrumbs/Breadcrumbs';
import Footer from '@plone/volto/components/theme/Footer/Footer';
import Header from '@plone/volto/components/theme/Header/Header';
import Icon from '@plone/volto/components/theme/Icon/Icon';
import OutdatedBrowser from '@plone/volto/components/theme/OutdatedBrowser/OutdatedBrowser';
import AppExtras from '@plone/volto/components/theme/AppExtras/AppExtras';
import SkipLinks from '@plone/volto/components/theme/SkipLinks/SkipLinks';
import BodyClass from '@plone/volto/helpers/BodyClass/BodyClass';
import { getBaseUrl, getView, isCmsUi } from '@plone/volto/helpers/Url/Url';
import { hasApiExpander } from '@plone/volto/helpers/Utils/Utils';
import { getBreadcrumbs } from '@plone/volto/actions/breadcrumbs/breadcrumbs';
import { getContent } from '@plone/volto/actions/content/content';
import { getNavigation } from '@plone/volto/actions/navigation/navigation';
import { getTypes } from '@plone/volto/actions/types/types';
import { getWorkflow } from '@plone/volto/actions/workflow/workflow';

import clearSVG from '@plone/volto/icons/clear.svg';
import MultilingualRedirector from '@plone/volto/components/theme/MultilingualRedirector/MultilingualRedirector';
import WorkingCopyToastsFactory from '@plone/volto/components/manage/WorkingCopyToastsFactory/WorkingCopyToastsFactory';
import LockingToastsFactory from '@plone/volto/components/manage/LockingToastsFactory/LockingToastsFactory';
import RouteAnnouncer from '@plone/volto/components/theme/RouteAnnouncer/RouteAnnouncer';
import SlotRenderer from '@plone/volto/components/theme/SlotRenderer/SlotRenderer';

/**
 * @export
 * @class App
 * @extends {Component}
 */
export class App extends Component {
  /**
   * Property types.
   * @property {Object} propTypes Property types.
   * @static
   */
  static propTypes = {
    pathname: PropTypes.string.isRequired,
  };

  state = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  constructor(props) {
    super(props);
    this.mainRef = React.createRef();
  }

  /**
   * @method componentWillReceiveProps
   * @param {Object} nextProps Next properties
   * @returns {undefined}
   */
  UNSAFE_componentWillReceiveProps(nextProps) {
    if (nextProps.pathname !== this.props.pathname) {
      if (this.state.hasError) {
        this.setState({ hasError: false });
      }
    }
  }

  /**
   * ComponentDidCatch
   * @method ComponentDidCatch
   * @param {string} error  The error
   * @param {string} info The info
   * @returns {undefined}
   */
  componentDidCatch(error, info) {
    this.setState({ hasError: true, error, errorInfo: info });
    config.settings.errorHandlers.forEach((handler) => handler(error));
  }

  dispatchContentClick = (event) => {
    if (event.target === event.currentTarget) {
      const rect = this.mainRef.current.getBoundingClientRect();
      if (event.clientY > rect.bottom) {
        document.dispatchEvent(new Event('voltoClickBelowContent'));
      }
    }
  };

  /**
   * Render method.
   * @method render
   * @returns {string} Markup for the component.
   */
  render() {
    const { views } = config;
    const path = getBaseUrl(this.props.pathname);
    const action = getView(this.props.pathname);
    const isCmsUI = isCmsUi(this.props.pathname);
    const ConnectionRefusedView = views.errorViews.ECONNREFUSED;

    const language =
      this.props.content?.language?.token ?? this.props.intl?.locale;

    return (
      <PluggablesProvider>
        {/* HYDRA: hosts the frontend's adapter on EVERY route. Editing routes
            without an iframe — the contents view above all — would otherwise
            have no adapter and no way to reach the CMS. */}
        <AdapterHost />
        {language && (
          <Helmet>
            <html lang={language} />
          </Helmet>
        )}
        <BodyClass className={`view-${action}view`} />

        {/* Body class depending on content type */}
        {this.props.content && this.props.content['@type'] && (
          <BodyClass
            className={`contenttype-${this.props.content['@type']
              .replaceAll(' ', '-')
              .toLowerCase()}`}
          />
        )}

        {/* Body class depending on sections */}
        <BodyClass
          className={cx({
            [trim(join(split(this.props.pathname, '/'), ' section-'))]:
              this.props.pathname !== '/',
            siteroot: this.props.pathname === '/',
            [`is-adding-contenttype-${decodeURIComponent(
              this.props.location?.search?.startsWith('?type=')
                ? this.props.location?.search?.replace('?type=', '')
                : '',
            )
              .replaceAll(' ', '-')
              .toLowerCase()}`]:
              this.props.location?.search?.startsWith('?type='),
            'is-authenticated': !!this.props.token,
            'is-anonymous': !this.props.token,
            'cms-ui': isCmsUI,
            'public-ui': !isCmsUI,
          })}
        />
        <SlotRenderer name="aboveApp" content={this.props.content} />
        <SkipLinks />
        <Header pathname={path} />
        <Breadcrumbs pathname={path} />
        <MultilingualRedirector
          pathname={this.props.pathname}
          contentLanguage={this.props.content?.language?.token}
        >
          <Segment
            basic
            className="content-area"
            onClick={this.dispatchContentClick}
          >
            <main ref={this.mainRef}>
              <OutdatedBrowser />
              {this.props.connectionRefused ? (
                <ConnectionRefusedView
                  staticContext={this.props.staticContext}
                />
              ) : this.state.hasError ? (
                <Error
                  message={this.state.error.message}
                  stackTrace={this.state.errorInfo.componentStack}
                />
              ) : (
                renderRoutes(this.props.route.routes, {
                  staticContext: this.props.staticContext,
                })
              )}
            </main>
          </Segment>
        </MultilingualRedirector>
        <RouteAnnouncer />
        <Footer />
        <LockingToastsFactory
          content={this.props.content}
          user={this.props.userId}
        />
        <WorkingCopyToastsFactory content={this.props.content} />
        <ToastContainer
          position={toast.POSITION.BOTTOM_CENTER}
          hideProgressBar
          transition={Slide}
          autoClose={5000}
          closeButton={
            <Icon
              className="toast-dismiss-action"
              name={clearSVG}
              size="18px"
            />
          }
        />
        <AppExtras {...this.props} />
      </PluggablesProvider>
    );
  }
}

export const __test__ = connect(
  (state, props) => ({
    pathname: props.location.pathname,
    token: state.userSession.token,
    content: state.content.data,
    apiError: state.apierror.error,
    connectionRefused: state.apierror.connectionRefused,
  }),
  {},
)(App);

export const fetchContent = async ({ store, location }) => {
  const content = await store.dispatch(
    getContent(getBaseUrl(location.pathname)),
  );

  const promises = [];
  const { blocksConfig } = config.blocks;

  const visitor = ([id, data]) => {
    const blockType = data['@type'];
    const block = blocksConfig[blockType];
    if (!block) return;
    const { getAsyncData } = block;
    if (getAsyncData) {
      const p = getAsyncData({
        store,
        dispatch: store.dispatch,
        path: location.pathname,
        location,
        id,
        data,
        blocksConfig,
        content,
      });
      if (!p?.length) {
        throw new Error(
          'You should return a list of promises from getAsyncData',
        );
      }
      promises.push(...p);
    }
  };

  visitBlocks(content, visitor);

  await Promise.allSettled(promises);

  return content;
};

/**
 * Where the route's initial data can actually be fetched.
 *
 * Volto loads content, breadcrumbs and navigation on the server only, and the
 * client inherits them through the serialised store. A bridge-backed admin has
 * no server-side CMS to load them from — the adapter lives in an iframe that
 * does not exist until the browser renders one — so the same fetches have to
 * happen client-side instead. Without this the toolbar never sees a folder to
 * add into, because nothing ever fetched it.
 */
const loadsInThisEnvironment = () =>
  __SERVER__ || config.settings.useBridgeBackend;

export function connectAppComponent(AppComponent) {
  return compose(
    asyncConnect([
      {
        key: 'breadcrumbs',
        promise: ({ location, store: { dispatch } }) => {
          // Do not trigger the breadcrumbs action if the expander is present
          if (
            loadsInThisEnvironment() &&
            !hasApiExpander('breadcrumbs', getBaseUrl(location.pathname))
          ) {
            return dispatch(getBreadcrumbs(getBaseUrl(location.pathname)));
          }
        },
      },
      {
        key: 'content',
        // AFTER the site, in a bridge session. The api middleware builds the
        // expand list from the store as the request goes out, and drops
        // `translations` unless the site is already known to be multilingual —
        // so a content read that wins this race comes back without
        // `@components.translations`, and nothing reads it again. SSR settles
        // this for a direct-fetch admin; there is no server here to settle it.
        promise: async ({ location, store }) => {
          if (!loadsInThisEnvironment()) return;
          if (config.settings.useBridgeBackend) await ensureSiteLoaded(store);
          return fetchContent({ store, location });
        },
      },
      {
        // The site's own facts — default language, languages offered, which
        // features are on — which the admin gates real affordances on:
        // `features.multilingual` decides whether Manage Translations exists at
        // all.
        //
        // Volto fetches this through an asyncProps EXTENDER
        // (helpers/Site/index.js), guarded `__SERVER__ &&`. Two reasons that
        // never fires here: a bridge session has no server-side CMS to read,
        // and the extender list is built for `loadOnServer`, so on the client it
        // is not consumed at all — patching the guard inside it changes nothing.
        //
        // So it is asked for here instead, where this file already re-runs its
        // promises on the client in a bridge session. Only in that session: on
        // the server, and against a CMS the admin talks to directly, Volto's own
        // extender still does it and a second fetch would be waste.
        key: 'site',
        promise: ({ store }) =>
          config.settings.useBridgeBackend && ensureSiteLoaded(store),
      },
      {
        key: 'navigation',
        promise: ({ location, store: { dispatch } }) => {
          // Do not trigger the navigation action if the expander is present
          if (
            loadsInThisEnvironment() &&
            !hasApiExpander('navigation', getBaseUrl(location.pathname))
          ) {
            return dispatch(
              getNavigation(
                getBaseUrl(location.pathname),
                config.settings.navDepth,
              ),
            );
          }
        },
      },
      {
        key: 'types',
        promise: ({ location, store: { dispatch } }) => {
          // Do not trigger the types action if the expander is present
          if (
            __SERVER__ &&
            !hasApiExpander('types', getBaseUrl(location.pathname))
          ) {
            return dispatch(getTypes(getBaseUrl(location.pathname)));
          }
        },
      },
      {
        key: 'workflow',
        promise: ({ location, store: { dispatch } }) =>
          __SERVER__ && dispatch(getWorkflow(getBaseUrl(location.pathname))),
      },
    ]),
    injectIntl,
    connect(
      (state, props) => ({
        pathname: props.location.pathname,
        token: state.userSession.token,
        userId: state.userSession.token
          ? jwtDecode(state.userSession.token).sub
          : '',
        content: state.content.data,
        apiError: state.apierror.error,
        connectionRefused: state.apierror.connectionRefused,
      }),
      null,
    ),
  )(AppComponent);
}

export default connectAppComponent(App);
