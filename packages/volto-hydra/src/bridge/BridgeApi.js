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
import { plonify } from '@volto-hydra/helpers';

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
        this.dispatch({ op, path, data, headers, params }).catch((error) => {
          throw asVoltoError(error);
        });
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
    //
    // Overridable so the cost of the INTENT path can be measured rather than
    // argued about: against Plone, passthrough relays the admin's own HTTP
    // calls verbatim, so a bridge-vs-direct comparison measures one extra hop
    // and nothing of routeToIntent. RAZZLE_BRIDGE_PASSTHROUGH=false forces the
    // same run down the intents, which is the path every non-Plone CMS takes.
    // Validated in playwright.config.ts, like RAZZLE_BRIDGE_EXPANDERS: a typo
    // must fail rather than quietly pick a side.
    if (process.env.RAZZLE_BRIDGE_PASSTHROUGH === 'false') return false;
    return Boolean(info?.capabilities?.includes('http-passthrough'));
  }

  async dispatch({ op, path, data, headers, params }) {

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

    // Renewal is a question for whoever HOLDS the session, and it has to be
    // asked.
    //
    // Volto renews on a timer and once at startup. This used to be answered out
    // of the admin's own cookie — the reasoning being that in bridge mode the
    // admin holds no CMS credentials, the adapter owns the session, so there is
    // nothing to renew. True about renewing, wrong about asking: renewal is the
    // ONLY thing that ever checks whether the token the browser is holding is
    // still one the site accepts, and /connect-agent is built on that. It
    // offers Allow only once renewal has answered, because a deploy that resets
    // the site stops accepting every token it had issued, and the agent would
    // be handed that dead one and fail on every call. Answering from the cookie
    // said yes to a session nobody had asked about — the single thing that page
    // exists to prevent — and the bridge admin duly offered Allow on a token
    // the site had just revoked.
    //
    // A Plone-dialect adapter is relayed: @login-renew is a real endpoint there,
    // so the SITE decides — a 401 for a token it no longer accepts, a fresh
    // token otherwise, which is what Volto asked for in the first place.
    //
    // Any other adapter has no such endpoint, so the adapter is asked who the
    // session belongs to instead (`auth.whoami`, the contract's Session
    // question, which all four adapters answer), and the admin keeps the token
    // it already has.
    //
    // Both answered HERE, together, and not left to fall through: `@login-renew`
    // also matches the `@login-<option>` branch below, which would press it as
    // a login provider called "renew".
    if (op === 'post' && String(path).split('?')[0].endsWith('@login-renew')) {
      if (this.supportsPassthrough(info)) {
        return this.rpc.request('http', { op, path, data, headers, params });
      }
      // "The signed-in user, or null" — so an adapter may refuse by answering
      // rather than by throwing, and both mean the same thing here.
      const user = await this.rpc.request('auth.whoami', {});
      if (!user) {
        throw Object.assign(
          new Error('[hydra] The site no longer accepts this sign-in.'),
          { code: 'UNAUTHORIZED', status: 401 },
        );
      }
      return { token: currentAuthToken() };
    }

    // @querystring is a DECLARATION, not content.
    //
    // It is how a backend says what it can be queried on, ordered by and shown
    // as a column, and the admin builds its query builder, its rearrange menu
    // and its contents columns from the answer. Relayed verbatim through the
    // passthrough, the answer is the CMS's own rather than the ADAPTER's — so a
    // Plone backend handed back raw plone.app.querystring, which says nothing
    // about what kind of value an index holds and carries whatever sort keys
    // Plone happens to list rather than the ones the adapter has normalised.
    //
    // Which left the admin holding that knowledge instead: a hard-coded table
    // of Plone index names, consulted for every backend, describing none of
    // them but Plone.
    //
    // Before passthrough for the same reason @logout is: the question has one
    // canonical answer that the contract pins, so every adapter should answer
    // it the same way. `@querystring-search` is a POST and a different
    // endpoint, and is not caught by this.
    if (op === 'get' && String(path).split('?')[0].endsWith('@querystring')) {
      const result = await this.rpc.request('querystring.getIndexes', {});
      return plonify('querystring.getIndexes', result, { path });
    }

    // How this site lets someone sign in is the SITE's answer, not Plone's.
    //
    // Relayed through the passthrough it worked on a Plone backend and was
    // unroutable everywhere else — `No canonical intent for GET /@login` —
    // so an admin over WordPress or Drupal could not even ask. Before
    // passthrough for the same reason @logout and @querystring are: one
    // question, one canonical answer, every adapter.
    //
    // Asked while anonymous, which is the only time it matters. The adapter
    // announces before anyone has signed in (an announced adapter with no
    // user is exactly what the sign-in prompt is for), so there is a peer to
    // ask.
    if (op === 'get' && String(path).split('?')[0].endsWith('@login')) {
      const result = await this.rpc.request('auth.loginOptions', {});
      return plonify('auth.loginOptions', result, { path });
    }

    // Pressing one of them. The id is in the path, as Plone puts it there
    // (@login-demo), so Volto's action creators stay URL-shaped and the same
    // component works on either transport. @login-renew is not one of these —
    // it is answered above, on either transport, before this can see it.
    const pressed = /@login-([^/?]+)$/.exec(String(path).split('?')[0]);
    if (op === 'post' && pressed) {
      const result = await this.rpc.request('auth.loginWithOption', {
        id: decodeURIComponent(pressed[1]),
      });
      return plonify('auth.loginWithOption', result, { path });
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
      // Audited like any other call. This throw happens BEFORE the try/catch
      // that logs [AUDIT-INTENT] FAILED, so without this an unroutable
      // endpoint is the one kind of failure the audit cannot see — and Volto
      // turns it into a FAIL action rather than an uncaught error, so it is
      // invisible in the console too. That blind spot hid `@lock` for a while.
      if (typeof window !== 'undefined' && window.__HYDRA_AUDIT) {
        // eslint-disable-next-line no-console
        console.log(`[AUDIT-INTENT] UNROUTABLE ${op.toUpperCase()} ${fullPath}`);
      }
      throw new Error(
        `[hydra] No canonical intent for ${op.toUpperCase()} ${fullPath}, ` +
          `and this adapter does not implement the http passthrough. ` +
          `Add a route in intentRouter.js or an http case in the adapter.`,
      );
    }

    // Several canonical operations for one request (a bulk @move): perform
    // them in order — moves into the same folder must not race — and answer
    // with each result, as Plone answers a bulk request with a list.
    if (Array.isArray(routed)) {
      const results = [];
      for (const step of routed) {
        const result = await this.rpc.request(step.intent, step.args);
        results.push(plonify(step.intent, result, { path: fullPath }));
      }
      return results;
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
        const shared = pending.then((r) =>
          plonify(routed.intent, r, {
            path: fullPath,
            endpoint: routed.endpoint,
          }),
        );
        // Someone has to WATCH this one fail. The caller awaits `pending` and
        // handles its rejection below; `shared` is a second promise derived
        // from it, kept here for a second caller who may never come — so when
        // a read failed, its rejection went unobserved. In a browser that is
        // an "Unhandled promise rejection" in the console of every session
        // that ever fails a read, in Node it is loud enough to fail the whole
        // process, and in neither is it a second failure: it is this one,
        // reported by nobody. Noticed when three of them failed the build
        // while all 1770 tests passed.
        //
        // The no-op catch observes it. `shared` itself still rejects, so a
        // second caller awaiting it gets the failure exactly as before.
        shared.catch(() => {});
        this.inFlightReads.set(readKey, shared);
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
/**
 * A failure shaped the way Volto's reducers read one.
 *
 * Volto's Api helper rejects with superagent's error, so `error.response` is
 * always there, and its reducers go straight for it — userSession's
 * `LOGIN_RENEW_FAIL` does `action.error.response.error` with nothing guarding
 * it. An error from the bridge has no `response`, and the cost is not a
 * missing message: the REDUCER THROWS while reading it, so the FAIL action
 * never lands and the state it was meant to change is left as it was.
 *
 * Which is how /connect-agent came to sit on "Checking your sign-in…" for ever
 * against a revoked token. The renewal was refused exactly as it should be,
 * 401 and all; the reducer that was supposed to drop the token threw instead,
 * the token stayed, and the page went on waiting for an answer it had already
 * been given. Every other `_FAIL` reducer that reads `.response` has the same
 * hole under it.
 *
 * BridgeApi is a drop-in replacement for the Api helper, and the shape of a
 * rejection is part of that interface, not a detail of the transport.
 */
function asVoltoError(error) {
  if (!error || typeof error !== 'object' || error.response) return error;
  error.response = {
    status: error.status ?? 500,
    // Plone's own error body when the adapter passed one up, else the most
    // the bridge knows: what went wrong and what it is called.
    error: error.body?.error ?? {
      type: error.code ?? 'Error',
      message: error.message,
    },
  };
  return error;
}

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
