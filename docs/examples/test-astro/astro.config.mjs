import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Aliases that mirror the test-svelte / test-react / test-vue convention so
// that block components reference the shared hydra bridge + example sources
// from `docs/examples/examples/astro/` without each one re-declaring paths.
// $hydra:    the bridge JS (loaded as a side-effect module in the browser AND
//            imported in the render endpoint to compute the changed-unit diff).
// $examples: the directory of .astro block components — kept SEPARATE from
//            this test app so that the same components can be reused by a
//            production example app in a follow-up.
// $schemas:  the block-definitions.json file shared with svelte/react/vue.
// The mock API this frontend talks to, from the same HYDRA_MOCK_API_PORT as
// tests-playwright/ports.ts — no default, for the same reason: a checkout that
// fell back to 8888 would fetch from another checkout's mock API.
const mockApiPort = process.env.HYDRA_MOCK_API_PORT;
if (!mockApiPort) {
  throw new Error('HYDRA_MOCK_API_PORT must be set (tests-playwright/ports.ts has no defaults)');
}
const HYDRA_API_URL = JSON.stringify(`http://localhost:${mockApiPort}`);
// The listing's server-side render reads it too (examples/astro/ListingBlock.astro).
process.env.HYDRA_API_URL = JSON.parse(HYDRA_API_URL);

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  // No port here: the test harness passes --port (HYDRA_ASTRO_DOC_PORT, see
  // tests-playwright/ports.ts), like every other test frontend.
  vite: {
    define: { __HYDRA_API_URL__: HYDRA_API_URL },
    resolve: {
      alias: {
        '$hydra': path.resolve(__dirname, '../../../packages/hydra-js/hydra.src.js'),
        '$helpers': path.resolve(__dirname, '../../../packages/helpers/index.js'),
        '$examples': path.resolve(__dirname, '../examples/astro'),
        '$schemas': path.resolve(__dirname, '../../../tests-playwright/fixtures/shared-block-schemas.js'),
      },
    },
  },
});
