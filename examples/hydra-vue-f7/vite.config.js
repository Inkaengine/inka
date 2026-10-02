import path from 'path';
import vue from '@vitejs/plugin-vue';

const SRC_DIR = path.resolve(__dirname, './src');
const PUBLIC_DIR = path.resolve(__dirname, './public');
const BUILD_DIR = path.resolve(__dirname, './dist');
const HYDRA_JS_DIR = path.resolve(__dirname, '../../packages/hydra-js');
const HELPERS_DIR = path.resolve(__dirname, '../../packages/helpers');

// For local HTTPS dev, use: pnpm exec vite --config vite.config.https.js
export default {
  plugins: [
    vue({
      template: {
        compilerOptions: {
          isCustomElement: (tag) => tag.startsWith('swiper-'),
        },
      },
    }),
  ],
  root: SRC_DIR,
  base: '',
  publicDir: PUBLIC_DIR,
  build: {
    outDir: BUILD_DIR,
    assetsInlineLimit: 0,
    emptyOutDir: true,
    rollupOptions: {
      treeshake: false,
      // Two pages: the app, and the proxy frame that hosts its adapter.
      input: {
        main: path.resolve(SRC_DIR, 'index.html'),
        'hydra-proxy': path.resolve(SRC_DIR, 'hydra-proxy.html'),
      },
    },
  },
  resolve: {
    alias: {
      '@': SRC_DIR,
      '@hydra-js/hydra.js': path.resolve(HYDRA_JS_DIR, 'hydra.src.js'),
      // The adapter the proxy frame hosts. The examples sit outside the pnpm
      // workspace, so the adapter and the core it imports are resolved from
      // source like hydra-js itself.
      '@volto-hydra/hydra-adapters-plone': path.resolve(HYDRA_JS_DIR, '../hydra-adapters-plone/index.js'),
      '@volto-hydra/hydra-adapters-core': path.resolve(HYDRA_JS_DIR, '../hydra-adapters-core/baseAdapter.js'),
      '@hydra-js/helpers': path.resolve(HELPERS_DIR, 'index.js'),
      '@hydra-js': HYDRA_JS_DIR,
    },
  },
  server: {
    host: true,
    cors: {
      origin: "https://hydra.pretagov.com"
    }
  },
};
