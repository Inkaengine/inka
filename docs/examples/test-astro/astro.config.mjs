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
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  // dev:test in package.json passes --port 3009 to match PORTS.astroDoc;
  // this is just the default for `astro dev` without args.
  server: {
    port: 3009,
  },
  vite: {
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
