import { defineConfig } from 'vitest/config';

/**
 * hydra-js runs in the browser, but its tests run on Node: the ones that need
 * a page build their own with jsdom, so each one sets up exactly the DOM it
 * tests.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.test.js'],
  },
});
