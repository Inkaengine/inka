import { defineConfig } from '@playwright/test';
import * as path from 'path';

/**
 * Conformance config: the mock API, diffed against a real Plone.
 *
 * checking-against-plone.md exists because three bugs came from validating the mock
 * against its own callers instead of against Plone — an action's destination read from
 * `@id` when Plone emits `url`, `delete` looked up in `object` when Plone puts it in
 * `object_buttons`, and action ids invented by reading Volto's consumer code. A suite that
 * asks the real server cannot drift the way a hand-copied fixture does.
 *
 * Separate from playwright.config.ts on purpose: this one needs Docker, so it must not be
 * a tax on `pnpm test:e2e`.
 *
 *     make backend-docker-start     # terminal 1: plone/server-dev:6 on :8080
 *     make test-conformance         # terminal 2
 *
 * BOTH servers are started by the infra, not by the tests: Plone by the Docker target
 * above (waited on by the `Plone` webServer entry) and the mock by its own entry. The
 * tests themselves only make HTTP calls and diff — no listen(), no lifecycle hooks.
 */
const PLONE_URL = process.env.PLONE_URL || 'http://localhost:8080/Plone';
const MOCK_PORT = Number(process.env.HYDRA_MOCK_API_PORT || 8888);
const MOCK_URL = `http://localhost:${MOCK_PORT}`;

export default defineConfig({
  testDir: './tests-playwright/conformance',
  // One worker: both servers are shared, mutable state (the mock has session content, and
  // a real Plone is a single site). Parallel workers would race each other's writes.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  timeout: 30 * 1000,

  use: {
    // Both base URLs reach the tests as config; the fixtures in the spec read them.
    baseURL: MOCK_URL,
  },

  metadata: { ploneUrl: PLONE_URL, mockUrl: MOCK_URL },

  webServer: [
    {
      // Not started here — `make backend-docker-start` owns its lifecycle, because a
      // Plone container takes ~60s to boot and is worth keeping up across runs. This
      // entry just WAITS for it, and fails with a usable message if it is absent.
      name: 'Plone',
      command:
        `echo "Waiting for Plone at ${PLONE_URL} (start it with: make backend-docker-start)"; ` +
        `until curl -sf -H 'Accept: application/json' ${PLONE_URL}/++api++/ > /dev/null 2>&1; do sleep 2; done`,
      url: `${PLONE_URL}/++api++/`,
      timeout: 120 * 1000,
      reuseExistingServer: true,
      stdout: 'pipe' as const,
      stderr: 'pipe' as const,
    },
    {
      name: 'Mock API',
      command: `node ${path.join(__dirname, 'tests-playwright/fixtures/mock-api-server.cjs')}`,
      url: `${MOCK_URL}/health`,
      timeout: 60 * 1000,
      reuseExistingServer: true,
      cwd: process.cwd(),
      stdout: 'pipe' as const,
      stderr: 'pipe' as const,
      env: {
        PORT: String(MOCK_PORT),
        CONTENT_MOUNTS:
          '/docs:docs,/_test_data:tests-playwright/fixtures/content,/:tests-playwright/fixtures/site-root',
      },
    },
  ],
});
