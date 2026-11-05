/**
 * AuthToken helper.
 * @module helpers/AuthToken
 *
 * HYDRA: copied from core so the token-RENEWAL timer can be switched off in a
 * bridge session. Everything else is unchanged.
 *
 * The admin holds no credentials of its own when a bridge is in play — the
 * adapter authenticates against the CMS on the user's behalf — so there is
 * nothing here to renew. Left on, the timer dispatched loginRenew(), which
 * POSTs to `apiPath`: during SSR that reached whatever CMS apiPath names,
 * which in a bridge session is the wrong one (a Plone that does not exist for
 * a WordPress site, or the WRONG Plone for a Plone one, answering 200).
 *
 * It fired far sooner than it looks, too. The renewal delay is derived from
 * the token's `exp`, and a long-lived token overflows setTimeout's 32-bit
 * range — Node clamps that to 1ms, so a token expiring in 2100 renewed
 * IMMEDIATELY, on the server, on every render.
 */

import Cookies from 'universal-cookie';
import jwtDecode from 'jwt-decode';
import { loginRenew } from '@plone/volto/actions/userSession/userSession';
import { getCookieOptions } from '@plone/volto/helpers/Cookies/cookies';
import { push } from 'connected-react-router';
import config from '@plone/volto/registry';

/**
 * Get auth token method (does not work in SSR)
 * @method getAuthToken
 * @returns {undefined}
 */
export function getAuthToken() {
  const cookies = new Cookies();
  return cookies.get('auth_token');
}

/**
 * Persist auth token method.
 * @method persistAuthToken
 * @param {object} store Redux store.
 * @returns {undefined}
 */
export function persistAuthToken(store, req) {
  const cookies = new Cookies();
  let currentValue;
  if (req) {
    // We are in SSR
    currentValue = req.universalCookies.get('auth_token');
  } else {
    currentValue = cookies.get('auth_token');
  }
  /**
   * handleChange method.
   * @method handleChange
   * @param {bool} initial Initial call.
   * @returns {undefined}
   */
  function handleChange(initial) {
    const previousValue = currentValue;
    const state = store.getState();
    currentValue = state.userSession.token;
    if (
      module.hot &&
      module.hot.data &&
      module.hot.data.reloaded &&
      previousValue
    ) {
      currentValue = previousValue;
    }
    if (previousValue !== currentValue || initial) {
      if (!currentValue) {
        if (previousValue) {
          cookies.remove('auth_token', { path: '/' });
          cookies.remove('__ac', { path: '/' });
        }
      } else {
        if (previousValue !== currentValue) {
          cookies.set(
            'auth_token',
            currentValue,
            getCookieOptions({
              expires: new Date(jwtDecode(currentValue).exp * 1000),
            }),
          );
        }
        // HYDRA: no renewal in a bridge session — see the note at the top.
        if (config.settings.useBridgeBackend) return;
        const exp =
          (jwtDecode(store.getState().userSession.token).exp * 1000 -
            new Date().getTime()) *
            0.9 || 3600000;
        setTimeout(() => {
          if (store.getState().userSession.token) {
            if (
              jwtDecode(store.getState().userSession.token).exp * 1000 >
              new Date().getTime()
            ) {
              store.dispatch(loginRenew());
            } else {
              // Logout
              store.dispatch(
                push(
                  `/logout?return_url=${
                    store.getState().router.location.pathname
                  }`,
                ),
              );
            }
          }
        }, exp);
      }
    }
  }
  store.subscribe(handleChange);
  handleChange(true);
}
if (module?.hot) {
  module.hot.dispose((data) => {
    data.reloaded = true;
  });
}
