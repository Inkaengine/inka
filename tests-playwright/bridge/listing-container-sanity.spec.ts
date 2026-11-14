/**
 * A listing and the container holding it have to agree, from @inka/testing.
 *
 * Synthetic conversion-test containers (dnd-convert.spec.ts) are rendered only
 * by the mock frontend, so they are not part of the cross-frontend contract —
 * the same exclusion empty-region sanity makes, for the same reason.
 */
import { defineListingContainerTests } from '@inka/testing/playwright/sanity';
import { CONTRACT_SCOPE, DISCOVERY_DIR, SANITY_PROJECTS } from '../frontends';

defineListingContainerTests({
  excludeTypePrefixes: CONTRACT_SCOPE.excludeTypePrefixes,
  discoveryDir: DISCOVERY_DIR,
  projects: SANITY_PROJECTS,
});
