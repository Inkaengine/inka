/**
 * Auto-discovered page integrity tests, from @inka/testing.
 */
import { definePageIntegrityTests } from '@inka/testing/playwright/sanity';
import { DISCOVERY_DIR, FRONTEND_URLS } from '../frontends';

definePageIntegrityTests({
  discoveryDir: DISCOVERY_DIR,
  frontends: FRONTEND_URLS,
});
