/**
 * Integration tests for Quanta Toolbar in Volto Hydra.
 *
 * The Quanta Toolbar is rendered in the parent window (Volto) when a block is selected.
 * It provides buttons for: Drag handle, Format buttons (for Slate blocks).
 * The Add button is rendered separately in the iframe.
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

test.describe('Quanta Toolbar - Visibility', () => {
  test('Quanta Toolbar appears when block is selected', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Click on a block to select it
    await helper.clickBlockInIframe('block-1-uuid');

    // Verify Quanta Toolbar is visible in parent window
    const toolbarVisible = await helper.isQuantaToolbarVisibleInIframe('block-1-uuid');
    expect(toolbarVisible).toBe(true);
  });

  test('Quanta Toolbar has buttons when Slate block selected', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Click on Slate block
    await helper.clickBlockInIframe('block-1-uuid');

    // Get all toolbar buttons
    const buttons = await helper.getQuantaToolbarButtons();
    console.log('[TEST] Toolbar buttons:', buttons);

    // Should have at least some buttons
    expect(buttons.length).toBeGreaterThan(0);

    // Check for expected format buttons (by title)
    const buttonTitles = buttons.map((b) => b.title.toLowerCase());
    expect(buttonTitles.some((t) => t.includes('bold'))).toBe(true);
    expect(buttonTitles.some((t) => t.includes('italic'))).toBe(true);
  });
});

test.describe('Quanta Toolbar - Format Buttons (Slate Blocks)', () => {
  test('Format buttons appear for Slate/text blocks', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Click on Slate block
    await helper.clickBlockInIframe('block-1-uuid');

    // Get all toolbar buttons
    const buttons = await helper.getQuantaToolbarButtons();
    const buttonTitles = buttons.map((b) => b.title.toLowerCase());

    // Format buttons should exist for Slate blocks
    expect(buttonTitles.some((t) => t.includes('bold'))).toBe(true);
    expect(buttonTitles.some((t) => t.includes('italic'))).toBe(true);
    expect(buttonTitles.some((t) => t.includes('link'))).toBe(true);
  });

  test('Format buttons do NOT appear for Image blocks', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Click on Image block
    await helper.clickBlockInIframe('block-2-uuid');

    // Get all toolbar buttons
    const buttons = await helper.getQuantaToolbarButtons();
    const buttonTitles = buttons.map((b) => b.title.toLowerCase());

    // Format buttons should NOT exist for Image blocks
    expect(buttonTitles.some((t) => t.includes('bold'))).toBe(false);
    expect(buttonTitles.some((t) => t.includes('italic'))).toBe(false);
  });
});

test.describe('Quanta Toolbar - Dropdown Menu', () => {
  test('Dropdown menu opens when menu button is clicked', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';
    await helper.clickBlockInIframe(blockId);

    // Initially dropdown should not be visible
    let menu = await helper.getQuantaToolbarMenu(blockId);
    await expect(menu).not.toBeVisible();

    // Click menu button
    await helper.openQuantaToolbarMenu(blockId);

    // Dropdown should now be visible
    menu = await helper.getQuantaToolbarMenu(blockId);
    await expect(menu).toBeVisible();
  });

  test('Dropdown menu contains Settings, Remove, and Make Template options', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';
    await helper.clickBlockInIframe(blockId);
    await helper.openQuantaToolbarMenu(blockId);

    // Get menu options
    const options = await helper.getQuantaToolbarMenuOptions(blockId);

    expect(options).toContain('Settings');
    expect(options).toContain('Remove');
    expect(options.some(o => o.toLowerCase().includes('make') && o.toLowerCase().includes('template'))).toBe(true);
    // Also includes Copy and Cut actions
    expect(options.some(o => o.includes('Copy'))).toBe(true);
    expect(options.some(o => o.includes('Cut'))).toBe(true);
    expect(options.length).toBe(5);
  });

  test('Clicking Remove option triggers delete', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';

    // Verify block exists - use deduplicated count (getBlockCount)
    const initialBlockCount = await helper.getBlockCount();
    expect(initialBlockCount).toBeGreaterThanOrEqual(3);

    // Select block and open menu
    await helper.clickBlockInIframe(blockId);
    await helper.openQuantaToolbarMenu(blockId);

    // Click Remove
    await helper.clickQuantaToolbarMenuOption(blockId, 'Remove');

    // Wait for block to be removed (one less than initial)
    await helper.waitForBlockCountToBe(initialBlockCount - 1);

    // Verify block count decreased by 1
    const finalBlockCount = await helper.getBlockCount();
    expect(finalBlockCount).toBe(initialBlockCount - 1);
  });

  test('Clicking Settings option expands collapsed sidebar', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');
    await helper.waitForSidebarOpen();

    const blockId = 'block-1-uuid';

    // First collapse the sidebar using the close button
    const closeButton = page.locator('.sidebar-close-button');
    await closeButton.click();
    await page.waitForTimeout(300);

    // Verify sidebar is collapsed
    const sidebarContainer = page.locator('.sidebar-container');
    await expect(sidebarContainer).toHaveClass(/collapsed/);

    // Click block and open menu
    await helper.clickBlockInIframe(blockId);
    await helper.openQuantaToolbarMenu(blockId);

    // Click Settings
    await helper.clickQuantaToolbarMenuOption(blockId, 'Settings');
    await page.waitForTimeout(300);

    // Sidebar should be expanded
    await expect(sidebarContainer).not.toHaveClass(/collapsed/);
  });
});

test.describe('Quanta Toolbar - Positioning', () => {
  test('toolbar aligns correctly with blocks near right edge of iframe', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();

    // grid-cell-2 is in the right side of the gridBlock, near the right edge of the iframe
    // This tests the toolbar alignment issue where blocks near the edge have misaligned toolbars
    const block = iframe.locator('[data-block-uid="grid-cell-2"]');
    await expect(block).toBeVisible();

    // Click the block and wait for toolbar to be properly positioned
    await block.click();
    await helper.waitForBlockSelectedInAdmin('grid-cell-2');

    // Get bounding boxes for alignment check
    const blockBox = await helper.getBlockBoundingBoxInIframe('grid-cell-2');
    const outlineBox = await helper.getBlockOutlineBoundingBox();
    expect(blockBox).toBeTruthy();
    expect(outlineBox).toBeTruthy();

    // The outline should align horizontally with the block
    // Allow 5px tolerance for minor differences
    const tolerance = 5;
    const xAligned = Math.abs(blockBox!.x - outlineBox!.x) <= tolerance;
    const widthAligned = Math.abs(blockBox!.width - outlineBox!.width) <= tolerance;

    // This test documents the bug - currently fails because outline is offset for right-side blocks
    expect(
      xAligned,
      `Outline x (${outlineBox!.x}) should match block x (${blockBox!.x})`,
    ).toBe(true);
    expect(
      widthAligned,
      `Outline width (${outlineBox!.width}) should match block width (${blockBox!.width})`,
    ).toBe(true);
  });

  test('toolbar menu opens correctly for blocks near right edge', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();

    // Click on grid-cell-2 (right side block in gridBlock) and wait for toolbar
    const block = iframe.locator('[data-block-uid="grid-cell-2"]');
    await block.click();
    await helper.waitForBlockSelectedInAdmin('grid-cell-2');

    // Try to open the toolbar menu using the helper
    // The menu button should be clickable and not intercepted by the sidebar
    await helper.openQuantaToolbarMenu('grid-cell-2');

    // Menu should open and be visible (not hidden behind sidebar)
    const menu = await helper.getQuantaToolbarMenu('grid-cell-2');
    await expect(menu).toBeVisible({ timeout: 3000 });

    // Verify menu options are accessible
    const options = await helper.getQuantaToolbarMenuOptions('grid-cell-2');
    expect(options.length).toBeGreaterThan(0);
  });
});

test.describe('Quanta Toolbar - Different Block Types', () => {
  test('Slate blocks have format buttons, Image blocks do not', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Slate block should have format buttons
    await helper.clickBlockInIframe('block-1-uuid');
    let buttons = await helper.getQuantaToolbarButtons();
    let hasBold = buttons.some((b) => b.title.toLowerCase().includes('bold'));
    expect(hasBold).toBe(true);

    // Image block should NOT have format buttons
    await helper.clickBlockInIframe('block-2-uuid');
    buttons = await helper.getQuantaToolbarButtons();
    hasBold = buttons.some((b) => b.title.toLowerCase().includes('bold'));
    expect(hasBold).toBe(false);

    // Another Slate block should have format buttons
    await helper.clickBlockInIframe('block-3-uuid');
    buttons = await helper.getQuantaToolbarButtons();
    hasBold = buttons.some((b) => b.title.toLowerCase().includes('bold'));
    expect(hasBold).toBe(true);
  });
});

test.describe('Quanta Toolbar - Format Dropdown', () => {
  test('format dropdown appears in toolbar for Slate blocks', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Click on Slate block
    await helper.clickBlockInIframe('block-1-uuid');

    // Verify format dropdown trigger exists
    const toolbar = page.locator('.quanta-toolbar');
    await expect(toolbar).toBeVisible();

    // Format dropdown should have a trigger button with dropdown arrow
    const formatDropdown = toolbar.locator('.format-dropdown-trigger');
    await expect(formatDropdown).toBeVisible();
  });

  test('text-format buttons show in text mode but hide in block mode (no cursor)', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // A desktop click on a Slate block lands in TEXT mode (cursor placed in the
    // editable field): the block-format dropdown and the inline text-format
    // buttons (bold/italic/link/…) are relevant, so they're shown.
    await helper.clickBlockInIframe('block-1-uuid');
    const toolbar = page.locator('.quanta-toolbar');
    const formatDropdown = toolbar.locator('.format-dropdown-trigger');
    await expect(formatDropdown).toBeVisible();
    expect(await toolbar.locator('[data-toolbar-button]').count()).toBeGreaterThan(0);

    // Escape steps up TEXT → BLOCK mode: the same block stays selected, but the
    // text cursor is gone (focusedFieldName is cleared). Text-formatting controls
    // don't apply to a block that isn't being text-edited, so they must leave the
    // toolbar — only the block-level actions (drag, step-up, move) remain.
    await page.keyboard.press('Escape');
    await helper.waitForIframeBlockHandle('block-1-uuid');
    await expect(toolbar).toBeVisible();
    await expect(formatDropdown).toBeHidden();
    await expect(toolbar.locator('[data-toolbar-button]')).toHaveCount(0);
  });

  test('format dropdown shows paragraph format options when clicked', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Click on Slate block
    await helper.clickBlockInIframe('block-1-uuid');

    const toolbar = page.locator('.quanta-toolbar');
    const formatDropdown = toolbar.locator('.format-dropdown-trigger');
    await expect(formatDropdown).toBeVisible();

    // Click to open dropdown
    await formatDropdown.click();

    // Dropdown menu should appear with format options
    const dropdownMenu = page.locator('.format-dropdown-menu');
    await expect(dropdownMenu).toBeVisible();

    // Should contain block-level format options (headings, lists, blockquote)
    const menuItems = dropdownMenu.locator('.format-dropdown-item');
    const itemCount = await menuItems.count();
    expect(itemCount).toBeGreaterThanOrEqual(4); // At least: h2, h3, bullets, blockquote

    // Verify specific format options are present by their title attributes
    const itemTitles = await menuItems.evaluateAll((items) =>
      items.map((item) => item.getAttribute('title')),
    );

    // Should have headings
    expect(itemTitles).toContain('Title');
    expect(itemTitles).toContain('Subtitle');

    // Should have lists
    expect(itemTitles.some((t) => t?.toLowerCase().includes('list'))).toBe(
      true,
    );

    // Should have blockquote
    expect(itemTitles.some((t) => t?.toLowerCase().includes('quote'))).toBe(
      true,
    );
  });

  test('selecting format from dropdown changes text format', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Click on Slate block and place cursor inside
    await helper.clickBlockInIframe('block-1-uuid');
    const editableField = await helper.getEditorLocator('block-1-uuid');
    await editableField.click();

    // Open format dropdown
    const toolbar = page.locator('.quanta-toolbar');
    const formatDropdown = toolbar.locator('.format-dropdown-trigger');
    await formatDropdown.click();

    // Select heading format (second item, typically h2/Title)
    const dropdownMenu = page.locator('.format-dropdown-menu');
    const menuItems = dropdownMenu.locator('.format-dropdown-item');
    const secondItem = menuItems.nth(1);
    await secondItem.click();

    // Dropdown should close after selection
    await expect(dropdownMenu).not.toBeVisible();
  });

  test('applying heading format creates h2 element in iframe', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const iframe = helper.getIframe();

    // Click on Slate block and place cursor inside
    await helper.clickBlockInIframe('block-1-uuid');
    const editableField = await helper.getEditorLocator('block-1-uuid');
    await editableField.click();

    // Verify initial state is paragraph (no h2)
    const block = iframe.locator('[data-block-uid="block-1-uuid"]');
    await expect(block.locator('h2')).toHaveCount(0);

    // Open format dropdown and select "Title" (h2)
    const toolbar = page.locator('.quanta-toolbar');
    const formatDropdown = toolbar.locator('.format-dropdown-trigger');
    await formatDropdown.click();

    const dropdownMenu = page.locator('.format-dropdown-menu');
    await expect(dropdownMenu).toBeVisible({ timeout: 5000 });

    // Find and click the Title/h2 button in the dropdown
    const titleButton = dropdownMenu.getByRole('button', { name: 'Title', exact: true });
    await expect(titleButton).toBeVisible();
    await titleButton.click();

    // Wait for the text to be wrapped in h2
    await expect(block.locator('h2')).toBeVisible({ timeout: 5000 });

    // The original text should now be inside an h2
    const h2Text = await block.locator('h2').textContent();
    expect(h2Text).toContain('This is a test paragraph');
  });

  test('applying heading-three format creates h3 element in iframe', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const iframe = helper.getIframe();

    // Click on Slate block and place cursor inside
    await helper.clickBlockInIframe('block-1-uuid');
    const editableField = await helper.getEditorLocator('block-1-uuid');
    await editableField.click();

    // Open format dropdown and select "Subtitle" (h3)
    const toolbar = page.locator('.quanta-toolbar');
    const formatDropdown = toolbar.locator('.format-dropdown-trigger');
    await formatDropdown.click();

    const dropdownMenu = page.locator('.format-dropdown-menu');
    await expect(dropdownMenu).toBeVisible({ timeout: 5000 });

    // Find and click the Subtitle/h3 button in the dropdown
    const subtitleButton = dropdownMenu.getByRole('button', { name: 'Subtitle' });
    await expect(subtitleButton).toBeVisible();
    await subtitleButton.click();

    // Wait for the text to be wrapped in h3
    const block = iframe.locator('[data-block-uid="block-1-uuid"]');
    await expect(block.locator('h3')).toBeVisible({ timeout: 5000 });
  });

  test('format dropdown includes Paragraph option to revert heading back to plain text', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const iframe = helper.getIframe();
    const blockId = 'block-1-uuid';
    const block = iframe.locator(`[data-block-uid="${blockId}"]`);

    // Click on Slate block and place cursor inside
    await helper.clickBlockInIframe(blockId);
    const editableField = await helper.getEditorLocator(blockId);
    await editableField.click();

    // Convert to H2 via format dropdown
    const toolbar = page.locator('.quanta-toolbar');
    const formatDropdown = toolbar.locator('.format-dropdown-trigger');
    await formatDropdown.click();
    const dropdownMenu = page.locator('.format-dropdown-menu');
    await expect(dropdownMenu).toBeVisible({ timeout: 5000 });
    const titleButton = dropdownMenu.getByRole('button', { name: 'Title', exact: true });
    await titleButton.click();
    await expect(block.locator('h2')).toBeVisible({ timeout: 5000 });

    // Re-open dropdown — should have a Paragraph/Normal option
    await formatDropdown.click();
    await expect(dropdownMenu).toBeVisible({ timeout: 5000 });
    const items = dropdownMenu.locator('.format-dropdown-item');
    const titles = await items.evaluateAll((els) =>
      els.map((el) => (el.getAttribute('title') || el.textContent || '').trim()),
    );
    const hasParagraph = titles.some(
      (t) => /paragraph|normal|body/i.test(t),
    );
    expect(hasParagraph, `Expected a Paragraph option in dropdown, got: ${titles.join(', ')}`).toBe(true);

    // Click it to revert to paragraph
    const paragraphButton = dropdownMenu.locator('.format-dropdown-item[title]').filter({
      hasText: /paragraph|normal|body/i,
    }).first();
    await paragraphButton.click();

    // H2 should be gone, paragraph should be back
    await expect(block.locator('h2')).not.toBeVisible({ timeout: 5000 });
    await expect(block.locator('p')).toBeVisible({ timeout: 5000 });
  });

  test('format dropdown shows current format indicator', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Click on Slate block
    await helper.clickBlockInIframe('block-1-uuid');
    const editableField = await helper.getEditorLocator('block-1-uuid');
    await editableField.click();

    const toolbar = page.locator('.quanta-toolbar');
    const formatDropdown = toolbar.locator('.format-dropdown-trigger');

    // Initially should show paragraph indicator (default format)
    await expect(formatDropdown).toBeVisible();

    // Apply heading format
    await formatDropdown.click();
    const dropdownMenu = page.locator('.format-dropdown-menu');
    await expect(dropdownMenu).toBeVisible({ timeout: 5000 });
    const titleButton = dropdownMenu.getByRole('button', { name: 'Title', exact: true });
    await expect(titleButton).toBeVisible();
    await titleButton.click();

    // After applying heading, the dropdown trigger should update to show heading indicator
    // (The trigger shows an icon for the current format)
    await page.waitForTimeout(500); // Wait for state update

    // Click elsewhere first to deselect, then re-select
    await editableField.click();

    // The format dropdown should still be visible and reflect the new format
    await expect(formatDropdown).toBeVisible();
  });
});

test.describe('Quanta Toolbar - Overflow', () => {
  test('toolbar does not extend beyond iframe boundary (left column)', async ({
    page,
  }) => {
    // Use a narrow viewport to test overflow
    await page.setViewportSize({ width: 1024, height: 768 });

    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();

    // Click on a block in the LEFT side of grid - this has more available width
    // Use grid-cell-1 instead of text-1b (columns block not supported in Nuxt)
    const block = iframe.locator('[data-block-uid="grid-cell-1"]');
    await block.click();

    // Wait for toolbar to appear
    const toolbar = page.locator('.quanta-toolbar');
    await expect(toolbar).toBeVisible({ timeout: 5000 });

    // Get toolbar and iframe bounding boxes (retry — toolbar can briefly
    // lose its box during FORM_DATA echo re-render)
    const iframeElement = page.locator('#previewIframe');
    let toolbarBox: any, iframeBox: any;
    await expect(async () => {
      toolbarBox = await toolbar.boundingBox();
      iframeBox = await iframeElement.boundingBox();
      expect(toolbarBox).not.toBeNull();
      expect(iframeBox).not.toBeNull();
    }).toPass({ timeout: 5000 });

    // Toolbar's right edge should not extend past iframe's right edge
    const toolbarRight = toolbarBox!.x + toolbarBox!.width;
    const iframeRight = iframeBox!.x + iframeBox!.width;

    // Toolbar must stay within iframe bounds
    expect(toolbarRight).toBeLessThanOrEqual(iframeRight + 5); // 5px tolerance
  });

  test('toolbar does not extend beyond iframe boundary (right column)', async ({
    page,
  }) => {
    // Use a narrow viewport to force overflow condition
    await page.setViewportSize({ width: 1024, height: 768 });

    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();

    // Click on a block in the grid - this positions toolbar near sidebar
    // Use grid-cell-2 instead of text-2a (columns block not supported in Nuxt)
    const block = iframe.locator('[data-block-uid="grid-cell-2"]');
    await block.click();

    // Wait for toolbar to appear
    const toolbar = page.locator('.quanta-toolbar');
    await expect(toolbar).toBeVisible({ timeout: 5000 });

    // Get toolbar and iframe bounding boxes (retry — toolbar can briefly
    // lose its box during FORM_DATA echo re-render)
    const iframeElement = page.locator('#previewIframe');
    let toolbarBox: any, iframeBox: any;
    await expect(async () => {
      toolbarBox = await toolbar.boundingBox();
      iframeBox = await iframeElement.boundingBox();
      expect(toolbarBox).not.toBeNull();
      expect(iframeBox).not.toBeNull();
    }).toPass({ timeout: 5000 });

    // Toolbar's right edge should not extend past iframe's right edge
    const toolbarRight = toolbarBox!.x + toolbarBox!.width;
    const iframeRight = iframeBox!.x + iframeBox!.width;

    // Toolbar must stay within iframe bounds
    expect(toolbarRight).toBeLessThanOrEqual(iframeRight + 5); // 5px tolerance
  });

  test('overflow menu contains buttons that do not fit inline', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name.includes('nuxt'), 'Columns block not supported in Nuxt frontend');

    // Use a narrow viewport to force buttons into overflow
    await page.setViewportSize({ width: 800, height: 768 });

    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();

    // Click on slate block in column (constrained space forces overflow)
    const block = iframe.locator('[data-block-uid="text-2a"]');
    await block.click();

    const toolbar = page.locator('.quanta-toolbar');
    await expect(toolbar).toBeVisible({ timeout: 5000 });

    // The overflow button (⋯) should be visible
    const overflowButton = toolbar.locator('button:has-text("⋯")');
    await expect(overflowButton).toBeVisible();

    // Click overflow button to open menu
    await overflowButton.click();

    // Menu should contain formatting buttons that didn't fit inline
    const menu = page.locator('.volto-hydra-dropdown-menu');
    await expect(menu).toBeVisible();

    // Menu should have formatting buttons (not just Settings/Remove)
    // These are buttons that overflowed from the toolbar
    // Look for buttons wrapped in data-toolbar-button divs (our overflow button wrappers)
    const formattingButtons = menu.locator('[data-toolbar-button]');
    const count = await formattingButtons.count();
    expect(count).toBeGreaterThan(0);
  });

  test('clicking overflow button applies formatting', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name.includes('nuxt'), 'Columns block not supported in Nuxt frontend');

    // Use narrow viewport to force link button into overflow
    await page.setViewportSize({ width: 800, height: 768 });

    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    // Click on slate block in column (constrained space forces overflow)
    await helper.clickBlockInIframe('text-2a');

    // Select all text in the block using selectTextRange for reliability
    const editableField = await helper.getEditorLocator('text-2a');
    const textContent = await editableField.textContent();
    await helper.selectTextRange(editableField, 0, textContent?.length || 0);

    const toolbar = page.locator('.quanta-toolbar');

    // Verify no links initially
    await expect(editableField.locator('a')).toHaveCount(0);

    // Get the original selected text
    const originalText = await editableField.textContent();

    // Open overflow menu
    const overflowButton = toolbar.locator('button:has-text("⋯")');
    await expect(overflowButton).toBeVisible();
    await overflowButton.click();

    const menu = page.locator('.volto-hydra-dropdown-menu');
    await expect(menu).toBeVisible();

    // Find link button in overflow and click it
    const linkButton = menu.locator('[data-toolbar-button="link"]');
    await expect(linkButton).toBeVisible();
    await linkButton.click();

    // LinkEditor popup should appear
    await helper.waitForLinkEditorPopup();

    // Enter a URL and submit
    const urlInput = await helper.getLinkEditorUrlInput();
    await urlInput.fill('https://example.com');
    await urlInput.press('Enter');

    // Verify link was created in the editable field
    const linkElement = editableField.locator('a[href="https://example.com"]');
    await expect(linkElement).toBeVisible({ timeout: 5000 });

    // Verify the same text is still there (wrapped in link)
    await expect(linkElement).toHaveText(originalText!.trim());

    // Re-select the link text for the next check
    // (selection may be lost when focus moves back after link creation)
    await editableField.click();
    await page.keyboard.press('ControlOrMeta+a');

    // Open overflow menu to verify link button is now active
    // First check if menu is already open, if not click to open it
    const overflowButton2 = toolbar.locator('button:has-text("⋯")');
    await expect(overflowButton2).toBeVisible();
    const menuAlreadyOpen = await menu.isVisible();
    if (!menuAlreadyOpen) {
      await overflowButton2.click();
    }
    await expect(menu).toBeVisible();

    // Verify link button is now active (Semantic UI adds .active class to <a> tag)
    const linkButtonAgain = menu.locator('[data-toolbar-button="link"]');
    const activeButton = linkButtonAgain.locator('a.active');
    await expect(activeButton).toBeVisible();
  });

});

test.describe('Quanta Toolbar - Auto-fade', () => {
  test('toolbar shows on mouse click then fades after inactivity', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Click a slate block — mouse activity shows toolbar
    await helper.clickBlockInIframe('block-1-uuid');

    const toolbar = page.locator('.quanta-toolbar');
    await expect(toolbar).toHaveCSS('opacity', '1');

    // Toolbar should fade out after inactivity (5s timer + 0.3s transition)
    await expect(toolbar).toHaveCSS('opacity', '0', { timeout: 8000 });
  });

  test('keyboard navigation keeps toolbar hidden', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');
    await helper.waitForIframeReady();

    const toolbar = page.locator('.quanta-toolbar');

    // ArrowDown with no block selected → selects first block via keyboard
    await page.keyboard.press('ArrowDown');

    // Toolbar should be hidden — no mouse activity
    await expect(toolbar).toHaveCSS('opacity', '0');

    // Arrow to next block — still hidden
    await page.keyboard.press('ArrowDown');
    await expect(toolbar).toHaveCSS('opacity', '0');
  });

  test('mouse activity after keyboard nav shows toolbar', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');
    await helper.waitForIframeReady();

    const toolbar = page.locator('.quanta-toolbar');

    // Select first block via keyboard — toolbar hidden
    await page.keyboard.press('ArrowDown');
    await expect(toolbar).toHaveCSS('opacity', '0');

    // Move mouse inside iframe — toolbar appears
    const iframe = helper.getIframe();
    await iframe.locator('[data-block-uid="block-1-uuid"]').hover();
    await expect(toolbar).toHaveCSS('opacity', '1');
  });

  test('text selection shows toolbar and prevents fade', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');
    await helper.waitForIframeReady();

    const toolbar = page.locator('.quanta-toolbar');

    // Select first block via keyboard — toolbar hidden
    await page.keyboard.press('ArrowDown');
    await expect(toolbar).toHaveCSS('opacity', '0');

    // Select all text — SELECTION_CHANGE shows toolbar
    await page.keyboard.press('ControlOrMeta+a');
    await expect(toolbar).toHaveCSS('opacity', '1');

    // Toolbar stays visible — non-collapsed selection prevents fade.
    // Testing a negative (toolbar does NOT fade) requires waiting past
    // the fade timeout (~3s). No way to avoid waitForTimeout here.
    await page.waitForTimeout(4000);
    await expect(toolbar).toHaveCSS('opacity', '1');
  });

  test('arrow keys navigate past fixed blocks without editable fields', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.includes('nuxt'), 'Skipping on nuxt - template merge uses different block IDs');

    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    // Template-test-page layout (after merge):
    // standalone-block-1 (editable slate)
    // [template instance: template-header (fixed), grid (fixed), user-content-1, user-content-2, slider (fixed), template-footer (fixed)]
    // standalone-block-2 (editable slate)

    const { blockId: footerBlockId } = await helper.waitForBlockByContent('Template Footer');

    // Find the slider container's block ID from block order (it's between user-content-2 and footer)
    const blockOrder = await helper.getBlockOrder();
    const uc2Idx = blockOrder.indexOf('user-content-2');
    const footerIdx = blockOrder.indexOf(footerBlockId);
    // The slider container is the first top-level block after user-content-2
    // (slides are nested inside it but also appear in DOM order)
    const sliderBlockId = blockOrder[uc2Idx + 1];
    expect(sliderBlockId).toBeTruthy();
    expect(blockOrder.indexOf(sliderBlockId)).toBeLessThan(footerIdx);

    // Start at the last user content block inside the template
    await helper.clickBlockInIframe('user-content-2');
    await helper.waitForBlockSelectedInAdmin('user-content-2');

    // ArrowDown from user-content-2 reaches fixed slider (selected but not editable)
    await page.keyboard.press('ArrowDown');
    await helper.waitForBlockSelectedInAdmin(sliderBlockId);

    // ArrowDown from slider reaches fixed template-footer
    await page.keyboard.press('ArrowDown');
    await helper.waitForBlockSelectedInAdmin(footerBlockId);

    // ArrowDown from template-footer crosses template boundary to standalone-block-2
    await page.keyboard.press('ArrowDown');
    await helper.waitForBlockSelectedInAdmin('standalone-block-2');

    // ArrowUp from standalone-block-2: first press moves cursor to "home" (start of line),
    // second press detects edge and crosses template boundary to template-footer
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await helper.waitForBlockSelectedInAdmin(footerBlockId);

    // ArrowUp from template-footer reaches slider
    await page.keyboard.press('ArrowUp');
    await helper.waitForBlockSelectedInAdmin(sliderBlockId);

    // ArrowUp from slider returns to user-content-2
    await page.keyboard.press('ArrowUp');
    await helper.waitForBlockSelectedInAdmin('user-content-2');
  });

  test('arrow keys navigate across page block field boundaries', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.includes('nuxt'), 'Skipping on nuxt');

    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    // test-page has two page-level block fields:
    // blocks: [block-1-uuid, ..., block-10-listing-no-mapping]
    // footer_blocks: [footer-block-1 (slate), footer-block-2 (image)]
    // ArrowUp from footer-block-1 should cross into main blocks

    // Click footer-block-1 (first block in footer_blocks field)
    await helper.clickBlockInIframe('footer-block-1');
    await helper.waitForBlockSelectedInAdmin('footer-block-1');

    // ArrowUp should cross the block field boundary into the main blocks area.
    // First ArrowUp goes "home" (cursor normalization), second triggers edge navigation.
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');

    // Verify we left footer-block-1 (now in main blocks field)
    const iframe = helper.getIframe();
    await expect(async () => {
      const dragHandle = iframe.locator('.volto-hydra-drag-button');
      const handleBox = await dragHandle.boundingBox();
      const footerBlock = iframe.locator('[data-block-uid="footer-block-1"]');
      const footerBox = await footerBlock.boundingBox();
      // Drag handle should be ABOVE footer-block-1 (navigated backward)
      expect(handleBox!.y).toBeLessThan(footerBox!.y);
    }).toPass({ timeout: 5000 });

    // ArrowDown should return to footer-block-1 (cross back into footer_blocks)
    await page.keyboard.press('ArrowDown');
    await helper.waitForBlockSelectedInAdmin('footer-block-1');
  });
});
