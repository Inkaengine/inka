/**
 * Tests for inline editing of linkable and media fields.
 *
 * These tests verify that:
 * - Elements with data-edit-link show link icon in toolbar
 * - Elements with data-edit-media show image icon in toolbar
 * - Link icon opens AddLinkForm popup
 * - Image icon triggers object browser
 *
 * Uses the hero block (block-4-hero) which has:
 * - data-edit-link="buttonLink" on the button
 * - data-edit-media="image" on the image element
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

test.describe('Inline editing - linkable/media fields', () => {
  test('shows link icon when clicking element with data-edit-link', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Wait for initial block selection to settle (first block auto-selected on page load)
    await helper.waitForBlockSelectedInAdmin('block-1-uuid');

    // The hero block has a button with data-edit-link="buttonLink"
    const iframe = helper.getIframe();
    const linkableElement = iframe.locator('[data-edit-link="buttonLink"]');
    await expect(linkableElement).toBeVisible();

    // Click the linkable element
    await linkableElement.click();

    // Verify toolbar appears with link icon
    const toolbar = page.locator('.quanta-toolbar');
    await expect(toolbar).toBeVisible();

    // Look for the link button (should show when focusedLinkableField is set)
    const linkButton = toolbar.locator('button[title*="Edit link"]');
    await expect(linkButton).toBeVisible();
  });

  test('shows image icon when clicking element with data-edit-media', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // The hero block has an image with data-edit-media="image"
    const iframe = helper.getIframe();
    const heroBlock = iframe.locator('[data-block-uid="block-4-hero"]');
    const mediaElement = heroBlock.locator('[data-edit-media="image"]');
    await expect(mediaElement).toBeVisible();

    // Click the media element
    await mediaElement.click();

    // Verify toolbar appears with image icon
    const toolbar = page.locator('.quanta-toolbar');
    await expect(toolbar).toBeVisible();

    // Look for the image button (should show when focusedMediaField is set)
    const imageButton = toolbar.locator('button[title*="Select image"]');
    await expect(imageButton).toBeVisible();
  });

  test('clicking link icon opens AddLinkForm popup', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Wait for initial block selection to settle
    await helper.waitForBlockSelectedInAdmin('block-1-uuid');

    // Click the linkable element (hero button)
    const iframe = helper.getIframe();
    const linkableElement = iframe.locator('[data-edit-link="buttonLink"]');
    await linkableElement.click();

    // Click the link icon in toolbar
    const toolbar = page.locator('.quanta-toolbar');
    const linkButton = toolbar.locator('button[title*="Edit link"]');
    await linkButton.click();

    // Verify AddLinkForm popup appears
    const linkForm = page.locator('.field-link-editor .link-form-container');
    await expect(linkForm).toBeVisible();

    // Verify input exists and can be interacted with
    const linkInput = linkForm.locator('input[name="link"]');
    await expect(linkInput).toBeVisible();
  });

  test('element with both editable and linkable fields shows both format and link buttons', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Wait for initial block selection to settle
    await helper.waitForBlockSelectedInAdmin('block-1-uuid');

    // The hero button has both data-edit-text="buttonText" and data-edit-link="buttonLink"
    const iframe = helper.getIframe();
    const buttonElement = iframe.locator('[data-edit-text="buttonText"][data-edit-link="buttonLink"]');
    await expect(buttonElement).toBeVisible();

    // Click the element
    await buttonElement.click();

    const toolbar = page.locator('.quanta-toolbar');
    await expect(toolbar).toBeVisible();

    // Should show link button for the linkable field
    const linkButton = toolbar.locator('button[title*="Edit link"]');
    await expect(linkButton).toBeVisible();
  });

  test('text typed into a field, then its link edited straight away: both are kept and saved', async ({ page }) => {
    // The author types the element's text and goes straight to its link
    // button, without waiting for anything. The text was still only on the
    // canvas when the link editor opened, and the link edit wrote the block
    // back without it: the canvas showed the new text, the form never had it.
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');
    const iframe = helper.getIframe();
    const button = iframe.locator('[data-block-uid="block-4-hero"] [data-edit-text="buttonText"][data-edit-link="buttonLink"]');
    await expect(button).toHaveText('Click Me');

    await helper.enterEditMode('block-4-hero', 'buttonText');
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Read more');
    await expect(button).toHaveText('Read more');

    await page.locator('.quanta-toolbar button[title*="Edit link"]').click();
    const linkInput = page.locator('.field-link-editor .link-form-container input[name="link"]');
    await linkInput.fill('https://example.com/more');
    await linkInput.press('Enter');
    await expect(button).toHaveAttribute('href', 'https://example.com/more');
    await expect(button).toHaveText('Read more');
    await expect(page.locator('#sidebar-properties #field-buttonText')).toHaveValue('Read more');

    await helper.saveContent();
    // Published, the hero carries no block uid (and other blocks on the page
    // say "Read more" too): find its button by the new link.
    await expect(iframe.locator('a[href="https://example.com/more"]')).toHaveText('Read more');
  });

  test('hover state shows dashed outline on linkable field', async ({ page }) => {
    // The hover affordance is now drawn with CSS `outline` (renders
    // outside the box, no layout impact) instead of a positioned
    // `::after` pseudo-element. The visual is the same — dashed cyan
    // border — but the host element's `position` is no longer forced
    // to relative just to anchor the pseudo. See host-css-preservation
    // spec for the regression that drove the change.
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const iframe = helper.getIframe();
    const linkableElement = iframe.locator('[data-edit-link="buttonLink"]');
    await linkableElement.hover();

    const outlineStyle = await linkableElement.evaluate(
      (el) => window.getComputedStyle(el).outlineStyle,
    );
    expect(outlineStyle).toBe('dashed');
  });

  test('hover state shows dashed outline on media field', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const iframe = helper.getIframe();
    const heroBlock = iframe.locator('[data-block-uid="block-4-hero"]');
    const mediaElement = heroBlock.locator('[data-edit-media="image"]');
    await mediaElement.hover();

    const outlineStyle = await mediaElement.evaluate(
      (el) => window.getComputedStyle(el).outlineStyle,
    );
    expect(outlineStyle).toBe('dashed');
  });
});
