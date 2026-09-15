/**
 * Integration tests for block selection in Volto Hydra admin UI.
 *
 * These tests verify that clicking blocks in the iframe opens the correct
 * sidebar settings and toolbars appear as expected.
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

test.describe('Block Selection', () => {
  test('clicking a block in iframe opens sidebar', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    // Login and navigate to edit page
    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Click on first block
    await helper.clickBlockInIframe('block-1-uuid');

    // Verify sidebar opens
    await helper.waitForSidebarOpen();
    const sidebarOpen = await helper.isSidebarOpen();
    expect(sidebarOpen).toBe(true);
  });

  test('clicking a Slate block shows Slate settings in sidebar', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Click on Slate block
    await helper.clickBlockInIframe('block-1-uuid');

    // Wait for sidebar
    await helper.waitForSidebarOpen();
    await helper.openSidebarTab('Block');

    // Verify sidebar is open with Block tab active
    const sidebarOpen = await helper.isSidebarOpen();
    expect(sidebarOpen).toBe(true);

    // Verify we can interact with sidebar (it has loaded content)
    const sidebar = page.locator('#sidebar-properties');
    const content = await sidebar.textContent();
    expect(content).toBeTruthy();
  });

  test('clicking different blocks updates sidebar settings', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Click first block (Slate)
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForSidebarOpen();
    await helper.openSidebarTab('Block');

    // Get sidebar content for first block
    const sidebar = page.locator('#sidebar-properties');
    await expect(sidebar).toBeVisible();
    const firstContent = await sidebar.textContent();
    expect(firstContent).toBeTruthy();

    // Click second block (Image) and wait for sidebar to remain open
    await helper.clickBlockInIframe('block-2-uuid');

    // Wait for sidebar to still be visible (it should stay open when switching blocks)
    await expect(sidebar).toBeVisible({ timeout: 10000 });

    // Get sidebar content for second block - should check for image-specific fields
    const hasUrlField = await helper.hasSidebarField('url');
    const hasAltField = await helper.hasSidebarField('alt');

    // Image block should have url and alt fields
    expect(hasUrlField || hasAltField).toBe(true);
  });

  test('selected block has visual indication', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Click on a block - this will wait for toolbar to appear
    const blockId = 'block-1-uuid';
    await helper.clickBlockInIframe(blockId);

    // Verify toolbar is visible (indicates block is selected)
    const hasToolbar = await helper.isQuantaToolbarVisibleInIframe(blockId);
    expect(hasToolbar).toBe(true);

    // Verify block appears selected with proper positioning
    await helper.waitForBlockSelectedInAdmin(blockId);
  });

  test('switching block selection updates visual state', async ({ page }, testInfo) => {
    // Skip on Nuxt - test-page has custom blocks that affect bounding box comparison
    test.skip(testInfo.project.name.includes('nuxt'), 'Nuxt test-page has custom blocks');

    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Select first block - clickBlockInIframe waits for toolbar
    await helper.clickBlockInIframe('block-1-uuid');

    expect((await helper.isBlockSelectedInIframe('block-1-uuid')).ok).toBe(true);
    expect((await helper.isBlockSelectedInIframe('block-2-uuid')).ok).toBe(false);

    // Select second block - clickBlockInIframe waits for toolbar
    await helper.clickBlockInIframe('block-2-uuid');

    expect((await helper.isBlockSelectedInIframe('block-1-uuid')).ok).toBe(false);
    expect((await helper.isBlockSelectedInIframe('block-2-uuid')).ok).toBe(true);
  });

  test('block selection shows correct block type in sidebar', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Test selecting an image block
    await helper.clickBlockInIframe('block-2-uuid');
    await helper.waitForSidebarCurrentBlock('Image');

    // Verify sidebar shows image-specific fields (alt, size)
    await expect(page.locator('#sidebar-properties .field-wrapper-alt')).toBeVisible();
    await expect(page.locator('#sidebar-properties .field-wrapper-size')).toBeVisible();

    // Test selecting a slate/text block
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForSidebarCurrentBlock('Text');

    // Verify sidebar no longer shows image-specific fields
    await expect(page.locator('#sidebar-properties .field-wrapper-alt')).not.toBeVisible();
    await expect(page.locator('#sidebar-properties .field-wrapper-size')).not.toBeVisible();
  });

  test('clicking block in ChildBlocksWidget selects it in iframe', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Click first block to open sidebar
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForSidebarOpen();

    // Click the back arrow to deselect - this navigates up to page level
    const backArrow = page.locator('.sidebar-section-header .nav-back');
    await expect(backArrow).toBeVisible({ timeout: 5000 });
    await backArrow.click();

    // Wait for ChildBlocksWidget to show page-level blocks with the Image item
    const childBlocksWidget = page.locator('#sidebar-order .child-blocks-widget');
    await expect(childBlocksWidget).toBeVisible({ timeout: 5000 });

    // Click the first Image block item (block-2-uuid)
    // Using hasText ensures the list is fully rendered before clicking
    // .first() needed because there are two Image blocks (regular and linked)
    const imageBlockItem = childBlocksWidget.locator('.child-block-item', { hasText: 'Image' }).first();
    await expect(imageBlockItem).toBeVisible({ timeout: 5000 });
    await imageBlockItem.click();

    // The sidebar should now show image block fields (alt text, alignment, etc.)
    // Wait for the alt text field to appear (indicates sidebar updated to image block)
    const altTextField = page.locator('.sidebar-container').getByRole('textbox', { name: 'Alt text' });
    await expect(altTextField).toBeVisible({ timeout: 5000 });

    // Wait for Quanta toolbar to appear and be positioned on the selected block
    await helper.waitForBlockSelectedInAdmin('block-2-uuid');
  });

  // IMPORTANT: This test verifies that a SINGLE click on a text block focuses the editor
  // at the correct cursor position. Do NOT change this to use enterEditMode or multiple
  // clicks - the purpose is to test that hydra.js correctly handles focus on the first click.
  test('clicking text block puts cursor focus at correct position', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const iframe = helper.getIframe();

    // Wait for iframe content to be ready - look for the specific text we'll be clicking
    await expect(iframe.locator('text=Another paragraph for testing')).toBeVisible({ timeout: 15000 });

    // block-3-uuid contains "Another paragraph for testing"
    // Click in the middle of the text to position cursor there
    const blockId = 'block-3-uuid';
    const blockLocator = iframe.locator(`[data-block-uid="${blockId}"]`);

    // Find the editable field using helper that handles both Nuxt and mock patterns
    const editor = helper.getSlateField(blockLocator);
    await editor.waitFor({ state: 'visible', timeout: 10000 });

    // Wait for the text content to be rendered inside the editor
    await expect(editor).toContainText('Another paragraph', { timeout: 5000 });

    // Get the click coordinates for the middle of the text
    // "Another paragraph for testing" is 29 chars, so position 14 is roughly middle
    const clickPos = await helper.getClickPositionForCharacter(editor, 14);
    expect(clickPos).toBeTruthy();
    await editor.click({ position: clickPos! });

    // Wait for block to be selected
    await helper.waitForIframeBlockHandle(blockId);

    // Wait for contenteditable to become true after click
    await expect(editor).toHaveAttribute('contenteditable', 'true', { timeout: 5000 });

    // Verify toolbar appeared
    const hasToolbar = await helper.isQuantaToolbarVisibleInIframe(blockId);
    expect(hasToolbar).toBe(true);

    // Verify cursor is in the middle of the text (not at start or end)
    // This also verifies the editor is focused (can't have cursor position without focus)
    const { textBefore, textAfter } = await helper.getTextAroundCursor(editor);
    expect(textBefore.length).toBeGreaterThan(0);
    expect(textAfter.length).toBeGreaterThan(0);

    // Verify we can type immediately - text should be inserted at cursor position
    await editor.pressSequentially('TYPED');

    // Verify the text was inserted at the cursor position (between textBefore and textAfter)
    const expectedText = textBefore + 'TYPED' + textAfter;
    await expect(iframe.locator(`[data-block-uid="${blockId}"]`)).toContainText(expectedText);
  });

  test('selecting new block scrolls sidebar to show settings', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Click first block to open sidebar
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForSidebarOpen();

    // Get the sidebar scroll container (.sidebar-content-wrapper in Sidebar.jsx)
    const sidebarScroller = page.locator('.sidebar-content-wrapper');
    await expect(sidebarScroller).toBeVisible();

    // Get the current block settings section (#sidebar-properties)
    const blockSettings = page.locator('#sidebar-properties');
    await expect(blockSettings).toBeVisible({ timeout: 5000 });

    // Wait for scroll animation to complete
    await page.waitForTimeout(500);

    // Verify the block settings are visible within the scroll viewport
    const settingsBox = await blockSettings.boundingBox();
    const scrollerBox = await sidebarScroller.boundingBox();

    expect(settingsBox).toBeTruthy();
    expect(scrollerBox).toBeTruthy();

    // The settings should be at least partially visible in the sidebar viewport
    const settingsTop = settingsBox!.y;
    const settingsBottom = settingsBox!.y + settingsBox!.height;
    const scrollerTop = scrollerBox!.y;
    const scrollerBottom = scrollerBox!.y + scrollerBox!.height;

    // Check that settings are within visible area (at least partially)
    const isVisible = settingsTop < scrollerBottom && settingsBottom > scrollerTop;
    expect(isVisible, 'Current block settings should be visible in sidebar scroll area').toBe(true);
  });

  test('reselecting same block does not scroll sidebar', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Click first block to open sidebar
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForSidebarOpen();

    // Get the sidebar scroll container (.sidebar-content-wrapper in Sidebar.jsx)
    const sidebarScroller = page.locator('.sidebar-content-wrapper');
    await expect(sidebarScroller).toBeVisible();

    // Wait for any initial scroll to complete
    await page.waitForTimeout(500);

    // Check if content is scrollable (content height > container height)
    const canScroll = await sidebarScroller.evaluate((el) => {
      return el.scrollHeight > el.clientHeight;
    });

    // Skip scroll test if content isn't tall enough to scroll
    if (!canScroll) {
      // If we can't scroll, just verify re-clicking doesn't cause errors
      await helper.clickBlockInIframe('block-1-uuid');
      await page.waitForTimeout(300);
      // Test passes - no scroll to verify
      return;
    }

    // Scroll the sidebar to a specific position (simulating user scroll)
    await sidebarScroller.evaluate((el) => {
      // Scroll to 50px or max scrollable, whichever is smaller
      el.scrollTop = Math.min(50, el.scrollHeight - el.clientHeight);
    });
    await page.waitForTimeout(100);

    // Get the scroll position (may be less than 50 if content is short)
    const scrollBefore = await sidebarScroller.evaluate((el) => el.scrollTop);
    expect(scrollBefore).toBeGreaterThan(0);

    // Re-click the same block
    await helper.clickBlockInIframe('block-1-uuid');
    await page.waitForTimeout(300);

    // Verify scroll position is maintained (not reset)
    const scrollAfter = await sidebarScroller.evaluate((el) => el.scrollTop);
    expect(scrollAfter).toBe(scrollBefore);
  });

  test('selecting block shows sidebar settings from top, not scrolled down', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Select listing block which has multiple settings (variation, headline, querystring, fieldMapping)
    await helper.clickBlockInIframe('block-9-listing');
    await helper.waitForSidebarOpen();
    await helper.openSidebarTab('Block');

    // Get the sidebar scroll container and block settings
    const sidebarScroller = page.locator('.sidebar-content-wrapper');
    const blockSettings = page.locator('#sidebar-properties');
    await expect(sidebarScroller).toBeVisible();
    await expect(blockSettings).toBeVisible({ timeout: 5000 });

    // Wait for any scroll animation to complete
    await page.waitForTimeout(500);

    // Verify the TOP of block settings is visible (not scrolled past)
    // Get bounding boxes to compare positions
    const scrollerBox = await sidebarScroller.boundingBox();
    const settingsBox = await blockSettings.boundingBox();

    expect(scrollerBox).toBeTruthy();
    expect(settingsBox).toBeTruthy();

    // The top of settings should be at or below the top of the scroller viewport
    // (i.e., not scrolled so far that the top of settings is above the viewport)
    const settingsTopIsVisible = settingsBox!.y >= scrollerBox!.y - 20; // Allow 20px tolerance
    expect(
      settingsTopIsVisible,
      `Top of block settings should be visible. Settings top: ${settingsBox!.y}, Scroller top: ${scrollerBox!.y}`,
    ).toBe(true);

    // Also verify the first field is visible (variation for listing block)
    const firstField = page.locator('#sidebar-properties .field-wrapper-variation');
    await expect(firstField).toBeVisible({ timeout: 5000 });
  });

  test('sidebar block header menu has same items as toolbar menu except settings', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Click a block to open sidebar
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForSidebarOpen();

    // Open the Quanta toolbar menu (outside iframe, in Admin UI)
    await helper.openQuantaToolbarMenu('block-1-uuid');
    const toolbarItemTexts = (await helper.getQuantaToolbarMenuOptions('block-1-uuid')).map(t => t.toLowerCase());

    // Close toolbar menu by clicking elsewhere
    await page.locator('body').click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(200);

    // Open the sidebar block header menu
    const sidebarMenuButton = page.locator(
      '.sidebar-section-header .block-actions-menu button, .sidebar-section-header [aria-label="More options"], .sidebar-section-header .menu-trigger',
    );
    await expect(sidebarMenuButton).toBeVisible({ timeout: 5000 });
    await sidebarMenuButton.click();
    await page.waitForTimeout(200);

    // Get sidebar menu items (same dropdown class as toolbar)
    const sidebarMenuItems = page.locator('.volto-hydra-dropdown-item');
    const sidebarItemTexts: string[] = [];
    const sidebarCount = await sidebarMenuItems.count();
    for (let i = 0; i < sidebarCount; i++) {
      const text = await sidebarMenuItems.nth(i).textContent();
      if (text) {
        // Remove emoji prefix (e.g., "🗑️ Remove" -> "Remove")
        const cleanText = text.replace(/^[^\w]*/, '').trim().toLowerCase();
        if (cleanText) sidebarItemTexts.push(cleanText);
      }
    }

    // Filter out "settings" from toolbar items for comparison
    const toolbarItemsWithoutSettings = toolbarItemTexts.filter(
      (item) => !item.includes('setting'),
    );

    // Sidebar should have same items as toolbar (minus settings)
    expect(sidebarItemTexts.sort()).toEqual(toolbarItemsWithoutSettings.sort());
  });

  test('can select block that is wrapped in a link', async ({ page }) => {
    // When an entire block is wrapped in a link (e.g., image block with href),
    // clicking it should select the block instead of navigating away
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const iframe = helper.getIframe();
    const LINKED_IMAGE_BLOCK_ID = 'block-5-linked-image';

    // Store original URL to verify we haven't navigated away
    const originalUrl = page.url();

    // Click the linked image block
    await helper.clickBlockInIframe(LINKED_IMAGE_BLOCK_ID);

    // Block should be selected (toolbar visible)
    const hasToolbar = await helper.isQuantaToolbarVisibleInIframe(LINKED_IMAGE_BLOCK_ID);
    expect(hasToolbar).toBe(true);

    // Page should NOT have navigated away - URL should still contain /edit
    expect(page.url()).toContain('/edit');
    expect(page.url()).toBe(originalUrl);

    // Verify the link element is present inside the block (confirms test setup)
    const linkElement = iframe.locator(`[data-block-uid="${LINKED_IMAGE_BLOCK_ID}"] a.image-link`);
    await expect(linkElement).toBeVisible();
  });

  test('scrolling selected block off screen does not scroll back', async ({ page }, testInfo) => {
    // Skip on Nuxt - uses container-test-page which has container blocks not yet supported
    test.skip(testInfo.project.name.includes('nuxt'), 'Uses container-test-page');

    // Bug: After selecting a block, if user scrolls the iframe so the block
    // goes off screen, the page automatically scrolls back to the block.
    // This is disruptive to user workflow.

    // Use a small viewport so content is much taller than iframe - matches real user scenario
    await page.setViewportSize({ width: 1280, height: 400 });

    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();

    // Select the title block (first block at very top)
    await helper.clickBlockInIframe('title-block');
    await helper.waitForBlockSelectedInAdmin('title-block');

    // Get initial scroll position (should be 0 or near top)
    const iframeBody = iframe.locator('body');
    const scrollBefore = await iframeBody.evaluate(() => window.scrollY);

    // Scroll iframe to bottom programmatically (simulates user scrolling)
    await iframeBody.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(200);

    // Check scroll position right after scrolling
    const scrollAfterEnd = await iframeBody.evaluate(() => window.scrollY);
    expect(scrollAfterEnd).toBeGreaterThan(scrollBefore);

    // Wait to see if it jumps back (the bug was scroll-back after ~1s)
    await page.waitForTimeout(1000);

    // Check if scroll position was maintained
    const scrollFinal = await iframeBody.evaluate(() => window.scrollY);

    // The scroll should stay where End key put it, not jump back to the selected block
    expect(scrollFinal).toBeGreaterThanOrEqual(scrollAfterEnd - 50);

    // Now scroll back to the top - the toolbar should reappear on the selected block
    await iframeBody.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);

    // Verify the toolbar is visible again for the selected block
    const hasToolbar = await helper.isQuantaToolbarVisibleInIframe('title-block');
    expect(hasToolbar).toBe(true);
  });
});

test.describe('Block Mode (Escape state machine)', () => {
  test('First Escape from text editing enters block mode (not parent)', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const iframe = helper.getIframe();

    // Click a Slate text block — enters text editing mode (contenteditable)
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForIframeBlockHandle('block-1-uuid');

    // Verify we're in text editing mode: field should be contenteditable
    const editFieldEditable = await helper.getEditorLocator('block-1-uuid', 'value');
    await expect(editFieldEditable).toBeVisible({ timeout: 5000 });

    // Text mode: subtle outline on block + field underline
    const outline = page.locator('.volto-hydra-block-outline');
    await expect(outline).toHaveAttribute('data-outline-style', 'subtle', { timeout: 3000 });
    await expect(page.locator('.volto-hydra-field-underline')).toBeVisible({ timeout: 3000 });

    // First Escape: should enter block mode (block still selected, but NOT editing)
    await page.keyboard.press('Escape');

    // Block mode: full border, no field underline
    await expect(outline).toBeVisible({ timeout: 3000 });
    await expect(outline).toHaveAttribute('data-outline-style', 'border', { timeout: 3000 });
    await expect(page.locator('.volto-hydra-field-underline')).not.toBeVisible({ timeout: 3000 });

    // The field should no longer be contenteditable="true"
    const editField = await helper.getEditorLocator('block-1-uuid', 'value');
    await expect(editField).not.toHaveAttribute('contenteditable', 'true', { timeout: 3000 });

    // Second Escape: should deselect (top-level block, no parent)
    await page.keyboard.press('Escape');

    // Block should now be deselected — no outline, no quanta toolbar
    await expect(page.locator('.volto-hydra-block-outline')).not.toBeVisible({ timeout: 3000 });
  });

  test('Escape (an editor key) does NOT leak to the frontend page keydown listeners', async ({ page }) => {
    // Regression guard: the capture-phase _documentKeyboardBlocker consumes ESC
    // (escape-to-parent / to-block-mode) and MUST stopPropagation, so an editor
    // keystroke never reaches the frontend app's own window handlers — otherwise
    // an app-level ESC shortcut (e.g. a slide-out menu that closes on ESC) fires
    // mid-edit. Without the stopPropagation this test fails (esc reaches the page).
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Select a block → any Escape with a block selected hits the consume branch.
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForIframeBlockHandle('block-1-uuid');

    // Install a bubble-phase window keydown listener INSIDE the iframe — the exact
    // shape a frontend app uses (PGHeader closes its mobile menu on window ESC).
    const iframeHandle = await page.waitForSelector('#previewIframe');
    const frame = await iframeHandle.contentFrame();
    await frame.evaluate(() => {
      window.__escReachedPage = false;
      window.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.__escReachedPage = true; }, false);
    });

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    const reached = await frame.evaluate(() => window.__escReachedPage);
    expect(reached, 'editor Escape leaked to a frontend window keydown listener').toBe(false);
  });

  test('Escape from container block to page level hides outline', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();

    // Click a container block (columns-1 has a title field)
    await helper.clickContainerBlockInIframe('columns-1');
    await helper.waitForIframeBlockHandle('columns-1');

    // Verify outline is visible
    await expect(page.locator('.volto-hydra-block-outline')).toBeVisible({ timeout: 5000 });

    // Escape to parent — columns-1 is top-level, so should deselect
    await helper.escapeToParent();

    // Outline should be gone
    await expect(page.locator('.volto-hydra-block-outline')).not.toBeVisible({ timeout: 5000 });
  });

  /**
   * The progressive step-up state machine — text → block → parent →
   * deselect — must be reachable BOTH from the Escape key (desktop)
   * AND from the ⬆ button in the Quanta toolbar (mobile, where no
   * Escape key exists). Both gestures route through the SAME
   * `stepUpSelection()` method in hydra.js, so any drift between the
   * two would be a code regression in that method or its trigger
   * wiring. These tests parametrize the trigger and assert the exact
   * same post-state after each step — if a future change accidentally
   * gives one path a different behavior, the failing parametrized
   * test names it.
   */
  const STEP_UP_TRIGGERS = [
    {
      label: 'Escape key',
      step: async (page: import('@playwright/test').Page) => {
        await page.keyboard.press('Escape');
      },
    },
    {
      label: '⬆ button',
      step: async (page: import('@playwright/test').Page) => {
        // Quanta's select-parent button posts STEP_UP to the iframe,
        // which calls the same stepUpSelection() that Escape does.
        await page.locator('.quanta-toolbar .step-up-btn').click();
      },
    },
  ] as const;

  for (const t of STEP_UP_TRIGGERS) {
    test(`step-up via ${t.label}: text → block → page (top-level slate block)`, async ({
      page,
    }) => {
      const helper = new AdminUIHelper(page);
      await helper.login();
      await helper.navigateToEdit('/test-page');

      // Enter inline text editing on a top-level slate block.
      await helper.clickBlockInIframe('block-1-uuid');
      await helper.waitForIframeBlockHandle('block-1-uuid');
      const outline = page.locator('.volto-hydra-block-outline');
      await expect(outline).toHaveAttribute('data-outline-style', 'subtle', {
        timeout: 3000,
      });

      // Step 1: text mode → block mode (same block, no inline cursor).
      await t.step(page);
      await expect(outline).toHaveAttribute('data-outline-style', 'border', {
        timeout: 3000,
      });
      const editField = await helper.getEditorLocator('block-1-uuid', 'value');
      await expect(editField).not.toHaveAttribute('contenteditable', 'true', {
        timeout: 3000,
      });

      // Step 2: block mode → deselect (top-level block has no parent).
      await t.step(page);
      await expect(page.locator('.volto-hydra-block-outline')).not.toBeVisible({
        timeout: 3000,
      });
    });

    test(`step-up via ${t.label}: a block with NO text starts in block mode (one step to deselect)`, async ({
      page,
    }) => {
      // Only clicking TEXT lands in text mode. An image block has no `data-edit-text`
      // field, so there is no cursor to place and no inline editor to leave — clicking
      // it must land straight in block mode. Previously every click landed in text
      // mode, so Escape / ⬆ wasted their first press "leaving" an editor that was
      // never entered, and an image took two presses to deselect.
      const helper = new AdminUIHelper(page);
      await helper.login();
      await helper.navigateToEdit('/test-page');

      await helper.clickBlockInIframe('block-2-uuid'); // image: no editable text
      const outline = page.locator('.volto-hydra-block-outline');
      await expect(outline).toBeVisible({ timeout: 5000 });

      // Already in block mode: the outline is the solid 'border' style, not the
      // 'subtle' one that marks an active inline editor.
      await expect(outline).toHaveAttribute('data-outline-style', 'border', {
        timeout: 3000,
      });

      // So a SINGLE step-up deselects — no wasted "exit text mode" press.
      await t.step(page);
      await expect(outline).not.toBeVisible({ timeout: 3000 });
    });

    test(`step-up via ${t.label}: text → block → parent → grandparent → page (nested)`, async ({
      page,
    }) => {
      const helper = new AdminUIHelper(page);
      await helper.login();
      await helper.navigateToEdit('/container-test-page');

      // text-1a sits inside col-1 inside columns-1 (three levels nested).
      await helper.clickBlockInIframe('text-1a');
      await helper.waitForIframeBlockHandle('text-1a');
      const outline = page.locator('.volto-hydra-block-outline');
      await expect(outline).toHaveAttribute('data-outline-style', 'subtle', {
        timeout: 3000,
      });

      // text mode → block mode (still text-1a)
      await t.step(page);
      await expect(outline).toHaveAttribute('data-outline-style', 'border', {
        timeout: 3000,
      });

      // block mode → parent col-1
      await t.step(page);
      await helper.waitForIframeBlockHandle('col-1');

      // parent col-1 → grandparent columns-1
      await t.step(page);
      await helper.waitForIframeBlockHandle('columns-1');

      // top-level columns-1 → page (deselect)
      await t.step(page);
      await expect(page.locator('.volto-hydra-block-outline')).not.toBeVisible({
        timeout: 3000,
      });
    });
  }

  test('Enter or click in block mode re-enters text editing', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const iframe = helper.getIframe();

    // Click a Slate text block — enters text editing mode
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForIframeBlockHandle('block-1-uuid');

    // First Escape: enter block mode
    await helper.escapeFromEditing();

    // Verify block mode: editor field should not be contenteditable
    const editor = await helper.getEditorLocator('block-1-uuid', 'value');
    await expect(editor).not.toHaveAttribute('contenteditable', 'true', { timeout: 3000 });

    // Click the text area again — should re-enter text editing mode
    await editor.click();

    // Field should become contenteditable again
    await expect(editor).toHaveAttribute('contenteditable', 'true', { timeout: 5000 });
  });

  test('Arrow Down in block mode moves to next block', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Click block-1, enter block mode
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForIframeBlockHandle('block-1-uuid');
    await helper.escapeFromEditing();

    // Arrow Down twice to reach block-3 (Slate text block) — must stay in block mode
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await helper.waitForIframeBlockHandle('block-3-uuid');

    // Should still be in block mode (full border, not subtle/text mode)
    await expect(page.locator('.volto-hydra-block-outline[data-outline-style="border"]'))
      .toBeVisible({ timeout: 3000 });
  });

  test('Arrow through non-editable block stays in text mode', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    // block-1 (slate text), block-2 (image, no fields), block-3 (slate text)
    // Click block-1, cursor at end
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForIframeBlockHandle('block-1-uuid');

    // Verify text mode (subtle border)
    await expect(page.locator('.volto-hydra-block-outline[data-outline-style="subtle"]'))
      .toBeVisible({ timeout: 3000 });

    // ArrowDown at end → lands on block-2 (image, no editable fields)
    // Should show block mode border for this block but editMode stays 'text'
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowDown');
    await helper.waitForIframeBlockHandle('block-2-uuid');

    // ArrowDown again → lands on block-3 (slate text)
    // Should re-enter text mode (subtle border) because editMode is 'text'
    await page.keyboard.press('ArrowDown');
    await helper.waitForIframeBlockHandle('block-3-uuid');

    // Should be in text mode with cursor at start
    await expect(page.locator('.volto-hydra-block-outline[data-outline-style="subtle"]'))
      .toBeVisible({ timeout: 3000 });
  });

  test('Arrow Down navigates between nested blocks inside a container', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    // Click text-1a (inside col-1 of columns-1), enter block mode
    await helper.clickBlockInIframe('text-1a');
    await helper.waitForIframeBlockHandle('text-1a');
    await helper.escapeFromEditing();

    // Arrow Down should move to text-1b (sibling inside same column)
    await page.keyboard.press('ArrowDown');
    await helper.waitForIframeBlockHandle('text-1b');

    // Should still be in block mode
    await expect(page.locator('.volto-hydra-block-outline[data-outline-style="border"]'))
      .toBeVisible({ timeout: 3000 });
  });

  test('Cmd+A in text mode selects all text, second enters block mode, third selects all siblings', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();

    // Click text-1a inside col-1 — enters text mode
    await helper.clickBlockInIframe('text-1a');
    await helper.waitForIframeBlockHandle('text-1a');

    // Verify text mode (subtle border)
    await expect(page.locator('.volto-hydra-block-outline[data-outline-style="subtle"]'))
      .toBeVisible({ timeout: 3000 });

    // First Cmd+A: selects all text in field (browser native)
    await page.keyboard.press('ControlOrMeta+a');

    // Should still be in text mode with text selected
    const hasTextSelection = await iframe.locator('body').evaluate(() => {
      const sel = window.getSelection();
      return sel ? sel.toString().length > 0 : false;
    });
    expect(hasTextSelection).toBe(true);
    await expect(page.locator('.volto-hydra-block-outline[data-outline-style="subtle"]'))
      .toBeVisible({ timeout: 2000 });

    // Second Cmd+A: enters block mode (selects block, not text)
    await page.keyboard.press('ControlOrMeta+a');
    await expect(page.locator('.volto-hydra-block-outline[data-outline-style="border"]'))
      .toBeVisible({ timeout: 3000 });

    // Third Cmd+A: selects all sibling blocks (multi-selection).
    // col-1 has 3 children: text-1a, text-1b, col1-img-1.
    await page.keyboard.press('ControlOrMeta+a');

    await helper.waitForMultiSelectOutlines(3);

    // Sidebar should show "3 selected" summary bar
    await expect(page.locator('.multi-select-bar'))
      .toContainText('3 selected', { timeout: 3000 });
  });

  test('Cmd+A in block mode selects all sibling blocks', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    // Click text-1a, enter block mode
    await helper.clickBlockInIframe('text-1a');
    await helper.waitForIframeBlockHandle('text-1a');
    await helper.escapeFromEditing();

    // Verify block mode
    await expect(page.locator('.volto-hydra-block-outline[data-outline-style="border"]'))
      .toBeVisible({ timeout: 3000 });

    // Cmd+A should select all siblings (text-1a + text-1b)
    await page.keyboard.press('ControlOrMeta+a');

    await helper.waitForMultiSelectOutlines(2);
  });

  test('Cmd+A on non-editable block selects all sibling blocks', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Click image block (non-editable — no contenteditable fields)
    await helper.clickBlockInIframe('block-2-uuid');
    await helper.waitForIframeBlockHandle('block-2-uuid');

    // Already in block mode (image has no editable fields)
    await expect(page.locator('.volto-hydra-block-outline[data-outline-style="border"]'))
      .toBeVisible({ timeout: 3000 });

    // Cmd+A should select all page-level siblings
    await page.keyboard.press('ControlOrMeta+a');

    await helper.waitForMultiSelectOutlines(3);
  });

  // Subsequent Cmd+A presses walk up the parent chain
  test('Cmd+A escalates up through parent containers', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    // Enter text mode on text-1a (deepest leaf)
    await helper.clickBlockInIframe('text-1a');
    await helper.waitForIframeBlockHandle('text-1a');

    // Press 1: text in field. Press 2: block mode. Press 3: siblings in
    // col-1 (text-1a, text-1b, col1-img-1 = 3 blocks).
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+a');
    await helper.waitForMultiSelectOutlines(3);
    const level3Count = await page.locator('.selected-block-path').count();
    expect(level3Count).toBe(3);

    // Press 4: escalate to siblings of col-1 (inside columns-1). The
    // signal is that a Column entry (col-2) shows up in the selection —
    // counts alone aren't enough since columns-1 has only 2 columns,
    // matching col-1's 2 children.
    const level4Count = await helper.escalateSelection('Column');

    // Press 5: escalate to columns-1's siblings (page level). Page has title + columns-1 + text-after + grid-1.
    // Page-level siblings include 'Title' (title-block type), absent from every
    // level below, so it identifies the top without relying on counts.
    const level5Count = await helper.escalateSelection('Title');

    // Further presses: no-op (already at page root — escalation has nowhere to
    // go). Nothing should change, so wait for a frame boundary rather than a
    // sleep: the handler runs as a microtask, so by the next frame it has either
    // acted or never will.
    await page.keyboard.press('ControlOrMeta+a');
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    );
    expect(await page.locator('.selected-block-path').count()).toBe(level5Count);
  });

  test('Shift+Arrow extend and shrink shows correct outline at each step', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();
    const outline = page.locator('.volto-hydra-block-outline');

    // Click text-1a inside col-1, enter block mode
    await helper.clickBlockInIframe('text-1a');
    await helper.waitForIframeBlockHandle('text-1a');
    await helper.escapeFromEditing();

    // Step 1: Single block — full border around text-1a only
    await expect(outline).toHaveAttribute('data-outline-style', 'border', { timeout: 3000 });
    const singleBox = await outline.boundingBox();
    expect(singleBox).not.toBeNull();

    // Step 2: Shift+ArrowDown — multi-select text-1a + text-1b
    await page.keyboard.press('Shift+ArrowDown');
    await helper.waitForMultiSelectOutlines(2);

    // Step 3: Shift+ArrowUp — shrink back to single block (text-1a)
    await page.keyboard.press('Shift+ArrowUp');

    // Should be exactly one outline with block mode border, NOT multi-select
    await expect(outline).toHaveCount(1, { timeout: 3000 });
    await expect(outline).toHaveAttribute('data-outline-style', 'border', { timeout: 3000 });

    // Outline should be back to single-block size (not the combined box)
    await expect(async () => {
      const box = await outline.boundingBox();
      expect(box).not.toBeNull();
      // Should be approximately the same height as the original single block
      expect(Math.abs(box!.height - singleBox!.height)).toBeLessThan(20);
    }).toPass({ timeout: 5000 });

    // No browser text selection should remain
    const hasTextSelection = await iframe.locator('body').evaluate(() => {
      const sel = window.getSelection();
      return sel ? sel.toString().length > 0 : false;
    });
    expect(hasTextSelection).toBe(false);
  });

  test('Shift+Arrow Down in block mode extends multi-selection', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Click block-1, enter block mode
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForIframeBlockHandle('block-1-uuid');
    await helper.escapeFromEditing();

    // Shift+ArrowDown should extend selection to include block-2
    await page.keyboard.press('Shift+ArrowDown');

    await helper.waitForMultiSelectOutlines(2);
  });
});

test.describe('Multi-Block Selection', () => {
  test('Shift+Click on same block in block mode enters text mode', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();

    // Click text-1a, enter block mode
    await helper.clickBlockInIframe('text-1a');
    await helper.waitForIframeBlockHandle('text-1a');
    await helper.escapeFromEditing();

    // Verify block mode
    await expect(page.locator('.volto-hydra-block-outline[data-outline-style="border"]'))
      .toBeVisible({ timeout: 3000 });

    // Shift+Click on the SAME block (text-1a)
    const textField1a = await helper.getEditorLocator('text-1a', 'value');
    await textField1a.click({ modifiers: ['Shift'] });

    // Should enter text mode: subtle border + field underline + toolbar
    await expect(page.locator('.volto-hydra-block-outline[data-outline-style="subtle"]'))
      .toBeVisible({ timeout: 3000 });
    await expect(page.locator('.volto-hydra-field-underline')).toBeVisible({ timeout: 3000 });
    await helper.waitForBlockSelectedInAdmin('text-1a');
  });

  test('Shift+Click on text block from block mode multi-selects (not text mode)', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const iframe = helper.getIframe();

    // Click block-1 (Slate text) and enter block mode
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForIframeBlockHandle('block-1-uuid');
    await helper.escapeFromEditing();

    // Verify we're in block mode (full border, not subtle)
    await expect(page.locator('.volto-hydra-block-outline[data-outline-style="border"]'))
      .toBeVisible({ timeout: 3000 });

    // Shift+Click directly on the TEXT inside block-3 (another Slate block)
    // This must trigger multi-select, NOT enter text editing on block-3
    const textField3 = await helper.getEditorLocator('block-3-uuid', 'value');
    await textField3.click({ modifiers: ['Shift'] });

    await helper.waitForMultiSelectOutlines(2);

    // Should NOT be in text mode — field should not be contenteditable
    await expect(textField3).not.toHaveAttribute('contenteditable', 'true', { timeout: 2000 });
  });

  test('Shift+Click selects range of blocks', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const iframe = helper.getIframe();

    // Click first block and enter block mode (Shift+Click only works in block mode)
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForIframeBlockHandle('block-1-uuid');
    await helper.escapeFromEditing();

    // Get single block outline height for comparison
    const singleOutline = page.locator('.volto-hydra-block-outline');
    await expect(singleOutline).toBeVisible({ timeout: 5000 });
    const singleBox = await singleOutline.boundingBox();

    // Enable debug to trace click handler
    await iframe.locator('body').evaluate(() => { (window as any).HYDRA_DEBUG = true; });

    // Shift+Click third block — should select range block-1 through block-3
    await iframe.locator('[data-block-uid="block-3-uuid"]').click({ modifiers: ['Shift'] });

    // Should have individual outlines on all blocks in the range
    await helper.waitForMultiSelectOutlines(3);

    // Debug: check toolbar DOM state
    const toolbarInfo = await page.evaluate(() => {
      const t = document.querySelector('.quanta-toolbar');
      return t ? { html: t.outerHTML.substring(0, 300), multiSelect: t.getAttribute('data-multi-select') } : 'NO TOOLBAR';
    });
    console.log('Toolbar state:', JSON.stringify(toolbarInfo));

    // Multi-select toolbar should show block count (not format buttons)
    const toolbar = page.locator('.quanta-toolbar[data-multi-select="true"]');
    await expect(toolbar).toBeVisible({ timeout: 3000 });
  });

  test('Ctrl+Click toggles block in/out of selection', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const iframe = helper.getIframe();

    // Click first block
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForIframeBlockHandle('block-1-uuid');

    // Ctrl/Meta+Click third block — outline should expand to cover both
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await iframe.locator('[data-block-uid="block-3-uuid"]').click({ modifiers: [modifier] });

    await helper.waitForMultiSelectOutlines(2);
  });

  test('Click clears multi-selection back to single', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const iframe = helper.getIframe();

    // Create multi-selection via Shift+Click (need block mode first)
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForIframeBlockHandle('block-1-uuid');
    await helper.escapeFromEditing();
    await iframe.locator('[data-block-uid="block-3-uuid"]').click({ modifiers: ['Shift'] });

    await helper.waitForMultiSelectOutlines(2);

    // Plain click on block-2 — should clear multi-selection
    await helper.clickBlockInIframe('block-2-uuid');
    await helper.waitForIframeBlockHandle('block-2-uuid');

    // Should be back to single outline (multi-select outline removed)
    await expect(page.locator('.volto-hydra-block-outline')).toHaveCount(1, { timeout: 5000 });

    // Quanta toolbar should be back (single-select mode)
    await helper.waitForBlockSelectedInAdmin('block-2-uuid');
  });

  test('Delete via left toolbar removes all multi-selected blocks', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const iframe = helper.getIframe();

    // Select block-1, enter block mode, Shift+ArrowDown twice to select block-1 + block-2 + block-3
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForIframeBlockHandle('block-1-uuid');
    await helper.escapeFromEditing();
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowDown');

    await helper.waitForMultiSelectOutlines(2);

    // Click delete on left toolbar
    const deleteButton = page.locator('button[aria-label="Delete blocks"]');
    await expect(deleteButton).toBeVisible({ timeout: 3000 });
    await deleteButton.click();

    // All three blocks should be gone
    await expect(iframe.locator('[data-block-uid="block-1-uuid"]')).not.toBeVisible({ timeout: 5000 });
    await expect(iframe.locator('[data-block-uid="block-2-uuid"]')).not.toBeVisible({ timeout: 5000 });
    await expect(iframe.locator('[data-block-uid="block-3-uuid"]')).not.toBeVisible({ timeout: 5000 });

    // Outlines should be gone
    await expect(page.locator('.volto-hydra-block-outline')).not.toBeVisible({ timeout: 3000 });
  });

  // Regression: ChildBlocksWidget's onClick handler used to close over
  // useSelector's `multiSelected`. Two ctrl+clicks fired back-to-back (no
  // React re-render between them) both saw the pre-first-click value, so
  // the second dispatch overwrote the first instead of appending —
  // multiSelected ended up containing only the second item. This is hard
  // to surface from the existing 'Ctrl+Click in sidebar block list…'
  // test because the failure depends on click timing relative to React
  // render commits. This test forces the race by issuing both clicks
  // via dispatchEvent in a single page.evaluate (zero React render time
  // between them) and asserts both ids end up in multiSelected.
  test('two rapid ctrl+clicks in ChildBlocksWidget both multi-select (no stale-closure overwrite)', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    // Navigate the sidebar so col-1 is current and its child rows render.
    await helper.clickBlockInIframe('text-1a');
    await helper.waitForIframeBlockHandle('text-1a');
    await helper.escapeToParent();
    await helper.waitForIframeBlockHandle('col-1');

    const blockList = page.locator('.child-blocks-widget');
    await expect(blockList.locator('.child-block-item')).toHaveCount(3);

    // Fire both ctrl+click events synchronously via JS — no awaits, no
    // React render commit between them. The pre-fix code would overwrite
    // the first dispatch with the second; the fix reads fresh state from
    // the store at click time so both append.
    await page.evaluate(() => {
      const rows = document.querySelectorAll(
        '.child-blocks-widget .child-block-item',
      );
      const fire = (el: Element) => {
        const ev = new MouseEvent('click', {
          bubbles: true, cancelable: true, ctrlKey: true, metaKey: true,
        });
        el.dispatchEvent(ev);
      };
      fire(rows[0]);
      fire(rows[1]);
    });

    // Both rows should end up with .selected class.
    await expect(blockList.locator('.child-block-item.selected'))
      .toHaveCount(2, { timeout: 5_000 });
  });

  test('Ctrl+Click in sidebar block list multi-selects and highlights blocks', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    // Navigate into col-1 to see its children
    await helper.clickBlockInIframe('text-1a');
    await helper.waitForIframeBlockHandle('text-1a');
    await helper.escapeToParent();
    await helper.waitForIframeBlockHandle('col-1');

    const blockList = page.locator('.child-blocks-widget');
    await expect(blockList).toBeVisible({ timeout: 5000 });

    // Ctrl+Click first item (text-1a)
    await blockList.locator('.child-block-item').first().click({ modifiers: ['ControlOrMeta'] });
    // Ctrl+Click second item (text-1b — col-1 has text-1a, text-1b, col1-img-1)
    await blockList.locator('.child-block-item').nth(1).click({ modifiers: ['ControlOrMeta'] });

    // Both items should be highlighted in the block list
    await expect(blockList.locator('.child-block-item.selected'))
      .toHaveCount(2, { timeout: 5000 });

    // Summary bar should show count (in sidebar, not inside blockList)
    await expect(page.locator('.multi-select-bar'))
      .toContainText('2 selected', { timeout: 3000 });

    // Block list should remain visible (not replaced by summary)
    await expect(blockList).toBeVisible();

    // Sidebar view should NOT have changed — still showing col-1's children
    // (Ctrl+Click toggles selection, doesn't navigate to the clicked block)
    await expect(blockList.locator('.child-block-item')).toHaveCount(3);
  });

  test('Shift+Click in sidebar block list selects range and highlights', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Navigate to page-level block list
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForIframeBlockHandle('block-1-uuid');
    const backArrow = page.locator('.sidebar-section-header .nav-back').last();
    await expect(backArrow).toBeVisible({ timeout: 5000 });
    await backArrow.click();

    const blockList = page.locator('.child-blocks-widget');
    await expect(blockList).toBeVisible({ timeout: 5000 });

    // Ctrl+Click first item to set anchor and enter selection mode
    await blockList.locator('.child-block-item').first().click({ modifiers: ['ControlOrMeta'] });

    // Shift+Click third item to extend range to items 0, 1, 2
    const thirdItem = blockList.locator('.child-block-item').nth(2);
    await expect(thirdItem).toBeVisible({ timeout: 3000 });
    await thirdItem.click({ modifiers: ['Shift'] });

    // 3 items should be highlighted
    await expect(blockList.locator('.child-block-item.selected'))
      .toHaveCount(3, { timeout: 5000 });

    // Summary bar at bottom of sidebar
    await expect(page.locator('.multi-select-bar'))
      .toContainText('3 selected', { timeout: 3000 });
  });

  test('Delete via left toolbar removes blocks from different containers', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();

    // Select text-1a (inside col-1), enter block mode
    await helper.clickBlockInIframe('text-1a');
    await helper.waitForIframeBlockHandle('text-1a');
    await helper.escapeFromEditing();

    // Ctrl+Click text-2a (inside col-2) to add to multi-selection
    await iframe.locator('[data-block-uid="text-2a"]').click({ modifiers: ['ControlOrMeta'] });
    await helper.waitForMultiSelectOutlines(2);

    // Click delete on left toolbar
    const deleteButton = page.locator('button[aria-label="Delete blocks"]');
    await expect(deleteButton).toBeVisible({ timeout: 3000 });
    await deleteButton.click();

    // Both blocks should be gone
    await expect(iframe.locator('[data-block-uid="text-1a"]')).not.toBeVisible({ timeout: 5000 });
    await expect(iframe.locator('[data-block-uid="text-2a"]')).not.toBeVisible({ timeout: 5000 });
  });

  test('Delete key removes all multi-selected blocks', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const iframe = helper.getIframe();

    // Verify block-1 and block-3 exist
    await expect(iframe.locator('[data-block-uid="block-1-uuid"]')).toBeVisible();
    await expect(iframe.locator('[data-block-uid="block-3-uuid"]')).toBeVisible();

    // Select block-1, enter block mode, Shift+ArrowDown twice to select block-1 + block-2 + block-3
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForIframeBlockHandle('block-1-uuid');
    await helper.escapeFromEditing();
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowDown');

    await helper.waitForMultiSelectOutlines(2);

    // Press Delete — should remove all three selected blocks
    await page.keyboard.press('Delete');

    // block-1, block-2 (image), block-3 should all be gone from iframe
    await expect(iframe.locator('[data-block-uid="block-1-uuid"]')).not.toBeVisible({ timeout: 5000 });
    await expect(iframe.locator('[data-block-uid="block-2-uuid"]')).not.toBeVisible({ timeout: 5000 });
    await expect(iframe.locator('[data-block-uid="block-3-uuid"]')).not.toBeVisible({ timeout: 5000 });

    // Multi-selection outline should be gone
    await expect(page.locator('.volto-hydra-block-outline')).not.toBeVisible({ timeout: 3000 });
  });

  test('Cmd+C in block mode copies block to clipboard', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Click block-1, enter block mode
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForIframeBlockHandle('block-1-uuid');
    await helper.escapeFromEditing();

    // Cmd+C in block mode should send COPY_BLOCKS to admin
    await page.keyboard.press('ControlOrMeta+c');

    // Verify the blocksClipboard Redux state was set
    // BlocksToolbar renders a paste button when clipboard has content
    // We can check by looking for the paste button in the toolbar
    const pasteButton = page.locator('#toolbar-paste-blocks');
    await expect(pasteButton).toBeVisible({ timeout: 3000 });
  });

  test('Multi-select shows left toolbar buttons (copy/cut/delete)', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Click block-1, enter block mode, Shift+ArrowDown to multi-select
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForIframeBlockHandle('block-1-uuid');
    await helper.escapeFromEditing();
    await page.keyboard.press('Shift+ArrowDown');

    // Left toolbar should show copy, cut, and delete buttons
    await expect(page.locator('#toolbar-copy-blocks')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#toolbar-cut-blocks')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('#toolbar-delete-blocks')).toBeVisible({ timeout: 3000 });
  });

  test('Multi-select shows right sidebar summary', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Click block-1, enter block mode, Shift+ArrowDown to multi-select 2 blocks
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForIframeBlockHandle('block-1-uuid');
    await helper.escapeFromEditing();
    await page.keyboard.press('Shift+ArrowDown');

    // Right sidebar should show multi-select summary bar
    const summary = page.locator('.multi-select-bar');
    await expect(summary).toBeVisible({ timeout: 5000 });
    await expect(summary).toContainText('2 selected');
  });

  test('Copy block and paste after another block', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');
    const iframe = helper.getIframe();

    const initialOrder = await helper.getBlockOrder();
    const initialCount = initialOrder.length;

    // Select block-1, enter block mode, copy
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForIframeBlockHandle('block-1-uuid');
    await helper.escapeFromEditing();
    await page.keyboard.press('ControlOrMeta+c');

    // Paste button should appear in left toolbar
    const pasteButton = page.locator('#toolbar-paste-blocks');
    await expect(pasteButton).toBeVisible({ timeout: 3000 });

    // Click block-3 to select as paste target
    await helper.clickBlockInIframe('block-3-uuid');
    await helper.waitForIframeBlockHandle('block-3-uuid');
    await expect(pasteButton).toBeVisible({ timeout: 3000 });

    // Click paste — block should be inserted after block-3
    await pasteButton.click();

    // Verify: one more block, and it appears after block-3
    await expect(async () => {
      const newOrder = await helper.getBlockOrder();
      expect(newOrder.length).toBe(initialCount + 1);
      const block3Idx = newOrder.indexOf('block-3-uuid');
      // New block is right after block-3
      expect(block3Idx).toBeGreaterThanOrEqual(0);
      expect(block3Idx + 1).toBeLessThan(newOrder.length);
      // The new block should NOT be any of the original blocks
      expect(initialOrder).not.toContain(newOrder[block3Idx + 1]);
    }).toPass({ timeout: 5000 });
  });

  test('Multi-select copy and paste inserts all blocks', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');
    const iframe = helper.getIframe();

    const initialOrder = await helper.getBlockOrder();
    const initialCount = initialOrder.length;

    // Select block-1 in block mode, Shift+Arrow to also select block-2
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForIframeBlockHandle('block-1-uuid');
    await helper.escapeFromEditing();
    await page.keyboard.press('Shift+ArrowDown');

    // Left toolbar should show copy button for multi-selection
    const copyButton = page.locator('#toolbar-copy-blocks');
    await expect(copyButton).toBeVisible({ timeout: 5000 });

    // Copy via left toolbar button
    await copyButton.click();

    // All outlines should clear after copy (no block selected until user clicks)
    await expect(page.locator('.volto-hydra-block-outline')).toHaveCount(0, { timeout: 5000 });

    // Click block-3 to set paste target
    await helper.clickBlockInIframe('block-3-uuid');
    await helper.waitForIframeBlockHandle('block-3-uuid');

    // Paste button should show with count of 2
    const pasteButton = page.locator('#toolbar-paste-blocks');
    await expect(pasteButton).toBeVisible({ timeout: 3000 });
    await expect(pasteButton.locator('.blockCount')).toHaveText('2');

    // Click paste
    await pasteButton.click();

    // Verify: two more blocks inserted after block-3
    await expect(async () => {
      const newOrder = await helper.getBlockOrder();
      expect(newOrder.length).toBe(initialCount + 2);
    }).toPass({ timeout: 5000 });
  });

  test('Paste button is disabled when block type not allowed in target container', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    // Copy a text block (type=slate) from inside a column
    await helper.clickBlockInIframe('text-1a');
    await helper.waitForIframeBlockHandle('text-1a');
    await helper.escapeFromEditing();
    await page.keyboard.press('ControlOrMeta+c');

    // Paste button should appear
    const pasteButton = page.locator('#toolbar-paste-blocks');
    await expect(pasteButton).toBeVisible({ timeout: 3000 });

    // Navigate to col-1 via Escape from text-1a (text mode → block mode → parent)
    // col-1's parent (columns-1) only allows 'column' children,
    // so pasting 'slate' after col-1 is not allowed
    await helper.clickBlockInIframe('text-1a');
    await helper.waitForIframeBlockHandle('text-1a');
    await helper.escapeFromEditing();  // text mode → block mode
    await page.keyboard.press('Escape');  // block mode → select parent (col-1)
    await helper.waitForBlockSelectedInAdmin('col-1');

    // Left toolbar paste button should be disabled
    await expect(pasteButton).toBeVisible({ timeout: 5000 });
    await expect(pasteButton).toBeDisabled({ timeout: 5000 });

    // Dropdown paste item should be hidden when not allowed
    const menuButton = page.locator('.quanta-toolbar .volto-hydra-menu-trigger');
    await menuButton.click();
    const dropdown = page.locator('.volto-hydra-dropdown-menu');
    await expect(dropdown).toBeVisible({ timeout: 3000 });
    await expect(dropdown.locator('[data-action="paste-block"]')).not.toBeVisible();
    await menuButton.click(); // close

    // Cmd+V should be a no-op — block count shouldn't change
    const iframe = helper.getIframe();
    const blocksBefore = await iframe.locator('[data-block-uid]').count();
    await page.keyboard.press('ControlOrMeta+v');
    // Small wait then verify count unchanged
    await page.waitForTimeout(500);
    const blocksAfter = await iframe.locator('[data-block-uid]').count();
    expect(blocksAfter).toBe(blocksBefore);
  });

  test('Quanta toolbar dropdown has copy/cut/paste actions for single block', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Select block-1
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForIframeBlockHandle('block-1-uuid');

    // Open the ⋯ dropdown
    const menuButton = page.locator('.quanta-toolbar .volto-hydra-menu-trigger');
    await expect(menuButton).toBeVisible({ timeout: 3000 });
    await menuButton.click();

    // Should have copy and cut items
    const dropdown = page.locator('.volto-hydra-dropdown-menu');
    await expect(dropdown).toBeVisible({ timeout: 3000 });
    await expect(dropdown.locator('[data-action="copy-block"]')).toBeVisible();
    await expect(dropdown.locator('[data-action="cut-block"]')).toBeVisible();

    // Click copy
    await dropdown.locator('[data-action="copy-block"]').click();

    // Re-select block and reopen menu — paste should now be available
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForIframeBlockHandle('block-1-uuid');
    await expect(menuButton).toBeVisible({ timeout: 3000 });
    await menuButton.click();
    await expect(dropdown.locator('[data-action="paste-block"]')).toBeVisible();
  });

  test('Quanta toolbar dropdown has copy/cut for multi-selected blocks', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Multi-select: block-1 + block-2
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForIframeBlockHandle('block-1-uuid');
    await helper.escapeFromEditing();
    await page.keyboard.press('Shift+ArrowDown');

    // Multi-select toolbar should have ⋯ button
    const toolbar = page.locator('.quanta-toolbar[data-multi-select="true"]');
    await expect(toolbar).toBeVisible({ timeout: 5000 });
    const menuButton = toolbar.locator('.volto-hydra-menu-trigger');
    await expect(menuButton).toBeVisible({ timeout: 3000 });
    await menuButton.click();

    // Should have copy, cut, delete items
    const dropdown = page.locator('.volto-hydra-dropdown-menu');
    await expect(dropdown).toBeVisible({ timeout: 3000 });
    await expect(dropdown.locator('[data-action="copy-block"]')).toBeVisible();
    await expect(dropdown.locator('[data-action="cut-block"]')).toBeVisible();
  });

  test('Paste from quanta toolbar dropdown inserts block', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');
    const iframe = helper.getIframe();

    const initialOrder = await helper.getBlockOrder();
    const initialCount = initialOrder.length;

    // Copy block-1 via keyboard
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForIframeBlockHandle('block-1-uuid');
    await helper.escapeFromEditing();
    await page.keyboard.press('ControlOrMeta+c');

    // Select block-3
    await helper.clickBlockInIframe('block-3-uuid');
    await helper.waitForIframeBlockHandle('block-3-uuid');

    // Open ⋯ dropdown and click paste
    const menuButton = page.locator('.quanta-toolbar .volto-hydra-menu-trigger');
    await menuButton.click();
    const dropdown = page.locator('.volto-hydra-dropdown-menu');
    await expect(dropdown.locator('[data-action="paste-block"]')).toBeVisible({ timeout: 3000 });
    await dropdown.locator('[data-action="paste-block"]').click();

    // Should have one more block
    await expect(async () => {
      const newOrder = await helper.getBlockOrder();
      expect(newOrder.length).toBe(initialCount + 1);
    }).toPass({ timeout: 5000 });
  });

  test('Cmd+V in block mode pastes blocks from clipboard', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');
    const iframe = helper.getIframe();

    const initialOrder = await helper.getBlockOrder();
    const initialCount = initialOrder.length;

    // Select block-1, enter block mode, copy
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForIframeBlockHandle('block-1-uuid');
    await helper.escapeFromEditing();
    await page.keyboard.press('ControlOrMeta+c');

    // Paste button should appear (clipboard has content)
    const pasteButton = page.locator('#toolbar-paste-blocks');
    await expect(pasteButton).toBeVisible({ timeout: 3000 });

    // ArrowDown to move to block-2 (stay in block mode)
    await page.keyboard.press('ArrowDown');

    // Cmd+V in block mode should paste after currently selected block
    await page.keyboard.press('ControlOrMeta+v');

    // Should have one more block
    await expect(async () => {
      const newOrder = await helper.getBlockOrder();
      expect(newOrder.length).toBe(initialCount + 1);
    }).toPass({ timeout: 5000 });
  });

  test('Cut blocks removes originals after paste', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');
    const iframe = helper.getIframe();

    const initialOrder = await helper.getBlockOrder();
    const initialCount = initialOrder.length;

    // Select block-1, enter block mode
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForIframeBlockHandle('block-1-uuid');
    await helper.escapeFromEditing();

    // Cut via Cmd+X (block mode sends COPY_BLOCKS with action='cut')
    await page.keyboard.press('ControlOrMeta+x');

    // block-1 should be removed (cut deletes immediately)
    await expect(async () => {
      const order = await helper.getBlockOrder();
      expect(order).not.toContain('block-1-uuid');
    }).toPass({ timeout: 5000 });

    // Click block-3 to set paste target
    await helper.clickBlockInIframe('block-3-uuid');
    await helper.waitForIframeBlockHandle('block-3-uuid');

    // Paste button should be visible
    const pasteButton = page.locator('#toolbar-paste-blocks');
    await expect(pasteButton).toBeVisible({ timeout: 3000 });

    // Click paste — block-1 data pasted after block-3 (same count as before cut)
    await pasteButton.click();

    await expect(async () => {
      const newOrder = await helper.getBlockOrder();
      // Cut removes 1, paste adds 1 — same total count
      expect(newOrder.length).toBe(initialCount);
    }).toPass({ timeout: 5000 });
  });

  test('Multi-select Cmd+X cuts multiple blocks', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');
    const iframe = helper.getIframe();

    const initialOrder = await helper.getBlockOrder();
    const initialCount = initialOrder.length;

    // Select block-1, block mode, extend to block-2
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForIframeBlockHandle('block-1-uuid');
    await helper.escapeFromEditing();
    await page.keyboard.press('Shift+ArrowDown');

    // Cmd+X should cut both blocks
    await page.keyboard.press('ControlOrMeta+x');

    // Both blocks should be removed
    await expect(async () => {
      const order = await helper.getBlockOrder();
      expect(order).not.toContain('block-1-uuid');
      expect(order).not.toContain('block-2-uuid');
      expect(order.length).toBe(initialCount - 2);
    }).toPass({ timeout: 5000 });

    // Paste button should show count of 2
    // Select block-3 first to have a paste target
    await helper.clickBlockInIframe('block-3-uuid');
    await helper.waitForIframeBlockHandle('block-3-uuid');
    const pasteButton = page.locator('#toolbar-paste-blocks');
    await expect(pasteButton).toBeVisible({ timeout: 3000 });
    await expect(pasteButton.locator('.blockCount')).toHaveText('2');
  });

  test('Escape clears multi-selection back to single block', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Select block-1, block mode, extend to block-2
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForIframeBlockHandle('block-1-uuid');
    await helper.escapeFromEditing();
    await page.keyboard.press('Shift+ArrowDown');

    // Multi-select toolbar should be visible
    await expect(page.locator('.quanta-toolbar[data-multi-select="true"]'))
      .toBeVisible({ timeout: 5000 });

    // Escape should clear multi-selection
    await page.keyboard.press('Escape');

    // Should be back to single-block toolbar (no data-multi-select)
    await expect(page.locator('.quanta-toolbar[data-multi-select="true"]'))
      .not.toBeVisible({ timeout: 3000 });

    // Should still have a block selected (block outline visible)
    await expect(page.locator('.volto-hydra-block-outline'))
      .toBeVisible({ timeout: 3000 });
  });

  test('Shift+Arrow multi-selects inside containers', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    // Click text-1a inside col-1, enter block mode
    await helper.clickBlockInIframe('text-1a');
    await helper.waitForIframeBlockHandle('text-1a');
    await helper.escapeFromEditing();

    // Shift+ArrowDown should select text-1a + text-1b (siblings in col-1)
    await page.keyboard.press('Shift+ArrowDown');

    // Multi-select toolbar should appear
    await expect(page.locator('.quanta-toolbar[data-multi-select="true"]'))
      .toBeVisible({ timeout: 5000 });

    // Right sidebar should show 2 selected summary bar
    const summary = page.locator('.multi-select-bar');
    await expect(summary).toBeVisible({ timeout: 5000 });
    await expect(summary).toContainText('2 selected');
  });

  test('Delete multi-selected blocks in container', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/container-test-page');
    const iframe = helper.getIframe();

    // Click text-1a, block mode, extend to text-1b
    await helper.clickBlockInIframe('text-1a');
    await helper.waitForIframeBlockHandle('text-1a');
    await helper.escapeFromEditing();
    await page.keyboard.press('Shift+ArrowDown');

    // Wait for multi-select
    await expect(page.locator('.quanta-toolbar[data-multi-select="true"]'))
      .toBeVisible({ timeout: 5000 });

    // Delete should remove both blocks from the container
    await page.keyboard.press('Delete');

    // Both text blocks should be gone from col-1
    await expect(async () => {
      await expect(iframe.locator('[data-block-uid="text-1a"]')).not.toBeVisible();
      await expect(iframe.locator('[data-block-uid="text-1b"]')).not.toBeVisible();
    }).toPass({ timeout: 5000 });
  });

  test('Shift+Click across containers toggles block into selection (no range)', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    // Click text-1a (inside col-1), block mode
    await helper.clickBlockInIframe('text-1a');
    await helper.waitForIframeBlockHandle('text-1a');
    await helper.escapeFromEditing();

    // Shift+Click on text-2a (inside col-2 — different container)
    // Range can't span containers, so Shift+Click falls through to toggle behavior
    // (Option D): multiSelected becomes [text-1a, text-2a] — both selected, no range between
    const iframe = helper.getIframe();
    await iframe.locator('[data-block-uid="text-2a"]').click({ modifiers: ['Shift'] });

    // Both blocks should be selected (summary bar shows 2)
    await expect(page.locator('.multi-select-bar'))
      .toContainText('2 selected', { timeout: 5000 });
  });

  test('Ctrl+Click selects blocks from different containers and paste works', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();

    // Click text-1a (inside col-1), enter block mode
    await helper.clickBlockInIframe('text-1a');
    await helper.waitForIframeBlockHandle('text-1a');
    await helper.escapeFromEditing();

    // Ctrl+Click text-2a (inside col-2 — different container)
    await iframe.locator('[data-block-uid="text-2a"]').click({ modifiers: ['ControlOrMeta'] });

    // Should have multi-selection with blocks from both containers
    await expect(page.locator('.multi-select-bar'))
      .toContainText('2 selected', { timeout: 5000 });

    // Copy the multi-selected blocks
    await page.keyboard.press('ControlOrMeta+c');

    // Click on text-after (page-level block outside containers), enter block mode
    await helper.clickBlockInIframe('text-after');
    await helper.waitForIframeBlockHandle('text-after');
    await helper.escapeFromEditing();

    // Count blocks before paste
    const blocksBefore = await iframe.locator('[data-block-uid]').count();

    // Paste — should insert both blocks after text-after
    await page.keyboard.press('ControlOrMeta+v');

    // Verify two new blocks were inserted
    await expect(async () => {
      const blocksAfter = await iframe.locator('[data-block-uid]').count();
      expect(blocksAfter).toBe(blocksBefore + 2);
    }).toPass({ timeout: 5000 });
  });

  test('Long press enters selection mode, copy and paste via left toolbar', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const iframe = helper.getIframe();

    // Click block-1 to select it first
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForIframeBlockHandle('block-1-uuid');

    // Long press on block-1 — enters selection mode with checkbox overlays
    await helper.longPressBlock('block-1-uuid');

    // Block-1 should already be checked (long-pressed block)
    const checkbox1 = page.locator('.volto-hydra-selection-checkbox[data-block-uid="block-1-uuid"]');
    await expect(checkbox1).toHaveAttribute('data-checked', 'true', { timeout: 3000 });

    // Check block-2 as well
    const checkbox2 = page.locator('.volto-hydra-selection-checkbox[data-block-uid="block-2-uuid"]');
    await expect(checkbox2).toBeVisible({ timeout: 5000 });
    await checkbox2.click();

    // Sidebar should show 2 selected summary bar
    await expect(page.locator('.multi-select-bar'))
      .toContainText('2 selected', { timeout: 5000 });

    // Copy via left toolbar — auto-exits selection mode
    const copyButton = page.locator('button[aria-label="Copy blocks"]');
    await expect(copyButton).toBeVisible({ timeout: 3000 });
    await copyButton.click();

    // Checkboxes should be gone after copy
    await expect(page.locator('.volto-hydra-selection-checkbox').first())
      .not.toBeVisible({ timeout: 3000 });

    // Click block-3, enter block mode to paste after it
    await helper.clickBlockInIframe('block-3-uuid');
    await helper.waitForIframeBlockHandle('block-3-uuid');
    await helper.escapeFromEditing();

    // Count blocks before paste
    const blocksBefore = await iframe.locator('[data-block-uid]').count();

    // Paste via left toolbar
    const pasteButton = page.locator('button[aria-label="Paste blocks"]');
    await expect(pasteButton).toBeVisible({ timeout: 3000 });
    await pasteButton.click();

    // Should have 2 more blocks
    await expect(async () => {
      const blocksAfter = await iframe.locator('[data-block-uid]').count();
      expect(blocksAfter).toBe(blocksBefore + 2);
    }).toPass({ timeout: 5000 });
  });

  test('Exit selection mode button clears checkboxes and shows count badge', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Enter selection mode
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForIframeBlockHandle('block-1-uuid');
    await helper.longPressBlock('block-1-uuid');

    // Check block-2
    const checkbox2 = page.locator('.volto-hydra-selection-checkbox[data-block-uid="block-2-uuid"]');
    await expect(checkbox2).toBeVisible({ timeout: 5000 });
    await checkbox2.click();

    // Wait for multi-select state to update
    await expect(page.locator('.multi-select-bar'))
      .toContainText('2 selected', { timeout: 5000 });

    // Exit button should show count badge "2"
    const exitButton = page.locator('[data-testid="exit-selection-mode"]');
    await expect(exitButton).toBeVisible({ timeout: 3000 });
    await expect(exitButton.locator('.blockCount')).toContainText('2', { timeout: 2000 });

    // Click exit
    await exitButton.click();

    // Checkboxes should be gone
    await expect(page.locator('.volto-hydra-selection-checkbox').first())
      .not.toBeVisible({ timeout: 3000 });

    // Multi-select should be cleared
    await expect(page.locator('.multi-select-bar'))
      .not.toBeVisible({ timeout: 3000 });
  });

  test('Unticking all checkboxes exits selection mode', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Enter selection mode with block-1 checked
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForIframeBlockHandle('block-1-uuid');
    await helper.longPressBlock('block-1-uuid');

    // Block-1 is checked
    const checkbox1 = page.locator('.volto-hydra-selection-checkbox[data-block-uid="block-1-uuid"]');
    await expect(checkbox1).toHaveAttribute('data-checked', 'true', { timeout: 3000 });

    // Uncheck block-1 — now nothing is checked
    await checkbox1.click();

    // Selection mode should auto-exit — checkboxes gone
    await expect(page.locator('.volto-hydra-selection-checkbox').first())
      .not.toBeVisible({ timeout: 5000 });
  });

  test('Long press on unchecked block in selection mode checks it', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Enter selection mode with block-1 checked
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForIframeBlockHandle('block-1-uuid');
    await helper.longPressBlock('block-1-uuid');

    // Block-2 should be unchecked
    const checkbox2 = page.locator('.volto-hydra-selection-checkbox[data-block-uid="block-2-uuid"]');
    await expect(checkbox2).toHaveAttribute('data-checked', 'false', { timeout: 3000 });

    // Long press on block-2 — should check it (not start a new selection mode)
    await helper.longPressBlock('block-2-uuid');

    // Block-2 should now be checked
    await expect(checkbox2).toHaveAttribute('data-checked', 'true', { timeout: 3000 });

    // Block-1 should still be checked
    const checkbox1 = page.locator('.volto-hydra-selection-checkbox[data-block-uid="block-1-uuid"]');
    await expect(checkbox1).toHaveAttribute('data-checked', 'true', { timeout: 3000 });
  });

  test('Clicking block in iframe toggles it during selection mode', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const iframe = helper.getIframe();

    // Enter selection mode with block-1 checked
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForIframeBlockHandle('block-1-uuid');
    await helper.longPressBlock('block-1-uuid');

    // Click block-2 in the iframe (away from the checkbox overlay on the left edge)
    // In selection mode, this should toggle block-2, not select it
    await iframe.locator('[data-block-uid="block-2-uuid"]').click({ position: { x: 200, y: 50 } });

    // Block-2 should now be checked
    await expect(page.locator('.volto-hydra-selection-checkbox[data-block-uid="block-2-uuid"]'))
      .toHaveAttribute('data-checked', 'true', { timeout: 5000 });

    // Block-1 should still be checked
    await expect(page.locator('.volto-hydra-selection-checkbox[data-block-uid="block-1-uuid"]'))
      .toHaveAttribute('data-checked', 'true', { timeout: 3000 });

    // Click block-2 again in iframe — should uncheck it
    await iframe.locator('[data-block-uid="block-2-uuid"]').click({ position: { x: 200, y: 50 } });

    await expect(page.locator('.volto-hydra-selection-checkbox[data-block-uid="block-2-uuid"]'))
      .toHaveAttribute('data-checked', 'false', { timeout: 5000 });
  });

  test('Long press on checked block unchecks it', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Enter selection mode with block-1 checked
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForIframeBlockHandle('block-1-uuid');
    await helper.longPressBlock('block-1-uuid');

    // Block-1 is checked
    const checkbox1 = page.locator('.volto-hydra-selection-checkbox[data-block-uid="block-1-uuid"]');
    await expect(checkbox1).toHaveAttribute('data-checked', 'true', { timeout: 3000 });

    // Check block-2 first so we don't auto-exit on empty
    const checkbox2 = page.locator('.volto-hydra-selection-checkbox[data-block-uid="block-2-uuid"]');
    await expect(checkbox2).toBeVisible({ timeout: 5000 });
    await checkbox2.click();
    await expect(checkbox2).toHaveAttribute('data-checked', 'true', { timeout: 3000 });

    // Long press on block-1 (already checked) — should uncheck it
    await helper.longPressBlock('block-1-uuid');
    await expect(checkbox1).toHaveAttribute('data-checked', 'false', { timeout: 5000 });

    // Block-2 should still be checked
    await expect(checkbox2).toHaveAttribute('data-checked', 'true', { timeout: 3000 });
  });

  test('Long press during text editing enters selection mode', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Click block-1 — enters text mode (cursor in text)
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForIframeBlockHandle('block-1-uuid');

    // Verify text mode
    await expect(page.locator('.volto-hydra-block-outline[data-outline-style="subtle"]'))
      .toBeVisible({ timeout: 3000 });

    // Long press on block-1 while in text mode — should enter selection mode
    await helper.longPressBlock('block-1-uuid');

    // Checkboxes should appear
    await expect(page.locator('.volto-hydra-selection-checkbox[data-block-uid="block-1-uuid"]'))
      .toHaveAttribute('data-checked', 'true', { timeout: 3000 });
  });

  test('Shift+Click in text mode extends text selection, not multi-select', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const iframe = helper.getIframe();

    // Click block-1 — enters text mode
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForIframeBlockHandle('block-1-uuid');

    // Verify text mode (subtle border)
    await expect(page.locator('.volto-hydra-block-outline[data-outline-style="subtle"]'))
      .toBeVisible({ timeout: 3000 });

    // Shift+Click on block-3's text — should extend text selection, NOT multi-select
    const textField3 = await helper.getEditorLocator('block-3-uuid', 'value');
    await textField3.click({ modifiers: ['Shift'] });

    // Should NOT have multi-select summary bar
    await expect(page.locator('.multi-select-bar'))
      .not.toBeVisible({ timeout: 2000 });

    // Should still be in text mode (subtle border, not block mode border)
    await expect(page.locator('.volto-hydra-block-outline[data-outline-style="subtle"]'))
      .toBeVisible({ timeout: 2000 });
  });

  test('Ctrl+Click from text mode toggles block selection', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const iframe = helper.getIframe();

    // Click block-1 — enters text mode
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForIframeBlockHandle('block-1-uuid');

    // Ctrl+Click on block-3 — should toggle it into multi-selection regardless of mode
    await iframe.locator('[data-block-uid="block-3-uuid"]').click({ modifiers: ['ControlOrMeta'] });

    await helper.waitForMultiSelectOutlines(2);
  });

  test('Multi-select outlines reappear at correct positions after scroll', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const iframe = helper.getIframe();

    // Multi-select block-1 and block-3 via Ctrl+Click (selectedBlockUid becomes null)
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForIframeBlockHandle('block-1-uuid');
    await helper.escapeFromEditing();
    await iframe.locator('[data-block-uid="block-3-uuid"]').click({ modifiers: ['ControlOrMeta'] });
    await helper.waitForMultiSelectOutlines(2);

    // Scroll iframe down — outlines should disappear during scroll
    await iframe.locator('body').evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(page.locator('.volto-hydra-block-outline')).toHaveCount(0, { timeout: 1000 });

    // Scroll back to top
    await iframe.locator('body').evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);

    // Outlines should reappear correctly positioned on each block
    await expect(async () => {
      for (const uid of ['block-1-uuid', 'block-3-uuid']) {
        const outline = page.locator(`.volto-hydra-block-outline[data-block-uid="${uid}"]`);
        const outlineBox = await outline.boundingBox();
        const blockBox = await helper.getCombinedBlockBoundingBox([uid]);
        expect(outlineBox).not.toBeNull();
        expect(blockBox).not.toBeNull();
        expect(Math.abs(blockBox!.x - outlineBox!.x)).toBeLessThan(10);
        expect(Math.abs(blockBox!.y - outlineBox!.y)).toBeLessThan(10);
        expect(Math.abs(blockBox!.width - outlineBox!.width)).toBeLessThan(10);
        expect(Math.abs(blockBox!.height - outlineBox!.height)).toBeLessThan(10);
      }
    }).toPass({ timeout: 5000 });
  });

  // --- Unified Selection Mode tests (plan tasks 1-5) ---

  // Task 1: Iframe checkboxes on ALL visible blocks
  test('Selection mode shows checkboxes on blocks outside current container', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    // Click text-1a (inside col-1), enter selection mode via long press
    await helper.clickBlockInIframe('text-1a');
    await helper.waitForIframeBlockHandle('text-1a');
    await helper.longPressBlock('text-1a');

    // Checkbox should appear on text-after (page-level, different container)
    const textAfterCheckbox = page.locator('.volto-hydra-selection-checkbox[data-block-uid="text-after"]');
    await expect(textAfterCheckbox).toBeVisible({ timeout: 5000 });

    // Checkbox should also appear on text-2a (inside col-2, different container)
    const text2aCheckbox = page.locator('.volto-hydra-selection-checkbox[data-block-uid="text-2a"]');
    await expect(text2aCheckbox).toBeVisible({ timeout: 5000 });
  });

  // Task 2: ChildBlocksWidget highlighting and summary bar
  test('Multi-selected blocks are highlighted in sidebar ChildBlocksWidget', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    // Select text-1a, escape to col-1 level
    await helper.clickBlockInIframe('text-1a');
    await helper.waitForIframeBlockHandle('text-1a');
    await helper.escapeToParent();
    await helper.waitForIframeBlockHandle('col-1');

    // ChildBlocksWidget visible with col-1's children
    const blockList = page.locator('.child-blocks-widget');
    await expect(blockList).toBeVisible({ timeout: 5000 });

    // Ctrl+Click first item
    await blockList.locator('.child-block-item').first().click({ modifiers: ['ControlOrMeta'] });
    // Ctrl+Click second item
    await blockList.locator('.child-block-item').last().click({ modifiers: ['ControlOrMeta'] });

    // Items should be highlighted with selected class
    await expect(blockList.locator('.child-block-item.selected'))
      .toHaveCount(2, { timeout: 5000 });

    // Summary bar in sidebar (below child widget) shows count
    await expect(page.locator('.multi-select-bar'))
      .toContainText('2 selected', { timeout: 3000 });
  });

  // Task 3: Sidebar enters selection mode (syncs with iframe)
  test('Ctrl+Click in sidebar also shows checkboxes in iframe', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    // Navigate to col-1 children in sidebar
    await helper.clickBlockInIframe('text-1a');
    await helper.waitForIframeBlockHandle('text-1a');
    await helper.escapeToParent();
    await helper.waitForIframeBlockHandle('col-1');

    // Ctrl+Click items in sidebar
    const blockList = page.locator('.child-blocks-widget');
    await blockList.locator('.child-block-item').first().click({ modifiers: ['ControlOrMeta'] });
    await blockList.locator('.child-block-item').last().click({ modifiers: ['ControlOrMeta'] });

    // Iframe should show checkboxes too
    await expect(page.locator('.volto-hydra-selection-checkbox').first())
      .toBeVisible({ timeout: 5000 });

    // Exit button should be on left toolbar
    await expect(page.locator('[data-testid="exit-selection-mode"]'))
      .toBeVisible({ timeout: 3000 });
  });

  // Task 4: Sibling multi-select keeps block list, cross-container shows filtered view
  test('Sibling multi-select shows summary bar with selected blocks', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    // Shift+Arrow to multi-select text-1a + text-1b (siblings in col-1)
    await helper.clickBlockInIframe('text-1a');
    await helper.waitForIframeBlockHandle('text-1a');
    await helper.escapeFromEditing();
    await page.keyboard.press('Shift+ArrowDown');

    // Summary bar should show 2 selected with paths listed
    await expect(page.locator('.multi-select-bar'))
      .toContainText('2 selected', { timeout: 5000 });
    await expect(page.locator('.selected-block-path')).toHaveCount(2);
  });

  test('Multi-select summary lists selected blocks across containers', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();

    // Select text-1a (col-1), Ctrl+Click text-2a (col-2)
    await helper.clickBlockInIframe('text-1a');
    await helper.waitForIframeBlockHandle('text-1a');
    await helper.escapeFromEditing();
    await iframe.locator('[data-block-uid="text-2a"]').click({ modifiers: ['ControlOrMeta'] });

    // Summary bar is in the sidebar (below any ChildBlocksWidget)
    // Shows total count and lists selected blocks across containers
    await expect(page.locator('.multi-select-bar'))
      .toContainText('2 selected', { timeout: 5000 });
    await expect(page.locator('.selected-block-path')).toHaveCount(2, { timeout: 5000 });
  });

  test('Multi-select summary persists for leaf block (no ChildBlocksWidget)', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();

    // Select text-1a (leaf block - no ChildBlocksWidget), Ctrl+Click text-after
    await helper.clickBlockInIframe('text-1a');
    await helper.waitForIframeBlockHandle('text-1a');
    await helper.escapeFromEditing();
    await iframe.locator('[data-block-uid="text-after"]').click({ modifiers: ['ControlOrMeta'] });

    // Summary bar appears in sidebar even when selected block is a leaf
    await expect(page.locator('.multi-select-bar'))
      .toContainText('2 selected', { timeout: 5000 });
    await expect(page.locator('.selected-block-path')).toHaveCount(2);
  });

  // Cross-container selection shows path (not just type) in summary bar
  test('Multi-select summary bar renders path from common ancestor', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();

    // Select text-1a (inside columns-1 > col-1), Ctrl+Click text-2a (inside columns-1 > col-2)
    // Common ancestor = columns-1. Path should be "Columns > ... > Slate" style.
    await helper.clickBlockInIframe('text-1a');
    await helper.waitForIframeBlockHandle('text-1a');
    await helper.escapeFromEditing();
    await iframe.locator('[data-block-uid="text-2a"]').click({ modifiers: ['ControlOrMeta'] });

    await expect(page.locator('.multi-select-bar'))
      .toContainText('2 selected', { timeout: 5000 });
    // Each row should contain ' > ' since path crosses the column level
    const rows = page.locator('.selected-block-path');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText(' > ');
    await expect(rows.last()).toContainText(' > ');
  });

  // Task 5: Selection mode navigation in sidebar
  test('Sidebar navigation works during selection mode', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    // Enter selection mode via iframe long press
    await helper.clickBlockInIframe('text-1a');
    await helper.waitForIframeBlockHandle('text-1a');
    await helper.longPressBlock('text-1a');

    // Verify selection mode is active before navigation
    await expect(page.locator('.volto-hydra-selection-checkbox').first())
      .toBeVisible({ timeout: 5000 });
    await expect(page.locator('.multi-select-bar')).toBeAttached({ timeout: 3000 });

    // Navigate back to col-1 via sidebar back arrow (use last = innermost)
    const backArrow = page.locator('.sidebar-section-header .nav-back').last();
    await expect(backArrow).toBeVisible({ timeout: 5000 });
    await backArrow.click();

    // After navigation: selection mode should STILL be active
    // Checkboxes should still be visible in iframe
    await expect(page.locator('.volto-hydra-selection-checkbox').first())
      .toBeVisible({ timeout: 3000 });

    // Summary bar should still exist in DOM
    await expect(page.locator('.multi-select-bar')).toBeAttached({ timeout: 3000 });

    // Summary bar should contain the selected block
    await expect(page.locator('.selected-block-path')).toHaveCount(1, { timeout: 3000 });
  });

  // Selection mode suppresses single-block outline (toolbar stays visible for DnD)
  test('Selection mode hides single-block outline in iframe', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Enter selection mode
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForIframeBlockHandle('block-1-uuid');
    await helper.longPressBlock('block-1-uuid');

    // Checkboxes should be visible
    await expect(page.locator('.volto-hydra-selection-checkbox').first())
      .toBeVisible({ timeout: 5000 });

    // Single-block outline should NOT be visible
    await expect(page.locator('.volto-hydra-block-outline[data-outline-style="border"]'))
      .not.toBeVisible({ timeout: 2000 });
    await expect(page.locator('.volto-hydra-block-outline[data-outline-style="subtle"]'))
      .not.toBeVisible({ timeout: 2000 });

    // Toolbar stays visible (needed for drag handle during DnD of selected blocks)
    await expect(page.locator('.quanta-toolbar')).toBeVisible({ timeout: 2000 });
  });

  // Multi-select toolbar positions around combined rect of selected blocks
  test('Multi-select toolbar spans combined rect of selected blocks', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const iframe = helper.getIframe();
    const toolbar = page.locator('.quanta-toolbar');

    // Start with block-3 selected (slate, so we get text mode first)
    await helper.clickBlockInIframe('block-3-uuid');
    await helper.waitForIframeBlockHandle('block-3-uuid');
    await helper.escapeFromEditing();

    // Baseline: single-block toolbar offset above block-3 top
    const box3Before = await iframe.locator('[data-block-uid="block-3-uuid"]').boundingBox();
    expect(box3Before).not.toBeNull();
    const singleToolbarBox = await toolbar.boundingBox();
    expect(singleToolbarBox).not.toBeNull();
    const singleOffsetAboveTop = box3Before!.y - singleToolbarBox!.y;

    // Extend UPWARD: anchor=block-3, add block-2 via Shift+ArrowUp.
    // Critical: anchor's top (block-3.top) is BELOW combined top (block-2.top),
    // so if toolbar used anchor.top it would be below combined top — wrong.
    await page.keyboard.press('Shift+ArrowUp');
    await helper.waitForMultiSelectOutlines(2);

    const box2 = await iframe.locator('[data-block-uid="block-2-uuid"]').boundingBox();
    const box3 = await iframe.locator('[data-block-uid="block-3-uuid"]').boundingBox();
    expect(box2).not.toBeNull();
    expect(box3).not.toBeNull();

    const combinedTop = Math.min(box2!.y, box3!.y);
    const combinedBottom = Math.max(box2!.y + box2!.height, box3!.y + box3!.height);

    await expect(toolbar).toBeVisible({ timeout: 3000 });

    // Verify via the admin's voltoHydraData.blockUIRect that toolbar positioning
    // uses the COMBINED rect (spans both blocks in iframe coords), not just the anchor.
    // blockUIRect is in iframe-relative coords.
    const hydraData = await page.evaluate(() => (window as any).voltoHydraData);
    expect(hydraData).not.toBeNull();
    expect(hydraData.blockUIRect).toBeDefined();

    // Get iframe-relative block positions (hydra's local coord space)
    const iframeRects = await iframe.locator('[data-block-uid="block-2-uuid"], [data-block-uid="block-3-uuid"]').evaluateAll(
      (els: HTMLElement[]) => els.map(el => {
        const r = el.getBoundingClientRect();
        return { uid: el.getAttribute('data-block-uid'), top: r.top, left: r.left, width: r.width, height: r.height };
      })
    );
    const b2 = iframeRects.find(r => r.uid === 'block-2-uuid')!;
    const b3 = iframeRects.find(r => r.uid === 'block-3-uuid')!;
    const expectedCombinedTop = Math.min(b2.top, b3.top);
    const expectedCombinedBottom = Math.max(b2.top + b2.height, b3.top + b3.height);
    const expectedCombinedHeight = expectedCombinedBottom - expectedCombinedTop;
    const expectedCombinedLeft = Math.min(b2.left, b3.left);
    const expectedCombinedRight = Math.max(b2.left + b2.width, b3.left + b3.width);
    const expectedCombinedWidth = expectedCombinedRight - expectedCombinedLeft;

    // blockUIRect drives toolbar + outline positioning. Must be the combined rect.
    expect(Math.abs(hydraData.blockUIRect.top - expectedCombinedTop)).toBeLessThan(2);
    expect(Math.abs(hydraData.blockUIRect.left - expectedCombinedLeft)).toBeLessThan(2);
    expect(Math.abs(hydraData.blockUIRect.height - expectedCombinedHeight)).toBeLessThan(2);
    expect(Math.abs(hydraData.blockUIRect.width - expectedCombinedWidth)).toBeLessThan(2);
  });

  // Clicking item body in sidebar during selection mode toggles, not navigates
  test('Sidebar item click in selection mode toggles selection (no navigation)', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    // Enter selection mode via iframe long press on text-1a
    await helper.clickBlockInIframe('text-1a');
    await helper.waitForIframeBlockHandle('text-1a');
    await helper.longPressBlock('text-1a');

    // Sidebar navigation: click text-1a's "Go to parent" (last one — its section's nav-back → col-1)
    const goToParent = page.locator('.sidebar-section-header .nav-back[title="Go to parent"]').last();
    await expect(goToParent).toBeVisible({ timeout: 5000 });
    await goToParent.click();

    const blockList = page.locator('.child-blocks-widget');
    await expect(blockList).toBeVisible({ timeout: 5000 });

    // Click on second item body (normally this would navigate/select it)
    // In selection mode it should toggle the checkbox
    const item2 = blockList.locator('.child-block-item').nth(1);
    await item2.click();

    // Both items should be selected now (text-1a was already selected, now + text-1b)
    await expect(blockList.locator('.child-block-item.selected'))
      .toHaveCount(2, { timeout: 5000 });

    // Sidebar should still show col-1's children (not navigate away)
    await expect(blockList).toBeVisible();
  });

  // Sidebar > arrow still navigates into block during selection mode
  test('Sidebar > arrow navigates into block during selection mode', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    // Enter selection mode
    await helper.clickBlockInIframe('text-1a');
    await helper.waitForIframeBlockHandle('text-1a');
    await helper.longPressBlock('text-1a');

    // Navigate up to columns-1 level to see col-1, col-2 (two Go to parent clicks)
    // Always use .last() — it's the current block's nav-back
    const goToParent = page.locator('.sidebar-section-header .nav-back[title="Go to parent"]').last();
    await expect(goToParent).toBeVisible({ timeout: 5000 });
    await goToParent.click();
    await page.locator('.sidebar-section-header .nav-back[title="Go to parent"]').last().click();

    const blockList = page.locator('.child-blocks-widget');
    await expect(blockList).toBeVisible({ timeout: 5000 });

    // Click the > arrow on col-2 to navigate into it (not toggle)
    const col2Item = blockList.locator('.child-block-item').filter({ hasText: 'column' }).last();
    // Click the arrow wrapper specifically — behavior: drill into col-2, still in selection mode
    await col2Item.locator('.nav-arrow-wrapper').click();

    // ChildBlocksWidget should now show col-2's children (text-2a)
    await expect(blockList.locator('.child-block-item', { hasText: /Text/ })).toBeVisible({ timeout: 5000 });

    // Still in selection mode — checkboxes visible in iframe
    await expect(page.locator('.volto-hydra-selection-checkbox').first())
      .toBeVisible({ timeout: 3000 });

    // col-2 itself should NOT be in multiSelected (only text-1a from initial long press)
    // Check by counting highlighted items in current view
    await expect(blockList.locator('.child-block-item.selected')).toHaveCount(0);
  });

  // Exit selection mode collapses to single-block selection
  test('Exit selection mode returns to single-block selected state', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Enter selection mode with 2 blocks
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForIframeBlockHandle('block-1-uuid');
    await helper.longPressBlock('block-1-uuid');

    const checkbox2 = page.locator('.volto-hydra-selection-checkbox[data-block-uid="block-2-uuid"]');
    await expect(checkbox2).toBeVisible({ timeout: 5000 });
    await checkbox2.click();

    // Should have 2 blocks selected
    await expect(page.locator('[data-testid="exit-selection-mode"] .blockCount'))
      .toContainText('2', { timeout: 3000 });

    // Exit via X button
    await page.locator('[data-testid="exit-selection-mode"]').click();

    // Checkboxes gone
    await expect(page.locator('.volto-hydra-selection-checkbox').first())
      .not.toBeVisible({ timeout: 3000 });

    // Single-block outline should reappear on one of the previously selected blocks
    await expect(page.locator('.volto-hydra-block-outline').first())
      .toBeVisible({ timeout: 3000 });
  });

  // Cross-block text drag: selecting text across block boundaries enters multi-block selection
  test('Text selection spanning two blocks enters multi-block selection', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Click into block-1 first to establish text mode, then select across to block-3
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForIframeBlockHandle('block-1-uuid');

    await helper.selectTextAcrossBlocks('block-1-uuid', 0, 'block-3-uuid', 3);

    // Expected: multi-block selection. Outlines on both slate blocks (block-1 + block-3)
    // Note: block-2 (image, between them) may or may not be included
    await helper.waitForMultiSelectOutlines(2);

    // Summary bar reflects it
    await expect(page.locator('.multi-select-bar'))
      .toContainText('selected', { timeout: 3000 });
  });

  // Option A semantics: once a text drag crosses a block boundary we promote to
  // full block selection. Copy operates on whole blocks, not the partial-text
  // sub-range that spawned the promotion.
  //
  // Rationale: block-level clipboard is the composable unit (pastable anywhere
  // blocks are allowed). Serializing a partial paragraph across blocks produces
  // an awkward half-block on paste with no good block-type mapping. Matches the
  // Notion/Plate.js convention. Downside: user who carefully trimmed their
  // selection loses that intent — they see the whole block outlines appear
  // once the drag crosses a boundary, which signals the mode switch.
  test('Cross-block partial text selection copies full blocks, not trimmed text (Option A)', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const iframe = helper.getIframe();

    // Focus block-1, then programmatically select from block-1 midpoint to block-3 midpoint.
    // block-1 text is "This is a test paragraph" — start at offset 5 ("is a test paragraph")
    // block-3 text is "Another paragraph for testing" — end at offset 7 ("Another")
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForIframeBlockHandle('block-1-uuid');

    await helper.selectTextAcrossBlocks('block-1-uuid', 5, 'block-3-uuid', 7);

    // Cross-block detector promotes partial-text → full multi-block selection
    await helper.waitForMultiSelectOutlines(2);
    await expect(page.locator('.multi-select-bar')).toContainText('selected');

    // Capture COPY_BLOCKS message from the admin (parent) window — iframe
    // postMessage lands here via the existing onmessage listener. We listen
    // on 'message' events to see what hydra sent.
    const copyMsg = page.evaluate(() => {
      return new Promise<{ uids: string[]; action: string } | null>((resolve) => {
        const handler = (e: MessageEvent) => {
          if (e.data?.type === 'COPY_BLOCKS') {
            window.removeEventListener('message', handler);
            resolve({ uids: e.data.uids, action: e.data.action });
          }
        };
        window.addEventListener('message', handler);
        setTimeout(() => {
          window.removeEventListener('message', handler);
          resolve(null);
        }, 4000);
      });
    });

    await page.keyboard.press('ControlOrMeta+c');
    const result = await copyMsg;
    expect(result).not.toBeNull();
    expect(result!.action).toBe('copy');
    // Full blocks copied (Option A) — not a trimmed text snippet
    expect(result!.uids).toContain('block-1-uuid');
    expect(result!.uids).toContain('block-3-uuid');
  });

  // Drag-and-drop moves all selected blocks together
  test('Drag of multi-selected blocks moves them together', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const iframe = helper.getIframe();
    const initialOrder = await helper.getBlockOrder();
    // Expect at least block-1, block-2, block-3 at top
    expect(initialOrder.slice(0, 3)).toEqual(['block-1-uuid', 'block-2-uuid', 'block-3-uuid']);

    // Multi-select block-1 + block-2 via Shift+ArrowDown from block mode
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForIframeBlockHandle('block-1-uuid');
    await helper.escapeFromEditing();
    await page.keyboard.press('Shift+ArrowDown');
    await helper.waitForMultiSelectOutlines(2);

    // Drag via the toolbar drag handle onto block-3
    const dragHandle = await helper.getDragHandle();
    const block3 = iframe.locator('[data-block-uid="block-3-uuid"]');
    await helper.dragBlockWithMouse(dragHandle, block3, true);

    // After drop: block-3 precedes block-1, block-2 in the layout
    const newOrder = await helper.getBlockOrder();
    const idx3 = newOrder.indexOf('block-3-uuid');
    const idx1 = newOrder.indexOf('block-1-uuid');
    const idx2 = newOrder.indexOf('block-2-uuid');
    expect(idx3).toBeLessThan(idx1);
    expect(idx1).toBeLessThan(idx2);
  });

  // Multi-select containing a locked/fixed block: delete spares the locked one
  test('Delete on multi-selection with locked block spares the locked block', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    // standalone-block-1 is a regular slate block (not fixed)
    // template-header is fixed + readOnly (part of the template)
    const initialOrder = await helper.getBlockOrder();
    expect(initialOrder).toContain('standalone-block-1');
    expect(initialOrder).toContain('template-header');

    // Select standalone-block-1 then Ctrl+Click the locked template-header
    const iframe = helper.getIframe();
    await helper.clickBlockInIframe('standalone-block-1');
    await helper.waitForIframeBlockHandle('standalone-block-1');
    await helper.escapeFromEditing();

    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await iframe.locator('[data-block-uid="template-header"]').click({ modifiers: [modifier] });
    await helper.waitForMultiSelectOutlines(2);

    // Press Delete — expect the locked block to survive; standalone should go
    await page.keyboard.press('Delete');

    await expect.poll(async () => helper.getBlockOrder(), { timeout: 5000 })
      .not.toContain('standalone-block-1');

    const finalOrder = await helper.getBlockOrder();
    expect(finalOrder).toContain('template-header');
  });

  // DnD on multi-selection with a locked block: only the movable blocks move;
  // the locked block stays in its original position.
  test('Drag of multi-selection containing locked block moves only unlocked', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    const initialOrder = await helper.getBlockOrder();
    const initialHeaderIdx = initialOrder.indexOf('template-header');
    const initialStandaloneIdx = initialOrder.indexOf('standalone-block-1');
    // Drop after standalone-block-2 (the last page-level leaf) — known-safe
    // target with deterministic drop position (no descendants to absorb drop).
    const targetUid = 'standalone-block-2';
    const targetIdx = initialOrder.indexOf(targetUid);
    expect(initialHeaderIdx).toBeGreaterThanOrEqual(0);
    expect(initialStandaloneIdx).toBeGreaterThanOrEqual(0);
    expect(targetIdx).toBeGreaterThan(initialHeaderIdx);
    // standalone-block-1 comes before template-header in this fixture
    expect(initialStandaloneIdx).toBeLessThan(initialHeaderIdx);

    // Multi-select standalone-block-1 + template-header (one locked)
    const iframe = helper.getIframe();
    await helper.clickBlockInIframe('standalone-block-1');
    await helper.waitForIframeBlockHandle('standalone-block-1');
    await helper.escapeFromEditing();
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await iframe.locator('[data-block-uid="template-header"]').click({ modifiers: [modifier] });
    await helper.waitForMultiSelectOutlines(2);

    // Drag onto the target after the template-header
    const dragHandle = await helper.getDragHandle();
    const targetBlock = iframe.locator(`[data-block-uid="${targetUid}"]`);
    await helper.dragBlockWithMouse(dragHandle, targetBlock, true);

    // Expected order: remove standalone-block-1 from initial, insert it right
    // after targetUid. template-header stays exactly where it was.
    const expected = initialOrder.filter((uid) => uid !== 'standalone-block-1');
    const insertAt = expected.indexOf(targetUid) + 1;
    expected.splice(insertAt, 0, 'standalone-block-1');

    const newOrder = await helper.getBlockOrder();
    expect(newOrder).toEqual(expected);
  });

  // Regression: when the previously-selected block was a container with
  // edge-drag handles, those handles used to leak into the newly-selected
  // block's chrome (visible in the iframe, not driven by blockUI), so the
  // user saw two simultaneous selection rects: the new admin
  // `.volto-hydra-block-outline` AND a "frame" of stale edge handles drawn
  // around the previous container. The chrome refactor moves the visible
  // edge handles into admin-side `.volto-hydra-edge-handle-visual` driven
  // by `blockUI.canResize`, so they unmount automatically on selection
  // change.
  test('switching selection from a container to a descendant does not leave stale edge handles', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();

    // 1. Select the grid via the bridge — admin should render edge handles.
    // Use waitForBlockSelectedInAdmin: the assertions below target admin
    // chrome (edge-handle visuals), so we need to wait for admin's
    // BLOCK_SELECTED handler → setBlockUI → React commit to mount the
    // chrome. waitForIframeBlockHandle only confirms the iframe-side
    // drag handle and races the admin render.
    await iframe.locator('[data-block-uid="grid-1"]').first().evaluate((el) => {
      (window as any).bridge?.selectBlock(el);
    });
    await helper.waitForBlockSelectedInAdmin('grid-1');

    const adminEdges = page.locator('.volto-hydra-edge-handle-visual');
    const gridEdgeCountInitial = await adminEdges.count();
    expect(gridEdgeCountInitial,
      'expected at least one edge handle while a container is selected'
    ).toBeGreaterThan(0);

    // 2. Click into a non-editable child (the teaser's image placeholder).
    //    Use the bridge for the second selection too — what matters is that
    //    blockUI moves to grid-cell-1.
    await iframe.locator('[data-block-uid="grid-cell-1"]').first().evaluate((el) => {
      (window as any).bridge?.selectBlock(el);
    });
    await helper.waitForBlockSelectedInAdmin('grid-cell-1');

    // ASSERT: exactly one selection outline (for grid-cell-1).
    const outlines = page.locator('.volto-hydra-block-outline');
    await expect(outlines).toHaveCount(1);

    // ASSERT: any edge handles still rendered must be for grid-cell-1's
    //         rect, not for grid-1's rect. Easiest invariant: their
    //         bounding boxes must lie within the teaser's bounding box
    //         (with a small slop for the 3px outset).
    const teaserBox = await iframe.locator('[data-block-uid="grid-cell-1"]')
      .first().boundingBox();
    expect(teaserBox).not.toBeNull();
    const remaining = await adminEdges.count();
    for (let i = 0; i < remaining; i++) {
      const box = await adminEdges.nth(i).boundingBox();
      if (!box) continue;
      const slop = 8;
      expect(box.x + box.width).toBeLessThanOrEqual(teaserBox!.x + teaserBox!.width + slop);
      expect(box.y + box.height).toBeLessThanOrEqual(teaserBox!.y + teaserBox!.height + slop);
      expect(box.x).toBeGreaterThanOrEqual(teaserBox!.x - slop);
      expect(box.y).toBeGreaterThanOrEqual(teaserBox!.y - slop);
    }
  });
});
