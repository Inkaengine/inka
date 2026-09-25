<template>
    <nav v-if="languages.length > 1" id="language-switcher" aria-label="Language"
         class="flex items-center gap-2 text-sm">
        <template v-for="lang in languages" :key="lang">
            <span v-if="lang === current" aria-current="true" class="font-semibold">
                {{ name(lang) }}
            </span>
            <a v-else :href="href(lang)" :hreflang="lang" class="hover:underline">
                {{ name(lang) }}
            </a>
        </template>
    </nav>
</template>

<script setup>
// This page in the site's other languages.
//
// Both answers come from the API: which languages exist is the site's business
// (@site), and what this page is called in each is the translation's
// (@translations). A language this page is not translated into links to that
// language's root — the same fallback Volto's own selector makes, and better
// than dropping the language from the list.
//
// The translations are fetched here rather than read off the page document,
// because inside the admin the bridge replaces that document with the editor's
// copy, which carries no @components. Asking the CMS is the one answer that is
// right in every mode.
const props = defineProps({ page: { type: Object, default: null } });

const route = useRoute();
const runtimeConfig = useRuntimeConfig();
const languages = await useSiteLanguages();

const NAMES = { en: 'English', de: 'Deutsch', fr: 'Français', it: 'Italiano' };
const name = (lang) => NAMES[lang] || lang;

const { data: translations } = await useAsyncData(
  () => `translations:${route.path}`,
  async () => {
    if (languages.value.length < 2) return [];
    const headers = { Accept: 'application/json' };
    const token = route.query.access_token;
    if (token) headers.Authorization = 'Bearer ' + token;
    const answer = await $fetch(
      `${runtimeConfig.public.backendBaseUrl}/++api++${route.path}/@translations`,
      { headers },
    ).catch(() => null);
    return answer?.items || [];
  },
  { watch: [() => route.path] },
);

const current = computed(
  () =>
    props.page?.language?.token
    || props.page?.language
    // The language root folder the page sits under — true of every page on a
    // multilingual Plone site, and the only clue left when the page document
    // comes from the bridge.
    || languages.value.find((lang) => route.path.startsWith(`/${lang}/`) || route.path === `/${lang}`)
    || '',
);

const href = (lang) => {
  const translation = (translations.value || []).find((item) => item.language === lang);
  return translation ? new URL(translation['@id']).pathname : `/${lang}`;
};
</script>
