<template>
  <!-- Caller controls item rendering via scoped slot -->
  <slot :items="items" />
  <!-- Render own paging when no shared paging was passed in -->
  <Paging v-if="ownsPaging && paging?.totalPages > 1" :paging="paging" :build-url="buildPagingUrl" />
</template>

<script setup>
import { computed, ref, reactive, watch } from 'vue';
import { expandListingBlocks, ploneFetchItems, relatedItemsFetcher, searchShortcutsFetcher, rssFetcher } from '@hydra-js/helpers';

const props = defineProps({
  id: { type: String, required: true },
  block: { type: Object, required: true },
  // Shared paging state (for combined paging in containers like gridBlock).
  // When null, the listing creates and owns its own paging with default page size.
  paging: { type: Object, default: null },
  // Number of items already seen by prior staticBlocks calls (for grid position tracking)
  seen: { type: Number, default: 0 },
  apiUrl: { type: String, required: true },
  contextPath: { type: String, required: true },
});

const route = useRoute();

function buildExtraCriteria(query) {
  const criteria = {};
  for (const [key, value] of Object.entries(query)) {
    if (key === 'SearchableText' || key === 'sort_on' || key.startsWith('facet.')) {
      criteria[key] = value;
    }
  }
  return criteria;
}

// Create own paging if none shared.
const ownsPaging = !props.paging;
const DEFAULT_PAGE_SIZE = 6;

// Parse our own paging segment out of the URL. The route is reactive,
// so this re-evaluates whenever the iframe navigates to a paging URL
// like `/path/@pg_<id>_<n>` — paging.start follows without a remount.
const listingPage = computed(() => {
  if (!ownsPaging) return 0;
  const slug = route.params.slug || [];
  const prefix = `@pg_${props.id}_`;
  for (const part of slug) {
    if (part.startsWith(prefix)) {
      const n = Number(part.slice(prefix.length));
      if (Number.isFinite(n)) return n;
    }
  }
  return 0;
});

const paging = props.paging || reactive({ start: listingPage.value * DEFAULT_PAGE_SIZE, size: DEFAULT_PAGE_SIZE });

async function fetchListing(query) {
  const opts = {
    blocks: { [props.id]: props.block },
    fetchItems: {
      listing: ploneFetchItems({ apiUrl: props.apiUrl, contextPath: props.contextPath, extraCriteria: buildExtraCriteria(query) }),
      relatedItemsListing: relatedItemsFetcher({ apiUrl: props.apiUrl, contextPath: props.contextPath }),
      searchShortcuts: searchShortcutsFetcher({ apiUrl: props.apiUrl, contextPath: props.contextPath }),
      rssFeed: rssFetcher(),
    },
    seen: props.seen,
    itemTypeField: 'variation',
  };
  if (paging) {
    opts.paging = { start: paging.start, size: paging.size };
  }
  return await expandListingBlocks([props.id], opts);
}

// Initial fetch
const result = await fetchListing(route.query);
const items = ref(result.items);
if (paging) Object.assign(paging, result.paging);

// Re-fetch when route query, block data, or paging page (from URL) changes.
watch(
  [() => route.query, () => props.block, () => listingPage.value],
  async ([newQuery, , newPage]) => {
    if (ownsPaging) paging.start = newPage * DEFAULT_PAGE_SIZE;
    const result = await fetchListing(newQuery);
    items.value = result.items;
    if (paging) Object.assign(paging, result.paging);
  },
  { deep: false },
);

// Build paging URL for own paging (per-listing)
let contextPath = props.contextPath;
const buildPagingUrl = (page) => {
  if (page === 0) return contextPath;
  // Strip a trailing slash so a root context gives "/@pg_…" not "//@pg_…".
  return `${contextPath.replace(/\/+$/, '')}/@pg_${props.id}_${page}`;
};
</script>
