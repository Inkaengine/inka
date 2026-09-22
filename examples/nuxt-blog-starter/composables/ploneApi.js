import { getAccessToken } from '@hydra-js/hydra.js';

export default async function ploneApi({
  path,
  query = null,
  watch = [],
  _default = {},
  pages = {},
  // Templates to resolve in addition to the ones the page references: the forced layouts
  // this frontend's rules pick (a footer, a content-type layout). They are never
  // referenced from page content, so the backend cannot discover them — the layout RULES
  // stay here, and the backend is only asked to resolve what they name.
  preloadTemplates = [],
  // Whether a template that failed to resolve is ignored. Default false: a missing
  // template fails the render with the real error, instead of being dropped and
  // resurfacing far away as a misleading "not found in pre-loaded templates" 500. Opt in
  // with `ignoreTemplateErrors: true` only when a page can legitimately render without it.
  ignoreTemplateErrors = false,
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
    // The page and every template it needs arrive in ONE request: `templates` is the
    // @templates component (the inkaengine.inka addon), which resolves the page's
    // template references — and theirs, recursively — on the server.
    //
    // This replaced fetching each template from here, which discovered nested
    // references only after the parent arrived and needed a cross-render cache, an
    // in-flight dedupe and a per-fetch abort to survive the SSG prerender (it hit a cold
    // API ~179x for the same forced footer).
    const extra = preloadTemplates.filter(Boolean);
    api =
      `${api}?expand=breadcrumbs,navroot,navigation,templates&expand.navigation.depth=2` +
      (extra.length
        ? `&expand.templates.extra=${encodeURIComponent([...new Set(extra)].join(','))}`
        : '');
  } else {
    headers['Content-Type'] = 'application/json';
  }
  const key = JSON.stringify({
    path,
    query,
    headers,
  });

  // plone.app.redirector 302s moved content (/++api++/old -> /++api++/new).
  // ofetch auto-follows to valid JSON, so without this the page would render
  // the new content under the OLD url. Capture the followed-redirect target
  // and surface it so the page setup can navigateTo() a permanent 301 — the
  // redirect can't be issued from the ofetch interceptor (it won't propagate
  // as an SSR redirect).
  let redirectTarget = null;
  // A template failure recorded by `transform`, re-thrown once useFetch returns. It has
  // to be carried out: an error thrown INSIDE transform does not propagate — useFetch
  // parks it in its `error` ref and leaves `data` at its default, so the page rendered
  // anyway and failed far away with the misleading "not found in pre-loaded templates".
  let templateFailure = null;
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

        // A backend without the addon ignores an unknown `expand=templates` rather than
        // erroring, so a missing component means a missing addon — say so, instead of
        // letting every template lookup fail later as "not found in pre-loaded templates".
        const component = comp?.templates;
        const errors = component?.errors || [];
        const failure = !component?.templates
          ? 'The backend did not return the @templates component. Install the ' +
            'inkaengine.inka addon on the Plone backend (see backend/README.md).'
          : errors.length
            ? `Failed to load templates: ${errors.map((e) => `${e.templateId}: ${e.error}`).join('; ')}`
            : null;
        if (failure) {
          // Default: don't swallow. A failed template fails the render with the real
          // error, instead of dropping the template and 500-ing far away with a
          // misleading "not found". Opt into leniency only when a page can render without.
          if (!ignoreTemplateErrors) {
            templateFailure = failure;
            throw new Error(failure);
          }
          console.warn('[ploneApi] Ignoring template failure:', failure);
        }
        const templates = component?.templates || {};

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

  if (templateFailure) {
    throw createError({ statusCode: 500, message: templateFailure, fatal: true });
  }

  // Moved content: surface the target so the page setup can navigateTo() it.
  // Must be issued from the page's setup context for Nuxt to honor the SSR
  // redirect (not from here, and not from the ofetch interceptor).
  if (redirectTarget) {
    result.redirectTo = redirectTarget;
  }

  return result;
}
