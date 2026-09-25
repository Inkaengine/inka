import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';

/**
 * Globals referenced in Svelte example files without explicit imports.
 * The plugin injects `const X = window.X;` for each.
 */
/**
 * Function-valued globals get arrow wrappers so they resolve at call time
 * (main.js sets them after the component import chain is evaluated).
 * API_URL is a string, so we inject a getter function and rewrite references.
 */
const GLOBAL_INJECTIONS = {
  expandListingBlocks: { inject: '(...a) => window.expandListingBlocks(...a)' },
  expandTemplatesSync: { inject: '(...a) => window.expandTemplatesSync(...a)' },
  ploneFetchItems: { inject: '(...a) => window.ploneFetchItems(...a)' },
  contentPath: { inject: '(...a) => window._contentPath(...a)' },
  API_URL: { inject: '() => window._API_URL', rewrite: true, getterName: '_getApiUrl' },
};

/**
 * Vite plugin to inject global references into Svelte doc examples.
 *
 * Svelte compiles <script> in strict mode, so bare globals like
 * `expandListingBlocks` need explicit `const` declarations pointing
 * at window properties set by main.js.
 */
function svelteExamplesPlugin() {
  const examplesDir = path.resolve(__dirname, '../examples/svelte');

  return {
    name: 'svelte-examples',
    enforce: 'pre',
    transform(code, id) {
      if (!id.startsWith(examplesDir) || !id.endsWith('.svelte')) return;

      const injections = [];
      let transformedCode = code;
      for (const [name, config] of Object.entries(GLOBAL_INJECTIONS)) {
        if (!code.includes(name) || code.includes(`${name} =`) || code.includes(`import ${name}`)) continue;
        if (config.rewrite) {
          // Inject a getter function and rewrite bare references to calls
          const getterName = config.getterName || `_get${name.charAt(0).toUpperCase() + name.slice(1)}`;
          injections.push(`const ${getterName} = ${config.inject};`);
          transformedCode = transformedCode.replace(new RegExp(`\\b${name}\\b`, 'g'), `${getterName}()`);
        } else {
          injections.push(`const ${name} = ${config.inject};`);
        }
      }

      if (injections.length === 0) return;

      // Insert after <script> tag
      const injectionBlock = injections.join('\n  ');
      return transformedCode.replace(
        /(<script[^>]*>)/,
        `$1\n  ${injectionBlock}`
      );
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
  plugins: [svelteExamplesPlugin(), svelte()],
  define: { __HYDRA_API_URL__: HYDRA_API_URL },
  resolve: {
    alias: {
      '$examples': path.resolve(__dirname, '../examples/svelte'),
      '$hydra': path.resolve(__dirname, '../../../packages/hydra-js/hydra.src.js'),
      '$helpers': path.resolve(__dirname, '../../../packages/helpers/index.js'),
      '$schemas': path.resolve(__dirname, '../../../tests-playwright/fixtures/shared-block-schemas.js'),
    },
  },
});
