<template>
  <nav v-if="paging.totalPages > 1" aria-label="Page Navigation" class="paging mt-4">
    <ul class="inline-flex -space-x-px text-sm">
      <li v-if="paging.prev !== null">
        <a :href="buildUrl(paging.prev)" data-linkable-allow
          :data-block-selector="'-' + (paging.size || 1)"
          class="paging-prev flex items-center justify-center px-3 h-8 leading-tight text-gray-500 bg-white border border-gray-300 rounded-s-lg hover:bg-gray-100"
          @click.prevent="navigate(buildUrl(paging.prev))">
          Previous
        </a>
      </li>
      <li v-for="page in paging.pages" :key="page.page">
        <a :href="buildUrl(page.page - 1)" data-linkable-allow
          :class="['paging-page', paging.currentPage === page.page - 1 ? 'current bg-blue-100' : 'bg-white']"
          class="flex items-center justify-center px-3 h-8 leading-tight text-gray-500 border border-gray-300 hover:bg-gray-100"
          @click.prevent="navigate(buildUrl(page.page - 1))">
          {{ page.page }}
        </a>
      </li>
      <li v-if="paging.next !== null">
        <a :href="buildUrl(paging.next)" data-linkable-allow
          :data-block-selector="'+' + (paging.size || 1)"
          class="paging-next flex items-center justify-center px-3 h-8 leading-tight text-gray-500 bg-white border border-gray-300 rounded-e-lg hover:bg-gray-100"
          @click.prevent="navigate(buildUrl(paging.next))">
          Next
        </a>
      </li>
    </ul>
  </nav>
</template>

<script setup>
const props = defineProps({
  paging: { type: Object, required: true },
  buildUrl: { type: Function, required: true },
});

const navigate = (url) => {
  // Delay navigation to let hydra's document click handler run first
  // (it sets hydra_in_page_nav_time for the inPage PATH_CHANGE flag)
  setTimeout(() => navigateTo(url), 0);
};
</script>
