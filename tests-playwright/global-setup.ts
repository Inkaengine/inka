/**
 * Global setup for Playwright tests
 * Verifies servers are healthy before running tests
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  discoverForFrontends,
  warmFrontend,
  waitForAdmin,
} from '@inka/testing/playwright/global-setup';
import { PORTS, URLS } from './ports';
import { FRONTEND_URLS, SANITY_PROJECTS, DISCOVERY_DIR } from './frontends';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Which frontend each storageState points the editor at.
 *
 * The editor reads the iframe URL from a cookie NAMED for the Volto SSR port
 * (`iframe_url_<port>`), so a storageState pins two ports at once: the admin's
 * in the name and the frontend's in the value. These used to be checked in with
 * 3001/3003/... baked into the JSON, which quietly cancelled the env overrides
 * ports.ts documents — set HYDRA_VOLTO_SSR_PORT and the cookie kept the old
 * name, so the editor never learned which frontend to load and the bridge sat
 * at "Not Connected", initBridge never called. Running on the default ports was
 * the only thing that worked, which means sharing them with whatever else is
 * already on 3001/8888 and, with reuseExistingServer, silently adopting a
 * stale Volto from another session.
 *
 * Generating them from PORTS restores the override, so a run can take a private
 * set of ports and leave anyone else's hydra alone.
 */
const STORAGE_FRONTENDS: Record<string, string> = {
  nuxt: URLS.nuxt,
  react: URLS.reactDoc,
  svelte: URLS.svelteDoc,
  vue: URLS.vueDoc,
  nextjs: URLS.nextjs,
  // F7 is hash-routed: the editor needs the `#!` or it loads the app shell
  // without a route.
  f7: `${URLS.f7}/#!`,
};

export const GENERATED_DIR = path.resolve(__dirname, '.generated');

function writeStorageStates(): void {
  fs.mkdirSync(GENERATED_DIR, { recursive: true });
  for (const [name, frontendUrl] of Object.entries(STORAGE_FRONTENDS)) {
    const state = {
      cookies: [
        {
          name: `iframe_url_${PORTS.voltoSsr}`,
          value: frontendUrl,
          domain: 'localhost',
          path: '/',
        },
      ],
      origins: [],
    };
    fs.writeFileSync(
      path.join(GENERATED_DIR, `storage-${name}.json`),
      JSON.stringify(state, null, 2),
    );
  }
}

async function globalSetup() {
  // Before anything else: the storageStates have to name the ports THIS run uses.
  writeStorageStates();

  // Run block discovery if configured (before health checks — SKIP_VOLTO_CHECK
  // causes early return but discovery still needs to run for bridge tests)
  // Fixture mounts are authored for their own root: served under /_test_data
  // (the docs+fixtures job layout) their internal refs legitimately miss the
  // merged view. Default the integrity exemption here so every harness gets
  // it; a consuming repo can still override before setup runs.
  process.env.INTEGRITY_EXEMPT_PREFIXES ??= '/_test_data';
  // Only frontends block-sanity enforces. A frontend it skips yields cases
  // that are generated and then skipped — pure cost, and for the docs
  // frontends (which register a small registry, so most content reads as
  // unregistered) it was ~1736 entries each, timing the job out.
  await discoverForFrontends({
    discoveryDir: DISCOVERY_DIR,
    frontends: {
      ...Object.fromEntries(
        Object.entries(FRONTEND_URLS).filter(([project]) => SANITY_PROJECTS.has(project)),
      ),
      mock: URLS.testFrontend,
    },
  });

  // Same --project logic playwright.config uses to decide which frontends to
  // start: warm exactly the one the run will drive.
  const projectArgIndex = process.argv.indexOf('--project');
  const projectArg =
    process.argv.find((arg) => arg.startsWith('--project='))?.split('=')[1] ||
    (projectArgIndex !== -1 ? process.argv[projectArgIndex + 1] : undefined);
  // Only the ADMIN-driven projects: they are the ones whose helper waits for
  // the iframe to render a block, so they are the ones that pay for a cold
  // frontend. The bridge projects drive the frontend directly.
  if (!projectArg || /admin-nuxt|nuxt-specific/.test(projectArg)) {
    await warmFrontend(`${URLS.nuxt}/test-page`);
  }

  // Bridge-only CI jobs don't run Volto — skip the health check
  if (process.env.SKIP_VOLTO_CHECK === 'true') {
    console.log('[SETUP] Skipping Volto health check (SKIP_VOLTO_CHECK=true)');
    return;
  }

  // In production mode (USE_PREBUILT), check SSR server directly
  // In dev mode, check webpack-dev-server health endpoint
  // Consumers running Volto on non-default ports (e.g. parallel test stacks)
  // can override with VOLTO_HEALTH_URL.
  await waitForAdmin();
}

export default globalSetup;
