import { createApp, reactive } from 'vue';
import { initBridge } from '$hydra';
import { expandListingBlocks, ploneFetchItems, contentPath, expandTemplatesSync } from '$helpers';
// One source of truth: the flat shared-block-schemas registry, read directly.
import { sharedBlocksConfig } from '$schemas';
const docBlocksConfig = sharedBlocksConfig;
import App from './App.vue';

// Expose hydra.js helpers globally for doc example components
window.expandListingBlocks = expandListingBlocks;
window.expandTemplatesSync = expandTemplatesSync;
window.ploneFetchItems = ploneFetchItems;
window._API_URL = 'http://localhost:8888';
window._contentPath = (url) => contentPath(url, window._API_URL);

const state = reactive({ items: [], content: {} });

const app = createApp(App, { items: state.items, content: state.content });
app.mount('#app');

function renderApp(content) {
  const layout = content.blocks_layout?.items || [];
  const blocks = content.blocks || {};
  state.items.splice(0, state.items.length, ...layout.map(id => ({ ...blocks[id], '@uid': id })));
  Object.assign(state.content, { title: content.title, description: content.description, blocks: content.blocks, blocks_layout: content.blocks_layout });
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
