import { mount } from 'svelte';
import { initBridge } from '$hydra';
import { expandListingBlocks, ploneFetchItems, contentPath, expandTemplatesSync } from '$helpers';
import { sharedBlocksConfig } from '$schemas';
import App from './App.svelte';

// One source of truth: the flat shared-block-schemas registry, read directly.
const docBlocksConfig = sharedBlocksConfig;

// Expose hydra.js helpers globally for doc example components
window.expandListingBlocks = expandListingBlocks;
window.expandTemplatesSync = expandTemplatesSync;
window.ploneFetchItems = ploneFetchItems;
window._API_URL = 'http://localhost:8888';
window._contentPath = (url) => contentPath(url, window._API_URL);

// Svelte 5: mount once, then drive re-renders by mutating reactive props
// (replacing Svelte 4's `new App({...})` + `app.$set(...)`).
const props = $state({ items: [], content: {} });
mount(App, { target: document.getElementById('app'), props });

function renderApp(content) {
  const layout = content.blocks_layout?.items || [];
  const blocks = content.blocks || {};
  props.items = layout.map(id => ({ ...blocks[id], '@uid': id }));
  props.content = content;
}

// Init bridge — Volto sends content via onEditChange, no API fetch needed
window.bridge = initBridge({
  page: {
    schema: {
      properties: {
        blocks_layout: {
          title: 'Blocks',
          allowedBlocks: Object.keys(docBlocksConfig),
        },
      },
    },
  },
  blocks: { ...docBlocksConfig },
  onEditChange: async (formData) => {
    if (formData.title) {
      document.getElementById('page-title').textContent = formData.title;
    }
    if (formData.blocks && formData.blocks_layout) {
      renderApp(formData);
    }
  },
});
