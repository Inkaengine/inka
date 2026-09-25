import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';
import { PORTS, URLS } from './tests-playwright/ports';

// Check which extra servers we need based on --project arg
const projectArgIndex = process.argv.indexOf('--project');
const projectArg = process.argv.find(arg => arg.startsWith('--project='))?.split('=')[1]
  || (projectArgIndex !== -1 ? process.argv[projectArgIndex + 1] : undefined);
const needsNuxt = !projectArg || projectArg.includes('nuxt');
const needsReact = !projectArg || projectArg.includes('react');
const needsSvelte = !projectArg || projectArg.includes('svelte');
const needsVue = !projectArg || projectArg.includes('vue');
// Astro example frontend — opt-in only because it carries an SSR runtime
// (Node adapter) the other doc examples don't, and the unconditional
// startup tax for every `pnpm test:e2e` run would be unnecessary for the
// majority of test invocations that don't touch Astro.
const needsAstro = projectArg?.includes('astro');
// Example frontends — opt-in only (not started unless explicitly requested)
const needsNextjs = projectArg?.includes('nextjs');
const needsF7 = projectArg?.includes('f7');
// Quick Start starter apps — opt-in only, same rationale as the example frontends.
const needsVanilla = projectArg?.includes('vanilla');
const needsSvelteQs = projectArg?.includes('svelte-qs');
const needsAstroQs = projectArg?.includes('astro-qs');

/**
 * Playwright Test configuration for Volto Hydra tests.
 *
 * Tests the admin UI editing functionality with a mocked Plone backend.
 */
export default defineConfig({
  testDir: './tests-playwright',

  /* Global setup - verifies servers are healthy before running tests */
  globalSetup: require.resolve('./tests-playwright/global-setup.ts'),

  /* Maximum time one test can run for */
  timeout: 45 * 1000, // 45s - bridge tests complete in 2-5s, integration tests need more for page nav + re-renders

  /* Run tests in files in parallel */
  fullyParallel: true,

  /* Fail the build on CI if you accidentally left test.only in the source code */
  forbidOnly: !!process.env.CI,

  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,

  /* Opt out of parallel tests on CI */
  workers: process.env.CI ? undefined : undefined,

  /* Reporter to use */
  reporter: [
    ['html', { open: 'never' }],
    // Aggregates block-sanity field/text-style coverage across all parallel
    // workers and fails the run in onEnd if any block type has a field or style
    // with no working example anywhere. See tests-playwright/coverage-reporter.ts.
    ['./tests-playwright/coverage-reporter.ts'],
  ],

  /* Shared settings for all the projects below */
  use: {
    /* Base URL to use in actions like `await page.goto('/')` */
    baseURL: URLS.voltoSsr,

    /* Trace recording - disabled by default to save space. Enable with TRACE=1 */
    trace: process.env.TRACE ? 'on-first-retry' : 'off',

    /* Screenshot on failure */
    screenshot: 'only-on-failure',

    /* Video recording - disabled by default to save CPU. Enable with VIDEO=1 */
    video: process.env.VIDEO ? 'retain-on-failure' : 'off',
  },

  /* Configure projects for different test categories and frontends.
   *
   * Test directories:
   *   unit/        — Pure unit tests, run once (no frontend needed)
   *   api/         — HTTP-contract tests against the mock API, run once
   *                  (frontend-agnostic, no browser storageState)
   *   bridge/      — Mock-parent tests using hydra.js bridge protocol,
   *                  run on ALL frontends (mock, nuxt, react, svelte, vue)
   *   integration/ — Full Volto admin UI tests, run on mock + nuxt only
   */
  projects: [
    // --- Unit tests ---
    {
      name: 'unit',
      testDir: 'tests-playwright/unit',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        permissions: ['clipboard-read', 'clipboard-write'],
      },
    },
    {
      name: 'unit-firefox',
      testDir: 'tests-playwright/unit',
      use: {
        ...devices['Desktop Firefox'],
        viewport: { width: 1280, height: 720 },
      },
    },

    // --- API-contract tests — frontend-agnostic, run once ---
    // Pure HTTP-contract tests against the mock API (port 8888, always started).
    // No browser frontend and deliberately NO storageState — these assert a
    // backend/serializer contract (which blocks fields persist), so they must
    // not be multiplied across frontend projects or inherit a frontend's cookies.
    {
      name: 'api-contract',
      testDir: 'tests-playwright/api',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
      },
    },

    // --- Bridge tests — run on all frontends ---
    // Mock frontend (default, port 8888)
    {
      name: 'mock',
      testDir: 'tests-playwright/bridge',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        permissions: ['clipboard-read', 'clipboard-write'],
      },
    },
    // Nuxt frontend (port 3003)
    {
      name: 'nuxt',
      testDir: 'tests-playwright/bridge',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        permissions: ['clipboard-read', 'clipboard-write'],
        storageState: 'tests-playwright/.generated/storage-nuxt.json',
      },
    },
    {
      name: 'nuxt-firefox',
      testDir: 'tests-playwright/bridge',
      use: {
        ...devices['Desktop Firefox'],
        viewport: { width: 1280, height: 720 },
        storageState: 'tests-playwright/.generated/storage-nuxt.json',
      },
    },
    // React Vite frontend (port 3004)
    {
      name: 'react',
      testDir: 'tests-playwright/bridge',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        permissions: ['clipboard-read', 'clipboard-write'],
        storageState: 'tests-playwright/.generated/storage-react.json',
      },
    },
    // Svelte Vite frontend (port 3005)
    {
      name: 'svelte',
      testDir: 'tests-playwright/bridge',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        permissions: ['clipboard-read', 'clipboard-write'],
        storageState: 'tests-playwright/.generated/storage-svelte.json',
      },
    },
    // Vue Vite frontend (port 3006)
    {
      name: 'vue',
      testDir: 'tests-playwright/bridge',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        permissions: ['clipboard-read', 'clipboard-write'],
        storageState: 'tests-playwright/.generated/storage-vue.json',
      },
    },
    // Astro SSR frontend (port 3009)
    {
      name: 'astro',
      testDir: 'tests-playwright/bridge',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        permissions: ['clipboard-read', 'clipboard-write'],
        storageState: 'tests-playwright/.generated/storage-svelte.json',
      },
    },
    // Quick Start starters — each runs the exact docs/quickstart/<fw> snippet
    // (opt-in). Only quickstart-*.spec.ts runs on these dedicated blank apps.
    {
      name: 'vanilla',
      testDir: 'tests-playwright/bridge',
      testMatch: /quickstart-.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        permissions: ['clipboard-read', 'clipboard-write'],
        storageState: 'tests-playwright/.generated/storage-svelte.json',
      },
    },
    {
      name: 'svelte-qs',
      testDir: 'tests-playwright/bridge',
      testMatch: /quickstart-.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        permissions: ['clipboard-read', 'clipboard-write'],
        storageState: 'tests-playwright/.generated/storage-svelte.json',
      },
    },
    {
      name: 'astro-qs',
      testDir: 'tests-playwright/bridge',
      testMatch: /quickstart-.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        permissions: ['clipboard-read', 'clipboard-write'],
        storageState: 'tests-playwright/.generated/storage-svelte.json',
      },
    },

    // Example frontends for bridge tests — always defined so workers can find them.
    // webServer entries below are conditional (only started when --project includes nextjs/f7).
    // Tests are skipped at runtime in doc-examples.spec.ts beforeEach when not explicitly requested.
    {
      name: 'nextjs',
      testDir: 'tests-playwright/bridge',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        permissions: ['clipboard-read', 'clipboard-write'],
      },
    },
    {
      name: 'nextjs-firefox',
      testDir: 'tests-playwright/bridge',
      use: {
        ...devices['Desktop Firefox'],
        viewport: { width: 1280, height: 720 },
      },
    },
    {
      name: 'f7',
      testDir: 'tests-playwright/bridge',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        permissions: ['clipboard-read', 'clipboard-write'],
      },
    },

    // --- Admin integration tests — fully implemented frontends only ---
    // Mock frontend
    {
      name: 'admin-mock',
      testDir: 'tests-playwright/integration',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        permissions: ['clipboard-read', 'clipboard-write'],
      },
      testIgnore: [
        /nuxt-.*\.spec\.ts/, // Skip nuxt-specific tests
      ],
    },
    // Nuxt frontend
    {
      name: 'admin-nuxt',
      testDir: 'tests-playwright/integration',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        permissions: ['clipboard-read', 'clipboard-write'],
        storageState: 'tests-playwright/.generated/storage-nuxt.json',
      },
      testIgnore: [
        /mock-.*\.spec\.ts/, // the mock frontend's own setup (mock-frontend.spec.ts)
        /nuxt-.*\.spec\.ts/, // Skip nuxt-specific tests (they set their own cookie)
        /multifield.*\.spec\.ts/, // Skip multifield tests (hero block not in Nuxt)
      ],
    },
    // Nuxt-specific tests (nuxt-*.spec.ts) - set their own iframe_url cookie
    {
      name: 'nuxt-specific',
      testDir: 'tests-playwright/integration',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        permissions: ['clipboard-read', 'clipboard-write'],
      },
      testMatch: /nuxt-.*\.spec\.ts/,
    },

    // --- Example frontends — opt-in only (run with --project=admin-nextjs or --project=admin-f7) ---
    {
      name: 'admin-nextjs',
      testDir: 'tests-playwright/integration',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        permissions: ['clipboard-read', 'clipboard-write'],
        storageState: 'tests-playwright/.generated/storage-nextjs.json',
      },
      testIgnore: [
        /mock-.*\.spec\.ts/, // the mock frontend's own setup (mock-frontend.spec.ts)
        /nuxt-.*\.spec\.ts/,
      ],
    },
    {
      name: 'admin-f7',
      testDir: 'tests-playwright/integration',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        permissions: ['clipboard-read', 'clipboard-write'],
        storageState: 'tests-playwright/.generated/storage-f7.json',
      },
      testIgnore: [
        /mock-.*\.spec\.ts/, // the mock frontend's own setup (mock-frontend.spec.ts)
        /nuxt-.*\.spec\.ts/,
      ],
    },
    // Documentation screenshots — manual / on-demand only.
    // Run with: pnpm exec playwright test --project=screenshots-nuxt
    // Captures images of the editor UI for the editor guide. Larger viewport
    // (1440x900) than the default 1280x720 so screenshots have a bit more
    // breathing room without scrollbars on common content.
    //
    // Uses the Nuxt example frontend (storage-nuxt.json cookie points the
    // iframe at :3003) — the Nuxt blog renderer is more visually polished
    // than the bare-HTML test frontend, so screenshots look better in the
    // docs. The "nuxt" substring in the project name also makes the
    // needsNuxt check above auto-start the Nuxt dev server.
    {
      name: 'screenshots-nuxt',
      testDir: 'tests-playwright/screenshots',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        permissions: ['clipboard-read', 'clipboard-write'],
        storageState: 'tests-playwright/.generated/storage-nuxt.json',
      },
    },
    // Homepage hero demo video — manual / on-demand.
    // Run with: pnpm demo:capture (then pnpm demo:encode)
    // Records a single deterministic edit session and writes the .webm to
    // tests-playwright/demo-video/.recordings/. The encode step muxes that
    // into docs/_static/hydra-demo.mp4 which docs/index.md embeds.
    {
      name: 'demo-video',
      testDir: 'tests-playwright/demo-video',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        permissions: ['clipboard-read', 'clipboard-write'],
        storageState: 'tests-playwright/.generated/storage-nuxt.json',
        video: {
          mode: 'on',
          size: { width: 1280, height: 720 },
        },
      },
      outputDir: 'tests-playwright/demo-video/.recordings',
    },
  ],

  /* Start mock API server and Volto dev server before running tests */
  /* In CI, servers are started in advance by the workflow - Playwright just reuses them */
  /* Set NO_WEBSERVER=true in CI to disable all auto-start (each CI job manages its own servers) */
  webServer: process.env.NO_WEBSERVER ? [] : [
    {
      // Mock Plone API — REST endpoints, content from disk
      // Test frontend is served by the separate Vite webServer entry below
      name: 'Mock API',
      command: `node --watch --watch-path=tests-playwright/fixtures --watch-path=packages/hydra-js ${path.join(__dirname, 'tests-playwright/fixtures/mock-api-server.cjs')}`,
      url: `${URLS.mockApi}/health`,
      timeout: 30 * 1000,
      reuseExistingServer: true,
      cwd: process.cwd(),
      stdout: 'pipe' as const,
      stderr: 'pipe' as const,
      env: {
        PORT: String(PORTS.mockApi),
        CONTENT_MOUNTS: '/docs:docs,/_test_data:tests-playwright/fixtures/content,/:tests-playwright/fixtures/site-root',
      },
    },
    {
      // Test frontend — Vite dev server, auto-bundles hydra.src.js with tabbable
      // Health check on hydra.js (not HTML) to ensure Vite has compiled it
      name: 'Test Frontend',
      command: 'npx vite --config tests-playwright/fixtures/test-frontend/vite.config.js',
      url: `${URLS.testFrontend}/hydra.js`,
      timeout: 30 * 1000,
      reuseExistingServer: true,
      cwd: process.cwd(),
      stdout: 'pipe' as const,
      stderr: 'pipe' as const,
    },
    // Use prebuilt production server in CI, dev server locally
    process.env.USE_PREBUILT
      ? {
          // Production server (prebuilt in CI) - starts immediately, no webpack compilation
          name: 'Volto Admin UI (Production)',
          command: `PORT=${PORTS.voltoSsr} RAZZLE_API_PATH=${URLS.mockApi} RAZZLE_DEFAULT_IFRAME_URL=${URLS.testFrontend} pnpm start:prod`,
          url: URLS.voltoSsr, // Health check on SSR server directly
          timeout: 30 * 1000, // 30 seconds should be plenty for starting prebuilt server
          reuseExistingServer: true, // CI starts server in advance
          cwd: process.cwd(),
          stdout: 'pipe' as const,
          stderr: 'pipe' as const,
          env: {
            NODE_ENV: 'production',
            PORT: String(PORTS.voltoSsr),
            RAZZLE_API_PATH: URLS.mockApi,
            // All frontends available for switching
            RAZZLE_DEFAULT_IFRAME_URL: [
              URLS.testFrontend, URLS.nuxt, URLS.reactDoc, URLS.svelteDoc,
              URLS.vueDoc, URLS.nextjs, URLS.f7, URLS.astroDoc,
            ].join(','),
            VOLTOCONFIG: process.cwd() + '/volto.config.js',
          },
        }
      : {
          // Dev server with HMR - used locally for fast iteration
          // Volto creates TWO servers:
          // - voltoSsr: Razzle SSR server (set by PORT env var) - serves content, tests navigate here
          // - voltoWebpack: webpack-dev-server (auto-incremented from PORT) - compiles assets, health check here
          // Tests navigate to voltoSsr (SSR server for content)
          // Health check on voltoWebpack (webpack-dev-server) waits for compilation to complete
          name: 'Volto Admin UI (Dev)',
          command: `PORT=${PORTS.voltoSsr} RAZZLE_API_PATH=${URLS.mockApi} RAZZLE_DEFAULT_IFRAME_URL=${URLS.testFrontend} VOLTOCONFIG=$(pwd)/volto.config.js razzle start`,
          url: `${URLS.voltoWebpack}/health`, // Health check on webpack-dev-server (returns 200 when ready)
          timeout: 300 * 1000, // 5 minutes for initial webpack compilation
          reuseExistingServer: true, // Always reuse - local dev starts manually
          cwd: process.cwd(),
          stdout: 'pipe' as const,
          stderr: 'pipe' as const,
          env: {
            PORT: String(PORTS.voltoSsr),
            RAZZLE_API_PATH: URLS.mockApi,
            // All frontends available for switching
            RAZZLE_DEFAULT_IFRAME_URL: [
              URLS.testFrontend, URLS.nuxt, URLS.reactDoc, URLS.svelteDoc,
              URLS.vueDoc, URLS.nextjs, URLS.f7, URLS.astroDoc,
            ].join(','),
            VOLTOCONFIG: process.cwd() + '/volto.config.js',
            // Prevent parcel from trying to access TTY (fixes segfault in background process)
            CI: process.env.CI || 'true',
          },
        },
    // Nuxt frontend for testing Nuxt-specific scenarios (only started when running nuxt tests)
    ...(needsNuxt ? [{
      name: 'Nuxt Frontend (Test)',
      command: 'pnpm run dev:test',
      url: URLS.nuxt,
      timeout: 120 * 1000, // 2 minutes for Nuxt compilation
      reuseExistingServer: true, // CI starts server in advance, local dev starts manually
      cwd: path.join(process.cwd(), 'examples/nuxt-blog-starter'),
      stdout: 'pipe' as const,
      stderr: 'pipe' as const,
    }] : []),
    // React Vite frontend for doc example tests
    ...(needsReact ? [{
      name: 'React Frontend (Test)',
      command: `npx vite --port ${PORTS.reactDoc} --strictPort`,
      url: URLS.reactDoc,
      timeout: 30 * 1000,
      reuseExistingServer: true,
      cwd: path.join(process.cwd(), 'docs/examples/test-react'),
      stdout: 'pipe' as const,
      stderr: 'pipe' as const,
    }] : []),
    // Svelte Vite frontend for doc example tests
    ...(needsSvelte ? [{
      name: 'Svelte Frontend (Test)',
      command: `npx vite --port ${PORTS.svelteDoc} --strictPort`,
      url: URLS.svelteDoc,
      timeout: 30 * 1000,
      reuseExistingServer: true,
      cwd: path.join(process.cwd(), 'docs/examples/test-svelte'),
      stdout: 'pipe' as const,
      stderr: 'pipe' as const,
    }] : []),
    // Vue Vite frontend for doc example tests
    ...(needsVue ? [{
      name: 'Vue Frontend (Test)',
      command: `npx vite --port ${PORTS.vueDoc} --strictPort`,
      url: URLS.vueDoc,
      timeout: 30 * 1000,
      reuseExistingServer: true,
      cwd: path.join(process.cwd(), 'docs/examples/test-vue'),
      stdout: 'pipe' as const,
      stderr: 'pipe' as const,
    }] : []),
    // Astro SSR frontend for doc example tests (opt-in via --project=astro)
    // dev:test pins the port via --port/--host so playwright's reuse logic
    // gets a stable URL; the Node adapter is configured in astro.config.mjs.
    // 120s timeout because the first run installs astro + @astrojs/node.
    ...(needsAstro ? [{
      name: 'Astro Frontend (Test)',
      command: 'pnpm run dev:test',
      url: URLS.astroDoc,
      timeout: 120 * 1000,
      reuseExistingServer: true,
      cwd: path.join(process.cwd(), 'docs/examples/test-astro'),
      stdout: 'pipe' as const,
      stderr: 'pipe' as const,
    }] : []),
    // Quick Start vanilla starter — a vite server rooted at docs/quickstart/vanilla,
    // aliasing the bridge specifier to source. SPA fallback serves index.html for
    // the editor iframe's content path (/_test_data/test-page).
    ...(needsVanilla ? [{
      name: 'Quick Start Vanilla',
      command: `npx vite --port ${PORTS.vanillaDoc} --strictPort --config ${path.join(process.cwd(), 'docs/quickstart/vanilla/vite.config.mjs')}`,
      url: URLS.vanillaDoc,
      timeout: 60 * 1000,
      reuseExistingServer: true,
      cwd: path.join(process.cwd(), 'docs/quickstart/vanilla'),
      stdout: 'pipe' as const,
      stderr: 'pipe' as const,
    }] : []),
    // Quick Start Svelte 5 starter — a vite server rooted at docs/quickstart/svelte.
    ...(needsSvelteQs ? [{
      name: 'Quick Start Svelte',
      command: `npx vite --port ${PORTS.svelteQs} --strictPort`,
      url: URLS.svelteQs,
      timeout: 60 * 1000,
      reuseExistingServer: true,
      cwd: path.join(process.cwd(), 'docs/quickstart/svelte'),
      stdout: 'pipe' as const,
      stderr: 'pipe' as const,
    }] : []),
    // Quick Start Astro starter — server-render (node adapter); astro dev serves
    // the catch-all page + the /api/render endpoint. 120s for the first run.
    ...(needsAstroQs ? [{
      name: 'Quick Start Astro',
      command: `npx astro dev --port ${PORTS.astroQs}`,
      url: URLS.astroQs,
      timeout: 120 * 1000,
      reuseExistingServer: true,
      cwd: path.join(process.cwd(), 'docs/quickstart/astro'),
      stdout: 'pipe' as const,
      stderr: 'pipe' as const,
    }] : []),
    // Example frontends — opt-in only
    ...(needsNextjs ? [{
      name: 'Next.js Frontend (Test)',
      // Wait for the mock API before starting. Playwright brings every
      // webServer up at once, and the mock API only listens after it has
      // scanned all content (~40s) — so Next would boot first, its very first
      // SSR fetch would be refused, and the whole run failed with "#previewIframe
      // never appeared" on every test. It reads like the app is broken; it is a
      // start-order race. CI doesn't hit this path (NO_WEBSERVER=true; the
      // workflow starts and waits for servers itself).
      command: `until curl -sf ${URLS.mockApi}/health > /dev/null 2>&1; do sleep 1; done; pnpm run dev:test`,
      url: URLS.nextjs,
      timeout: 120 * 1000,
      reuseExistingServer: true,
      cwd: path.join(process.cwd(), 'examples/hydra-nextjs'),
      stdout: 'pipe' as const,
      stderr: 'pipe' as const,
      env: {
        NEXT_PUBLIC_BACKEND_BASE_URL: URLS.mockApi,
      },
    }] : []),
    ...(needsF7 ? [{
      name: 'Framework7 Frontend (Test)',
      // No hydra.js copy: the app imports `@hydra-js/hydra.js`, which both vite
      // configs alias to packages/hydra-js/hydra.src.js — vite compiles the
      // SOURCE per request, so the example always runs the current bridge. The
      // copy wrote a gitignored file nothing reads, and reading it as the served
      // bridge sent me chasing a "stale build" that never existed.
      command: `npx vite --port ${PORTS.f7} --strictPort --config vite.config.test.mjs`,
      url: URLS.f7,
      timeout: 120 * 1000,
      reuseExistingServer: true,
      cwd: path.join(process.cwd(), 'examples/hydra-vue-f7'),
      stdout: 'pipe' as const,
      stderr: 'pipe' as const,
      env: {
        ...process.env,
        VITE_API_BASE_URL: URLS.mockApi,
      },
    }] : []),
  ],
});
