/**
 * Astro example client bootstrap.
 *
 * All the per-block diffing + POST + swap logic lives in the Hydra
 * bridge itself (packages/hydra-js/hydra.src.js): pass `renderEndpoint`
 * and the bridge wires findChangedUnit + a POST to that endpoint + the
 * outerHTML / innerHTML swap. The pattern works for any server-only
 * frontend (Astro, PHP, Django, Rails) — only the render endpoint
 * implementation differs per language.
 */
import { initBridge } from '$hydra';
import { expandListingBlocks, ploneFetchItems, contentPath } from '$helpers';
import { sharedBlocksConfig } from '$schemas';

// One source of truth: the flat shared-block-schemas registry, read directly.
const docBlocksConfig = sharedBlocksConfig;

// Hydra helpers that doc-example block components consume as globals —
// same pattern as test-svelte/main.js. Keeps the global shape compatible
// so the shared block-definitions.json reaches the same DOM hooks.
window.expandListingBlocks = expandListingBlocks;
window.ploneFetchItems = ploneFetchItems;
window._API_URL = 'http://localhost:8888';
window._contentPath = (url) => contentPath(url, window._API_URL);

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
  // Server-render mode: bridge diffs each FORM_DATA, POSTs the smallest
  // changed unit to this endpoint, swaps the returned HTML into the DOM
  // (outerHTML for a single block; innerHTML on renderContainer for the
  // whole page). See packages/hydra-js/hydra.src.js#_installRenderEndpoint.
  renderEndpoint: '/api/render',
  renderContainer: '#content',
});

// Keep the page title in sync with formData.title. Title isn't a block,
// so the per-block diff doesn't catch it — handle it with a separate
// listener via the bridge's onContentChangeCallback path. We can't use
// onEditChange (renderEndpoint takes that slot), so subscribe directly
// to the bridge's formData mutation point. Simplest: poll once per
// FORM_DATA via a MutationObserver on #content for the first swap, or
// just patch title on first formData by checking window.bridge.formData
// in a short interval. For now, expose a helper on the bridge so
// frameworks can opt-in to title sync as a separate concern.
//
// (Title-update flow is a minor doc-example concern; production
// frontends fetch the page record server-side and would render title
// from there. Skipping the polling hack here keeps the example clean.)
