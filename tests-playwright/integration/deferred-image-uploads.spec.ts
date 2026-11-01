/**
 * Images held until the page is saved, for a front end that sets
 * `deferImageUploads` (the test frontend does on /deferred-images-page).
 *
 * An image dropped in the editor is not uploaded: the canvas shows it at once,
 * from a data: URL the bridge sends once, while the page JSON carries only a
 * short reference. Save uploads it and saves the page naming the uploaded
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

/** Clear the hero's image on the canvas and drop `name` into its empty overlay. */
async function dropImage(helper: AdminUIHelper, page: Page, name: string) {
  const iframe = helper.getIframe();
  const hero = iframe.locator('[data-block-uid="hero"]');
  await hero.scrollIntoViewIfNeeded();
  await hero.click();
  await page.locator('button[title="Clear image"]').click();
  await helper.revealOptionalFields();
  const overlay = page.locator('.empty-image-overlay');
  await expect(overlay).toBeVisible();
  await overlay.locator('input[type="file"][accept="image/*"]').first().setInputFiles({ name, mimeType: 'image/png', buffer: PNG });
  return iframe.locator('[data-block-uid="hero"] [data-edit-media="image"]');
}

test.describe('Images held until save', () => {
  test('the canvas shows a dropped image at once, and Save uploads it', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const uploads = imageUploads(page);
    const saves = pageSaves(page);
    await helper.login();
    await helper.navigateToEdit('/deferred-images-page');

    const heroImage = await dropImage(helper, page, 'held.png');
    await expect(heroImage).toHaveAttribute('src', /^data:image\/png;base64,/);
    // Drawn, not just pointed at: the picture decodes on the canvas.
    await expect.poll(() => heroImage.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
    expect(uploads, 'nothing is uploaded before Save').toHaveLength(0);

    await helper.saveContent();
    expect(uploads).toHaveLength(1);
    expect(uploads[0].postDataJSON().image.filename).toBe('held.png');
    const saved = JSON.stringify(saves.at(-1)!.postDataJSON());
    expect(saved, 'the page names the uploaded image').toMatch(/uploaded-image-\d+/);
    expect(saved, 'and no reference is left in it').not.toContain('inka-pending:');
    // The saved page, rendered (view mode draws no block uids). The mock keeps
    // an upload's bytes per signed-in session, which an <img> request does not
    // carry, so this checks where it points, as the drop-time upload specs do.
    await expect(helper.getIframe().locator('.hero-block img')).toHaveAttribute('src', /uploaded-image-\d+/);
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

    const heroImage = await dropImage(helper, page, 'held.png');
    await expect(heroImage).toHaveAttribute('src', /^data:image\/png;base64,/);
    // One more edit after the drop, as typing would send.
    await helper.getIframe().locator('[data-block-uid="hero"] [data-edit-text="heading"]').click();
    await page.keyboard.type('!');

    const sent: string[] = await canvas.evaluate(() => (window as any).__formData);
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.filter((data) => data.includes('data:image/png')), 'no FORM_DATA carries the picture').toEqual([]);
    expect(sent.at(-1)).toMatch(/"inka-pending:[^"]+"/);
  });

  test('a held image is listed in the picker where it will be uploaded, and can be picked again', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const uploads = imageUploads(page);
    await helper.login();
    await helper.navigateToEdit('/deferred-images-page');

    const heroImage = await dropImage(helper, page, 'held.png');
    await expect(heroImage).toHaveAttribute('src', /^data:image\/png;base64,/);
    // Cleared; the field stays revealed from the drop, so its empty overlay shows.
    await page.locator('button[title="Clear image"]').click();
    await expect(heroImage).not.toHaveAttribute('src', /^data:image\/png/);

    // The page is a folder, so its images go into it: the picker opens there.
    const overlay = page.locator('.empty-image-overlay');
    await expect(overlay).toBeVisible();
    await overlay.locator('button[aria-label="Open object browser"]').click();
    const objectBrowser = await helper.waitForObjectBrowser();
    await helper.objectBrowserSelectItem(objectBrowser, /held\.png/);
    await helper.submitAddLinkFormIfOpen(overlay);

    await expect(heroImage).toHaveAttribute('src', /^data:image\/png;base64,/);
    expect(uploads, 'still nothing uploaded').toHaveLength(0);
  });

  test('a failed upload refuses the save, and the page is not saved', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const saves = pageSaves(page);
    await helper.login();
    await helper.navigateToEdit('/deferred-images-page');

    await dropImage(helper, page, 'trigger-error.png');
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

    await dropImage(helper, page, 'held.png');
    await page.locator('#toolbar button.cancel').click();
    await page.waitForURL((url) => !url.pathname.endsWith('/edit'));
    expect(uploads).toHaveLength(0);
  });
});
