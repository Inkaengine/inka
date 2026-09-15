<template>
    <Head>
        <Title>{{ data.page?.title }}</Title>
        <Meta name="description" :content="data.page?.description" />
    </Head>
        <Header></Header>
        <main class="pt-8 pb-16 lg:pt-16 lg:pb-24 bg-white dark:bg-gray-900 antialiased">
        <!-- <div class="flex justify-between px-4 mx-auto max-w-screen-xl "> -->
            <!-- <article class="mx-auto w-full max-w-2xl format format-sm sm:format-base lg:format-lg format-blue dark:format-invert"> -->
        <!-- <h1 class="text-center" data-editable-metadata="title">{{data?.title}}</h1> -->
        <!-- <NuxtLink to="/blog/">Read the blog!</NuxtLink> -->

                <h1 v-if="route.path === '/'" class="sr-only">{{ data.page?.title }}</h1>

                <!-- Render blocks: template expansion in computed, style grouping, then iterate per group -->
                <template v-if="data.page?.blocks_layout && shouldRenderBlocks">
                    <section v-for="styleGroup in mainStyleGroups" :key="styleGroup.key" :class="styleGroup.style">
                        <div class="flex justify-between px-4 mx-auto max-w-screen-xl">
                            <div class="mx-auto w-full format format-sm sm:format-base lg:format-lg format-blue dark:format-invert">
                                <template v-for="item in styleGroup.blocks" :key="item['@uid']">
                                    <div class="mx-auto" :class="{'max-w-4xl': item['@type'] !== 'slider'}">
                                        <Block :block_uid="item['@uid']" :block="item" :data="data.page" :api-url="apiUrl" />
                                    </div>
                                </template>
                            </div>
                        </div>
                    </section>
                </template>

                <div v-else-if="data?.page">
                    <h1>{{ data.page?.title }}</h1>
                    <p v-if="data.page?.description"> {{ data.page.description }}</p>
                    <NuxtLink v-if="data.page['@type'] == 'Link'" :to="data.page.remoteUrl">{{ data.page.remoteUrl }}</NuxtLink>
                    <NuxtImg v-else-if="data.page['@type'] == 'Image'" :src="imageProps(data.page).url"/>
                    <pre v-else> {{ data.page }} </pre>
                </div>
                <div v-else>
                    Error: No page loaded
                </div>
    

    <!-- </article> -->
    <!-- </div> -->
    </main>
    <footer class="bg-white rounded-lg shadow m-4 dark:bg-gray-800">
        <div id="footer-content" class="w-full mx-auto max-w-screen-xl p-4 text-center text-sm text-gray-500 dark:text-gray-400">
            <template v-if="(data.page?.blocks_layout?.footer?.length || footerAllowedLayouts) && shouldRenderBlocks">
                <Block v-for="item in footerExpandedItems" :key="item['@uid']"
                       :block_uid="item['@uid']" :block="item" :data="data.page" :api-url="apiUrl" />
            </template>
        </div>
    </footer>   
</template>


<script setup>

import { ref, computed, provide, inject } from 'vue';
import { initBridge, isEditMode } from '@hydra-js/hydra.js';
import { expandTemplatesSync } from '@hydra-js/helpers';
import { sharedBlocksConfig } from '@test-fixtures/shared-block-schemas.js';
import { useRuntimeConfig } from "#imports"

// Paging URLs like `/foo/@pg_<id>_<n>` are sub-states of the same page,
// not separate pages. Without a stable key, Nuxt remounts the entire
// page component on every paging click — which tears down our reactive
// state (the hydra bridge's onEditChange callback is closed over the
// old component's `data` ref, so admin's resent FORM_DATA lands in the
// wrong instance and the new instance never gets populated).
definePageMeta({
  // `|| '/'` so a ROOT-page paging URL ("/@pg_<id>_<n>") strips to "/" — the same
  // key as the un-paged root "/". Without it the strip yields "", a DIFFERENT key
  // from "/", so Nuxt remounts and re-fetches an empty path (a blank page) the
  // moment you page the root document's grid.
  key: (route) => route.path.replace(/\/@pg_[^/]+_\d+/g, '') || '/',
});

const runtimeConfig = useRuntimeConfig();
const apiUrl = runtimeConfig.public.backendBaseUrl || runtimeConfig.public.apiUrl || '';
const route = useRoute();

// Context path for paging URLs
const contextPath = computed(() => {
    const pageId = data.value?.page?.['@id'] || '/';
    if (pageId.startsWith('http')) {
        return new URL(pageId).pathname;
    }
    return pageId;
});

// Track if we've received admin data (with nodeIds) - needed for inline editing sync
const hasAdminData = ref(false);

// Detect edit mode - check URL param (works in SSR) and window.name (client only)
const isInEditMode = computed(() => {
    if (route.query._edit === 'true') return true;
    if (typeof window !== 'undefined') {
        return window.name.startsWith('hydra-edit:');
    }
    return false;
});

// Render blocks immediately - no need to wait for admin data since hydra.js
// also initializes in onMounted, so no interaction is possible before then.
// Admin data (with nodeIds) will trigger a re-render when it arrives.
const shouldRenderBlocks = computed(() => {
    return true;
});

/**
 * Group blocks by their background style (for visual sectioning).
 * Takes an array of expanded blocks and returns groups that share the same style.
 */
function groupByStyle(items) {
    if (!items?.length) {
        return [];
    }
    let groupIndex = 0;
    let currentGroup = { blocks: [], style: null, key: `style-${groupIndex}` };
    const groups = [currentGroup];

    for (const item of items) {
        const style = item?.styles?.backgroundColor === 'grey' ? { 'bg-slate-300': true } : {};
        const styleKey = JSON.stringify(style);

        if (currentGroup.style !== null && JSON.stringify(currentGroup.style) !== styleKey) {
            groupIndex++;
            currentGroup = { blocks: [], style: null, key: `style-${groupIndex}` };
            groups.push(currentGroup);
        }
        currentGroup.style = style;
        currentGroup.blocks.push(item);
    }
    return groups;
}

// Shared templateState for all expandTemplatesSync calls (page + nested containers)
const templateState = {};

const mainExpandedItems = computed(() => {
    const layout = data.value?.page?.blocks_layout?.items || [];
    const blocks = data.value?.page?.blocks || {};
    if (!layout.length) return [];
    return expandTemplatesSync(layout, {
        blocks,
        templateState,
        templates: data.value?.templates || {},
        allowedLayouts: mainBlocksAllowedLayouts.value,
    });
});

const mainStyleGroups = computed(() => groupByStyle(mainExpandedItems.value));

const footerExpandedItems = computed(() => {
    const layout = data.value?.page?.blocks_layout?.footer || [];
    const blocks = data.value?.page?.blocks || {};
    // Don't early-return on empty layout — allowedLayouts forces a template
    // even when the page has no footer region content yet.
    if (!layout.length && !footerAllowedLayouts.value) return [];
    return expandTemplatesSync(layout, {
        blocks,
        templateState,
        templates: data.value?.templates || {},
        allowedLayouts: footerAllowedLayouts.value,
    });
});

// Content-type-specific layout templates (enforced in edit mode via initBridge allowedLayouts).
// Document is the default case — no entry needed.
const CONTENT_TYPE_LAYOUTS = {
    'Event': ['/templates/event-view'],
    'News Item': ['/templates/newsitem-view'],
};

// Initialize Flowbite components based on data attribute selectors.
// Safe to call initFlowbite() (which includes initCarousels) because block.vue
// removes data-carousel after init, so initCarousels() finds no elements here.
onMounted(() => {
    useFlowbite((flowbite) => {
        flowbite.initFlowbite();
    })

    if (import.meta.client) {
        // Check window.name to detect if we're in the Hydra admin iframe
        // Format: hydra-edit:<origin> or hydra-view:<origin>
        const isHydraIframe = window.name.startsWith('hydra-edit:') || window.name.startsWith('hydra-view:');
        console.log('[NUXT] window.name:', window.name, 'isHydraIframe:', isHydraIframe);

        if (isHydraIframe) {
            const newBlocks = {
                eventMetadata: {
                    id: 'eventMetadata',
                    title: 'Event Metadata',
                    group: 'common',
                    restricted: true,  // Not in add-block picker — part of event layout template
                    blockSchema: {
                        fieldsets: [{ id: 'default', title: 'Default', fields: [] }],
                        properties: {},
                    },
                },
                dateField: {
                    id: 'dateField',
                    title: 'Date',
                    group: 'common',
                    restricted: true,  // Not in add-block picker — added via content-type templates
                    blockSchema: {
                        fieldsets: [{ id: 'default', title: 'Default', fields: ['dateField', 'showTime'] }],
                        properties: {
                            dateField: {
                                title: 'Date field',
                                type: 'string',
                                widget: 'select',
                                choices: [
                                    ['effective', 'Publication date'],
                                    ['expires', 'Expiration date'],
                                    ['created', 'Creation date'],
                                    ['modified', 'Last modified date'],
                                    ['start', 'Event start'],
                                    ['end', 'Event end'],
                                ],
                            },
                            showTime: {
                                title: 'Show time',
                                type: 'boolean',
                            },
                        },
                    },
                },
                socialLinks: {
                    restricted: true,  // Only used in footer template
                    blockSchema: {
                        properties: {
                            links: {
                                title: 'Links',
                                widget: 'object_list',
                                schema: {
                                    properties: {
                                        url: {
                                            title: 'URL',
                                            widget: 'url',
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
                ...sharedBlocksConfig,
            };
            // Content-type-aware page-level blocks:
            // - Always exclude 'column' (only inside columns block)
            // - Restricted blocks are excluded unless they match the current content type
            const pageType = data.value?.page?.['@type'];
            const pageLevelBlocks = Object.keys(newBlocks).filter(k => {
                if (k === 'column') return false;
                if (newBlocks[k]?.restricted) {
                    if (k === 'eventMetadata') return pageType === 'Event';
                    if (k === 'dateField') return pageType === 'News Item';
                    return false;
                }
                return true;
            });
            const bridge = initBridge({
                debug: new URLSearchParams(window.location.search).has('_hydra_debug'),
                // A design system's own text styles (#295). Declared here because
                // stored content carrying `styleName` is validated against EVERY
                // frontend that serves it: block-sanity asks whether an author
                // could have produced it, and a style no menu offers fails that
                // — correctly. The shared fixtures use these, so the example
                // frontends that run block-sanity declare them.
                voltoConfig: {
                    settings: {
                        slate: {
                            styleMenu: {
                                blockStyles: [{ cssClass: 'lead', label: 'Lead' }],
                                inlineStyles: [{ cssClass: 'dropcap', label: 'Drop cap' }],
                            },
                        },
                    },
                },
                page: {
                    schema: {
                        properties: {
                                                        items: {
                                title: 'Blocks',
                                allowedBlocks: [...new Set(['slate', 'image', 'separator', 'video', 'gridBlock', 'teaser', 'listing', 'summary', 'default', 'section', 'contextNavigation', ...pageLevelBlocks])],
                                allowedTemplates: ['/_test_data/templates/test-layout'],
                                allowedLayouts: CONTENT_TYPE_LAYOUTS[pageType]
                                    || contextNavLayoutForced.value
                                    || [null, '/_test_data/templates/test-layout', '/_test_data/templates/header-footer-layout', '/_test_data/templates/header-only-layout', '/_test_data/templates/editable-fixed-layout'],
                            },
                            footer: {
                                title: 'Footer',
                                allowedBlocks: ['slate', 'image', 'socialLinks'],
                                allowedLayouts: route.path.startsWith('/_test_data/another-page')
                                    ? ['/_test_data/templates/footer-layout']
                                    : ['/templates/site-footer'],
                            },
                        },
                    },
                },
                blocks: newBlocks,
                pathToApiPath: (path) => path.replace(/\/@pg_[^/]+_\d+/, '') || '/',
                // Pass onEditChange before init() sends INIT to avoid race condition
                onEditChange: (page) => {
                    if (!page) return;
                    // Mark that we have admin data with nodeIds
                    hasAdminData.value = true;
                    // Clicking into a field produces a selection-only FORM_DATA
                    // echo whose content is unchanged. Applying it re-renders
                    // (and replaces) the focused contenteditable, which races
                    // with an in-flight keystroke — the typed character lands on
                    // the old node just before Vue swaps it, and is lost. Skip
                    // echoes that don't actually change content; real edits
                    // (different blocks/layout) still apply and re-render.
                    const cur = data.value.page;
                    if (cur
                        && JSON.stringify(page.blocks) === JSON.stringify(cur.blocks)
                        && JSON.stringify(page.blocks_layout) === JSON.stringify(cur.blocks_layout)) {
                        return;
                    }
                    // Update page data - ListingBlock components will
                    // re-render and expand listings via their own Suspense
                    data.value.page = page;
                },
            });
            // Expose bridge so Playwright tests can drive selection programmatically
            // (matches the test-frontend's window.bridge convention).
            window.bridge = bridge;
        }
    }
});

// Determine footer allowedLayouts based on path (same as mock frontend)
const footerAllowedLayouts = computed(() => {
    const normalizedPath = route.path.replace(/\/$/, '');
    // Test page uses its own test footer layout
    if (normalizedPath.startsWith('/_test_data/another-page')) {
        return ['/_test_data/templates/footer-layout'];
    }
    // All other pages get the site footer
    return ['/templates/site-footer'];
});

// Force context-navigation-layout on depth-2+ public pages
// (e.g. /docs/topic/page). Excluded under /_test_data so the per-page
// allowedLayouts config that other tests rely on stays in effect.
// Same rule used by both edit-mode initBridge schema (below) and SSR
// view-mode expandTemplatesSync via mainBlocksAllowedLayouts.
const contextNavLayoutForced = computed(() =>
    !route.path.startsWith('/_test_data/')
    && route.path.split('/').filter(Boolean).length >= 2
        ? ['/templates/context-navigation-layout']
        : null,
);

// Main blocks allowedLayouts for expandTemplatesSync (view mode / SSR)
// Content-type pages use null — their blocks_layout already contains the right blocks.
// The CONTENT_TYPE_LAYOUTS templates are enforced in edit mode via initBridge only.
const mainBlocksAllowedLayouts = computed(() => {
    const pageType = data.value?.page?.['@type'];
    if (CONTENT_TYPE_LAYOUTS[pageType]) {
        return null;  // Use page's own blocks_layout directly
    }
    if (contextNavLayoutForced.value) return contextNavLayoutForced.value;
    return [null, '/_test_data/templates/test-layout', '/_test_data/templates/header-footer-layout', '/_test_data/templates/header-only-layout', '/_test_data/templates/editable-fixed-layout'];
});

// Templates to eagerly pre-load (forced layouts that won't appear in page data)
const preloadTemplates = [
    '/templates/site-footer',
    ...(footerAllowedLayouts.value || []).filter(Boolean),
    ...(contextNavLayoutForced.value || []).filter(Boolean),
    // Content-type forced layouts (not referenced in page data but applied by expandTemplatesSync)
    ...Object.values(CONTENT_TYPE_LAYOUTS).flat(),
];

var path = [];
var pages = {};
// `|| []` because at the site root the catch-all param is empty, and whether
// vue-router hands back [] or undefined varies by version — on the nuxt 3.21.2
// the lockfile pins, it is undefined and this threw "route.params.slug is not
// iterable", failing the SSG prerender of / with a bare [500]. The reactive
// `pages` computed below already guarded the same value; this one was missed.
for (var part of route.params.slug || []) {
    if (part.startsWith("@pg_")) {
        const [_,bid,page] = part.split("_");
        pages[bid] = Number(page);
    } else {
        path.push(part);
    }
}

// Detect edit mode synchronously at setup time. `window.name` is set
// by the admin before the iframe loads and persists across in-page
// paging; the `_edit` query string is the SSR-safe fallback but gets
// dropped by paging URLs.
const inEditModeAtSetup =
    route.query._edit === 'true'
    || (typeof window !== 'undefined' && window.name?.startsWith('hydra-edit:'));

// retrieve the data associated with an article
// based on its slug (pre-loads templates for sync expansion)
// reloadTemplates: while editing, always reload templates (the editor may be changing
// one — never serve a cached copy). View/SSG reuses the shared template cache.
const result = await ploneApi({ path, pages, preloadTemplates, reloadTemplates: inEditModeAtSetup });

// Moved content: ploneApi detected the backend's 302 and resolved the
// new frontend path. Issue a permanent redirect from the page setup
// (where Nuxt honors SSR redirects) before rendering the old route.
if (result.redirectTo) {
  await navigateTo(result.redirectTo, { redirectCode: 301 });
}
const { data, error } = result;

// In edit mode the bridge owns the page document — it ships the only
// copy that carries the `nodeId` attributes selection sync depends on
// (see docs/architecture.md "Realtime preview"; docs/templates.md:65).
// But the frontend's layout rules (CONTENT_TYPE_LAYOUTS below) need
// the page's `@type` BEFORE initBridge fires — admin can't know which
// template to merge until we tell it, and we tell it via the
// initBridge schema config which goes out as part of INIT. So we
// still fetch the page here (cheap, view mode does it anyway) but
// strip it down to just the metadata our rules consume; the bridge's
// onEditChange will replace it with the full nodeId-bearing copy.
// Site-wide navigation is fetched once by useSiteNav() inside Header.
if (inEditModeAtSetup && data.value?.page) {
  data.value.page = {
    '@id':   data.value.page['@id'],
    '@type': data.value.page['@type'],
  };
}

// Provide templates, apiUrl, contextPath, templateState for nested components (grids, etc.)
provide('templates', computed(() => data.value?.templates || {}));
provide('templateState', templateState);  // Shared across all expandTemplatesSync calls
provide('apiUrl', apiUrl);
provide('contextPath', contextPath);
// Reactive pages: re-parses @pg_ segments when route changes (SPA paging navigation)
provide('pages', computed(() => {
    const result = {};
    for (const part of route.params.slug || []) {
        if (part.startsWith("@pg_")) {
            const [_, bid, page] = part.split("_");
            result[bid] = Number(page);
        }
    }
    return result;
}));

useSeoMeta({
  ogTitle: data.page?.title,
  description: data.page?.description,
  ogDescription: data.page?.description,
  ogImage: 'https://example.com/image.png',
  twitterCard: 'summary_large_image',
})



// if (error) {
//     showError(error)
//     data = {title:"Error"}
// }



// if the slug does not correspond to any articles,
// return a 404 page with the "Page Not Found" message
// if (!data.value?.article) {
//   throw createError({ statusCode: 404, statusMessage: 'Page Not Found' })
// }
</script>