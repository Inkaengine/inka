/**
 * Slider background image URL form (Nuxt frontend).
 *
 * A Plone Image content item has an id ending in a file extension (e.g.
 * /images/penguin1.jpg). Its bytes are served at BOTH the bare id and at
 * `<id>/@@images/image`. When one component renders it bare (a slider slide
 * background) and another renders it via Plone image_scales
 * (`<id>/@@images/image-1800.jpeg`), the SSG writes `penguin1.jpg` as both a
 * FILE and a DIRECTORY → ENOTDIR, dropping the image. The frontend must render
 * a Plone Image reference through the `@@images/image` (directory) form
 * everywhere so the two never collide.
 *
 * Fixture (slider-image-test-page): a slider slide whose preview_image is a
 * bare Plone Image ref (@type "Image", id ending in .jpg, no image_scales).
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

test.use({
  storageState: 'tests-playwright/.generated/storage-nuxt.json',
});

test.describe('Slider image URL form', () => {
  test('slide background of a Plone Image (.jpg) uses the @@images/image form', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);
    const iframe = helper.getIframe();

    await helper.login();
    await helper.navigateToEdit('/slider-image-test-page');
    await helper.waitForIframeReady();

    const slide = iframe.locator('[data-block-uid="slider-img-1"] .slide').first();
    await expect(slide).toBeAttached({ timeout: 10000 });

    const style = (await slide.getAttribute('style')) || '';
    // The background must reference penguin1.jpg via /@@images/image (directory
    // form), not the bare filename (which the SSG writes as a file and then
    // collides with the scale form's directory).
    expect(style).toContain('penguin1.jpg/@@images/image');
  });
});
