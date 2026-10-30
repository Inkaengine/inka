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

/**
 * ONE number names the whole block: HYDRA_PORT_BASE.
 *
 * Removing the defaults fixed the collisions and left a different problem —
 * nineteen variables that every launcher had to set, and so nineteen chances
 * to set one of them differently. The package.json scripts, three CI jobs and
 * a consuming repo's Makefile each carried their own copy of the list, which
 * is how a checkout ends up with its mock API on one block and its frontends
 * on another, or with a suite talking to a server that another checkout
 * started.
 *
 * So a run says where its block starts, once, and every port is that plus a
 * fixed offset. `HYDRA_PORT_BASE=8980` is the whole configuration.
 *
 * A single port may still be given explicitly, and then it wins. That is for
 * pointing one service at something already running — a seeded Plone kept up
 * between runs — not for configuring a suite; and it is what keeps a consuming
 * repo that still exports the whole list working unchanged.
 *
 * There is still no default. A port with neither a base nor a value of its own
 * is a hard failure, because the historical numbers are shared with every
 * other hydra checkout on this machine.
 */
const BASE = 'HYDRA_PORT_BASE';

const integer = (envName: string, raw: string): number => {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`Invalid ${envName}: ${raw} (must be a positive integer)`);
  }
  return n;
};

/**
 * Offsets within the block. The NAMES are the contract; these numbers only
 * have to be distinct and stable.
 *
 * `voltoWebpack` must stay one above `voltoSsr`: razzle derives its
 * webpack-dev-server port by incrementing PORT, so that pair is adjacent
 * whether we like it or not. A test below holds it there.
 */
const OFFSET = {
  mockApi: 0,
  testFrontend: 1,
  mockParent: 2,
  voltoSsr: 3,
  voltoWebpack: 4,
  nuxt: 5,
  reactDoc: 6,
  svelteDoc: 7,
  vueDoc: 8,
  nextjs: 9,
  f7: 14,
  astroDoc: 10,
  vanillaDoc: 11,
  svelteQs: 12,
  astroQs: 13,
} as const;

export type PortName = keyof typeof OFFSET;

/** Every variable this module reads, so a launcher can export the whole block. */
export const PORT_ENV: Readonly<Record<PortName, string>> = {
  mockApi: 'HYDRA_MOCK_API_PORT',
  testFrontend: 'HYDRA_TEST_FRONTEND_PORT',
  mockParent: 'HYDRA_MOCK_PARENT_PORT',
  voltoSsr: 'HYDRA_VOLTO_SSR_PORT',
  voltoWebpack: 'HYDRA_VOLTO_WEBPACK_PORT',
  nuxt: 'HYDRA_NUXT_PORT',
  reactDoc: 'HYDRA_REACT_DOC_PORT',
  svelteDoc: 'HYDRA_SVELTE_DOC_PORT',
  vueDoc: 'HYDRA_VUE_DOC_PORT',
  nextjs: 'HYDRA_NEXTJS_PORT',
  f7: 'HYDRA_F7_PORT',
  astroDoc: 'HYDRA_ASTRO_DOC_PORT',
  vanillaDoc: 'HYDRA_VANILLA_DOC_PORT',
  svelteQs: 'HYDRA_SVELTE_QS_PORT',
  astroQs: 'HYDRA_ASTRO_QS_PORT',
} as const;

const port = (which: PortName): number => {
  const envName = PORT_ENV[which];
  const explicit = process.env[envName];
  if (explicit) return integer(envName, explicit);

  const base = process.env[BASE];
  if (!base) {
    throw new Error(
      `Neither ${BASE} nor ${envName} is set. Test ports have no defaults — ` +
        `binding hydra's historical numbers is what lets one checkout take ` +
        `over another's servers.\n` +
        `  Set the block once:     ${BASE}=8980\n` +
        `  From a consuming repo:  make hydra-test ARGS="<spec> --project=admin-mock"\n` +
        `  One service elsewhere:  ${envName}=<port> overrides just that one`,
    );
  }
  return integer(BASE, base) + OFFSET[which];
};

/** Every port in the block, by name. Used by launchers to export the lot. */
export const allPorts = (): Record<PortName, number> =>
  Object.fromEntries(
    (Object.keys(OFFSET) as PortName[]).map((name) => [name, port(name)]),
  ) as Record<PortName, number>;

export const PORTS = {
  /** Mock Plone REST API (started by `pnpm start:mock-api`). */
  mockApi: port('mockApi'),
  /** Test frontend: HTML + bridge fixture served by Vite (`pnpm start:test-frontend`). */
  testFrontend: port('testFrontend'),
  /** Mock-parent test surface for bridge isolation tests. */
  mockParent: port('mockParent'),
  /** Volto admin SSR server (`pnpm start:test`, PORT). */
  voltoSsr: port('voltoSsr'),
  /** Razzle webpack-dev-server (auto-incremented from voltoSsr). */
  voltoWebpack: port('voltoWebpack'),
  /** Nuxt example frontend (`pnpm start:nuxt:test`). */
  nuxt: port('nuxt'),
  /** Doc-example: React (`pnpm start:react:test`). */
  reactDoc: port('reactDoc'),
  /** Doc-example: Svelte (`pnpm start:svelte:test`). */
  svelteDoc: port('svelteDoc'),
  /** Doc-example: Vue (no dedicated start script; see docs/examples/test-vue). */
  vueDoc: port('vueDoc'),
  /** Next.js example frontend. */
  nextjs: port('nextjs'),
  /** Vue F7 example frontend (hash-routed). */
  f7: port('f7'),
  /** Doc-example: Astro (SSR, Node adapter). */
  astroDoc: port('astroDoc'),
  /** Quick Start: vanilla HTML/JS starter (docs/quickstart/vanilla). */
  vanillaDoc: port('vanillaDoc'),
  /** Quick Start: dedicated Svelte 5 starter (docs/quickstart/svelte). */
  svelteQs: port('svelteQs'),
  /** Quick Start: dedicated Astro starter (docs/quickstart/astro). */
  astroQs: port('astroQs'),
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
  // 127.0.0.1, not localhost.
  //
  // WordPress refuses `localhost` as an application-password success_url — its
  // SSRF guard rejects the host, and authorize-application.php 500s rather than
  // declining cleanly. The sign-in flow redirects back to this origin, so the
  // frontend has to be addressed as something the CMS will accept. The CMS
  // mocks already use 127.0.0.1, so this is also the more consistent choice.
  testFrontend: `http://127.0.0.1:${PORTS.testFrontend}`,
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
  svelteQs: `http://localhost:${PORTS.svelteQs}`,
  astroQs: `http://localhost:${PORTS.astroQs}`,
} as const;
