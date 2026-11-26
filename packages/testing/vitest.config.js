import { defineConfig } from 'vitest/config';

/**
 * Tests of code that runs on Node, which need Node's environment. Playwright's
 * global setup runs on Node: what it gets from a refused fetch is Node's error
 * shape, not jsdom's. The others run git, a mock API server, or the
 * inka-mock-parent bin.
 */
const NODE_TESTS = [
  'admin-build-stamp.test.js',
  'field-mapping-vocabulary.test.js',
  'mock-parent-server.test.js',
  'playwright/waitForAdmin.test.ts',
];

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          include: ['**/*.test.{js,ts}'],
          exclude: ['**/node_modules/**', ...NODE_TESTS],
        },
      },
      {
        test: {
          name: 'node',
          environment: 'node',
          include: NODE_TESTS,
          // inka-mock-parent takes up to 20s to serve its first page.
          hookTimeout: 30_000,
          testTimeout: 30_000,
        },
      },
    ],
  },
});
