/**
 * Tests for editing page metadata inline.
 * Uses path syntax: /fieldName to edit page-level fields.
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

test.describe('Page Metadata Editing', () => {
  test('can edit page title inline using /title path', async ({ page }, testInfo) => {
    const helper = new AdminUIHelper(page);
    await helper.login();

    // Use different pages for different frontends
    const isNuxt = testInfo.project.name.includes('nuxt');
    const testPath = isNuxt ? '/carousel-test-page' : '/test-page';
    const expectedInitialTitle = isNuxt ? 'Carousel Test Page' : 'Test Page';

    await helper.navigateToEdit(testPath);

    const iframe = helper.getIframe();

    // Find the page title element (use #page-title for mock to avoid matching teaser titles)
    // Mock frontend uses "title" (without slash) to test shorthand works
    // Nuxt frontend uses "/title" (with slash) to test explicit page-level path
    const titleSelector = isNuxt ? '[data-edit-text="/title"]' : '#page-title';
    const pageTitle = iframe.locator(titleSelector);
    await expect(pageTitle).toBeVisible({ timeout: 10000 });
    await expect(pageTitle).toHaveText(expectedInitialTitle);

    // Click on the title to make it editable
    await pageTitle.click();

    // The title should become contenteditable and focused
    await expect(pageTitle).toHaveAttribute('contenteditable', 'true', { timeout: 5000 });
    await helper.waitForEditorFocus(pageTitle);

    // The slate warning popup should NOT appear - title is a plain string, not slate
    const slateWarning = page.locator('text=Missing data-node-id attributes');
    await expect(slateWarning).not.toBeVisible();

    // Select all text and verify selection before clearing
    await helper.selectAllTextInEditor(pageTitle);
    const selText = await pageTitle.evaluate(() => window.getSelection()?.toString() || '');
    expect(selText).toBe(expectedInitialTitle);

    // Clear by typing over the selection
    await pageTitle.pressSequentially('Updated Page Title', { delay: 50 });

    // Click elsewhere to trigger blur and save
    // Use a block that exists in both frontends
    const contentBlock = isNuxt
      ? iframe.locator('[data-block-uid="text-after"]')
      : iframe.locator('#content');
    await contentBlock.click({ force: true });

    // Wait for the change to propagate
    await page.waitForTimeout(500);

    // Verify the page title was updated in the iframe
    await expect(pageTitle).toHaveText('Updated Page Title');

    // Verify the sidebar title field also shows the updated value. Scoped to
    // the PAGE metadata form: blurring selects the block clicked, and a block
    // whose schema has its own `title` (image, here) renders a second
    // `.field-wrapper-title` — Volto's InlineForm gives both the same
    // `field-title` id — in `#sidebar-properties` right beside it.
    const sidebarTitleField = page.locator(
      '#sidebar-metadata .field-wrapper-title input, #sidebar-metadata .field-wrapper-title textarea',
    );
    await expect(sidebarTitleField).toHaveValue('Updated Page Title', { timeout: 5000 });
  });

  test('an inline title survives Save, with nothing clicked in between', async ({ page }, testInfo) => {
    // The tests around this one commit the edit by clicking ANOTHER BLOCK first,
    // and check the rendered text and the sidebar field. Nothing checked that the
    // edit reaches the SAVE — and an author does not click elsewhere before
    // saving, they type the title and hit Save.
    //
    // What that gap hid: when the content type schema arrived after INIT, `_page`
    // was registered without the content type's own fields, so the bridge could
    // not resolve `title` to a text-editable type and never made it editable.
    // Clicking the title still selected it — the toolbar appears, selection does
    // not go through the schema — so it LOOKED fine, while everything typed was
    // discarded and the save carried no title at all.
    const helper = new AdminUIHelper(page);
    await helper.login();

    const isNuxt = testInfo.project.name.includes('nuxt');
    const testPath = isNuxt ? '/carousel-test-page' : '/test-page';
    const expectedInitialTitle = isNuxt ? 'Carousel Test Page' : 'Test Page';
    const renamed = 'Renamed Before Saving';

    await helper.navigateToEdit(testPath);
    const iframe = helper.getIframe();

    const titleSelector = isNuxt ? '[data-edit-text="/title"]' : '#page-title';
    const pageTitle = iframe.locator(titleSelector);
    await expect(pageTitle).toBeVisible({ timeout: 10000 });
    await expect(pageTitle).toHaveText(expectedInitialTitle);

    await pageTitle.click();
    await expect(pageTitle).toHaveAttribute('contenteditable', 'true', { timeout: 5000 });
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type(renamed, { delay: 40 });
    await expect(pageTitle).toHaveText(renamed);

    // Straight to Save. No click on another block, no blur of our own — Save is
    // a button in the ADMIN, outside the iframe, so this is also the case where
    // the contenteditable never receives a same-document blur.
    await helper.saveContent();

    // Saved, not merely displayed: come back to the page and read the title the
    // server gives back. Asserting on the still-loaded document would pass on
    // state the save never persisted.
    await helper.navigateToEdit(testPath);
    await expect(
      helper.getIframe().locator(titleSelector),
      'the title typed before Save is the title the page now has',
    ).toHaveText(renamed, { timeout: 15000 });
  });

  test('page title edit persists when selecting another block', async ({ page }, testInfo) => {
    const helper = new AdminUIHelper(page);
    await helper.login();

    // Use different pages for different frontends
    const isNuxt = testInfo.project.name.includes('nuxt');
    const testPath = isNuxt ? '/carousel-test-page' : '/test-page';
    const blockToClick = isNuxt ? 'slider-1' : 'block-1-uuid';

    await helper.navigateToEdit(testPath);

    const iframe = helper.getIframe();

    // Find and click the page title (use #page-title to avoid matching teaser titles)
    // Mock frontend uses "title" (without slash), Nuxt uses "/title"
    const titleSelector = isNuxt ? '[data-edit-text="/title"]' : '#page-title';
    const pageTitle = iframe.locator(titleSelector);
    await expect(pageTitle).toBeVisible({ timeout: 10000 });
    await pageTitle.click();

    // Make it editable and wait for focus
    await expect(pageTitle).toHaveAttribute('contenteditable', 'true', { timeout: 5000 });
    await helper.waitForEditorFocus(pageTitle);
    await helper.selectAllTextInEditor(pageTitle);
    await pageTitle.pressSequentially('New Title', { delay: 50 });

    // Trigger save by clicking elsewhere
    const otherBlock = iframe.locator(`[data-block-uid="${blockToClick}"]`);
    await otherBlock.click({ force: true });
    await page.waitForTimeout(500);

    // The block should be selected
    const outline = page.locator('.volto-hydra-block-outline');
    await expect(outline).toBeVisible({ timeout: 5000 });

    // Verify page title is still the edited value
    await expect(pageTitle).toHaveText('New Title');
  });

  test('can click page-level preview_image and change it inline', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.includes('nuxt'), 'Nuxt frontend needs preview_image element added');

    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const iframe = helper.getIframe();

    // Wait for the preview image to be visible (it renders from formData)
    const previewImage = iframe.locator('#preview-image');
    await expect(previewImage).toBeVisible({ timeout: 10000 });

    // Get the original image src
    const originalSrc = await previewImage.getAttribute('src');

    // Click on the preview image (has data-edit-media="preview_image")
    await previewImage.click();

    // The toolbar should appear (Quanta toolbar)
    const toolbar = page.locator('.quanta-toolbar');
    await expect(toolbar).toBeVisible({ timeout: 5000 });

    // The drag handle should NOT be visible (page-level fields can't be dragged)
    const dragHandle = toolbar.locator('.drag-handle');
    await expect(dragHandle).not.toBeVisible();

    // The add button should NOT be visible (page-level fields don't have add)
    const addButton = page.locator('.volto-hydra-add-button');
    await expect(addButton).not.toBeVisible();

    // The menu button IS visible, but Remove option should NOT be in the dropdown
    const menuButton = toolbar.locator('[title="More options"]');
    await expect(menuButton).toBeVisible();
    await menuButton.click();

    // Wait for dropdown to appear
    const dropdown = page.locator('.volto-hydra-dropdown-menu');
    await expect(dropdown).toBeVisible({ timeout: 2000 });

    // The Remove option should NOT be visible (page-level fields can't be deleted)
    const removeOption = dropdown.locator('text=Remove');
    await expect(removeOption).not.toBeVisible();

    // Close the menu by clicking elsewhere
    await page.locator('body').click({ position: { x: 10, y: 10 } });

    // Click the image button to open the image editor overlay
    const imageButton = helper.getQuantaToolbarFormatButton('image');
    await expect(imageButton).toBeVisible();
    await imageButton.click();

    // Wait for the image editor overlay to appear at the image position
    const imageEditorOverlay = page.locator('.empty-image-overlay');
    await expect(imageEditorOverlay).toBeVisible({ timeout: 5000 });

    // Open object browser from the overlay
    const objectBrowser = await helper.openObjectBrowserFromToolbarPopup(imageEditorOverlay, imageButton);

    // Navigate to Images folder
    await helper.objectBrowserNavigateToFolder(objectBrowser, /Images/);

    // Select an image
    await helper.objectBrowserSelectItem(objectBrowser, /Test Image 1/);

    // Submit the form if still open
    await helper.submitAddLinkFormIfOpen(imageEditorOverlay);

    // Verify the preview image src has changed
    await expect(previewImage).toHaveAttribute('src', /test-image-1/, { timeout: 5000 });
    const newSrc = await previewImage.getAttribute('src');
    expect(newSrc).not.toBe(originalSrc);
  });

  test('page-level preview_image outline tracks on scroll', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.includes('nuxt'), 'Nuxt frontend needs preview_image element added');

    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const iframe = helper.getIframe();

    // Wait for the preview image to be visible
    const previewImage = iframe.locator('#preview-image');
    await expect(previewImage).toBeVisible({ timeout: 10000 });

    // Click on the preview image to select it
    await previewImage.click();

    // Wait for outline to appear
    const outline = page.locator('.volto-hydra-block-outline');
    await expect(outline).toBeVisible({ timeout: 5000 });

    // Get initial outline position
    const initialOutlineBox = await outline.boundingBox();
    expect(initialOutlineBox).toBeTruthy();

    // Get initial preview image position relative to iframe
    const initialImageBox = await previewImage.boundingBox();
    expect(initialImageBox).toBeTruthy();

    // Scroll down in the iframe
    await iframe.locator('body').evaluate((body) => {
      body.ownerDocument.defaultView?.scrollBy(0, 100);
    });

    // Wait for scroll to complete and outline to update
    await page.waitForTimeout(300);

    // Get new positions after scroll
    const newOutlineBox = await outline.boundingBox();
    const newImageBox = await previewImage.boundingBox();

    expect(newOutlineBox).toBeTruthy();
    expect(newImageBox).toBeTruthy();

    // The outline should have moved with the image (both should move up by ~100px)
    // Allow some tolerance for timing
    const outlineMovement = initialOutlineBox!.y - newOutlineBox!.y;
    const imageMovement = initialImageBox!.y - newImageBox!.y;

    // Both should have moved approximately the same amount
    expect(Math.abs(outlineMovement - imageMovement)).toBeLessThan(10);
  });
});
