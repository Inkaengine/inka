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
import { editorFrontendUrl } from './journey/frontends';
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

/**
 * The journey projects' frontends, from journey/frontends.ts.
 *
 * Declared there rather than here because a second caller needs the same
 * answer: the public-site spec loads the SAME CMS with NO credential, and two
 * copies of "which CMS does journey-drupal read" is exactly the drift the
 * comment above warns about.
 */
const JOURNEY_PROJECTS = [
  'journey-plone',
  'journey-plone-seeded',
  'journey-drupal',
  'journey-wordpress',
  'journey-strapi',
];

/** Where the journey's Strapi writes the API token it provisions on boot. */
const STRAPI_TOKEN_FILE = path.resolve(
  __dirname,
  '../tests-adapters/fixtures/strapi-app/app/.hydra-journey-token',
);

/**
 * Put the journey's Strapi into the seeded state, ONCE per run.
 *
 * Every other journey backend arrives seeded: the Plone and Drupal mocks serve
 * the canonical set by construction, and WordPress is seeded per spec by
 * seedFor because it boots empty. Strapi boots empty too, but only the specs
 * that call seedFor would fix that — and back-navigation does not (it was
 * written when WordPress was the only CMS that needed it) and runs first
 * alphabetically. In CI it therefore met an empty Strapi: "Not found: /news".
 *
 * Here rather than in that spec, because the guarantee belongs to the RUN: no
 * spec should have to know whether an earlier one happened to seed.
 *
 * Skipped when Strapi is not answering, which means this run did not ask for
 * it. Any other failure is raised: a journey against an unseeded CMS reports
 * missing content as broken behaviour.
 */
async function seedJourneyStrapi(): Promise<void> {
  if (!fs.existsSync(STRAPI_TOKEN_FILE)) return;
  const up = await fetch(`${URLS.strapi}/api/pages`)
    .then((r) => r.ok)
    .catch(() => false);
  if (!up) return;
  const { seedStrapi } = await import('../tests-adapters/fixtures/seed-strapi');
  await seedStrapi({
    baseUrl: URLS.strapi,
    token: fs.readFileSync(STRAPI_TOKEN_FILE, 'utf8').trim(),
  });
  // eslint-disable-next-line no-console
  console.log('[SETUP] seeded the journey Strapi');
}

export const GENERATED_DIR = path.resolve(__dirname, '.generated');

function writeStorageStates(): void {
  fs.mkdirSync(GENERATED_DIR, { recursive: true });
  const frontends = {
    ...STORAGE_FRONTENDS,
    // The editor's URL per journey project: the journeys pick their CMS through
    // the FRONTEND's ?adapter= and ?cms=, so the saved frontend is the only
    // thing that makes a journey Drupal rather than Plone. Strapi's rides on the
    // URL and only exists once its bootstrap has written the token, which is why
    // these are built HERE, after the servers are up, rather than at module
    // scope.
    ...Object.fromEntries(
      JOURNEY_PROJECTS.map((name) => [name, editorFrontendUrl(name)]),
    ),
  };
  for (const [name, frontendUrl] of Object.entries(frontends)) {
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

  // A seeded CMS before the first spec, so no spec depends on another having
  // run. A no-op unless this run started Strapi.
  await seedJourneyStrapi();

  // Run block discovery if configured (before health checks — SKIP_VOLTO_CHECK
  // causes early return but discovery still needs to run for bridge tests)
  // Fixture mounts are authored for their own root: served under /_test_data
  // (the docs+fixtures job layout) their internal refs legitimately miss the
  // merged view. Default the integrity exemption here so every harness gets
  // it; a consuming repo can still override before setup runs.
  process.env.INTEGRITY_EXEMPT_PREFIXES ??= '/_test_data';
  // Pages that are test APPARATUS, not authored content, so the containment
  // check does not apply to them. Added to whatever the launcher gives.
  //
  // dnd-convert-page is the whole synthetic conversion graph: convSource and the
  // conv containers sit at page level because a drag source has to exist
  // somewhere to be dragged FROM, and they are `restricted` because you should
  // never be offered "convAlien" in a real block chooser. Both are correct, and
  // together they read as a containment violation — the page's allowed set is the
  // non-restricted types. Un-restricting them to satisfy this check breaks 28
  // tests: the option-counting those specs assert on ("one option -> auto-convert,
  // two -> chooser") flows from that same flag. The sidebar-convert page holds
  // the same toy blocks (sidebar-type-dropdown.spec.ts), so the same applies.
  process.env.CONTAINMENT_EXEMPT_PAGES = [process.env.CONTAINMENT_EXEMPT_PAGES, '/_test_data/dnd-convert-page', '/_test_data/sidebar-convert-page']
    .filter(Boolean)
    .join(',');
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

  // The built admin (the default): check the SSR server, and that it was built
  // from this checkout. ADMIN_DEV=1: the dev server's webpack health.
  // In dev mode, check webpack-dev-server health endpoint
  // Consumers running Volto on non-default ports (e.g. parallel test stacks)
  // can override with VOLTO_HEALTH_URL.
  await waitForAdmin();
}

export default globalSetup;
