/**
 * Auto-discovered "empty container region" sanity tests, from @inka/testing.
 *
 * Run with:
 *   DISCOVER_BLOCKS_API=<mock-api-url> pnpm exec playwright test empty-region-sanity
 *
 * Synthetic conversion-test containers (dnd-convert.spec.ts) are rendered only
 * by the mock frontend, so they aren't part of the cross-frontend empty-region
 * contract — excluded, the same as block-sanity.
 */
import { defineEmptyRegionTests } from '@inka/testing/playwright/sanity';
import { CONTRACT_SCOPE, DISCOVERY_DIR, FRONTEND_URLS, SANITY_PROJECTS } from '../frontends';

defineEmptyRegionTests({
  excludeTypePrefixes: CONTRACT_SCOPE.excludeTypePrefixes,
  discoveryDir: DISCOVERY_DIR,
  frontends: FRONTEND_URLS,
  projects: SANITY_PROJECTS,
});
