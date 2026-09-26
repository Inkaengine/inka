import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';

/**
 * Map of component names referenced in Vue example SFCs without explicit imports.
 * The plugin auto-adds import statements for these.
 */
const COMPONENT_IMPORTS = {
  SlateNode:         './SlateNode.vue',
  BlockRenderer:     './BlockRenderer.vue',
  ColumnBlock:       './ColumnBlock.vue',
  ListingBlock:      './ListingBlock.vue',
};

/**
 * Vite plugin to make doc example Vue SFCs importable as modules.
 *
 * The example files in docs/blocks/examples/vue/ are documentation snippets.
 * Some reference other components (SlateNode, BlockRenderer, ColumnBlock) without
 * importing them. This plugin auto-adds the missing imports to <script setup>.
 */
function vueExamplesPlugin() {
  const examplesDir = path.resolve(__dirname, '../examples/vue');

  return {
    name: 'vue-examples',
    enforce: 'pre',
    transform(code, id) {
      if (!id.startsWith(examplesDir) || !id.endsWith('.vue')) return;

      const fileName = path.basename(id);

      // Find referenced components that aren't imported
      const neededImports = [];
      for (const [name, importPath] of Object.entries(COMPONENT_IMPORTS)) {
        const importFile = path.basename(importPath);
        if (importFile === fileName) continue;
        // Check if the component is used in template or script
        if (code.includes(name) && !code.includes(`import ${name}`)) {
          neededImports.push(`import ${name} from '${importPath}';`);
        }
      }

      // Check for hydra.js global references.
      // Use arrow wrappers so these resolve at call time, not at module-import time.
      if (code.includes('expandListingBlocks') && !code.includes('expandListingBlocks =')) {
        neededImports.push(`const expandListingBlocks = (...a) => window.expandListingBlocks(...a);`);
      }
      if (code.includes('expandTemplatesSync') && !code.includes('expandTemplatesSync =')) {
        neededImports.push(`const expandTemplatesSync = (...a) => window.expandTemplatesSync(...a);`);
      }
      if (code.includes('ploneFetchItems') && !code.includes('ploneFetchItems =')) {
        neededImports.push(`const ploneFetchItems = (...a) => window.ploneFetchItems(...a);`);
      }
      if (code.includes('API_URL') && !code.includes('API_URL =')) {
        neededImports.push(`const _getApiUrl = () => window._API_URL;`);
        // Rewrite bare API_URL references to _getApiUrl() calls
        code = code.replace(/\bAPI_URL\b/g, '_getApiUrl()');
      }
      if (code.includes('contentPath') && !code.includes('contentPath =')) {
        neededImports.push(`const contentPath = (...a) => window._contentPath(...a);`);
      }

      if (neededImports.length === 0) return;

      // Insert imports after <script setup> tag
      const importBlock = neededImports.join('\n');
      const transformed = code.replace(
        /(<script\s+setup[^>]*>)/,
        `$1\n${importBlock}`
      );

      return transformed;
    },
  };
}

// The mock API this frontend talks to, from the same HYDRA_MOCK_API_PORT as
// tests-playwright/ports.ts — no default, for the same reason: a checkout that
// fell back to 8888 would fetch from another checkout's mock API.
const mockApiPort = process.env.HYDRA_MOCK_API_PORT;
if (!mockApiPort) {
  throw new Error('HYDRA_MOCK_API_PORT must be set (tests-playwright/ports.ts has no defaults)');
}
const HYDRA_API_URL = JSON.stringify(`http://localhost:${mockApiPort}`);

export default defineConfig({
  plugins: [vue(), vueExamplesPlugin()],
  define: { __HYDRA_API_URL__: HYDRA_API_URL },
  resolve: {
    alias: {
      '$examples': path.resolve(__dirname, '../examples/vue'),
      '$hydra': path.resolve(__dirname, '../../../packages/hydra-js/hydra.src.js'),
      '$helpers': path.resolve(__dirname, '../../../packages/helpers/index.js'),
      '$schemas': path.resolve(__dirname, '../../../tests-playwright/fixtures/shared-block-schemas.js'),
    },
  },
});
