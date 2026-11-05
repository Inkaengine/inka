/**
 * The site's own facts, known before anything asks a question that depends on
 * them.
 *
 * Volto reads @site through an asyncProps extender that only `loadOnServer`
 * consumes, so in a bridge session — which has no server-side CMS to read — the
 * site is fetched on the client, as one more route load alongside the content.
 * That ordering is not incidental: the api middleware DROPS the `translations`
 * expander unless `state.site.data.features.multilingual` is already true when
 * the request is built (see Volto's addExpandersToPath). A content read that
 * goes out first therefore comes back with no `@components.translations`, and
 * nothing re-reads it — so the compare-languages pane had no languages to offer
 * and the editor simply never saw it.
 *
 * The same race is why a deep link to /manage-translations cannot work in stock
 * Volto. There it is hidden by SSR settling the site first; here there is no
 * server, so it has to be settled explicitly.
 *
 * Read once per page load, NOT once per store:
 *
 *   - Single-flight, because GET_SITE_PENDING clears `data` — two overlapping
 *     reads would blank the features another caller had just acted on — and
 *     because App's loader and each route's loader both want this first.
 *   - `state.site.loaded` is deliberately not the guard. A serialised store can
 *     arrive with it already true, from a read the SERVER made: in a bridge
 *     session that read went straight to the CMS without the adapter, and
 *     without the session whose features the editor is working in. Trusting it
 *     left the admin believing a single-language site for good, because nothing
 *     re-reads @site. Volto's own code re-dispatched getSite on every route for
 *     exactly that reason; this keeps that, minus the duplicates.
 */
import { getSite } from '@plone/volto/actions/site/site';

let inFlight = null;
let readThisPage = false;

export function ensureSiteLoaded(store) {
  // No session to remember on the server: each request has its own store, and a
  // module-level flag there would serve one request's site to the next.
  if (typeof window === 'undefined') {
    return Promise.resolve(store.dispatch(getSite()));
  }
  if (readThisPage) return Promise.resolve();
  if (!inFlight) {
    // Deliberately NOT caught: a site read that fails is a session that cannot
    // be trusted to know what it may offer, and the caller's own error handling
    // is what should see it. A failure is not remembered either — the next
    // caller tries again rather than inheriting a verdict nobody reached.
    inFlight = Promise.resolve(store.dispatch(getSite()))
      .then((result) => {
        readThisPage = true;
        return result;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

/** Test seam: forget what this page has read. */
export function resetSiteLoadForTests() {
  inFlight = null;
  readThisPage = false;
}
