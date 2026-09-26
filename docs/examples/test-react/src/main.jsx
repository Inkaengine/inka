import React from 'react';
import { createRoot } from 'react-dom/client';
import { initBridge } from '$hydra';
import { expandTemplatesSync, expandListingBlocks, ploneFetchItems, contentPath } from '$helpers';
// One source of truth: the flat shared-block-schemas registry, read directly.
import { sharedBlocksConfig } from '$schemas';
const docBlocksConfig = sharedBlocksConfig;
import App from './App.jsx';

// Expose hydra.js helpers globally for doc example components
window._expandListingBlocks = expandListingBlocks;
window._ploneFetchItems = ploneFetchItems;
window._API_URL = __HYDRA_API_URL__; // from HYDRA_MOCK_API_PORT (vite.config.js)
window._contentPath = (url) => contentPath(url, window._API_URL);
window._expandTemplatesSync = expandTemplatesSync;

const root = createRoot(document.getElementById('root'));

function renderApp(content) {
  const layout = content.blocks_layout?.items || [];
  const blocks = content.blocks || {};
  const items = layout.map(id => ({ ...blocks[id], '@uid': id }));
  root.render(<App items={items} content={content} />);
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
