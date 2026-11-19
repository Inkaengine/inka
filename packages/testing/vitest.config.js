import { defineConfig } from 'vitest/config';

/**
 * Tests of code that runs on Node, which need Node's environment. Playwright's
 * global setup runs on Node: what it gets from a refused fetch is Node's error
 * shape, not jsdom's.
 */
const NODE_TESTS = ['playwright/waitForAdmin.test.ts'];

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
        },
      },
    ],
  },
});
