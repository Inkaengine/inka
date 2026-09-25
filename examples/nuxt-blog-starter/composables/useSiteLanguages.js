import { getAccessToken } from '@hydra-js/hydra.js';

// The site's languages, fetched once and cached for the whole app — the same
// shape as useSiteNav, and for the same reason: which languages a site has is
// a site-level fact, not a per-page one, and in edit mode the page document
// comes from the bridge rather than the REST API.
//
// A single-language site answers with one language, and the switcher then
// renders nothing.
export default async function useSiteLanguages() {
  const languages = useState('hydra-site-languages', () => null);
  if (languages.value) return languages;

  const runtimeConfig = useRuntimeConfig();
  const route = useRoute();
  const headers = { Accept: 'application/json' };
  const token = route.query.access_token || getAccessToken();
  if (token) headers.Authorization = 'Bearer ' + token;

  const site = await $fetch(`${runtimeConfig.public.backendBaseUrl}/++api++/@site`, {
    headers,
  }).catch(() => ({}));
  languages.value = site?.['plone.available_languages'] || [];
  return languages;
}
