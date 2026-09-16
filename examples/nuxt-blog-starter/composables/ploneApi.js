import { getAccessToken } from '@hydra-js/hydra.js';
import { loadTemplates } from '@hydra-js/helpers';

// Shared template cache across all page renders (survives SSG prerendering)
const templateCache = {};
// In-flight fetches, keyed by template path. templateCache only holds COMPLETED
// templates, so with prerender concurrency > 1 two routes starting together both
// miss the still-empty cache and each fetch the same forced layout (the footer,
// on every page) — doubling the instant load on a small auto-suspend API and
// making one time out ("not found in pre-loaded templates. Available:"). Sharing
// one in-flight promise per path collapses that to a single fetch.
const inFlightTemplates = {};

export default async function ploneApi({
  path,
  query = null,
  watch = [],
  _default = {},
  pages = {},
  preloadTemplates = [],  // Specific templates to eagerly pre-load (forced layouts)
  // Whether a template FETCH failure is ignored. Default false: a failed template load
  // propagates the real error (failing the render, and the SSG build), instead of being
  // silently dropped — which otherwise resurfaces far away as a misleading
  // "template not found in pre-loaded templates" 500 that hides the actual cause (the API
  // didn't answer). Opt in with `ignoreTemplateErrors: true` only when a page can
  // legitimately render without the template.
  ignoreTemplateErrors = false,
  // Milliseconds before a single template fetch is ABORTED (0 = no timeout). The SSG
  // prerender hits the API ~179x; a cold instance accepted the connection but never
  // answered, and with no timeout `fetch` hung ~300s on one route — stalling the whole
  // build. This aborts (actually cancels) the request; loadTemplates also stops WAITING
  // at its own 5s, but that leaves the socket open — the abort closes it. Kept at 5s to
  // match loadTemplates so neither pre-empts the other with a surprising cap.
  templateFetchTimeout = 5000,
  // While EDITING, always reload templates — the editor may be changing a template, so a
  // cached copy from an earlier render would be stale. In view / SSG, templates are
  // immutable for the render, so reuse the shared cross-render cache: it dedupes the
  // forced-layout fetches (site-footer is on every page — that was ~179 identical
  // refetches across the prerender, extra load on the very API that then cold-hung).
  reloadTemplates = false,
}) {
  const runtimeConfig = useRuntimeConfig();
  const route = useRoute();

  var headers = {
    Accept: 'application/json',
  };
  // route.query works in SSR, getAccessToken() works client-side
  const token = route.query.access_token || getAccessToken();
  if (token) {
    headers['Authorization'] = 'Bearer ' + token;
  }
  var api = path?.join ? path.filter(Boolean).join('/') : path;
  if (!api.startsWith('http')) {
    api = `${runtimeConfig.public.backendBaseUrl}/++api++/${api}`;
  }
  if (!query) {
    api = `${api}?expand=breadcrumbs,navroot,navigation&expand.navigation.depth=2`;
  } else {
    headers['Content-Type'] = 'application/json';
  }
  const key = JSON.stringify({
    path,
    query,
    headers,
  });

  // Fetch a single template by id/path — de-duped per path (see inFlightTemplates).
  const loadTemplate = async (templateId) => {
    // templateId may be a path or a full URL — normalise to path
    const tplPath = templateId.startsWith('http')
      ? new URL(templateId).pathname
      : `/${templateId.replace(/^\//, '')}`;
    // Concurrent renders of the same forced layout share ONE fetch.
    if (inFlightTemplates[tplPath]) return inFlightTemplates[tplPath];
    const fetchTemplate = async () => {
      const url = `${runtimeConfig.public.backendBaseUrl}/++api++${tplPath}`;
      // Bound the fetch: a hung request (cold API that never answers) aborts instead of
      // stalling the whole prerender indefinitely.
      const controller = templateFetchTimeout > 0 ? new AbortController() : null;
      const timer = controller
        ? setTimeout(() => controller.abort(), templateFetchTimeout)
        : null;
      try {
        const response = await fetch(url, { headers, signal: controller?.signal });
        if (!response.ok) {
          throw new Error(`Failed to fetch template ${templateId}: HTTP ${response.status}`);
        }
        return await response.json();
      } catch (error) {
        if (error?.name === 'AbortError') {
          throw new Error(
            `Timed out fetching template ${templateId} after ${templateFetchTimeout}ms`,
          );
        }
        throw error;
      } finally {
        if (timer) clearTimeout(timer);
      }
    };
    const p = fetchTemplate();
    inFlightTemplates[tplPath] = p;
    // Clear once settled (success OR failure) so a later render can retry a
    // failed fetch and a success doesn't pin the promise.
    p.finally(() => { if (inFlightTemplates[tplPath] === p) delete inFlightTemplates[tplPath]; });
    return p;
  };

  // Working template set for this render: the shared cross-render cache in view/SSG (so a
  // forced template is fetched once and reused across pages), or a fresh empty set while
  // editing (so every template is reloaded from the API — never a stale cached copy).
  const tplCache = reloadTemplates ? {} : templateCache;

  // plone.app.redirector 302s moved content (/++api++/old -> /++api++/new).
  // ofetch auto-follows to valid JSON, so without this the page would render
  // the new content under the OLD url. Capture the followed-redirect target
  // and surface it so the page setup can navigateTo() a permanent 301 — the
  // redirect can't be issued from the ofetch interceptor (it won't propagate
  // as an SSR redirect).
  let redirectTarget = null;
  const toFrontendPath = (u) => u
    .replace(runtimeConfig.public.backendBaseUrl, '')
    .replace('/++api++', '')
    .replace(/\?.*$/, '');

  const result = await useFetch(api, {
    key,
    method: query ? 'POST' : 'GET',
    headers: headers,
    body: query,
    cache: 'no-cache',
    // When authenticated, don't use cached data - always fetch fresh
    getCachedData: token ? () => undefined : undefined,
    watch: watch,
    default: () => {
      return _default;
    },
    onResponse({ response }) {
      if (response.redirected && response.url) {
        const target = toFrontendPath(response.url);
        if (target && !target.startsWith('http') && target !== toFrontendPath(api)) {
          redirectTarget = target;
        }
      }
    },
    onResponseError({ request, response, options }) {
      const error = response._data;
      showError({
        statusCode: response.status,
        statusMessage: `${error.type}: ${error.message}`,
      });
      return {
        title: response.statusText,
        '@components': { navigation: { items: [] } },
      };
    },
    transform: async (data) => {
      data['_listing_pages'] = pages;
      if (query) {
        return data;
      } else {
        const comp = data['@components'];
        delete data['@components'];

        // ONE template-loading path: loadTemplates handles the forced-layout templates
        // (passed as extraTemplateIds — they aren't referenced in page content) AND the
        // templates the content references, with a single dedup + cache + recursion.
        // `tplCache` is the shared cross-render cache in view/SSG (so a forced template is
        // fetched once and reused) or empty while editing (always reload). The per-fetch
        // timeout lives in `loadTemplate` (below) — no change to the shared helper.
        const { templates, errors } = await loadTemplates(
          data,
          loadTemplate,
          tplCache,
          preloadTemplates,
        );
        // Persist newly-loaded templates into the SHARED cross-render cache.
        // loadTemplates COPIES the cache it's given and returns a new object, so
        // without this write-back templateCache never fills — every prerendered
        // route re-fetched the forced footer layout (~once per page), hammering
        // the 1-thread API until a fetch dropped and the page 500'd with
        // "not found in pre-loaded templates". Skip while editing (fresh each time).
        if (!reloadTemplates) Object.assign(templateCache, templates);
        if (errors.length) {
          const summary = errors.map(e => `${e.templateId}: ${e.error?.message || e.error}`).join('; ');
          // Default: don't swallow. A failed template load fails the render with the real
          // error, instead of dropping the template and 500-ing far away with a misleading
          // "not found". Opt into leniency only when a page can render without it.
          if (!ignoreTemplateErrors) {
            throw new Error(`Failed to load templates: ${summary}`);
          }
          console.warn('[ploneApi] Ignoring failed templates:', summary);
        }

        return {
          page: data,
          templates,  // Pre-loaded templates for sync expansion
          _listing_pages: pages,
          navigation: comp.navigation,
          breadcrumbs: comp.breadcrumbs,
        };
      }
    },
  });

  // Moved content: surface the target so the page setup can navigateTo() it.
  // Must be issued from the page's setup context for Nuxt to honor the SSR
  // redirect (not from here, and not from the ofetch interceptor).
  if (redirectTarget) {
    result.redirectTo = redirectTarget;
  }

  return result;
}
