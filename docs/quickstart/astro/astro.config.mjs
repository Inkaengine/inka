// Not shown in the docs — server output + node adapter (so /api/render runs) and
// resolving the published bridge specifier to the in-repo source for the test.
import { defineConfig } from 'astro/config'
import node from '@astrojs/node'
import { fileURLToPath } from 'node:url'

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url))

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  vite: {
    resolve: {
      alias: {
        '@hydra-js/hydra.js': here('../../../packages/hydra-js/hydra.src.js'),
      },
    },
  },
})
