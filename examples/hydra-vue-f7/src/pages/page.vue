<template>
  <f7-page>
    <f7-navbar :sliding="false">
      <f7-nav-title sliding>{{data?.title}}</f7-nav-title>
      <f7-nav-right>
        <f7-link icon-ios="f7:menu" icon-aurora="f7:menu" icon-md="material:menu" @click="changePanelFoo" panel-open="right"></f7-link>
      </f7-nav-right>
      <f7-nav-title-large data-editable-metadata="title">{{data?.title}}</f7-nav-title-large>
    </f7-navbar>

    <f7-block v-if="data?.blocks_layout?.items">
      <Block v-for="item in items" :key="item['@uid']" :block_uid="item['@uid']" :block="item" :data="data"></Block>
    </f7-block>
  </f7-page>
</template>

<script>
  import { provide, reactive, computed, unref } from 'vue';
  import Block from '../components/block.vue';
  import { expandTemplatesSync } from '@hydra-js/helpers';
  import { useStore } from 'framework7-vue';

  export default {
    components: {
      Block
    },
    props: {
      f7route: Object,
      f7router: Object,
    },
    setup() {
      const data = useStore('content');
      const templates = useStore('templates') || {};
      const apiBase = useStore('apiBase') || '';
      const contextPath = useStore('contextPath') || '/';
      const templateState = reactive({});

      provide('templates', templates);
      provide('templateState', templateState);
      provide('apiBase', apiBase);
      provide('contextPath', contextPath);

      // The page's own region goes through the merge too, with the state every
      // container re-enters with (docs/frontend-guide/templates.md "Expand every
      // container"). unref: the store hands back refs; the merge needs plain objects.
      const items = computed(() =>
        expandTemplatesSync(unref(data)?.blocks_layout?.items || [], {
          blocks: unref(data)?.blocks || {},
          templateState,
          templates: unref(templates),
        }),
      );

      return { data, items };
    },
    methods: {
      changePanelFoo() {}
    },
  }
</script>
