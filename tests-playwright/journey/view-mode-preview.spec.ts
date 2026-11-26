import { test, expect } from '@playwright/test';
import { AdminUIHelper } from '../helpers/AdminUIHelper';
import { fixtureFor } from './fixtures';

/**
 * The preview in VIEW mode, on every CMS.
 *
 * In edit mode the admin hands the page to the frontend over the bridge, so a
 * frontend renders a WordPress or Drupal page without knowing anything about
 * WordPress or Drupal. View mode is different: the frontend fetches the page
 * itself, straight from its CMS, exactly as it does on the public site. The
 * adapter plays no part.
 *
 * So this is where a frontend that only knows how to read Plone falls over. It
 * went unnoticed because every journey that opens a view page only drives the
 * admin's own UI — the toolbar, the contents listing — and none looked inside
 * the preview.
 *
 * The draft is the other half. A published page needs no credential; a draft
 * does, and it has to be the FRONTEND's own credential for its CMS — the admin's
 * token is Plone-shaped and means nothing to WordPress or Drupal.
 */
test.describe('the preview in view mode', () => {
  test('shows a published page', async ({ page }, testInfo) => {
    const { published } = fixtureFor(testInfo.project.name);
    const helper = new AdminUIHelper(page);
    await helper.login();
    await page.goto(`${helper.adminUrl}${published.path}`);

    const preview = helper.getIframe();
    await expect(preview.locator('#page-title')).toHaveText(published.title, {
      timeout: 60_000,
    });
    await expect(
      preview.locator('[data-block-uid]').filter({ hasText: published.text }),
    ).toBeVisible();
  });

  test('shows a draft to a signed-in editor', async ({ page }, testInfo) => {
    const { draft } = fixtureFor(testInfo.project.name);
    const helper = new AdminUIHelper(page);
    await helper.login();
    await page.goto(`${helper.adminUrl}${draft.path}`);

    const preview = helper.getIframe();
    await expect(preview.locator('#page-title')).toHaveText(draft.title, {
      timeout: 60_000,
    });
  });
});
