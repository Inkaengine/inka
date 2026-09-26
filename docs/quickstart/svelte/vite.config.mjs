// Not shown in the docs — svelte plugin, plus resolving the published bridge
// specifier to the in-repo source so the test runs the current hydra.js.
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { fileURLToPath } from 'node:url'

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url))

export default defineConfig({
  root: here('.'),
  plugins: [svelte()],
  resolve: {
    alias: {
      '@hydra-js/hydra.js': here('../../../packages/hydra-js/hydra.src.js'),
    },
  },
})
