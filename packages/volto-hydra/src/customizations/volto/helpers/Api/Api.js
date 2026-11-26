/**
 * Api helper.
 * @module helpers/Api
 *
 * VOLTO-HYDRA SHADOW.
 * Byte-identical to the stock @plone/volto Api helper EXCEPT for the bridge
 * branch at the top of the constructor. Copied rather than wrapped because
 * Volto's customization aliasing rewrites `@plone/volto/helpers/Api/Api` for
 * every importer including this file, so importing the original by its package
 * specifier would resolve back here. That is the standard Volto customization
 * idiom and matches the sibling Url shadow.
 *
 * The Hydra additions are tagged with `HYDRA:` comments to keep
 * upstream-rebase diffing trivial.
 */

import superagent from 'superagent';
import Cookies from 'universal-cookie';
import config from '@plone/volto/registry';
import { addHeadersFactory } from '@plone/volto/helpers/Proxy/Proxy';
import {
  stripQuerystring,
  stripSubpathPrefix,
} from '@plone/volto/helpers/Url/Url';
// HYDRA: bridge transport, used instead of superagent inside a Hydra session.
import { BridgeApi } from '../../../../bridge/BridgeApi';
import { getAdapterInfo, whenAdapterReady } from '../../../../bridge/client';

const methods = ['get', 'post', 'put', 'patch', 'del'];

/**
 * Format the url.
 * @function formatUrl
 * @param {string} path Path (or URL) to be formatted.
 * @returns {string} Formatted path.
 */
export function formatUrl(path) {
  const { settings } = config;
  const apiSuffix = settings.legacyTraverse ? '' : '/++api++';

  if (path.startsWith('http://') || path.startsWith('https://')) return path;

  let apiPath = '';
  if (settings.internalApiPath && __SERVER__) {
    apiPath = settings.internalApiPath;
  } else if (settings.apiPath) {
    apiPath = settings.apiPath;
  }

  const contentPath = stripSubpathPrefix(path[0] !== '/' ? `/${path}` : path);
  return `${apiPath}${apiSuffix}${contentPath}`;
}

/**
 * Api class.
 * @class Api
 */
class Api {
  /**
   * Constructor
   * @method constructor
   * @constructs Api
   */
  constructor(req) {
    // HYDRA: inside a Hydra bridge session every CMS call is answered by the
    // frontend's adapter, so the admin holds no credentials and issues no
    // direct request.
    //
    // The choice is made PER CALL, not here in the constructor. Volto builds
    // exactly one Api in start-client at boot and the store middleware closes
    // over it for the life of the app, whereas the iframe view publishes its
    // RPC client only when it mounts. A constructor-time check would therefore
    // always run before the bridge exists and silently fall through to
    // superagent forever — the failure mode is invisible, because everything
    // still works, just not over the bridge.
    const bridgeApis = new WeakMap();

    /**
     * In a bridge session EVERY CMS call must cross the bridge. There is no
     * fallback, deliberately.
     *
     * Standalone Hydra has no CMS of its own: `apiPath` points at nothing
     * meaningful, and for a WordPress site a direct request would be aimed at
     * a Plone that does not exist. Falling back to a direct fetch is not
     * graceful degradation, it is a nonsense request that fails confusingly
     * far from its cause. Anything the adapter cannot serve is a bug — either
     * a UI affordance that should have been capability-gated, or a control
     * panel that should be delegating to the CMS's own admin — an action the
     * adapter declares with a `panel`, which the toolbar links to — instead of
     * calling an API at all.
     *
     * SSR is not an exception. In a bridge session `withoutServerPrefetch`
     * strips the server-side prefetch from every route, so nothing should be
     * asking for CMS content while rendering on the server. If something does,
     * it must say so: silently answering it from `apiPath` sends the admin to
     * whatever CMS that happens to point at — for a WordPress or Drupal site,
     * a Plone that does not exist, and for a Plone site the WRONG Plone, which
     * returns 200 and looks entirely correct.
     */
    const bridgeFor = () => {
      // Plain Volto, no bridge in play: superagent below is the real client.
      if (!config.settings.useBridgeBackend) return null;
      // Bridge session. `typeof window === 'undefined'` is the server, and it
      // is checked HERE rather than above so it cannot short-circuit into the
      // fallback: on the server there is no iframe and therefore no CMS.
      if (req || typeof window === 'undefined') {
        throw new Error(
          '[hydra] a CMS request was made during server-side rendering, but a ' +
            'bridge session has no server-side CMS to answer it. The route ' +
            'that issued it needs its prefetch stripped (withoutServerPrefetch) ' +
            'or its data loaded client-side.',
        );
      }
      const rpc = window.__hydraBridgeRpc;
      if (!rpc) {
        // Published at App mount, before any route can dispatch, so this
        // means the admin is running bridge-backed with no bridge at all.
        throw new Error(
          '[hydra] useBridgeBackend is on but no bridge client is present. ' +
            'The admin cannot reach a CMS by itself.',
        );
      }
      if (!bridgeApis.has(rpc))
        bridgeApis.set(rpc, new BridgeApi(rpc, { getAdapterInfo, whenAdapterReady }));
      return bridgeApis.get(rpc);
    };

    const cookies = new Cookies();

    methods.forEach((method) => {
      this[method] = (
        path,
        {
          params,
          data,
          type,
          headers = {},
          checkUrl = false,
          attach = [],
        } = {},
      ) => {
        // HYDRA: in a bridge session EVERY call crosses the bridge — bridgeFor()
        // throws rather than answer one itself. Stock superagent below serves
        // only a non-bridge (plain Volto) session.
        const bridge = bridgeFor();
        if (bridge) {
          return bridge[method](path, { params, data, type, headers, attach });
        }

        let request;
        let promise = new Promise((resolve, reject) => {
          request = superagent[method](formatUrl(path));

          if (params) {
            request.query(params);
          }

          let authToken;
          if (req) {
            // We are in SSR
            authToken = req.universalCookies.get('auth_token');
            request.use(addHeadersFactory(req));
          } else {
            authToken = cookies.get('auth_token');
          }
          if (authToken) {
            request.set('Authorization', `Bearer ${authToken}`);
          }

          request.set('Accept', 'application/json');

          if (type) {
            request.type(type);
          }

          Object.keys(headers).forEach((key) => request.set(key, headers[key]));

          if (__SERVER__ && checkUrl && ['get', 'head'].includes(method)) {
            request.redirects(0);
          }

          if (data) {
            request.send(data);
          }

          attach.forEach((attachment) => {
            request.attach.apply(request, attachment);
          });

          request.end((err, response = {}) => {
            if (
              checkUrl &&
              request.url &&
              request.xhr &&
              encodeURI(stripQuerystring(request.url)) !==
                stripQuerystring(request.xhr.responseURL)
            ) {
              if (request.xhr.responseURL?.length === 0) {
                return reject({
                  code: 408,
                  status: 408,
                  url: request.xhr.responseURL,
                });
              }
              return reject({
                code: 301,
                url: request.xhr.responseURL,
              });
            }

            if ([301, 302].includes(err?.status)) {
              return reject({
                code: err.status,
                url: err.response?.headers?.location,
              });
            }

            return err ? reject(err) : resolve(response.body || response.text);
          });
        });
        promise.request = request;
        return promise;
      };
    });
  }
}

export default Api;
