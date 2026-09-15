/**
 * Tests for Nuxt content-type rendering and inline editing.
 *
 * Verifies that content-type-specific blocks render their page-level metadata
 * fields and expose them for inline editing via data-edit-text / data-edit-media.
 *
 * Event test page (/_test_data/event-test-page):
 *   - @type: Event with start/end/location/contact fields
 *   - blocks_layout: title → eventMetadata → slate
 *
 * News Item test page (/_test_data/news-test-page):
 *   - @type: News Item with preview_image field
 *   - blocks_layout: title → leadimage → slate
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

test.use({
  storageState: 'tests-playwright/.generated/storage-nuxt.json',
});

test.describe('Event content type', () => {

  test('eventMetadata block renders with date, location and contact', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const iframe = helper.getIframe();

    await helper.login();
    await helper.navigateToEdit('/event-test-page');
    await helper.waitForIframeReady();

    const metadata = iframe.locator('[data-block-uid="ev-metadata-1"]');
    await expect(metadata).toBeVisible({ timeout: 10000 });

    // "When" row — shows formatted start date
    await expect(metadata.locator('dt', { hasText: 'When' })).toBeVisible();
    await expect(metadata.locator('[data-edit-text="/start"]')).toBeVisible();
    await expect(metadata.locator('[data-edit-text="/start"]')).toContainText('2025');

    // "Where" row — shows location
    await expect(metadata.locator('dt', { hasText: 'Where' })).toBeVisible();
    await expect(metadata.locator('[data-edit-text="/location"]')).toBeVisible();
    await expect(metadata.locator('[data-edit-text="/location"]')).toContainText('Conference Centre');

    // "Contact" row — shows contact name
    await expect(metadata.locator('dt', { hasText: 'Contact' })).toBeVisible();
    await expect(metadata.locator('[data-edit-text="/contact_name"]')).toBeVisible();
    await expect(metadata.locator('[data-edit-text="/contact_name"]')).toContainText('Jane Smith');
  });

  test('eventMetadata location field is inline-editable', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const iframe = helper.getIframe();

    await helper.login();
    await helper.navigateToEdit('/event-test-page');
    await helper.waitForIframeReady();

    const locationField = iframe.locator('[data-edit-text="/location"]');
    await expect(locationField).toBeVisible({ timeout: 10000 });

    // Click the location field to activate inline editing
    await locationField.click();

    // Field should become contenteditable
    await expect(locationField).toHaveAttribute('contenteditable', 'true', { timeout: 5000 });

    // Verify no "Missing data-node-id" warning (plain text field, not slate)
    const slateWarning = page.locator('text=Missing data-node-id attributes');
    await expect(slateWarning).not.toBeVisible();

    // Edit the location
    await locationField.fill('New Venue, Updated Street, Berlin');
    await locationField.blur();
    await page.waitForTimeout(300);

    // Sidebar should reflect the updated value
    const sidebarLocationField = page.locator('.field-wrapper-location input, .field-wrapper-location textarea');
    await expect(sidebarLocationField).toHaveValue('New Venue, Updated Street, Berlin', { timeout: 5000 });
  });

  test('eventMetadata contact_name field is inline-editable', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const iframe = helper.getIframe();

    await helper.login();
    await helper.navigateToEdit('/event-test-page');
    await helper.waitForIframeReady();

    const contactField = iframe.locator('[data-edit-text="/contact_name"]');
    await expect(contactField).toBeVisible({ timeout: 10000 });

    await contactField.click();
    await expect(contactField).toHaveAttribute('contenteditable', 'true', { timeout: 5000 });

    await contactField.fill('John Doe');
    await contactField.blur();
    await page.waitForTimeout(300);

    const sidebarField = page.locator('.field-wrapper-contact_name input, .field-wrapper-contact_name textarea');
    await expect(sidebarField).toHaveValue('John Doe', { timeout: 5000 });
  });

});

test.describe('News Item content type', () => {

  test('leadimage block renders the page preview image', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const iframe = helper.getIframe();

    await helper.login();
    await helper.navigateToEdit('/news-test-page');
    await helper.waitForIframeReady();

    const leadimage = iframe.locator('[data-block-uid="ni-leadimage-1"]');
    await expect(leadimage).toBeVisible({ timeout: 10000 });

    // Should render an image
    const img = leadimage.locator('img');
    await expect(img).toBeVisible();

    // Image should have a src (from preview_image.download)
    const src = await img.getAttribute('src');
    expect(src).toBeTruthy();
    expect(src?.length).toBeGreaterThan(0);
  });

  test('leadimage block is editable (has data-edit-media)', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const iframe = helper.getIframe();

    await helper.login();
    await helper.navigateToEdit('/news-test-page');
    await helper.waitForIframeReady();

    const leadimage = iframe.locator('[data-block-uid="ni-leadimage-1"]');
    await expect(leadimage).toBeVisible({ timeout: 10000 });

    // Image should have data-edit-media="/preview_image" (content-type level field)
    const img = leadimage.locator('[data-edit-media="/preview_image"]');
    await expect(img).toBeVisible();

    // Click the image — should show toolbar with image button
    await img.click();

    const toolbar = page.locator('.quanta-toolbar');
    await expect(toolbar).toBeVisible({ timeout: 5000 });

    const imageButton = toolbar.locator('button[title*="Select image"], button[title*="image"]');
    await expect(imageButton.first()).toBeVisible({ timeout: 5000 });
  });

  test('dateField block renders effective date above title', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const iframe = helper.getIframe();

    await helper.login();
    await helper.navigateToEdit('/news-test-page');
    await helper.waitForIframeReady();

    const dateBlock = iframe.locator('[data-block-uid="ni-date-1"]');
    await expect(dateBlock).toBeVisible({ timeout: 10000 });

    // Should show the effective date with data-edit-text="/effective"
    const dateEl = dateBlock.locator('[data-edit-text="/effective"]');
    await expect(dateEl).toBeVisible();

    // Date text should contain year from effective date "2023-01-15"
    const dateText = await dateEl.textContent();
    expect(dateText?.trim()).toContain('2023');

    // dateField block should appear before the title block in the DOM
    const titleBlock = iframe.locator('[data-block-uid="ni-title-1"]');
    await expect(titleBlock).toBeVisible();
    const dateY = (await dateBlock.boundingBox())?.y ?? 0;
    const titleY = (await titleBlock.boundingBox())?.y ?? 0;
    expect(dateY).toBeLessThan(titleY);
  });

});
