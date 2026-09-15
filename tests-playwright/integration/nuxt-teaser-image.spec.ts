/**
 * Teaser image rendering (Nuxt frontend).
 *
 * A teaser stores a summary of its target in href[0]. Real Plone can serialize
 * hasPreviewImage:true for a target that has no actual image — the flag is set
 * but there is no deliverable image, so image_scales is absent. The teaser must
 * trust image_scales (the real signal), NOT hasPreviewImage: emitting an <img>
 * for the nonexistent preview_image 404s and fails the strict SSG prerender.
 *
 * Fixture (teaser-image-test-page):
 *   - teaser-noimg   → target with hasPreviewImage:true and NO image_scales
 *   - teaser-withimg → target with image_scales present
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

test.use({
  storageState: 'tests-playwright/.generated/storage-nuxt.json',
});

test.describe('Teaser image rendering', () => {
  test('teaser to an imageless target renders no broken image', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const iframe = helper.getIframe();

    await helper.login();
    await helper.navigateToEdit('/teaser-image-test-page');
    await helper.waitForIframeReady();

    const noImg = iframe.locator('[data-block-uid="teaser-noimg"]');
    await expect(noImg).toBeVisible({ timeout: 10000 });

    // No image_scales → no deliverable image → the teaser must not emit an <img>
    // (it renders the placeholder instead). An <img> here would request the
    // nonexistent /@@images/preview_image and 404 the prerender.
    await expect(noImg.locator('img')).toHaveCount(0);
  });

  test('teaser to a target with an image still renders the image', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const iframe = helper.getIframe();

    await helper.login();
    await helper.navigateToEdit('/teaser-image-test-page');
    await helper.waitForIframeReady();

    const withImg = iframe.locator('[data-block-uid="teaser-withimg"]');
    await expect(withImg).toBeVisible({ timeout: 10000 });

    // image_scales present → the teaser renders the target's image.
    await expect(withImg.locator('img')).toHaveCount(1);
  });
});
