<template>
  <div>
    <template v-for="(item, idx) in items" :key="idx">
      <Block :block_uid="item['@uid']" :block="item" :data="data" />
    </template>
    <nav v-if="paging.totalPages > 1" aria-label="Page Navigation" style="margin-top:1rem">
      <div style="display:inline-flex">
        <f7-button v-if="paging.prev !== null" small outline
                   :href="buildPagingUrl(paging.prev)" data-linkable-allow
                   :data-block-selector="'-' + (paging.size || 1)"
                   @click.prevent="navigatePage(buildPagingUrl(paging.prev))"
                   style="border-radius:0.25rem 0 0 0.25rem">
          Previous
        </f7-button>
        <f7-button v-for="pg in paging.pages" :key="pg.page" small
                   :fill="paging.currentPage === pg.page - 1"
                   :outline="paging.currentPage !== pg.page - 1"
                   :href="buildPagingUrl(pg.page - 1)" data-linkable-allow
                   @click.prevent="navigatePage(buildPagingUrl(pg.page - 1))">
          {{ pg.page }}
        </f7-button>
        <f7-button v-if="paging.next !== null" small outline
                   :href="buildPagingUrl(paging.next)" data-linkable-allow
                   :data-block-selector="'+' + (paging.size || 1)"
                   @click.prevent="navigatePage(buildPagingUrl(paging.next))"
                   style="border-radius:0 0.25rem 0.25rem 0">
          Next
        </f7-button>
      </div>
    </nav>
  </div>
</template>

<script>
import { ref, reactive, watch, defineAsyncComponent } from 'vue';
import { expandListingBlocks, ploneFetchItems } from '@hydra-js/helpers';

export default {
  name: 'ListingBlock',
  components: { Block: defineAsyncComponent(() => import('./block.vue')) },
  props: {
    id: { type: String, required: true },
    block: { type: Object, required: true },
    data: { type: Object, required: true },
    apiUrl: { type: String, default: '' },
    contextPath: { type: String, default: '/' },
  },
  setup(props) {
    const items = ref([]);
    const paging = reactive({ start: 0, size: 6, totalPages: 0, currentPage: 0, pages: [], prev: null, next: null });

    async function fetchListing() {
      const apiUrl = props.apiUrl || '';
      const ctxPath = props.contextPath;
      if (!apiUrl) return;

      const urlPath = window.location.pathname;
      const pgMatch = urlPath.match(new RegExp(`@pg_${props.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_(\\d+)`));
      const currentPage = pgMatch ? parseInt(pgMatch[1], 10) : 0;
      paging.start = currentPage * paging.size;
      paging.currentPage = currentPage;

      const fetchItems = {
        listing: ploneFetchItems({ apiUrl, contextPath: ctxPath }),
      };
      const result = await expandListingBlocks([props.id], {
        blocks: { [props.id]: props.block },
        fetchItems,
        itemTypeField: 'variation',
        paging: { start: paging.start, size: paging.size },
      });
      items.value = result.items || [];
      if (result.paging) {
        Object.assign(paging, result.paging);
      }
    }

    function buildPagingUrl(page) {
      const ctxPath = props.contextPath;
      if (page === 0) return ctxPath;
      return `${ctxPath}/@pg_${props.id}_${page}`;
    }

    function navigatePage(url) {
      setTimeout(() => { window.location.href = url; }, 0);
    }

    fetchListing();
    watch([() => props.id, () => props.block, () => props.apiUrl], fetchListing);

    return { items, paging, buildPagingUrl, navigatePage };
  },
};
</script>
