/**
 * Central source of truth for test infrastructure ports.
 *
 * Every test, helper, and playwright config should import from here
 * instead of hard-coding `localhost:NNNN`.
 *
 * THERE ARE NO DEFAULTS. Every port must be given as HYDRA_<NAME>_PORT, and a
 * missing one is a hard failure rather than a quiet fall back to 8888/3001.
 *
 * The defaults were the problem. A checkout that ran playwright directly bound
 * the historical numbers, which are shared with every other hydra checkout on
 * the machine — so one run would take over, or quietly talk to, another
 * project's servers. Nothing in the output said so; the ports simply worked
 * until the day they belonged to someone else.
 *
 * Callers therefore say which ports they mean:
 *   - from a consuming repo: its make target exports its own block
 *     (`make hydra-test ARGS="<spec> --project=admin-mock"`)
 *   - in this repo: the CI workflow and package.json scripts set them
 *
 *
 * Keep the keys here aligned with package.json's start:* scripts and
 * the build job's "Start servers" step in .github/workflows/test.yaml.
 *
 * Not in scope: URLs embedded as DATA inside fixture JSON
 * (tests-playwright/fixtures/content/*\/data.json) — those are
 * historical site URLs in saved content, not infrastructure config.
 */

const port = (envName: string): number => {
  const v = process.env[envName];
  if (!v) {
    throw new Error(
      `${envName} is not set. Test ports have no defaults — binding hydra's ` +
        `historical numbers is what lets one checkout take over another's ` +
        `servers.\n` +
        `  From a consuming repo:  make hydra-test ARGS="<spec> --project=admin-mock"\n` +
        `  In this repo:           the package.json scripts and CI set them`,
    );
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid ${envName}: ${v} (must be a positive integer)`);
  }
  return n;
};

export const PORTS = {
  /** Mock Plone REST API (started by `pnpm start:mock-api`). */
  mockApi: port('HYDRA_MOCK_API_PORT'),
  /** Test frontend: HTML + bridge fixture served by Vite (`pnpm start:test-frontend`). */
  testFrontend: port('HYDRA_TEST_FRONTEND_PORT'),
  /** Mock-parent test surface for bridge isolation tests. */
  mockParent: port('HYDRA_MOCK_PARENT_PORT'),
  /** Volto admin SSR server (`pnpm start:test`, PORT). */
  voltoSsr: port('HYDRA_VOLTO_SSR_PORT'),
  /** Razzle webpack-dev-server (auto-incremented from voltoSsr). */
  voltoWebpack: port('HYDRA_VOLTO_WEBPACK_PORT'),
  /** Nuxt example frontend (`pnpm start:nuxt:test`). */
  nuxt: port('HYDRA_NUXT_PORT'),
  /** Doc-example: React (`pnpm start:react:test`). */
  reactDoc: port('HYDRA_REACT_DOC_PORT'),
  /** Doc-example: Svelte (`pnpm start:svelte:test`). */
  svelteDoc: port('HYDRA_SVELTE_DOC_PORT'),
  /** Doc-example: Vue (no dedicated start script; see docs/examples/test-vue). */
  vueDoc: port('HYDRA_VUE_DOC_PORT'),
  /** Next.js example frontend. */
  nextjs: port('HYDRA_NEXTJS_PORT'),
  /** Vue F7 example frontend (hash-routed). */
  f7: port('HYDRA_F7_PORT'),
  /** Doc-example: Astro (SSR, Node adapter). */
  astroDoc: port('HYDRA_ASTRO_DOC_PORT'),
  /** Quick Start: vanilla HTML/JS starter (docs/quickstart/vanilla). */
  vanillaDoc: port('HYDRA_VANILLA_DOC_PORT'),
} as const;

/**
 * Pre-built `http://localhost:N` strings for the common ports. Use these
 * instead of building URLs ad-hoc to keep the call sites short.
 *
 * Named `URLS` (plural) so it doesn't shadow the global `URL` constructor
 * in any file that does `import { URLS } from '../ports'` and also calls
 * `new URL(...)` (e.g. navigation.spec.ts parsing iframe `src` origins).
 */
export const URLS = {
  mockApi: `http://localhost:${PORTS.mockApi}`,
  testFrontend: `http://localhost:${PORTS.testFrontend}`,
  mockParent: `http://localhost:${PORTS.mockParent}`,
  voltoSsr: `http://localhost:${PORTS.voltoSsr}`,
  voltoWebpack: `http://localhost:${PORTS.voltoWebpack}`,
  nuxt: `http://localhost:${PORTS.nuxt}`,
  reactDoc: `http://localhost:${PORTS.reactDoc}`,
  svelteDoc: `http://localhost:${PORTS.svelteDoc}`,
  vueDoc: `http://localhost:${PORTS.vueDoc}`,
  nextjs: `http://localhost:${PORTS.nextjs}`,
  f7: `http://localhost:${PORTS.f7}`,
  astroDoc: `http://localhost:${PORTS.astroDoc}`,
  vanillaDoc: `http://localhost:${PORTS.vanillaDoc}`,
} as const;
