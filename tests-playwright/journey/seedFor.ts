import type { TestInfo } from '@playwright/test';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedWordPress } from './seedWordPress';
import { seedStrapi } from '../../tests-adapters/fixtures/seed-strapi';
import { URLS } from '../ports';

/**
 * The journey Strapi's own token file.
 *
 * Its own, because the journey runs a second instance of the same app — see
 * HYDRA_TOKEN_FILE in playwright.config.ts — and two instances writing one
 * token file would each revoke the other's credential on boot.
 */
// ESM, so __dirname has to be derived — the same two lines global-setup.ts has.
const HERE = path.dirname(fileURLToPath(import.meta.url));

const STRAPI_TOKEN = path.resolve(
  HERE,
  '../../tests-adapters/fixtures/strapi-app/app/.hydra-journey-token',
);

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
  if (testInfo.project.name === 'journey-strapi') {
    // The same seeder the contract target uses, so the two suites cannot
    // disagree about what the fixture IS — the drift seedWordPress and the
    // WordPress blueprint have to be kept out of by hand.
    testInfo.setTimeout(120_000);
    await seedStrapi({
      baseUrl: URLS.strapi,
      token: readFileSync(STRAPI_TOKEN, 'utf8').trim(),
    });
    return;
  }
  // Also the setup project, which seeds before signing in.
  if (!testInfo.project.name.startsWith('journey-wordpress')) return;
  testInfo.setTimeout(240_000);
  const t0 = Date.now(); // TEMP TIMING
  await seedWordPress();
  // eslint-disable-next-line no-console
  console.log('[TIME] seed', Date.now() - t0, 'ms');
}
