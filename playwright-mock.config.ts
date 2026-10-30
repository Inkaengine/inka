import { defineConfig, devices } from '@playwright/test';
import { URLS } from './tests-playwright/ports';

/**
 * Playwright config for mock parent tests (no Volto needed)
 * These tests only use the mock API server and test frontend
 *
 * Ports come from ports.ts, like the main config's. They were written here as
 * the historical number instead — one shared with every other hydra checkout
 * on the machine — so this config and the suite it starts could disagree about
 * where the mock API is, and nothing said so.
 */
export default defineConfig({
  testDir: './tests-playwright',
  testMatch: ['**/mock-parent/**/*.spec.ts', '**/unit/**/*.spec.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? undefined : undefined,
  reporter: [['html', { open: 'never' }]],

  use: {
    baseURL: URLS.mockApi,
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Explicit viewport for consistent behavior between local and CI
        viewport: { width: 1280, height: 720 },
      },
    },
  ],

  // Only start the mock API server (no Volto)
  webServer: {
    command: 'node tests-playwright/fixtures/mock-api-server.cjs',
    url: `${URLS.mockApi}/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
