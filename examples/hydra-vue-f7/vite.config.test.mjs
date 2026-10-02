// Test config: same as vite.config.js but without mkcert/https (which fails in CI/test)
import path from 'path';
import { fileURLToPath } from 'url';
import vue from '@vitejs/plugin-vue';

// `.mjs` because this config imports @vitejs/plugin-vue, which is ESM-only:
// the package has no "type": "module", so a `.js` config is require()d and
// vite fails to load it ('resolved to an ESM file'). ESM has no __dirname.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SRC_DIR = path.resolve(__dirname, './src');
const PUBLIC_DIR = path.resolve(__dirname, './public');
const BUILD_DIR = path.resolve(__dirname, './dist');
const HYDRA_JS_DIR = path.resolve(__dirname, '../../packages/hydra-js');
const HELPERS_DIR = path.resolve(__dirname, '../../packages/helpers');

export default {
  plugins: [vue({
    template: {
      compilerOptions: {
        isCustomElement: (tag) => tag.startsWith('swiper-'),
      },
    },
  })],
  root: SRC_DIR,
  base: '',
  publicDir: PUBLIC_DIR,
  build: {
    outDir: BUILD_DIR,
    assetsInlineLimit: 0,
    emptyOutDir: true,
    rollupOptions: {
      treeshake: false,
    },
  },
  resolve: {
    alias: {
      '@': SRC_DIR,
      '@hydra-js/hydra.js': path.resolve(HYDRA_JS_DIR, 'hydra.src.js'),
      '@hydra-js/helpers': path.resolve(HELPERS_DIR, 'index.js'),
      '@hydra-js': HYDRA_JS_DIR,
    },
  },
  server: {
    host: true,
  },
};
