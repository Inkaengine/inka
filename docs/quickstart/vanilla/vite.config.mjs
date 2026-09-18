// Not shown in the docs — the glue that makes the Quick Start snippet a runnable
// app for the bridge selection test. It resolves the published bridge specifier
// to the in-repo source so the test always runs the current hydra.js, and serves
// index.html for any path (SPA fallback) so the editor iframe's content path
// (/_test_data/test-page) loads the app. The port comes from --port on the CLI.
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));

export default defineConfig({
  root: here('.'),
  resolve: {
    alias: {
      '@hydra-js/hydra.js': here('../../../packages/hydra-js/hydra.src.js'),
    },
  },
});
