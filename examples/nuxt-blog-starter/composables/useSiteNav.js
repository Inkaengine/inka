import { getAccessToken } from '@hydra-js/hydra.js';

// Fetch the site-wide navigation once and cache it across the whole
// Nuxt app via useState (survives page navigations and SSR/CSR hop).
//
// Why this exists: in edit mode the page document comes from the
// bridge (via onEditChange), not the REST API — see the "Realtime
// preview" row in docs/architecture.md. So we can't keep piggy-backing
// navigation on the per-page ploneApi fetch; the page fetch is gone
// in edit mode. Nav is a site-level concern, doesn't change per page,
// safe to fetch once.
export default async function useSiteNav() {
  const runtimeConfig = useRuntimeConfig();
  const route = useRoute();

  // On a multilingual site the menu is the LANGUAGE's, not the site's: each
  // language root folder is the navigation root for everything inside it, so a
  // site-wide menu would offer every page in every language. Cached per
  // language for the same reason the site-wide one was cached at all.
  const languages = await useSiteLanguages();
  const segment = route.path.split('/').filter(Boolean)[0];
  const language = languages.value?.includes(segment) ? segment : null;

  const nav = useState(`hydra-site-nav:${language || ''}`, () => null);
  if (nav.value) return nav;
  const headers = { Accept: 'application/json' };
  const token = route.query.access_token || getAccessToken();
  if (token) headers.Authorization = 'Bearer ' + token;

  const url = `${runtimeConfig.public.backendBaseUrl}/++api++${
    language ? `/${language}` : '/'
  }?expand=navigation&expand.navigation.depth=2`;
  const data = await $fetch(url, { headers });
  nav.value = data?.['@components']?.navigation?.items || [];
  return nav;
}
