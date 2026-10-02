import type { TestInfo } from '@playwright/test';
import { seedWordPress } from './seedWordPress';

/**
 * Put the CMS into its known state before a spec runs.
 *
 * Only WordPress needs it: the Plone mock serves the repo's own content tree
 * and the Drupal mock builds the canonical set per session, while real
 * WordPress boots empty. Seeding it is dozens of writes at ~1.1s each on
 * PHP-WASM, comfortably past the suite's 45s default, which applies to hooks
 * too — hence the explicit budget.
 */
export async function seedFor(testInfo: TestInfo): Promise<void> {
  // Also the setup project, which seeds before signing in.
  if (!testInfo.project.name.startsWith('journey-wordpress')) return;
  testInfo.setTimeout(240_000);
  const t0 = Date.now(); // TEMP TIMING
  await seedWordPress();
  // eslint-disable-next-line no-console
  console.log('[TIME] seed', Date.now() - t0, 'ms');
}
