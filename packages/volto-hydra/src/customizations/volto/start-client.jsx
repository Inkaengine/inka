/**
 * HYDRA: copied from core so a bridge-backed admin MOUNTS instead of hydrating.
 *
 * In bridge mode the server renders nothing (see the routes customization):
 * the admin's content comes from an adapter in an iframe that does not exist
 * until the browser makes one, so there is no markup for the server to
 * produce. Hydration expects the server's output to match what the client
 * renders, and against an empty container React discards it and warns on every
 * boot. createRoot is what an app with no server markup is supposed to use.
 *
 * These two customizations only work as a pair. Rendering nothing on the
 * server while still hydrating here, or hydrating markup that was never sent,
 * are both broken — hence the pointer in each direction.
 */
import '@plone/volto/config'; // This is the bootstrap for the global config - client side
import '@root/theme';
import React from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { IntlProvider } from 'react-intl-redux';
import { RouterProvider } from 'react-aria-components';
import { ConnectedRouter } from 'connected-react-router';
import { useHistory } from 'react-router-dom';
import { createBrowserHistory } from 'history';
import { ReduxAsyncConnect } from '@plone/volto/helpers/AsyncConnect';
import { loadableReady } from '@loadable/component';
import { CookiesProvider } from 'react-cookie';
import debug from 'debug';
import routes from '@root/routes';
import config from '@plone/volto/registry';

import configureStore from '@plone/volto/store';
import Api from '@plone/volto/helpers/Api/Api';
import { persistAuthToken } from '@plone/volto/helpers/AuthToken/AuthToken';
import ScrollToTop from '@plone/volto/helpers/ScrollToTop/ScrollToTop';

function reactIntlErrorHandler(error) {
  debug('i18n')(error);
}

function ReactAriaRouterProvider({ children }) {
  const history = useHistory();

  const navigate = (to, options = {}) => {
    if (options.replace) {
      history.replace(to);
    } else {
      history.push(to);
    }
  };

  return <RouterProvider navigate={navigate}>{children}</RouterProvider>;
}

export default function client() {
  const api = new Api();

  if (window.env.RAZZLE_SUBPATH_PREFIX) {
    config.settings.subpathPrefix = window.env.RAZZLE_SUBPATH_PREFIX;
  }
  const history = createBrowserHistory({
    basename: config.settings.subpathPrefix
      ? config.settings.subpathPrefix
      : '/',
  });

  const store = configureStore(window.__data, history, api);
  persistAuthToken(store);

  // On Cypress we expose the history, the store and the settings
  // so we can access from Cypress and manipulate them
  if (window.Cypress) {
    window.appHistory = history;
    window.store = store;
    window.settings = config.settings;
  }

  // Setup the client registry from the SSR response values, presents in the `window.env`
  // variable. This is key for the Seamless mode to work.
  if (window.env.apiPath) {
    config.settings.apiPath = window.env.apiPath;
  }
  if (window.env.publicURL) {
    config.settings.publicURL = window.env.publicURL;
  }
  // There are some cases that the client needs to know the internal server URL
  // too, as some helpers (isInternalURL and flattenToAppURL) need to be aware of it.
  // This is specially important when the hydration of the store coming from the first SSR
  // request happens, since there all the server URLs might be the internalApiPath ones,
  // and the client should be able to take care of them properly.
  if (window.env.RAZZLE_INTERNAL_API_PATH) {
    config.settings.internalApiPath = window.env.RAZZLE_INTERNAL_API_PATH;
  }
  // TODO: To be removed when the use of the legacy traverse is deprecated.
  if (window.env.RAZZLE_LEGACY_TRAVERSE) {
    config.settings.legacyTraverse = true;
  }

  loadableReady(() => {
    const container = document.getElementById('main');
    // No server markup in a bridge session — mount rather than hydrate.
    const mount = config.settings.useBridgeBackend
      ? (node, element) => createRoot(node).render(element)
      : hydrateRoot;
    mount(
      container,
      <CookiesProvider>
        <Provider store={store}>
          <IntlProvider onError={reactIntlErrorHandler}>
            <ConnectedRouter history={history}>
              <ReactAriaRouterProvider>
                <ScrollToTop>
                  <ReduxAsyncConnect routes={routes} helpers={api} />
                </ScrollToTop>
              </ReactAriaRouterProvider>
            </ConnectedRouter>
          </IntlProvider>
        </Provider>
      </CookiesProvider>,
    );
  });
}
