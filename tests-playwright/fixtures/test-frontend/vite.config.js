import { defineConfig } from 'vite';
import path from 'path';

// tests-playwright/ports.ts is the source of truth for test ports and says so,
// but this config hardcoded 8889 and ignored it — so HYDRA_TEST_FRONTEND_PORT
// silently did nothing here and a run on alternate ports collided with whatever
// already held the default. Same env var, same default, honoured.
const port = Number(process.env.HYDRA_TEST_FRONTEND_PORT) || 8889;
const apiPort = Number(process.env.HYDRA_MOCK_API_PORT) || 8888;

export default defineConfig({
  root: __dirname,
  // The fixture's own API origin. It used to be hardcoded to :8888 in
  // index.html, so an isolated run silently read another server's mock.
  //
  // Done with transformIndexHtml rather than `define`: define only substitutes
  // in JS that Vite transforms, and this token lives in an inline <script> in
  // the HTML, where it came through verbatim.
  plugins: [
    {
      name: 'inject-mock-api-origin',
      // order 'pre' matters: Vite lifts inline <script type="module"> out of
      // the HTML into its own virtual module, and a default-order transform
      // runs after that — so the token was replaced in the HTML that no longer
      // contained it, and the module kept the literal. index.html only worked
      // because its assignment sits in a plain <script>, which stays inline.
      transformIndexHtml: {
        order: 'pre',
        handler(html) {
          return html.replaceAll(
            '__MOCK_API_ORIGIN__',
            JSON.stringify(`http://localhost:${apiPort}`),
          );
        },
      },
    },
  ],
  server: {
    port,
    strictPort: true,
    // Bind on all interfaces so tests can reach the same server via both
    // http://localhost:<port> and http://127.0.0.1:<port> — different origins
    // to the browser, used by the publicURL-flatten test to simulate
    // switching between two frontends without standing up a second Vite
    // process.
    host: true,
    headers: {
      'Content-Security-Policy': 'frame-ancestors *',
    },
    // Warm up hydra.js on startup so first test doesn't hit cold compile
    warmup: {
      clientFiles: [
        path.resolve(__dirname, '../../../packages/hydra-js/hydra.src.js'),
      ],
    },
  },
  // Pre-bundle tabbable dependency to avoid on-demand resolution delay
  optimizeDeps: {
    include: ['tabbable'],
  },
  resolve: {
    alias: {
      '/hydra.js': path.resolve(__dirname, '../../../packages/hydra-js/hydra.src.js'),
      '/helpers.js': path.resolve(__dirname, '../../../packages/helpers/index.js'),
      '/plone-adapter.js': path.resolve(__dirname, '../../../packages/hydra-adapters-plone/index.js'),
      '/wordpress-adapter.js': path.resolve(__dirname, '../../../packages/hydra-adapters-wordpress/index.js'),
      '/drupal-adapter.js': path.resolve(__dirname, '../../../packages/hydra-adapters-drupal/index.js'),
      '/build-block-path-map.js': path.resolve(__dirname, '../../../packages/hydra-js/buildBlockPathMap.js'),
      '/shared-block-schemas.js': path.resolve(__dirname, '../shared-block-schemas.js'),
      '/core-block-schemas.js': path.resolve(__dirname, '../core-block-schemas.js'),
    },
  },
});
