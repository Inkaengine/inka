import { defineConfig } from 'vite';
import path from 'path';

// Ports come from the same HYDRA_<NAME>_PORT overrides as tests-playwright/ports.ts.
// Resolving them HERE means every launcher inherits them — playwright's webServer,
// `pnpm start:test-frontend`, and any parent project running this checkout — rather
// than each having to remember a flag.
//
// The API origin is handed to index.html through `define` (its inline script is a
// module, so vite substitutes there). The fixture used to hardcode
// `window._apiOrigin = 'http://localhost:8888'` with a comment claiming the mock
// API "always" runs on 8888. It doesn't: ports.ts made every port overridable,
// and an override moved the server while the browser kept fetching 8888 —
// ERR_CONNECTION_REFUSED on every test. A fixture should be told which API it is
// talking to, not assert one.
const envPort = (name, fallback) => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`Invalid ${name}: ${raw} (must be a positive integer)`);
  }
  return n;
};
const TEST_FRONTEND_PORT = envPort('HYDRA_TEST_FRONTEND_PORT', 8889);
const MOCK_API_ORIGIN = `http://localhost:${envPort('HYDRA_MOCK_API_PORT', 8888)}`;
// Same reasoning for the frontend: mock-parent.html defaulted its iframe to a
// literal localhost:8889, so any run on an overridden port framed a dead server
// unless the caller remembered to pass ?frontend=.
const TEST_FRONTEND_ORIGIN = `http://localhost:${TEST_FRONTEND_PORT}`;

export default defineConfig({
  root: __dirname,
  plugins: [
    {
      // Tell the fixture which API it is talking to. Injected as a tag rather
      // than substituted into the page: `define` never reaches index.html's
      // inline module (vite extracts it to an html-proxy first), and a
      // transformIndexHtml string replace loses the same race in dev. An
      // injected head script runs before the deferred module, so _apiOrigin is
      // set by the time the fixture boots.
      name: 'inject-mock-api-origin',
      transformIndexHtml() {
        return [
          {
            tag: 'script',
            injectTo: 'head-prepend',
            children:
              `window._apiOrigin = ${JSON.stringify(MOCK_API_ORIGIN)};` +
              `window._frontendOrigin = ${JSON.stringify(TEST_FRONTEND_ORIGIN)};`,
          },
        ];
      },
    },
  ],
  server: {
    port: TEST_FRONTEND_PORT,
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
      '/build-block-path-map.js': path.resolve(__dirname, '../../../packages/hydra-js/buildBlockPathMap.js'),
      // The same merge the admin runs before it posts INITIAL_DATA (View.jsx),
      // so the mock parent hands the bridge a page with its forced layouts and
      // templates already stamped on — see mock-parent.html's INIT handler.
      '/merge-templates.js': path.resolve(__dirname, '../../../packages/volto-hydra/src/utils/mergeTemplates.mjs'),
      '/shared-block-schemas.js': path.resolve(__dirname, '../shared-block-schemas.js'),
      '/core-block-schemas.js': path.resolve(__dirname, '../core-block-schemas.js'),
    },
  },
});
