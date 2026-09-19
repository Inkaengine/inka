import { test as setup, expect } from '@playwright/test';
import { AdminUIHelper } from '../helpers/AdminUIHelper';
import { fixtureFor } from './fixtures';
import { seedFor } from './seedFor';
import { auditCmsRequests, signIn } from './steps';

/**
 * Sign in ONCE per run and save the session for every spec that follows.
 *
 * Signing in inside each spec cost about fifty seconds apiece against
 * WordPress — the login page, the consent page, and the reload after them —
 * which is most of why a "focused" test took four minutes. A focused test
 * should reach its subject in seconds; the login is setup, and setup belongs
 * in a fixture.
 *
 * The credential lives in the PROXY frame's origin storage, so what is saved
 * here is that origin's localStorage, not a cookie. Later specs load it and
 * the proxy comes up already authenticated — the sign-in panel never appears.
 */
// Generated every run (the setup project always runs first), so git-ignored
// with the other generated storage states — a committed copy was rewritten by
// every local run.
const STATE = 'tests-playwright/.generated/storage-authed-wordpress.json';

setup('sign in to WordPress once', async ({ page }, testInfo) => {
  setup.setTimeout(300_000);
  await seedFor(testInfo);

  const { root: ROOT } = fixtureFor(testInfo.project.name);
  const helper = new AdminUIHelper(page);
  await auditCmsRequests(page);
  await helper.login();

  await page.goto(`${helper.adminUrl}${ROOT}/contents`);
  await signIn(page);

  // Prove it took before saving: storing an unauthenticated state would make
  // every later spec fail somewhere far from here.
  await expect
    .poll(() => page.locator('tbody tr').count(), { timeout: 120_000 })
    .toBeGreaterThan(0);

  await page.context().storageState({ path: STATE });
});
