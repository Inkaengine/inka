/**
 * The ports of Inka's own test servers: the harness's block
 * (`@inka/testing/ports`, which explains the rules) plus the example and
 * doc-example frontends this repo's suites run against.
 *
 * Every test, helper, and playwright config should import from here
 * instead of hard-coding `localhost:NNNN`.
 *
 * Callers say which ports they mean:
 *   - in this repo: the CI workflow and package.json scripts set them
 *     (`scripts/with-ports.mjs`)
 *   - from a consuming repo: its make target exports its own block
 *
 * Keep the keys here aligned with package.json's start:* scripts and
 * the build job's "Start servers" step in .github/workflows/test.yaml.
 */
import { definePorts } from '@inka/testing/ports';

export const { PORTS, URLS, PORT_ENV, allPorts } = definePorts({
  /** Nuxt example frontend (`pnpm start:nuxt:test`). */
  nuxt: 5,
  /** Doc-example: React (`pnpm start:react:test`). */
  reactDoc: 6,
  /** Doc-example: Svelte (`pnpm start:svelte:test`). */
  svelteDoc: 7,
  /** Doc-example: Vue (no dedicated start script; see docs/examples/test-vue). */
  vueDoc: 8,
  /** Next.js example frontend. */
  nextjs: 9,
  /** Vue F7 example frontend (hash-routed). */
  f7: 10,
  /** Doc-example: Astro (SSR, Node adapter). */
  astroDoc: 11,
  /** Quick Start: vanilla HTML/JS starter (docs/quickstart/vanilla). */
  vanillaDoc: 12,
  /** Quick Start: dedicated Svelte 5 starter (docs/quickstart/svelte). */
  svelteQs: 13,
  /** Quick Start: dedicated Astro starter (docs/quickstart/astro). */
  astroQs: 14,
});

export type PortName = keyof typeof PORTS;
