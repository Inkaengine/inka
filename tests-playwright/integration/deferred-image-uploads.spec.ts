/**
 * Images held until the page is saved, for a front end that sets
 * `deferImageUploads` (the test frontend and the Nuxt starter's test build do
 * on /deferred-images-page; the Nuxt starter's edit build does everywhere).
 *
 * An image dropped in the editor is not uploaded: the canvas shows it at once,
 * from a blob: URL of the file the bridge sends once, while the page JSON
 * carries only a short reference. Save uploads it and saves the page naming the uploaded
 * image; a failed upload refuses the save; Cancel leaves nothing on the site.
 */
import type { Page, Request } from '@playwright/test';
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

// A 1x1 red PNG.
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408d763f8ffff3f0005fe02fe0000000049454e44ae426082',
  'hex',
);

/** Every image upload the admin makes (a POST creating an Image). */
function imageUploads(page: Page): Request[] {
  const uploads: Request[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.postDataJSON?.()?.['@type'] === 'Image') uploads.push(request);
  });
  return uploads;
}

/** Every page save the admin makes (the PATCH of the page). */
function pageSaves(page: Page): Request[] {
  const saves: Request[] = [];
  page.on('request', (request) => {
    if (request.method() === 'PATCH' && /deferred-images-page\/?$/.test(new URL(request.url()).pathname)) saves.push(request);
  });
  return saves;
}

const IMAGE = '[data-block-uid="image"] [data-edit-media="url"]';

/** Clear the image block's image on the canvas and drop `name` into its empty overlay. */
async function dropImage(helper: AdminUIHelper, page: Page, name: string) {
  const iframe = helper.getIframe();
  const block = iframe.locator('[data-block-uid="image"]');
  await block.scrollIntoViewIfNeeded();
  await block.click();
  await page.locator('button[title="Clear image"]').click();
  await helper.revealOptionalFields();
  const overlay = page.locator('.empty-image-overlay');
  await expect(overlay).toBeVisible();
  await overlay.locator('input[type="file"][accept="image/*"]').first().setInputFiles({ name, mimeType: 'image/png', buffer: PNG });
  return iframe.locator(IMAGE);
}

test.describe('Images held until save', () => {
  test('the canvas shows a dropped image at once, and Save uploads it', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const uploads = imageUploads(page);
    const saves = pageSaves(page);
    await helper.login();
    await helper.navigateToEdit('/deferred-images-page');

    const image = await dropImage(helper, page, 'held.png');
    await expect(image).toHaveAttribute('src', /^blob:/);
    // Drawn, not just pointed at: the picture decodes on the canvas.
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
    expect(uploads, 'nothing is uploaded before Save').toHaveLength(0);

    await helper.saveContent();
    expect(uploads).toHaveLength(1);
    expect(uploads[0].postDataJSON().image.filename).toBe('held.png');
    const saved = JSON.stringify(saves.at(-1)!.postDataJSON());
    expect(saved, 'the page names the uploaded image').toMatch(/uploaded-image-\d+/);
    expect(saved, 'and no reference is left in it').not.toContain('inka-pending:');
    // The image is its own Image item; the page holds only a link to it.
    expect(saved, 'and no picture data is saved in the page').not.toMatch(/data:image|blob:|base64/);
    // Saved: the page as the site now has it. Read from the API, signed in:
    // the mock keeps a save per session, which a front end's own reads (and an
    // <img> request) do not carry.
    const stored = await page.request.get(saves.at(-1)!.url(), {
      headers: { Authorization: `Bearer ${helper.authToken}` },
    });
    const storedImage = JSON.stringify((await stored.json()).blocks.image);
    expect(storedImage).toMatch(/uploaded-image-\d+/);
    expect(storedImage).toContain('"image_scales"');
    expect(storedImage).not.toContain('inka-pending:');
  });

  test('the page sent on each edit carries the reference, not the picture', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/deferred-images-page');
    // Each FORM_DATA as the canvas receives it.
    const canvas = helper.getIframe().locator('body');
    await canvas.evaluate(() => {
      (window as any).__formData = [];
      window.addEventListener('message', (e) => {
        if (e.data?.type === 'FORM_DATA') (window as any).__formData.push(JSON.stringify(e.data.data));
      });
    });

    const image = await dropImage(helper, page, 'held.png');
    await expect(image).toHaveAttribute('src', /^blob:/);
    const sent: string[] = await canvas.evaluate(() => (window as any).__formData);
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.filter((data) => /data:image|blob:/.test(data)), 'no FORM_DATA carries the picture').toEqual([]);
    expect(sent.at(-1)).toMatch(/"inka-pending:[^"]+"/);
  });

  test('a held image is listed in the picker where it will be uploaded, and can be picked again', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const uploads = imageUploads(page);
    await helper.login();
    await helper.navigateToEdit('/deferred-images-page');

    const image = await dropImage(helper, page, 'held.png');
    await expect(image).toHaveAttribute('src', /^blob:/);
    await page.locator('button[title="Clear image"]').click();
    await expect(image).not.toHaveAttribute('src', /^blob:/);

    // The page is a folder, so its images go into it: the picker opens there.
    const overlay = page.locator('.empty-image-overlay');
    await expect(overlay).toBeVisible();
    await overlay.locator('button[aria-label="Open object browser"]').click();
    const objectBrowser = await helper.waitForObjectBrowser();
    // Listed with the page's own children, once they have loaded, and on
    // screen: the browser slides in, and a click mid-slide lands off-screen.
    const held = page.locator('.object-listing li').filter({ hasText: /held\.png/ });
    await expect(held).toBeVisible({ timeout: 10000 });
    await expect(held).toBeInViewport();
    await helper.objectBrowserSelectItem(objectBrowser, /held\.png/);
    await helper.submitAddLinkFormIfOpen(overlay);

    await expect(image).toHaveAttribute('src', /^blob:/);
    expect(uploads, 'still nothing uploaded').toHaveLength(0);
  });

  test('a folder that takes no images refuses one when it is dropped, not on Save', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const uploads = imageUploads(page);
    await helper.login();
    await helper.navigateToEdit('/deferred-images-page/pages-only');

    const image = await dropImage(helper, page, 'held.png');
    await expect(page.locator('.Toastify__toast--error')).toContainText(
      'You can’t add images to /_test_data/deferred-images-page/pages-only, so this one can’t be saved there.',
    );
    await expect(image).not.toHaveAttribute('src', /^blob:/);
    expect(uploads).toHaveLength(0);
  });

  test('a failed upload refuses the save, and the page is not saved', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const saves = pageSaves(page);
    await helper.login();
    await helper.navigateToEdit('/deferred-images-page');

    const image = await dropImage(helper, page, 'trigger-error.png');
    // Held once the folder is known to take images: then the page can be saved.
    await expect(image).toHaveAttribute('src', /^blob:/);
    await page.locator('#toolbar-save').click();
    await expect(page.locator('.Toastify__toast--error')).toContainText('trigger-error.png could not be uploaded, so the page was not saved');
    await expect(page).toHaveURL(/\/edit$/);
    expect(saves).toHaveLength(0);
  });

  test('Cancel leaves nothing on the site', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const uploads = imageUploads(page);
    await helper.login();
    await helper.navigateToEdit('/deferred-images-page');

    const image = await dropImage(helper, page, 'held.png');
    await expect(image).toHaveAttribute('src', /^blob:/);
    await page.locator('#toolbar button.cancel').click();
    await page.waitForURL((url) => !url.pathname.endsWith('/edit'));
    expect(uploads).toHaveLength(0);
  });
});
