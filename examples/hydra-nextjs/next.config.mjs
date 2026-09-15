import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  productionBrowserSourceMaps: true,
  reactStrictMode: false,
  eslint: {
    ignoreDuringBuilds: true,
  },
  webpack: (config) => {
    // Always resolve hydra.js and helpers from workspace source —
    // webpack bundles their deps (tabbable for hydra-js, none for helpers).
    // The copy:hydra script vendors a built copy into src/utils/ for
    // VSCode autocomplete, but webpack ignores that and uses these aliases.
    config.resolve.alias['#utils/hydra'] = path.resolve(
      __dirname,
      '../../packages/hydra-js/hydra.src.js',
    );
    config.resolve.alias['#utils/helpers'] = path.resolve(
      __dirname,
      '../../packages/helpers/index.js',
    );
    // The one block registry every frontend reads. The Nuxt example and the
    // mock test frontend already import it; this example used to build its own
    // from the docs bundle, which is how five block types ended up unregistered
    // here while working elsewhere.
    config.resolve.alias['@test-fixtures'] = path.resolve(
      __dirname,
      '../../tests-playwright/fixtures',
    );
    return config;
  },
};

export default nextConfig;
