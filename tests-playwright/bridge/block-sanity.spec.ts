/**
 * Auto-discovered block sanity tests, from @inka/testing.
 *
 * Run with:
 *   DISCOVER_BLOCKS_API=<mock-api-url> pnpm exec playwright test block-sanity
 *
 * Block sanity is the cross-cutting render contract. We only enforce it on
 * the three frontends that ship full block coverage and are the canonical
 * references for downstream consumers — the mock test frontend (the spec's
 * own ground truth), Nuxt, and Next.js. Other example frontends (react,
 * svelte, vue, f7) intentionally skip block-sanity so missing block types or
 * in-flight renderer changes don't gate the suite.
 *
 * Cases discovered through the mock test frontend run on every project.
 */
import { defineBlockSanityTests } from '@inka/testing/playwright/sanity';
import { CONTRACT_SCOPE, DISCOVERY_DIR, FRONTEND_URLS, SANITY_PROJECTS } from '../frontends';

defineBlockSanityTests({
  ...CONTRACT_SCOPE,
  discoveryDir: DISCOVERY_DIR,
  frontends: FRONTEND_URLS,
  projects: SANITY_PROJECTS,
  sharedSources: ['(env)', 'mock'],
  // Some doc pages deliberately render MULTIPLE instances of a layout-chrome
  // component (header/masthead/main-nav) as structural-parity examples. See
  // the axe pass in block-sanity.
  axeSkipPages: ['/components/header'],
});
