/**
 * Drop-in replacement for Volto's Api helper that routes every call over the
 * Hydra bridge instead of fetching the CMS directly.
 *
 * Same five methods, same argument shape, so the api middleware, the ~30 URL
 * templates in the action creators, and every reducer stay untouched — only
 * the transport changes.
 *
 * Two transports live behind that interface:
 *
 *   passthrough — the request's Plone path is forwarded verbatim. Only an
 *     adapter advertising `http-passthrough` can serve it, and for Plone it
 *     reproduces today's behaviour exactly, which is what makes the
 *     transparency proof meaningful.
 *
 *   semantic — the path is translated to a canonical intent and the result
 *     translated back. This is what lets a CMS that has never heard of
 *     /@querystring answer the query builder.
 *
 * The adapter picks, by what it advertises. Routing per request rather than per
 * adapter matters because coverage is partial: /@history has no canonical form
 * yet, so it must still reach a passthrough adapter rather than fail.
 */

import { routeToIntent } from './intentRouter';
import { plonify } from './plonify';

const METHODS = ['get', 'post', 'put', 'patch', 'del'];

export class BridgeApi {
  constructor(rpc, { getAdapterInfo, whenAdapterReady } = {}) {
    this.rpc = rpc;
    this.getAdapterInfo = getAdapterInfo ?? (() => null);
    // Without this the first request decides the transport for good, before
    // the adapter has said a word.
    this.whenAdapterReady = whenAdapterReady ?? (() => Promise.resolve(null));
    // Reads currently on their way, by intent+args. See the note in dispatch.
    this.inFlightReads = new Map();
    METHODS.forEach((op) => {
      this[op] = (path, { params, data, headers } = {}) =>
        this.dispatch({ op, path, data, headers, params });
    });
  }

  supportsPassthrough(info) {
    // Passthrough means "this CMS speaks Plone's REST dialect". Only an
    // adapter that SAYS so gets it.
    //
    // This used to default to true when no adapter had announced, on the
    // reasoning that passthrough was the status quo. Against WordPress that
    // guess sent /@types, /@actions, /@breadcrumbs and the content GET itself
    // down a passthrough the adapter does not implement: six 501s, a schema
    // that never arrived, and an edit form with no fields — while the calls
    // made after the announcement worked perfectly, which made it look
    // intermittent rather than wrong.
    return Boolean(info?.capabilities?.includes('http-passthrough'));
  }

  async dispatch({ op, path, data, headers, params }) {
    // Volto renews its auth token on a timer and once at startup. In bridge
    // mode the admin holds no CMS credentials at all — the adapter owns the
    // session — so there is nothing to renew. Routed like any other POST this
    // became content.create for a document called "@login-renew", which 404s
    // on every CMS, and a failed renewal reads to the admin as a dead session.
    //
    // Answering with the token the admin already has is what a successful
    // renewal returns, and leaves its state exactly as it was.
    if (op === 'post' && String(path).split('?')[0].endsWith('@login-renew')) {
      return { token: currentAuthToken() };
    }

    // Wait for the announcement, then read what is CURRENTLY known: the wait
    // is about not deciding too early, and the answer is whatever the adapter
    // has since told us.
    await this.whenAdapterReady();
    const info = this.getAdapterInfo();
    if (!info) {
      // Nothing ever announced. Routing on a guess is what produced the 501
      // storm above; say so instead, naming the call that could not be routed.
      throw new Error(
        `[hydra] No adapter announced itself, so ${op.toUpperCase()} ${path} ` +
          `cannot be routed. The frontend either failed to load or never ` +
          `registered an adapter.`,
      );
    }
    // Logging out is the adapter's session ending, not a call to forward.
    //
    // Volto posts @logout. Routed like anything else, a passthrough adapter
    // proxies that to the CMS and keeps its own credential: the admin's UI
    // clears while the session that actually matters stays open — the shared
    // machine case auth.spec.ts calls out. An adapter without passthrough is
    // worse off still: intentRouter has no @logout case, so the call cannot be
    // routed at all and logout simply fails.
    //
    // Handled before passthrough so every adapter ends its session the same
    // way, through the canonical intent the contract already pins.
    if (op === 'post' && String(path).split('?')[0].endsWith('@logout')) {
      return this.rpc.request('auth.logout', {});
    }

    if (this.supportsPassthrough(info)) {
      return this.rpc.request('http', { op, path, data, headers, params });
    }

    // params are Volto's querystring; the router reads the query off the path,
    // so fold them in before matching.
    const fullPath = withParams(path, params);
    const routed = routeToIntent({ op, path: fullPath, data });

    if (!routed) {
      // No canonical equivalent and no passthrough to fall back on. Failing
      // loudly names the endpoint that needs one — silently returning empty
      // would surface later as an unexplained blank panel.
      throw new Error(
        `[hydra] No canonical intent for ${op.toUpperCase()} ${fullPath}, ` +
          `and this adapter does not implement the http passthrough. ` +
          `Add a route in intentRouter.js or an http case in the adapter.`,
      );
    }

    // JOIN a read that is already on its way, rather than asking again.
    //
    // Volto loads the same document from more than one place: the App-level
    // loaders (which a bridge session runs on the CLIENT, having no server to
    // run them on) and the route's own asyncConnect. In stock Volto the first
    // set runs during SSR, so only one client fetch happens; here both do.
    //
    // The cost is not just the extra request. Edit re-dispatches getSchema on
    // every content loading -> loaded transition, so a second, later fetch
    // re-runs the schema and re-initialises the form — tearing down whatever
    // is mounted inside it. On WordPress that landed while the object browser
    // was open: it unmounted mid-navigation and its listing arrived to a
    // component that no longer existed.
    //
    // Sharing one promise makes both callers settle together, so the store
    // sees a single loading -> loaded transition and the schema runs once.
    // Reads only: two writes are two intentions, never one.
    const readKey =
      op === 'get' ? `${routed.intent}:${JSON.stringify(routed.args)}` : null;
    if (readKey && this.inFlightReads.has(readKey)) {
      return this.inFlightReads.get(readKey);
    }

    let result;
    const pending = this.rpc.request(routed.intent, routed.args);
    try {
      if (readKey) {
        this.inFlightReads.set(
          readKey,
          pending.then((r) =>
            plonify(routed.intent, r, {
              path: fullPath,
              endpoint: routed.endpoint,
            }),
          ),
        );
      }
      result = await pending;
    } catch (err) {
      // A request that THROWS is invisible in the success log below, which is
      // how a silently-empty panel looks identical to one nobody asked for.
      if (typeof window !== 'undefined' && window.__HYDRA_AUDIT) {
        // eslint-disable-next-line no-console
        console.log(
          `[AUDIT-INTENT] FAILED ${op.toUpperCase()} ${fullPath} -> ` +
            `${routed.intent} ${JSON.stringify(routed.args)} | ${err?.code ?? ''} ${err?.message ?? err}`,
        );
      }
      throw err;
    } finally {
      if (readKey) this.inFlightReads.delete(readKey);
    }
    const plonified = plonify(routed.intent, result, {
      path: fullPath,
      endpoint: routed.endpoint,
    });
    if (typeof window !== 'undefined' && window.__HYDRA_AUDIT) {
      const count = (v) => (Array.isArray(v?.items) ? v.items.length : '-');
      // eslint-disable-next-line no-console
      console.log(
        `[AUDIT-INTENT] ${op.toUpperCase()} ${fullPath} -> ${routed.intent} ` +
          `${JSON.stringify(routed.args)} | adapter items=${count(result)} ` +
          `plonified items=${count(plonified)}`,
      );
    }
    return plonified;
  }
}

/**
 * The auth token the admin is currently carrying, straight from the cookie
 * Volto stores it in. Undefined outside a browser, where nothing renews.
 */
function currentAuthToken() {
  if (typeof document === 'undefined') return undefined;
  const match = document.cookie.match(/(?:^|;\s*)auth_token=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function withParams(path, params) {
  if (!params || !Object.keys(params).length) return path;
  const [base, existing] = String(path).split('?');
  const qs = new URLSearchParams(existing || '');
  for (const [k, v] of Object.entries(params)) qs.set(k, v);
  return `${base}?${qs.toString()}`;
}

export default BridgeApi;
