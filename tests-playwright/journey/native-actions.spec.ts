import { test, expect } from '@playwright/test';
import { AdminUIHelper } from '../helpers/AdminUIHelper';
import { fixtureFor } from './fixtures';
import { seedFor } from './seedFor';

/**
 * Switching to the CMS to do something.
 *
 * A CMS already has a media library, a settings page and an edit form, and the
 * user is logged into them in their own browser. The adapter can therefore
 * hand the toolbar entries that leave Volto entirely rather than have every
 * screen reimplemented here.
 *
 * The assertion is the LINK, not the CMS page behind it. Following it lands on
 * whatever the CMS decides — its admin if the browser session is live, its
 * login if that session has expired independently of the stored credential,
 * which is correct behaviour and exactly the point of delegating. A test that
 * demanded the admin page would be asserting the state of a session it does
 * not control.
 */
test.beforeAll(async ({}, testInfo) => {
  await seedFor(testInfo);
});

test('the toolbar offers the CMS its own screens', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const { root: ROOT } = fixtureFor(testInfo.project.name);

  const helper = new AdminUIHelper(page);
  await helper.login();
  await page.goto(`${helper.adminUrl}${ROOT}`);

  const button = page.locator('#toolbar-native-actions');
  const declared = await button
    .waitFor({ state: 'visible', timeout: 30_000 })
    .then(() => true)
    .catch(() => false);

  // An adapter that declares none is a passing case, not a skipped one: the
  // feature is optional, and asserting nothing about Plone or Drupal here is
  // the honest outcome rather than a test that pretends to have run.
  // Say which path ran: a test that can pass by asserting nothing should be
  // audible about having done so.
  // eslint-disable-next-line no-console
  console.log(`[native-actions] toolbar button present: ${declared}`);

  if (!declared) {
    expect(
      await page.locator('.native-action').count(),
      'no button, so no entries either',
    ).toBe(0);
    return;
  }

  await button.click();

  const entries = page.locator('.native-action');
  await expect(entries.first()).toBeVisible({ timeout: 15_000 });
  // eslint-disable-next-line no-console
  console.log(`[native-actions] entries: ${await entries.count()}`);

  // Every entry leaves the admin for the CMS. A link back to the admin's own
  // origin is not a weaker version of this feature, it is a dead end the user
  // only discovers by clicking.
  const adminOrigin = new URL(helper.adminUrl).origin;
  for (const href of await entries.evaluateAll((links) =>
    links.map((l) => (l as HTMLAnchorElement).href),
  )) {
    expect(href).toMatch(/^https?:\/\//);
    expect(new URL(href).origin).not.toBe(adminOrigin);
  }

  // Opening the CMS carries the user's own session, so the opened page must
  // not be able to reach back through window.opener and navigate the admin.
  for (const rel of await entries.evaluateAll((links) =>
    links.map((l) => l.getAttribute('rel') ?? ''),
  )) {
    expect(rel).toContain('noopener');
  }
});
