/**
 * Integration tests for container block management in Volto Hydra.
 *
 * Tests nested block selection, container hierarchy detection,
 * and add/delete operations within containers.
 */
import type { FrameLocator } from '@playwright/test';
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';
import { URLS } from '../ports';

test.describe('Container Block Detection', () => {
  test('clicking nested block selects it', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    // Login and navigate to container test page
    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();

    // Verify the page has the columns structure
    const columnsBlock = iframe.locator('[data-block-uid="columns-1"]');
    await expect(columnsBlock).toBeVisible();

    // Click on a nested content block (text-1a inside col-1 inside columns-1)
    await helper.clickBlockInIframe('text-1a');

    // Verify text-1a is selected (toolbar visible)
    const hasToolbar = await helper.isQuantaToolbarVisibleInIframe('text-1a');
    expect(hasToolbar).toBe(true);
  });

  test('nested blocks have correct hierarchy in DOM', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();

    // Verify 3-level structure:
    // Level 1: columns-1 (page-level container)
    const columnsBlock = iframe.locator('[data-block-uid="columns-1"]');
    await expect(columnsBlock).toBeVisible();

    // Level 2: col-1, col-2 (columns inside columns block)
    const col1 = columnsBlock.locator('[data-block-uid="col-1"]');
    const col2 = columnsBlock.locator('[data-block-uid="col-2"]');
    await expect(col1).toBeVisible();
    await expect(col2).toBeVisible();

    // Level 3: text-1a, text-1b inside col-1
    const text1a = col1.locator('[data-block-uid="text-1a"]');
    const text1b = col1.locator('[data-block-uid="text-1b"]');
    await expect(text1a).toBeVisible();
    await expect(text1b).toBeVisible();

    // Level 3: text-2a inside col-2
    const text2a = col2.locator('[data-block-uid="text-2a"]');
    await expect(text2a).toBeVisible();

    // Verify data-block-add attributes for direction hints on columns
    // Note: nested blocks inside columns don't require data-block-add - hydra infers direction from depth
    await expect(col1).toHaveAttribute('data-block-add', 'right');
    await expect(col2).toHaveAttribute('data-block-add', 'right');
  });

  test('clicking deeply nested block shows its settings in sidebar', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    // Click on text-1a (deepest level - inside col-1 inside columns-1)
    await helper.clickBlockInIframe('text-1a');
    await helper.waitForSidebarOpen();
    await helper.openSidebarTab('Block');

    // Sidebar should show slate block settings (since text-1a is a slate block)
    const sidebar = page.locator('#sidebar-properties');
    await expect(sidebar).toBeVisible();

    // Slate blocks don't have url/alt fields like images
    const hasUrlField = await helper.hasSidebarField('url');
    expect(hasUrlField).toBe(false);
  });

  test('container structure renders correctly in iframe', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();

    // Verify the columns container is visible
    const columnsBlock = iframe.locator('[data-block-uid="columns-1"]');
    await expect(columnsBlock).toBeVisible();

    // Verify nested column blocks are visible
    const col1 = iframe.locator('[data-block-uid="col-1"]');
    const col2 = iframe.locator('[data-block-uid="col-2"]');
    await expect(col1).toBeVisible();
    await expect(col2).toBeVisible();

    // Verify deeply nested content blocks are visible
    const text1a = iframe.locator('[data-block-uid="text-1a"]');
    const text1b = iframe.locator('[data-block-uid="text-1b"]');
    const text2a = iframe.locator('[data-block-uid="text-2a"]');
    await expect(text1a).toBeVisible();
    await expect(text1b).toBeVisible();
    await expect(text2a).toBeVisible();
  });


  test('can switch selection between nested and page-level blocks', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    // First select a nested block
    await helper.clickBlockInIframe('text-1a');
    expect((await helper.isBlockSelectedInIframe('text-1a')).ok).toBe(true);

    // Then select a page-level block
    await helper.clickBlockInIframe('text-after');
    expect((await helper.isBlockSelectedInIframe('text-after')).ok).toBe(true);
    expect((await helper.isBlockSelectedInIframe('text-1a')).ok).toBe(false);

    // And back to a different nested block
    await helper.clickBlockInIframe('text-2a');
    expect((await helper.isBlockSelectedInIframe('text-2a')).ok).toBe(true);
    expect((await helper.isBlockSelectedInIframe('text-after')).ok).toBe(false);
  });

  test('container block shows full border outline, not bottom line', async ({ page }) => {
    // Container blocks should show a full border around them, not just a bottom line
    // even if they only have a single editable text field (like a title)
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    // Click on columns-1 (a container block with a title field)
    await helper.clickContainerBlockInIframe('columns-1');

    // Clicking container title enters text mode — subtle outline on block
    const outline = page.locator('.volto-hydra-block-outline');
    await expect(outline).toBeVisible();
    await expect(outline).toHaveAttribute('data-outline-style', 'subtle');
  });
});

// Note: Container hierarchy (parentUid) is determined from blockPathMap on the admin side,
// not sent in BLOCK_SELECTED messages. The admin has full formData + blocksConfig,
// so it can derive parent relationships from blockPathMap[blockUid].parentId.

test.describe('Adding Blocks to Containers', () => {
  test('iframe add button adds AFTER selected block showing parent allowedBlocks', async ({
    page,
  }) => {
    // When columns-1 (page-level container) is selected, clicking the iframe add button
    // should add AFTER columns-1 at page level, showing page-level allowed blocks
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    // Click on columns-1 to select it
    // clickContainerBlockInIframe already waits for toolbar
    await helper.clickContainerBlockInIframe('columns-1');

    // Click the iframe add button (adds AFTER columns-1)
    await helper.clickAddBlockButton();

    // Wait for block chooser
    const blockChooser = page.locator('.blocks-chooser');
    await expect(blockChooser).toBeVisible({ timeout: 5000 });

    // Should show page-level blocks (Image, Text, Hero) since we're adding at page level
    await expect(
      blockChooser.getByRole('button', { name: 'Image' }),
    ).toBeVisible();
    await expect(
      blockChooser.getByRole('button', { name: 'Text' }),
    ).toBeVisible();

    await page.keyboard.press('Escape');
  });

  test('clicking add on nested block shows container-filtered block chooser', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    // Select a nested content block inside col-1
    await helper.clickBlockInIframe('text-1a');

    // Click the add button
    await helper.clickAddBlockButton();

    // Verify block chooser appears
    expect(await helper.isBlockChooserVisible()).toBe(true);

    // Column's allowedBlocks is ['slate', 'image'] - these should be visible
    expect(await helper.isBlockTypeVisible('slate')).toBe(true);
    expect(await helper.isBlockTypeVisible('image')).toBe(true);

    // Page-level blocks like 'hero' and 'columns' should NOT be visible
    // because we're adding inside a column container
    expect(await helper.isBlockTypeVisible('hero')).toBe(false);
    expect(await helper.isBlockTypeVisible('columns')).toBe(false);
  });

  test('adding block inside container inserts into container, not page', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();

    // Count initial blocks in col-1 (text-1a, text-1b, col1-img-1)
    const initialCol1Blocks = await iframe
      .locator('[data-block-uid="col-1"] > [data-block-uid]')
      .count();
    expect(initialCol1Blocks).toBe(3);

    // Count initial page-level blocks
    const initialPageBlocks = await iframe
      .locator('#content > [data-block-uid]')
      .count();

    // Select text-1a and add a new block after it
    await helper.clickBlockInIframe('text-1a');
    await helper.clickAddBlockButton();
    await helper.selectBlockType('slate');

    // col-1 should now have one more block (the new slate)
    const finalCol1Blocks = await iframe
      .locator('[data-block-uid="col-1"] > [data-block-uid]')
      .count();
    expect(finalCol1Blocks).toBe(initialCol1Blocks + 1);

    // Page-level blocks should be unchanged
    const finalPageBlocks = await iframe
      .locator('#content > [data-block-uid]')
      .count();
    expect(finalPageBlocks).toBe(initialPageBlocks);
  });

  test('adding block inside implicit container (gridBlock) works', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    // Wait for all blocks to render (Nuxt async components)
    await helper.getStableBlockCount();

    const iframe = helper.getIframe();

    // Wait for nested grid cells to render
    await expect(iframe.locator('[data-block-uid="grid-cell-2"]')).toBeVisible({ timeout: 10000 });

    // Count initial blocks in grid-1 (should be 2: grid-cell-1, grid-cell-2)
    const initialGridBlocks = await iframe
      .locator('[data-block-uid="grid-1"] > .grid-row > [data-block-uid]')
      .count();
    expect(initialGridBlocks).toBe(2);

    // Count initial page-level blocks
    const initialPageBlocks = await iframe
      .locator('#content > [data-block-uid]')
      .count();

    // Select grid-cell-1 and add a new block after it
    // gridBlock only allows ['teaser', 'image'] blocks
    await helper.clickBlockInIframe('grid-cell-1');
    await helper.clickAddBlockButton();
    await helper.selectBlockType('teaser');
    await helper.getStableBlockCount();

    // grid-1 should now have 3 blocks
    const finalGridBlocks = await iframe
      .locator('[data-block-uid="grid-1"] > .grid-row > [data-block-uid]')
      .count();
    expect(finalGridBlocks).toBe(3);

    // Page-level blocks should be unchanged
    const finalPageBlocks = await iframe
      .locator('#content > [data-block-uid]')
      .count();
    expect(finalPageBlocks).toBe(initialPageBlocks);
  });

  test('pressing Enter in nested block adds new block to container, not page', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();

    // Count initial blocks in col-1 (text-1a, text-1b, col1-img-1)
    const initialCol1Blocks = await iframe
      .locator('[data-block-uid="col-1"] > [data-block-uid]')
      .count();
    expect(initialCol1Blocks).toBe(3);

    // Count initial page-level blocks
    const initialPageBlocks = await iframe
      .locator('#content > [data-block-uid]')
      .count();

    // Click on text-1a to edit it and get the editor
    const editor = await helper.enterEditMode('text-1a');

    // Move cursor to end and press Enter to split/add new block
    await helper.moveCursorToEnd(editor);
    await page.keyboard.press('Enter');

    // Wait for col-1 to have one more block (text-1a was split, new block added)
    const col1BlocksLocator = iframe.locator(
      '[data-block-uid="col-1"] > [data-block-uid]',
    );
    await expect(col1BlocksLocator).toHaveCount(initialCol1Blocks + 1);

    // Page-level blocks should be unchanged - the new block should be in the container
    const finalPageBlocks = await iframe
      .locator('#content > [data-block-uid]')
      .count();
    expect(finalPageBlocks).toBe(initialPageBlocks);
  });

  // Regression: when the container allows MULTIPLE block types (e.g. gridBlock
  // with allowedBlocks ['image', 'listing', 'slate', 'teaser']) and no
  // defaultBlockType is set, View.jsx's ADD_BLOCK_AFTER handler currently falls
  // through past the single-allowedBlock branch to a hardcoded 'slate' default.
  // The expected behaviour is "another one of these": if the source block's
  // @type is in the computed allowed types, create another of that type;
  // otherwise use the centralised getEmptyBlockType() fallback. Mirrors the
  // single-allowedBlock test above.
  test('pressing Enter in container with multiple allowedBlocks creates same type as source', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();

    // grid-1 has two teaser cells (allowedBlocks: image/listing/slate/teaser).
    const gridCellsLocator = iframe.locator(
      '[data-block-uid="grid-1"] > .grid-row > [data-block-uid]',
    );
    await expect(gridCellsLocator).toHaveCount(2);

    // Click the first teaser cell (block-mode selection — cells are
    // data-block-readonly so we never enter text mode on the title).
    await helper.clickBlockInIframe('grid-cell-1');

    // Press Enter — should add another block in grid-1, of type 'teaser'
    // (same as source), not 'slate' (the old hardcoded default).
    await page.keyboard.press('Enter');
    await expect(gridCellsLocator).toHaveCount(3);

    // Verify the new block is a teaser via the sidebar's current-block label.
    await helper.waitForSidebarCurrentBlock('Teaser');
  });

  test('pressing Enter in container with single allowedBlock creates that type, not slate', async ({
    page,
  }) => {
    // The `columns` slot has allowedBlocks: ['column'] and intentionally
    // NO defaultBlockType — the factory must fall back to "use the only
    // allowed type" (column), NOT the global slate default in View.jsx.
    // This guards against the "global slate default leaks into single-
    // allowedBlock slots" regression.
    //
    // Source is a container (column has children), so per the docs on
    // "Enter in block mode on a container source" in block-add-remove
    // .spec.ts, ADD_BLOCK_AFTER's "another one of these" rule creates
    // another column AND auto-initialises a slate child inside it, with
    // focus moving into that slate. Two Escapes walk back up to the
    // new column block to verify its type via sidebar.
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();

    // Count initial columns (should be 2: col-1, col-2).
    const columnsLocator = iframe.locator('.columns-row > [data-block-uid]');
    await expect(columnsLocator).toHaveCount(2);

    // Select col-2 in block mode.
    await helper.clickContainerBlockInIframe('col-2', { waitForToolbar: false });
    await helper.waitForBlockSelectedInAdmin('col-2');

    // Press Enter — single-allowedBlock fallback creates a column (not a
    // slate). The new column auto-inits a slate child; focus lands there.
    await page.keyboard.press('Enter');
    await expect(columnsLocator).toHaveCount(3);

    // Walk up from the auto-init slate to the new column block to verify
    // its type. Escape #1 leaves text mode → block mode on the slate;
    // Escape #2 bubbles up to its parent (the new column).
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await helper.waitForSidebarCurrentBlock('Column', 5_000);
  });

  test('sidebar add at page level adds block to page blocks', async ({
    page,
  }) => {
    // When no block is selected, the sidebar shows page-level "Blocks" section
    // with an add button that should add blocks at the page level
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    // Get initial block count using helper (waits for stability)
    const initialBlockCount = await helper.getStableBlockCount();

    // Select a top-level block then deselect by clicking parent arrow
    await helper.clickBlockInIframe('columns-1');
    await helper.waitForSidebarOpen();
    await page.waitForTimeout(300);

    // Click current block's arrow to deselect (returns to page level)
    const currentHeader = page.locator(
      '.sidebar-section-header[data-is-current="true"] .parent-nav',
    );
    await currentHeader.locator('.nav-back').click();
    await page.waitForTimeout(300);

    // Now the sidebar should show page-level "Blocks" section
    const blocksSection = page.locator('.container-field-section', {
      has: page.locator('.widget-title', { hasText: 'Blocks' }),
    });
    await expect(blocksSection).toBeVisible({ timeout: 5000 });

    // Click the add button in the Blocks section
    const addButton = blocksSection.getByRole('button', { name: 'Add block' });
    await expect(addButton).toBeVisible();
    await addButton.click();

    // Block chooser should appear with page-level blocks
    const blockChooser = page.locator('.blocks-chooser');
    await expect(blockChooser).toBeVisible({ timeout: 5000 });

    // Should show page-level blocks (Image, Text, Hero)
    await expect(
      blockChooser.getByRole('button', { name: 'Image' }),
    ).toBeVisible();
    await expect(
      blockChooser.getByRole('button', { name: 'Text' }),
    ).toBeVisible();

    // Select Text to add a new block
    await blockChooser.getByRole('button', { name: 'Text' }).click();

    // Wait for block chooser to close and block to be added
    await expect(blockChooser).not.toBeVisible({ timeout: 5000 });

    // Block count should have increased by 1
    await helper.waitForBlockCountToBe(initialBlockCount + 1);

    // The new block should be the LAST block (added at bottom)
    const blockOrder = await helper.getBlockOrder();
    const lastBlockUid = blockOrder[blockOrder.length - 1];
    expect(lastBlockUid).not.toBe('grid-1'); // Not the original last block

    // The new block should be selected (toolbar visible for it)
    await helper.waitForIframeBlockHandle(lastBlockUid!);
  });
});

test.describe('Add Button Direction', () => {
  test('add button appears to right for blocks with data-block-add="right"', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    // col-1 has data-block-add="right" attribute
    // Use clickContainerBlockInIframe to avoid hitting nested content
    // (already waits for toolbar)
    await helper.clickContainerBlockInIframe('col-1');

    // Verify add button is positioned to the right of the block
    // verifyBlockUIPositioning already polls for the expected state
    const positioning = await helper.verifyBlockUIPositioning('col-1');
    expect(positioning.addButtonDirection).toBe('right');
  });

  test('add button appears below for blocks with data-block-add="bottom"', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    // text-1a has data-block-add="bottom" attribute
    await helper.clickBlockInIframe('text-1a');

    // Verify add button is positioned below the block
    const positioning = await helper.verifyBlockUIPositioning('text-1a');
    expect(positioning.addButtonDirection).toBe('bottom');
  });

  test('add button direction is inferred from nesting depth when no attribute', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    // Wait for all blocks to render (Nuxt async components)
    await helper.getStableBlockCount();

    const iframe = helper.getIframe();
    // Wait for nested grid cells to render
    await expect(iframe.locator('[data-block-uid="grid-cell-1"]')).toBeVisible({ timeout: 10000 });

    // grid-cell-1 has NO data-block-add attribute
    // It's nested at depth 1 (inside grid-1), so direction should be inferred as 'right'
    await helper.clickBlockInIframe('grid-cell-1');

    // Verify add button is positioned to the right (inferred from depth 1)
    const positioning = await helper.verifyBlockUIPositioning('grid-cell-1');
    expect(positioning.addButtonDirection).toBe('right');
  });
});

test.describe('Deleting Blocks from Containers', () => {
  test('deleting nested block removes from container, not page', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();

    // Count initial blocks in col-1 (text-1a, text-1b, col1-img-1)
    const initialCol1Blocks = await iframe
      .locator('[data-block-uid="col-1"] > [data-block-uid]')
      .count();
    expect(initialCol1Blocks).toBe(3);

    // Count initial page-level blocks
    const initialPageBlocks = await iframe
      .locator('#content > [data-block-uid]')
      .count();

    // Select text-1b and delete it via toolbar menu
    await helper.clickBlockInIframe('text-1b');
    await helper.openQuantaToolbarMenu('text-1b');
    await helper.clickQuantaToolbarMenuOption('text-1b', 'Remove');
    await helper.waitForBlockToDisappear('text-1b');

    // col-1 should now have one fewer block
    const finalCol1Blocks = await iframe
      .locator('[data-block-uid="col-1"] > [data-block-uid]')
      .count();
    expect(finalCol1Blocks).toBe(initialCol1Blocks - 1);

    // Page-level blocks should be unchanged
    const finalPageBlocks = await iframe
      .locator('#content > [data-block-uid]')
      .count();
    expect(finalPageBlocks).toBe(initialPageBlocks);
  });
});

test.describe('Hierarchical Sidebar', () => {
  test('sticky headers remain visible when scrolling sidebar', async ({ page }) => {
    // Set a very small viewport height to ensure sidebar content overflows
    await page.setViewportSize({ width: 1280, height: 400 });

    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    // Select a deeply nested block (text inside column inside columns)
    // This should show 4 headers: Page, Columns, Column, Text
    await helper.clickBlockInIframe('text-2a');
    await helper.waitForSidebarOpen();

    // Get the sidebar content wrapper
    const sidebarContent = page.locator('.sidebar-content-wrapper');

    // Get all sticky headers - should be 4 for deeply nested block
    const stickyHeaders = page.locator('.sidebar-section-header.sticky-header');
    await expect(stickyHeaders).toHaveCount(4);

    // Verify the header hierarchy: Page, Columns, Column, Text
    await expect(stickyHeaders.nth(0)).toContainText('Page');
    await expect(stickyHeaders.nth(1)).toContainText('Columns');
    await expect(stickyHeaders.nth(2)).toContainText('Column');
    await expect(stickyHeaders.nth(3)).toContainText('Text');

    // Get container bounds before scrolling
    const containerBounds = await sidebarContent.boundingBox();
    expect(containerBounds).toBeTruthy();

    // Scroll to bottom of sidebar
    const scrollInfo = await sidebarContent.evaluate((el) => {
      const before = el.scrollTop;
      el.scrollTop = el.scrollHeight;
      return {
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        scrollTopBefore: before,
        scrollTopAfter: el.scrollTop,
      };
    });

    // Verify scrolling actually happened (content is taller than viewport)
    expect(
      scrollInfo.scrollTopAfter,
      `Sidebar should have scrolled (scrollHeight=${scrollInfo.scrollHeight}, clientHeight=${scrollInfo.clientHeight})`,
    ).toBeGreaterThan(0);

    // After scrolling to bottom, sticky headers should be at the TOP of the container
    // If sticky isn't working, they would have scrolled out of view (y would be negative)
    const bounds = await Promise.all([
      stickyHeaders.nth(0).boundingBox(),
      stickyHeaders.nth(1).boundingBox(),
      stickyHeaders.nth(2).boundingBox(),
      stickyHeaders.nth(3).boundingBox(),
    ]);

    // Page header should be at the top of the container (sticky at top: 0)
    expect(
      bounds[0]!.y,
      `Page header should be at top of container after scrolling (got y=${bounds[0]!.y}, container top=${containerBounds!.y})`,
    ).toBeGreaterThanOrEqual(containerBounds!.y - 5); // Allow small margin

    expect(
      bounds[0]!.y,
      `Page header should be stuck at top, not scrolled down`,
    ).toBeLessThan(containerBounds!.y + 100);

    // All headers should be stacked within the visible container area
    for (let i = 0; i < 4; i++) {
      expect(
        bounds[i]!.y,
        `Header ${i} should be within visible container (y=${bounds[i]!.y})`,
      ).toBeGreaterThanOrEqual(containerBounds!.y - 5);

      expect(
        bounds[i]!.y,
        `Header ${i} should be in upper portion of container when sticky`,
      ).toBeLessThan(containerBounds!.y + containerBounds!.height / 2);
    }

    // Verify headers are stacked vertically (each below the previous)
    for (let i = 1; i < bounds.length; i++) {
      expect(
        bounds[i]!.y,
        `Header ${i} should be below header ${i - 1}`,
      ).toBeGreaterThan(bounds[i - 1]!.y);
    }
  });

  test('child blocks widget not shown for non-container blocks', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    // Select a leaf block (text-1a is a slate block with no children)
    await helper.clickBlockInIframe('text-1a');
    await helper.waitForSidebarOpen();

    // The child blocks widget should NOT be visible for non-container blocks
    const childBlocksWidget = page.locator('#sidebar-order .child-blocks-widget');
    await expect(childBlocksWidget).not.toBeVisible();
  });

  test('selecting nested block auto-scrolls sidebar to show its settings', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    // Select a deeply nested block (text-1a is 3 levels deep: page > columns > column > text)
    await helper.clickBlockInIframe('text-1a');
    await helper.waitForSidebarOpen();

    // Get the sidebar scroll container and current block settings
    const sidebarScroller = page.locator('.sidebar-content-wrapper');
    const blockSettings = page.locator('#sidebar-properties');

    await expect(sidebarScroller).toBeVisible();
    await expect(blockSettings).toBeVisible();

    // Wait for scroll to complete by polling until settings bottom is visible
    await expect(async () => {
      const settingsBox = await blockSettings.boundingBox();
      const scrollerBox = await sidebarScroller.boundingBox();

      expect(settingsBox).toBeTruthy();
      expect(scrollerBox).toBeTruthy();

      // The current block settings should be fully visible (scrolled into view)
      // Allow 5px tolerance for sub-pixel rendering differences
      const settingsBottom = settingsBox!.y + settingsBox!.height;
      const scrollerBottom = scrollerBox!.y + scrollerBox!.height;
      const tolerance = 5;

      expect(
        settingsBottom <= scrollerBottom + tolerance,
        `Settings bottom (${settingsBottom}) should be within ${tolerance}px of scroller bottom (${scrollerBottom})`,
      ).toBe(true);
    }).toPass({ timeout: 5000 });
  });

  test('child blocks widget shown for container blocks', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    // Click a child block first (text-1a is inside col-1)
    // Clicking directly on a container is unreliable as you often click a child inside
    await helper.clickBlockInIframe('text-1a', { waitForToolbar: false });
    await helper.waitForSidebarCurrentBlock('Text');

    // Navigate up to the parent container (col-1) by clicking the back arrow
    const parentNav = page.locator(
      '.sidebar-section-header[data-is-current="true"] .parent-nav',
    );
    await parentNav.locator('.nav-back').click();
    await helper.waitForSidebarCurrentBlock('Column');

    // The child blocks widget should be visible for container blocks
    const childBlocksWidget = page.locator('#sidebar-order .child-blocks-widget');
    await expect(childBlocksWidget).toBeVisible();

    // Should show col-1's child blocks (text-1a, text-1b, col1-img-1)
    const childItems = page.locator('#sidebar-order .child-block-item');
    await expect(childItems).toHaveCount(3);
  });

  test('clicking arrow on headers navigates up to parent', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    // Select a deeply nested block (text-1a inside col-1 inside columns-1)
    await helper.clickBlockInIframe('text-1a');
    await helper.waitForSidebarOpen();
    await page.waitForTimeout(300);

    // Should see: Page, Columns, Column, Text (4 headers)
    let headerCount = await page
      .locator('.sidebar-section-header.sticky-header')
      .count();
    expect(headerCount).toBeGreaterThanOrEqual(4);

    // Step 1: Click current "Text" header arrow to go up to Column
    let currentHeader = page.locator(
      '.sidebar-section-header[data-is-current="true"] .parent-nav',
    );
    await expect(currentHeader.locator('.nav-title')).toContainText(/text/i);
    await currentHeader.locator('.nav-back').click();
    await page.waitForTimeout(300);

    // Column is now current, Text header is gone
    currentHeader = page.locator(
      '.sidebar-section-header[data-is-current="true"]',
    );
    await expect(currentHeader).toContainText(/column/i);
    headerCount = await page
      .locator('.sidebar-section-header.sticky-header')
      .count();
    expect(headerCount).toBe(3); // Page, Columns, Column

    // Step 2: Click current "Column" header arrow to go up to Columns
    const columnHeader = page.locator(
      '.sidebar-section-header[data-is-current="true"] .parent-nav',
    );
    await columnHeader.locator('.nav-back').click();
    await page.waitForTimeout(300);

    // Columns is now current, Column header is gone
    currentHeader = page.locator(
      '.sidebar-section-header[data-is-current="true"]',
    );
    await expect(currentHeader).toContainText(/columns/i);
    headerCount = await page
      .locator('.sidebar-section-header.sticky-header')
      .count();
    expect(headerCount).toBe(2); // Page, Columns

    // Step 3: Click current "Columns" header arrow to deselect
    const columnsHeader = page.locator(
      '.sidebar-section-header[data-is-current="true"] .parent-nav',
    );
    await columnsHeader.locator('.nav-back').click();
    await page.waitForTimeout(300);

    // No block selected, only Page header shown
    headerCount = await page
      .locator('.sidebar-section-header.sticky-header')
      .count();
    expect(headerCount).toBe(1); // Only Page
  });

  test('clicking block arrow to deselect hides selection outline and add button', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    // Select a top-level block (columns-1)
    await helper.clickBlockInIframe('columns-1');
    await helper.waitForSidebarOpen();
    await page.waitForTimeout(300);

    // Verify selection UI is visible
    const selectionOutline = page.locator('.volto-hydra-block-outline');
    const addButton = page.locator('.volto-hydra-add-button');

    await expect(selectionOutline).toBeVisible();
    await expect(addButton).toBeVisible();

    // Click current block's arrow to deselect (Columns has no parent)
    const currentHeader = page.locator(
      '.sidebar-section-header[data-is-current="true"] .parent-nav',
    );
    await currentHeader.locator('.nav-back').click();
    await page.waitForTimeout(300);

    // Verify all selection UI is hidden
    await expect(selectionOutline).not.toBeVisible();
    await expect(addButton).not.toBeVisible();
  });

  test('clicking close button in Page header collapses sidebar', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');
    await helper.waitForSidebarOpen();

    // Verify sidebar is visible and expanded
    const sidebarContainer = page.locator('.sidebar-container');
    await expect(sidebarContainer).toBeVisible();
    await expect(sidebarContainer).not.toHaveClass(/collapsed/);

    // Click the close button in Page header
    const closeButton = page.locator('.sidebar-close-button');
    await expect(closeButton).toBeVisible();
    await closeButton.click();

    // Wait for sidebar to collapse
    await page.waitForTimeout(300);

    // Verify sidebar is collapsed
    await expect(sidebarContainer).toHaveClass(/collapsed/);
  });

  test('each block in hierarchy shows editable settings', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();

    // Verify initial titles are rendered in iframe
    await expect(
      iframe.locator('[data-block-uid="columns-1"] .columns-title'),
    ).toHaveText('My Columns Section');
    await expect(
      iframe.locator('[data-block-uid="col-1"] .column-title'),
    ).toHaveText('Left Column');

    // Select the deepest nested block (text-1a inside col-1 inside columns-1)
    await helper.clickBlockInIframe('text-1a');
    await helper.waitForSidebarOpen();
    // Wait for quanta toolbar to ensure block is fully selected
    await helper.waitForBlockSelectedInAdmin('text-1a');

    // Should see parent block headers in sidebar-parents
    const sidebarParents = page.locator('#sidebar-parents');
    await expect(sidebarParents).toBeVisible({ timeout: 5000 });

    // Find all title input fields in the parent blocks sidebar
    // Each parent block (Columns, Column) should have a title field
    // Wait for at least 2 title fields to appear (may take time on nuxt)
    const parentTitleInputs = sidebarParents.locator(
      'input[name="title"], .field-wrapper-title input',
    );
    await expect(parentTitleInputs).toHaveCount(2, { timeout: 5000 });

    // ===== Edit Level 1: Columns block (grandparent) =====
    // The first title field should be for the Columns block
    const columnsTitle = parentTitleInputs.first();
    await expect(columnsTitle).toBeVisible();
    await expect(columnsTitle).toHaveValue('My Columns Section');

    // fill() clears then types — avoid separate clear() which triggers a
    // re-render that can replace the input before fill() on slow CI
    await columnsTitle.fill('Edited Columns Title');
    await columnsTitle.blur();

    // Verify the iframe updated with the new Columns title
    await expect(
      iframe.locator('[data-block-uid="columns-1"] .columns-title'),
      'Columns title should update in iframe after sidebar edit',
    ).toHaveText('Edited Columns Title', { timeout: 10000 });

    // ===== Edit Level 2: Column block (parent) =====
    // Re-query inputs after the re-render from first edit
    const columnTitleInputs = sidebarParents.locator(
      'input[name="title"], .field-wrapper-title input',
    );
    const columnTitle = columnTitleInputs.nth(1);
    await expect(columnTitle).toBeVisible();
    await expect(columnTitle).toHaveValue('Left Column');

    await columnTitle.fill('Edited Column Title');
    await columnTitle.blur();

    // Verify the iframe updated with the new Column title
    await expect(
      iframe.locator('[data-block-uid="col-1"] .column-title'),
      'Column title should update in iframe after sidebar edit',
    ).toHaveText('Edited Column Title', { timeout: 10000 });

    // ===== Verify Level 3: Current block (Slate/Text) has settings =====
    // The current block's settings should render in #sidebar-properties inside the current block section
    const sidebarProperties = page.locator('#sidebar-properties');
    await expect(
      sidebarProperties,
      'Current block settings should be visible in #sidebar-properties',
    ).toBeVisible();

    // Slate block should have a "Body" field in its settings
    const slateBodyField = sidebarProperties.locator(
      '.field-wrapper-value, [class*="field"][class*="value"]',
    );
    await expect(
      slateBodyField.first(),
      'Slate block should show Body/value field in sidebar',
    ).toBeVisible();

    // ===== Verify all edits persisted =====
    // Both titles should still show the edited values
    await expect(
      iframe.locator('[data-block-uid="columns-1"] .columns-title'),
    ).toHaveText('Edited Columns Title');
    await expect(
      iframe.locator('[data-block-uid="col-1"] .column-title'),
    ).toHaveText('Edited Column Title');
  });

  test('toolbar position updates after sidebar toggle', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');
    await helper.waitForSidebarOpen();

    // Select a block to show toolbar
    await helper.clickBlockInIframe('text-after');
    await helper.waitForBlockSelectedInAdmin('text-after');

    // Close sidebar
    const closeButton = page.locator('.sidebar-close-button');
    await closeButton.click();
    // Wait for sidebar to collapse
    const sidebarContainer = page.locator('.sidebar-container');
    await expect(sidebarContainer).toHaveClass(/collapsed/, { timeout: 5000 });
    // Wait for toolbar to reposition after iframe resize
    await helper.waitForBlockSelectedInAdmin('text-after');

    // Re-open sidebar
    const triggerButton = page.locator('.sidebar-container .trigger');
    await triggerButton.click();
    // Wait for sidebar animation to complete (collapsed class removed)
    await expect(sidebarContainer).not.toHaveClass(/collapsed/, { timeout: 5000 });
    // Wait for toolbar to reposition after iframe resize
    await helper.waitForBlockSelectedInAdmin('text-after');
  });
});

test.describe('Empty Block Behavior', () => {
  // Note: We use gridBlock for empty block tests because it doesn't have a defaultBlockType
  // and 'slate' is not in its allowedBlocks: ['teaser', 'image'], so getEmptyBlockType
  // falls back to @type:'empty'. The column block has defaultBlockType: 'slate', so it
  // creates slate blocks instead of empty.

  test('container with defaultBlock creates that type when emptied', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();

    // The column block has defaultBlock: 'slate', so when we delete all blocks,
    // it should create a slate block, not an empty block.

    // col-1 starts with text-1a, text-1b, col1-img-1 — delete all three
    await helper.clickBlockInIframe('col1-img-1');
    await helper.openQuantaToolbarMenu('col1-img-1');
    await helper.clickQuantaToolbarMenuOption('col1-img-1', 'Remove');
    await helper.waitForBlockToDisappear('col1-img-1');

    await helper.clickBlockInIframe('text-1b');
    await helper.openQuantaToolbarMenu('text-1b');
    await helper.clickQuantaToolbarMenuOption('text-1b', 'Remove');
    await helper.waitForBlockToDisappear('text-1b');

    // Now delete text-1a (the last block in col-1)
    await helper.clickBlockInIframe('text-1a');
    await helper.openQuantaToolbarMenu('text-1a');
    await helper.clickQuantaToolbarMenuOption('text-1a', 'Remove');
    await helper.waitForBlockToDisappear('text-1a');

    // col-1 should now have 1 block (the default slate block, not empty)
    const col1Blocks = await iframe
      .locator('[data-block-uid="col-1"] > [data-block-uid]')
      .count();
    expect(col1Blocks).toBe(1);

    // The block should be of type 'slate' (the defaultBlock), not 'empty'
    const newBlock = iframe.locator('[data-block-uid="col-1"] > [data-block-uid]').first();
    await expect(helper.getSlateField(newBlock)).toBeVisible();
  });

  test('container with single allowedBlock creates that type when emptied', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();

    // The columns block has allowedBlocks: ['column'] with no defaultBlock,
    // so when we delete all columns, it should create a 'column' block
    // (the single allowed type) instead of 'empty'.

    // First delete col-2 from columns-1
    // Use clickContainerBlockInIframe to click on the column title,
    // not inside where nested blocks would be selected instead
    await helper.clickContainerBlockInIframe('col-2');
    await helper.openQuantaToolbarMenu('col-2');
    await helper.clickQuantaToolbarMenuOption('col-2', 'Remove');
    await helper.waitForBlockToDisappear('col-2');

    // Now delete col-1 (the last column in columns-1)
    await helper.clickContainerBlockInIframe('col-1');
    await helper.openQuantaToolbarMenu('col-1');
    await helper.clickQuantaToolbarMenuOption('col-1', 'Remove');
    await helper.waitForBlockToDisappear('col-1');

    // columns-1 should now have 1 block (a column block, not empty)
    const columnBlocks = await iframe
      .locator('[data-block-uid="columns-1"] > .columns-row > [data-block-uid]')
      .count();
    expect(columnBlocks).toBe(1);

    // The block should be of type 'column' (the single allowed type), not 'empty'
    // Columns have class="column" in the renderer
    const newColumn = iframe.locator('[data-block-uid="columns-1"] > .columns-row > [data-block-uid]').first();
    await expect(newColumn).toHaveClass(/column/);
  });

  test('deleting last block from container creates empty block', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    // Wait for all blocks to render (Nuxt async components)
    await helper.getStableBlockCount();

    const iframe = helper.getIframe();

    // Wait for nested grid cells to render
    await expect(iframe.locator('[data-block-uid="grid-cell-2"]')).toBeVisible({ timeout: 10000 });

    // First delete grid-cell-2 from grid-1
    await helper.clickBlockInIframe('grid-cell-2');
    await helper.openQuantaToolbarMenu('grid-cell-2');
    await helper.clickQuantaToolbarMenuOption('grid-cell-2', 'Remove');
    await helper.waitForBlockToDisappear('grid-cell-2');
    await helper.getStableBlockCount();

    // Now delete grid-cell-1 (the last block in grid-1)
    await helper.clickBlockInIframe('grid-cell-1');
    await helper.openQuantaToolbarMenu('grid-cell-1');
    await helper.clickQuantaToolbarMenuOption('grid-cell-1', 'Remove');
    await helper.waitForBlockToDisappear('grid-cell-1');
    await helper.getStableBlockCount();

    // grid-1 should now have 1 empty block
    const gridBlocks = await iframe
      .locator('[data-block-uid="grid-1"] > .grid-row > [data-block-uid]')
      .count();
    expect(gridBlocks).toBe(1);

    // The block should be of type 'empty' (has data-hydra-empty attribute)
    const emptyBlock = iframe
      .locator('[data-block-uid="grid-1"] > .grid-row > [data-block-uid]')
      .first();
    await expect(emptyBlock).toHaveAttribute('data-hydra-empty');

    // Empty block should have visible dashed border styling (injected by hydra.js)
    const borderStyle = await emptyBlock.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return style.borderStyle;
    });
    expect(borderStyle).toBe('dashed');

    // Empty block should have the "+" indicator (::after pseudo-element)
    const pseudoContent = await emptyBlock.evaluate((el) => {
      const style = window.getComputedStyle(el, '::after');
      return style.content;
    });
    // CSS content property wraps the value in quotes, so we check for '"+"'
    expect(pseudoContent).toBe('"+"');

    // A seeded 'empty' placeholder can't take a sibling AFTER it, but it CAN be typed in place: it
    // now shows the '+' add button, which opens the block chooser to pick the empty's type
    // (hydra.src.js getAddDirection keeps the '+' when canReplace is true; branch commit 9abb4a3 —
    // "a seeded empty in a no-default multi-allowed container can pick its type"). Use a direct
    // click since empty blocks don't show a toolbar (clickBlockInIframe expects one).
    await emptyBlock.click();

    // The '+' add button IS visible for the empty — the type-in-place affordance. (This test
    // previously asserted it hidden; 9abb4a3 intentionally changed that so a no-default,
    // multi-allowed empty isn't stranded with no way to be typed.)
    const addButton = page.locator('.volto-hydra-add-button');
    await expect(addButton).toBeVisible({ timeout: 5000 });

    // Clicking that '+' — the one drawn in the middle of the empty — opens the chooser. Merely
    // SELECTING the empty must not (a delete that seeds an empty selects it too).
    await addButton.click();
    const blockChooser = page.locator('.block-add-button-menu, .blocks-chooser');
    await expect(blockChooser).toBeVisible({ timeout: 5000 });
  });

  test("clicking an empty block's + opens the block chooser", async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    // Wait for all blocks to render (Nuxt async components)
    await helper.getStableBlockCount();

    const iframe = helper.getIframe();

    // Delete both blocks from grid-1 to create empty block
    await helper.clickBlockInIframe('grid-cell-2');
    await helper.openQuantaToolbarMenu('grid-cell-2');
    await helper.clickQuantaToolbarMenuOption('grid-cell-2', 'Remove');
    await helper.waitForBlockToDisappear('grid-cell-2');
    await helper.getStableBlockCount();

    // Verify grid-cell-2 is gone before proceeding
    await expect(iframe.locator('[data-block-uid="grid-cell-2"]')).not.toBeVisible();

    await helper.clickBlockInIframe('grid-cell-1');
    await helper.openQuantaToolbarMenu('grid-cell-1');
    await helper.clickQuantaToolbarMenuOption('grid-cell-1', 'Remove');
    await helper.waitForBlockToDisappear('grid-cell-1');
    await helper.getStableBlockCount();

    // Verify grid-cell-1 is gone
    await expect(iframe.locator('[data-block-uid="grid-cell-1"]')).not.toBeVisible();

    // Wait for an empty block to appear (hydra marks empty blocks with data-hydra-empty)
    const emptyBlockLocator = iframe.locator('[data-block-uid="grid-1"] > .grid-row > [data-hydra-empty]');
    await expect(emptyBlockLocator).toBeVisible({ timeout: 5000 });

    // Get the empty block's ID
    const emptyBlockId = await emptyBlockLocator.getAttribute('data-block-uid');
    console.log('[TEST] Empty block ID after deletions:', emptyBlockId);

    // Select the empty block. Don't use clickBlockInIframe — empty blocks show no toolbar.
    await emptyBlockLocator.click();

    // Selecting it is not the convert gesture; clicking the '+' drawn in the middle of the empty
    // is. Only then does the chooser open.
    const addButton = page.locator('.volto-hydra-add-button');
    await expect(addButton).toBeVisible({ timeout: 5000 });
    await addButton.click();

    const blockChooser = page.locator('.blocks-chooser');
    await expect(blockChooser).toBeVisible({ timeout: 5000 });
  });

  test('selecting block type replaces empty block', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    // Wait for all blocks to render (Nuxt async components)
    await helper.getStableBlockCount();

    const iframe = helper.getIframe();

    // Delete both blocks from grid-1 to create empty block
    await helper.clickBlockInIframe('grid-cell-2');
    await helper.openQuantaToolbarMenu('grid-cell-2');
    await helper.clickQuantaToolbarMenuOption('grid-cell-2', 'Remove');
    await helper.waitForBlockToDisappear('grid-cell-2');
    await helper.getStableBlockCount();

    await helper.clickBlockInIframe('grid-cell-1');
    await helper.openQuantaToolbarMenu('grid-cell-1');
    await helper.clickQuantaToolbarMenuOption('grid-cell-1', 'Remove');
    await helper.waitForBlockToDisappear('grid-cell-1');
    await helper.getStableBlockCount();

    // Wait for empty block to be rendered inside grid-1
    // hydra marks empty blocks with data-hydra-empty attribute
    const emptyBlockLocator = iframe.locator(
      '[data-block-uid="grid-1"] > .grid-row > [data-hydra-empty]'
    );
    await expect(emptyBlockLocator).toBeVisible({ timeout: 5000 });

    // Get the empty block's ID
    const emptyBlockId = await emptyBlockLocator.getAttribute('data-block-uid');

    // Select the empty block, then click the '+' drawn in its middle to open the chooser.
    // Don't use clickBlockInIframe — empty blocks show no toolbar.
    await emptyBlockLocator.click();
    const addButton = page.locator('.volto-hydra-add-button');
    await expect(addButton).toBeVisible({ timeout: 5000 });
    await addButton.click();

    // Wait for block chooser
    const blockChooser = page.locator('.blocks-chooser');
    await expect(blockChooser).toBeVisible({ timeout: 5000 });

    // Select teaser block type (gridBlock only allows ['teaser', 'image'])
    await blockChooser.getByRole('button', { name: 'Teaser' }).click();

    // The block should now be teaser type, not empty
    const teaserBlock = iframe
      .locator('[data-block-uid="grid-1"] > .grid-row > [data-block-uid]')
      .first();
    // Wait for teaser to render (has a link element)
    await expect(teaserBlock.locator('a').first()).toBeVisible({ timeout: 5000 });

    // The block should not have the empty fallback
    const blockContent = await teaserBlock.textContent();
    expect(blockContent).not.toContain('Empty block');
  });

  // Baseline (NO template): emptying a container seeds an empty placeholder
  // INSIDE the container, and adding into it clears that empty. This is the
  // behaviour parity that the template primary-slot case violates (see
  // template-advanced.spec.ts 'emptied template primary slot has no in-slot empty').
  test('emptied container seeds an in-place empty and adding into it clears it (no template)', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/container-test-page');
    await helper.getStableBlockCount();
    const iframe = helper.getIframe();

    // Empty grid-1 by removing both of its cells.
    for (const cell of ['grid-cell-2', 'grid-cell-1']) {
      await helper.clickBlockInIframe(cell);
      await helper.openQuantaToolbarMenu(cell);
      await helper.clickQuantaToolbarMenuOption(cell, 'Remove');
      await helper.waitForBlockToDisappear(cell);
      await helper.getStableBlockCount();
    }

    // The emptied container gets an empty placeholder INSIDE it (data-hydra-empty).
    const inContainerEmpty = iframe.locator(
      '[data-block-uid="grid-1"] > .grid-row > [data-hydra-empty]',
    );
    await expect(inContainerEmpty).toBeVisible({ timeout: 5000 });

    // Adding into that empty (select → click its '+' → chooser → Teaser) clears the empty and
    // places the new block inside the container.
    await inContainerEmpty.click();
    const addButton = page.locator('.volto-hydra-add-button');
    await expect(addButton).toBeVisible({ timeout: 5000 });
    await addButton.click();
    const chooser = page.locator('.blocks-chooser');
    await expect(chooser).toBeVisible({ timeout: 5000 });
    await chooser.getByRole('button', { name: 'Teaser' }).click();

    const newChild = iframe
      .locator('[data-block-uid="grid-1"] > .grid-row > [data-block-uid]')
      .first();
    await expect(newChild.locator('a').first()).toBeVisible({ timeout: 5000 });
    // The empty is gone — the add replaced it in place.
    await expect(
      iframe.locator('[data-block-uid="grid-1"] [data-hydra-empty]'),
    ).toHaveCount(0);
  });

  test('empty blocks are stripped on save and restored on re-edit', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');
    await helper.waitForIframeReady();

    const iframe = helper.getIframe();

    // Delete both blocks from grid-1 to create an empty block.
    // gridBlock has allowedBlocks: ['teaser', 'image'] — 'slate' is not allowed,
    // so getEmptyBlockType falls back to @type:'empty'.
    await helper.clickBlockInIframe('grid-cell-2');
    await helper.openQuantaToolbarMenu('grid-cell-2');
    await helper.clickQuantaToolbarMenuOption('grid-cell-2', 'Remove');
    await helper.waitForBlockToDisappear('grid-cell-2');
    await helper.getStableBlockCount();

    await helper.clickBlockInIframe('grid-cell-1');
    await helper.openQuantaToolbarMenu('grid-cell-1');
    await helper.clickQuantaToolbarMenuOption('grid-cell-1', 'Remove');
    await helper.waitForBlockToDisappear('grid-cell-1');
    await helper.getStableBlockCount();

    // Verify the empty block was created inside grid-1
    const emptyBlock = iframe.locator(
      '[data-block-uid="grid-1"] > .grid-row > [data-hydra-empty]',
    );
    await expect(emptyBlock).toBeVisible({ timeout: 5000 });

    // Save
    await helper.saveContent();

    // Verify the API does not contain any @type:'empty' blocks
    const cookies = await page.context().cookies();
    const authCookie = cookies.find((c: { name: string }) => c.name === 'auth_token');
    const token = authCookie!.value;
    const response = await page.request.get(`${URLS.mockApi}/container-test-page`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });
    const apiData = await response.json();

    // Check all blocks recursively for @type:'empty'
    const findEmptyBlocks = (blocks: Record<string, any>): string[] => {
      const found: string[] = [];
      for (const [id, block] of Object.entries(blocks)) {
        if (block?.['@type'] === 'empty') found.push(id);
        // Check nested blocks (e.g., inside grid-1)
        if (block?.blocks && typeof block.blocks === 'object') {
          found.push(...findEmptyBlocks(block.blocks));
        }
      }
      return found;
    };
    const emptyBlocks = findEmptyBlocks(apiData.blocks || {});
    expect(emptyBlocks).toHaveLength(0);

    // Re-edit — the empty block should be restored by ensureEmptyBlockIfEmpty
    await helper.navigateToEdit('/container-test-page');
    await helper.waitForIframeReady();

    // grid-1 should have an empty block again (re-created on edit)
    const restoredEmpty = iframe.locator(
      '[data-block-uid="grid-1"] > .grid-row > [data-hydra-empty]',
    );
    await expect(restoredEmpty).toBeVisible({ timeout: 10000 });
  });

  test('adding new container block creates initial block inside', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();

    // Click on columns-1 to select it (the container that holds columns)
    // We need to select the columns block to add a new column inside it
    await helper.clickContainerBlockInIframe('columns-1');

    // Add a column via the sidebar (columns field only allows 'column' type, so auto-inserts)
    await helper.addBlockViaSidebar('Columns');

    // Block chooser should NOT have appeared (single allowedBlock = auto-insert)
    const blockChooser = page.locator('.blocks-chooser');
    await expect(blockChooser).not.toBeVisible();

    // The new column should be created. Since column has defaultBlock: 'slate',
    // it should have a slate block inside, not be empty.
    // Wait for columns-1 to have 3 columns
    const columnBlocksLocator = iframe.locator(
      '[data-block-uid="columns-1"] > .columns-row > [data-block-uid]',
    );
    await expect(columnBlocksLocator).toHaveCount(3, { timeout: 5000 });

    // Get the new column (the third one)
    const newColumn = iframe
      .locator('[data-block-uid="columns-1"] > .columns-row > [data-block-uid]')
      .nth(2);

    // The new column should have at least one block inside
    const childBlocks = await newColumn.locator('> [data-block-uid]').count();
    expect(childBlocks).toBeGreaterThan(0);

    // The block inside should be of type 'slate' (the defaultBlock)
    const childBlock = newColumn.locator('> [data-block-uid]').first();
    await expect(helper.getSlateField(childBlock)).toBeVisible();
  });

  test('adding columns block recursively initializes column with default block', async ({
    page,
  }) => {
    // This tests the recursive initialization:
    // 1. Add columns block at page level
    // 2. Columns block should automatically get a column (only allowed type)
    // 3. That column should automatically get a slate block (column's defaultBlock)
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();

    // Click on a page-level block (text-after) to get add button at page level
    await helper.clickBlockInIframe('text-after');

    // Click the add button and select Columns block type
    await helper.clickAddBlockButton();
    await helper.selectBlockType('columns');

    // Wait for sidebar to show the new Columns block is selected
    await helper.waitForSidebarCurrentBlock('Columns', 10000);

    // Wait for the new columns block to appear in iframe (should be 2 total: original columns-1 + new one)
    // Columns blocks have a .columns-row child - find all blocks with this structure
    const allColumnsBlocks = iframe.locator('[data-block-uid]:has(> .columns-row)');
    await expect(allColumnsBlocks).toHaveCount(2, { timeout: 10000 });

    // Get the new columns block (the last one)
    const newColumnsBlock = allColumnsBlocks.last();
    const newColumnsId = await newColumnsBlock.getAttribute('data-block-uid');
    expect(newColumnsId).not.toBe('columns-1');

    // The new columns block should have at least one column inside
    const columnChildren = newColumnsBlock.locator(
      '> .columns-row > [data-block-uid]',
    );
    const columnCount = await columnChildren.count();
    expect(columnCount).toBeGreaterThanOrEqual(1);

    // Get the first column - columns have class="column"
    const firstColumn = columnChildren.first();
    await expect(firstColumn).toHaveClass(/column/);

    // The column should have at least one block inside (defaultBlock: 'slate')
    const columnContent = firstColumn.locator('> [data-block-uid]');
    const contentCount = await columnContent.count();
    expect(contentCount).toBeGreaterThanOrEqual(1);

    // The content block should be slate (column's defaultBlock)
    const contentBlock = columnContent.first();
    await expect(helper.getSlateField(contentBlock)).toBeVisible();
  });
});

test.describe('Single Allowed Block Auto-Insert', () => {
  // When a container only allows one block type, clicking add should
  // automatically insert that block type without showing the chooser

  test('sidebar add button auto-inserts when container has single allowedBlock', async ({
    page,
  }) => {
    // columns block has allowedBlocks: ['column'] - only one option
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();

    // Get initial column count
    const initialColumnCount = await iframe
      .locator('[data-block-uid="columns-1"] > .columns-row > [data-block-uid]')
      .count();
    expect(initialColumnCount).toBe(2);

    // Select columns-1 (the container that only allows column blocks)
    await helper.clickContainerBlockInIframe('columns-1', { waitForToolbar: false });
    await helper.waitForSidebarCurrentBlock('Columns');

    // Add a column via the sidebar (columns field only allows 'column' type, so auto-inserts)
    await helper.addBlockViaSidebar('Columns');

    // Block chooser should NOT have appeared (since there's only one option)
    const blockChooser = page.locator('.blocks-chooser');
    await expect(blockChooser).not.toBeVisible();

    // A new column should have been auto-inserted (wait for count to reach 3)
    const columnsLocator = iframe.locator(
      '[data-block-uid="columns-1"] > .columns-row > [data-block-uid]',
    );
    await expect(columnsLocator).toHaveCount(3);

    // The new column should have a slate inside (recursive initialization)
    const newColumn = iframe
      .locator('[data-block-uid="columns-1"] > .columns-row > [data-block-uid]')
      .last();
    const childBlocks = await newColumn.locator('> [data-block-uid]').count();
    expect(childBlocks).toBeGreaterThan(0);

    // The slate block should have EMPTY text, not "Empty block" fallback
    // This verifies that applyBlockDefaults was called and slate got proper initial value
    const slateBlock = newColumn.locator('> [data-block-uid]').first();
    const slateText = await slateBlock.textContent();
    expect(slateText?.trim()).toBe('');

    // The new column should be selected (toolbar visible)
    const newColumnId = await newColumn.getAttribute('data-block-uid');
    expect(newColumnId).toBeTruthy();
    // Wait for toolbar to appear after block insertion
    await helper.waitForBlockSelectedInAdmin(newColumnId!);

    // The add button should be to the RIGHT of the new column (columns go horizontally)
    const positioning = await helper.verifyBlockUIPositioning(newColumnId!);
    console.log('[TEST] positioning:', JSON.stringify(positioning));
    expect(positioning.addButtonDirection).toBe('right');
  });

  test('iframe add button auto-inserts when container has single allowedBlock', async ({
    page,
  }) => {
    // When col-1 is selected, the iframe add button inserts AFTER col-1
    // Parent container (columns-1) only allows 'column' blocks, so auto-insert
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();

    // Get initial column count
    const initialColumnCount = await iframe
      .locator('[data-block-uid="columns-1"] > .columns-row > [data-block-uid]')
      .count();
    expect(initialColumnCount).toBe(2);

    // Select col-1 (inside columns-1, which only allows column blocks)
    await helper.clickContainerBlockInIframe('col-1', { waitForToolbar: false });
    await helper.waitForSidebarCurrentBlock('Column');

    // Find and click the iframe add button (the + button next to the block)
    // This inserts AFTER col-1 as a sibling (another column)
    const addButton = page.locator('.volto-hydra-add-button');
    await expect(addButton).toBeVisible({ timeout: 5000 });
    await addButton.click();

    // Block chooser should NOT appear (since parent only allows column blocks)
    const blockChooser = page.locator('.blocks-chooser');
    await expect(blockChooser).not.toBeVisible({ timeout: 1000 });

    // A new column should have been auto-inserted
    const columns = iframe.locator('[data-block-uid="columns-1"] > .columns-row > [data-block-uid]');
    await expect(columns).toHaveCount(3, { timeout: 5000 });

  });

  test('sidebar add on column adds block INSIDE column not as sibling', async ({
    page,
  }) => {
    // When col-1 is selected and we click sidebar add, the new block should be
    // added INSIDE col-1 (as a child), NOT as a sibling column in columns-1
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();

    // Count initial blocks in col-1 and columns in columns-1
    const initialBlocksInCol1 = await iframe
      .locator('[data-block-uid="col-1"] > [data-block-uid]')
      .count();
    const initialColumnCount = await iframe
      .locator('[data-block-uid="columns-1"] > .columns-row > [data-block-uid]')
      .count();
    expect(initialBlocksInCol1).toBe(3); // text-1a, text-1b, col1-img-1
    expect(initialColumnCount).toBe(2); // col-1 and col-2

    // Select col-1 (a column that allows slate and image)
    await helper.clickContainerBlockInIframe('col-1');

    // Add a Text block via the sidebar (col-1 allows slate and image, so chooser appears)
    // Note: the column's container field is titled "Content" in its blockSchema
    await helper.addBlockViaSidebar('Content', 'Text');

    // Verify: col-1 should have one more child (new block added INSIDE)
    const col1Blocks = iframe.locator('[data-block-uid="col-1"] > [data-block-uid]');
    await expect(col1Blocks).toHaveCount(initialBlocksInCol1 + 1);

    // Verify: columns-1 should still have 2 columns (NO sibling added)
    const newColumnCount = await iframe
      .locator('[data-block-uid="columns-1"] > .columns-row > [data-block-uid]')
      .count();
    expect(newColumnCount).toBe(2); // should still be 2, not 3
  });

  test('iframe add after page-level container shows page-level allowed blocks', async ({
    page,
  }) => {
    // When clicking iframe add button on a page-level container block (columns-1),
    // the block chooser should show all page-level blocks, not the container's child blocks
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    // Select columns-1 (a page-level container block)
    await helper.clickContainerBlockInIframe('columns-1');
    await page.waitForTimeout(500);

    // Click the iframe add button (adds AFTER columns-1 at page level)
    const addButton = page.locator('.volto-hydra-add-button');
    await expect(addButton).toBeVisible({ timeout: 5000 });
    await addButton.click();

    // Block chooser should appear with page-level blocks (not just 'column')
    const blockChooser = page.locator('.blocks-chooser');
    await expect(blockChooser).toBeVisible({ timeout: 5000 });

    // Should see common blocks like Image, Text, Hero - not just Column
    // The page doesn't restrict allowedBlocks, so all common blocks should appear
    await expect(blockChooser.getByRole('button', { name: 'Image' })).toBeVisible();
    await expect(blockChooser.getByRole('button', { name: 'Text' })).toBeVisible();

    await page.keyboard.press('Escape');
  });
});

test.describe('Parent Block Navigation', () => {
  test('pressing Escape selects parent block', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    // Select a deeply nested block (text-1a inside col-1 inside columns-1)
    await helper.clickBlockInIframe('text-1a');
    await page.waitForTimeout(300);

    // Verify text-1a is selected (4 headers: Page, Columns, Column, Text)
    let headerCount = await page
      .locator('.sidebar-section-header.sticky-header')
      .count();
    expect(headerCount).toBe(4);

    // Press Escape to go up to parent (col-1)
    await helper.escapeToParent();
    await page.waitForTimeout(300);

    // Should now have 3 headers (Page, Columns, Column)
    headerCount = await page
      .locator('.sidebar-section-header.sticky-header')
      .count();
    expect(headerCount).toBe(3);

    // Current block should be Column
    const currentHeader = page.locator(
      '.sidebar-section-header[data-is-current="true"]',
    );
    await expect(currentHeader).toContainText(/column/i);

    // Press Escape again to go to columns-1
    await helper.escapeToParent();
    await page.waitForTimeout(300);

    headerCount = await page
      .locator('.sidebar-section-header.sticky-header')
      .count();
    expect(headerCount).toBe(2);
    await expect(currentHeader).toContainText(/columns/i);

    // Press Escape again to deselect (no block selected)
    await helper.escapeToParent();
    await page.waitForTimeout(300);

    headerCount = await page
      .locator('.sidebar-section-header.sticky-header')
      .count();
    expect(headerCount).toBe(1); // Only Page header
  });

  test('Quanta ⬆ steps up out of text mode, then to the parent', async ({
    page,
  }) => {
    // The ⬆ button is a STEP-UP control, not "select parent" — it posts STEP_UP and
    // runs hydra's stepUpSelection(), the exact state machine the Escape key drives:
    //   text mode → block mode → parent → deselect.
    // It was promoted out of the ⋯ dropdown by
    // docs/superpowers/specs/2026-06-09-select-parent-quanta-button-design.md as a
    // one-tap "select parent", but folding it into the Escape machine gave phones
    // (which have no Escape key) a way out of text editing. That is the contract now,
    // and block-selection.spec.ts's STEP_UP_TRIGGERS asserts ⬆ and Escape stay
    // identical. So a nested slate block needs TWO taps to reach its container: the
    // first leaves the inline editor, the second selects the parent.
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    // Select a nested block (text-1a inside col-1). Clicking a slate block lands in
    // text mode, so 4 headers: Page, Columns, Column, Text.
    await helper.clickBlockInIframe('text-1a');
    await helper.waitForBlockSelectedInAdmin('text-1a');

    const stepUpBtn = page.locator('.quanta-toolbar .step-up-btn');
    await expect(stepUpBtn).toBeVisible();

    // Tap 1: text mode → block mode. Same block, so the hierarchy is unchanged.
    await stepUpBtn.click();
    await expect(
      page.locator('.sidebar-section-header.sticky-header'),
    ).toHaveCount(4);

    // Tap 2: block mode → parent (col-1). Now 3 headers: Page, Columns, Column.
    await stepUpBtn.click();
    await expect(
      page.locator('.sidebar-section-header.sticky-header'),
    ).toHaveCount(3);

    const currentHeader = page.locator(
      '.sidebar-section-header[data-is-current="true"]',
    );
    await expect(currentHeader).toContainText(/column/i);
  });

  test('Quanta ⬆ stays available on a top-level block and deselects it', async ({
    page,
  }) => {
    // This test used to assert the button was HIDDEN at top level, back when ⬆ meant
    // "select parent" and a top-level block has no parent to select. As a STEP-UP
    // control it is still meaningful there — the machine's last state is `deselect` —
    // and on a phone it is the only way out of a selection, so it must stay visible.
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    // Select a top-level block (columns-1 has no parent).
    await helper.clickContainerBlockInIframe('columns-1');
    await helper.waitForBlockSelectedInAdmin('columns-1');

    const stepUpBtn = page.locator('.quanta-toolbar .step-up-btn');
    await expect(page.locator('.quanta-toolbar')).toBeVisible();
    await expect(stepUpBtn).toBeVisible();

    // NB clickContainerBlockInIframe lands on the columns block's own <h3
    // data-edit-text> title, so this IS a click on text and tap 1 leaves the inline
    // editor. See block-selection.spec.ts for the no-text case (image → block mode,
    // one tap to deselect).
    await stepUpBtn.click();
    await expect(page.locator('.quanta-toolbar')).toBeVisible();

    // Tap 2: block mode with no parent → deselect. Quanta goes with the selection.
    await stepUpBtn.click();
    await expect(page.locator('.quanta-toolbar')).toBeHidden({ timeout: 5000 });
  });
});

test.describe('Sidebar Editing for Nested Blocks', () => {
  test('editing nested slate block in iframe does not cause sidebar error', async ({
    page,
  }) => {
    // Regression test: When editing a slate block inside a column in the iframe,
    // the sidebar should not throw "Invalid value used as weak map key" error
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    // Select a slate block inside col-1 (text-1a)
    await helper.clickContainerBlockInIframe('text-1a');
    await page.waitForTimeout(500);

    // Verify sidebar shows the slate block settings without error
    const sidebarHeader = page.locator(
      '.sidebar-section-header[data-is-current="true"]',
    );
    await expect(sidebarHeader).toBeVisible({ timeout: 5000 });

    // Type some text in the iframe to trigger an edit
    const iframe = helper.getIframe();
    const slateBlock = iframe.locator('[data-block-uid="text-1a"]');
    await slateBlock.click();
    await page.keyboard.type('Test edit');

    // Verify typed text appears in iframe (confirms no crash)
    await expect(slateBlock).toContainText('Test edit', { timeout: 5000 });

    // The sidebar should still be visible (no crash)
    await expect(sidebarHeader).toBeVisible();
  });
});

test.describe('Container Block Drag and Drop', () => {
  test.setTimeout(30000);

  test('can reorder blocks within the same container', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();

    // Get initial order of blocks in col-1 (text-1a, text-1b, col1-img-1)
    const col1 = iframe.locator('[data-block-uid="col-1"]');
    const initialBlocks = await col1.locator(':scope > [data-block-uid]').all();
    expect(initialBlocks.length).toBe(3);

    const firstBlockUid = await initialBlocks[0].getAttribute('data-block-uid');
    const secondBlockUid = await initialBlocks[1].getAttribute('data-block-uid');
    expect(firstBlockUid).toBe('text-1a');
    expect(secondBlockUid).toBe('text-1b');

    // Select first block in container
    await helper.clickBlockInIframe('text-1a');

    // Get drag handle and drag to after second block
    const dragHandle = await helper.getDragHandle();
    const secondBlock = iframe.locator('[data-block-uid="text-1b"]');

    await helper.dragBlockWithMouse(dragHandle, secondBlock, true); // Insert after

    // Wait for reorder to complete - first block should now be text-1b
    await expect.poll(async () => {
      const firstBlock = col1.locator(':scope > [data-block-uid]').first();
      return await firstBlock.getAttribute('data-block-uid');
    }, { timeout: 5000 }).toBe('text-1b');

    // Verify second block is now text-1a
    const newSecondBlockUid = await col1.locator(':scope > [data-block-uid]').nth(1).getAttribute('data-block-uid');
    expect(newSecondBlockUid).toBe('text-1a');
  });

  test('can drag block from one container to another', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();

    // Get initial counts
    const col1 = iframe.locator('[data-block-uid="col-1"]');
    const col2 = iframe.locator('[data-block-uid="col-2"]');

    const col1InitialCount = await col1
      .locator(':scope > [data-block-uid]')
      .count();
    const col2InitialCount = await col2
      .locator(':scope > [data-block-uid]')
      .count();

    expect(col1InitialCount).toBe(3); // text-1a, text-1b, col1-img-1
    expect(col2InitialCount).toBe(1); // text-2a

    // Select text-1a from col-1
    await helper.clickBlockInIframe('text-1a');

    // Drag to col-2 (drop on text-2a)
    const dragHandle = await helper.getDragHandle();
    const targetBlock = iframe.locator('[data-block-uid="text-2a"]');

    await helper.dragBlockWithMouse(dragHandle, targetBlock, true); // Insert after

    // Wait for block to move between containers (React re-render may be async)
    await expect(col1.locator(':scope > [data-block-uid]'))
      .toHaveCount(col1InitialCount - 1, { timeout: 5000 });
    await expect(col2.locator(':scope > [data-block-uid]'))
      .toHaveCount(col2InitialCount + 1, { timeout: 5000 });
  });

  test('can drag block from container to page level', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();

    // Get initial counts
    const col1 = iframe.locator('[data-block-uid="col-1"]');
    const col1InitialCount = await col1
      .locator(':scope > [data-block-uid]')
      .count();

    // Verify col-1 starts with text-1a, text-1b, col1-img-1
    expect(col1InitialCount).toBe(3);

    // Select text-1a from col-1 and wait for toolbar
    await helper.clickBlockInIframe('text-1a');

    // Drag to page level (drop on text-after which is a page-level block)
    const dragHandle = await helper.getDragHandle();
    const targetBlock = iframe.locator('[data-block-uid="text-after"]');

    await helper.dragBlockWithMouse(dragHandle, targetBlock, true);

    // Wait for block to be removed from col-1 (React re-render may be async)
    await expect(col1.locator(':scope > [data-block-uid]')).toHaveCount(col1InitialCount - 1, { timeout: 5000 });

    // Verify text-1a is no longer inside col-1
    await expect(col1.locator('[data-block-uid="text-1a"]')).toHaveCount(0, { timeout: 5000 });

    // And it should exist at page level (not inside any container)
    const text1aAtPageLevel = iframe.locator(
      ':scope > [data-block-uid="text-1a"], body > [data-block-uid="text-1a"]',
    );
    // Actually the page-level blocks might be in a wrapper, let's just check it's not in col-1
  });

  test('can drag page-level block into container', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();

    // Get initial state
    const col2 = iframe.locator('[data-block-uid="col-2"]');
    const col2InitialCount = await col2
      .locator(':scope > [data-block-uid]')
      .count();

    // Verify text-after is NOT in col-2 initially
    const textAfterInCol2Initially = await col2
      .locator('[data-block-uid="text-after"]')
      .count();
    expect(textAfterInCol2Initially).toBe(0);

    // Select text-after (page-level slate block)
    await helper.clickBlockInIframe('text-after');

    // Drag into col-2 (drop on text-2a)
    const dragHandle = await helper.getDragHandle();
    const targetBlock = iframe.locator('[data-block-uid="text-2a"]');

    await helper.dragBlockWithMouse(dragHandle, targetBlock, false); // Insert before

    // Wait for block to be added to col-2 (React re-render may be async)
    await expect(col2.locator(':scope > [data-block-uid]')).toHaveCount(col2InitialCount + 1, { timeout: 5000 });

    // Verify text-after is now inside col-2
    await expect(col2.locator('[data-block-uid="text-after"]')).toHaveCount(1, { timeout: 5000 });
  });

  test('block data is preserved after drag between containers', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();

    // Get initial text content of text-1a
    const originalText = await iframe
      .locator('[data-block-uid="text-1a"] p')
      .textContent();
    expect(originalText).toContain('Col 1 Text 1');

    // Select and drag text-1a to col-2
    await helper.clickBlockInIframe('text-1a');
    await page.waitForTimeout(300);

    const dragHandle = await helper.getDragHandle();
    const targetBlock = iframe.locator('[data-block-uid="text-2a"]');

    await helper.dragBlockWithMouse(dragHandle, targetBlock, true);

    // Verify the text content is preserved
    const newText = await iframe
      .locator('[data-block-uid="text-1a"] p')
      .textContent();
    expect(newText).toContain('Col 1 Text 1');
  });

  test('drop indicator is vertical for horizontal layout blocks', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();

    // Select col-1 (a column with data-block-add="right")
    // Use clickContainerBlockInIframe to click on the column's title, not child blocks
    await helper.clickContainerBlockInIframe('col-1', { waitForToolbar: false });
    await helper.waitForSidebarCurrentBlock('Column');

    // Wait for drag handle to appear (indicates block is selected)
    const dragHandle = await helper.getDragHandle();
    await expect(dragHandle).toBeVisible();
    const col2 = iframe.locator('[data-block-uid="col-2"]');

    // Get drag handle position
    const handleBox = await dragHandle.boundingBox();
    expect(handleBox).not.toBeNull();

    // Get iframe position to translate coordinates
    const iframeEl = page.locator('#previewIframe');
    const iframeBox = await iframeEl.boundingBox();
    expect(iframeBox).not.toBeNull();

    // Start the drag
    await page.mouse.move(
      handleBox!.x + handleBox!.width / 2,
      handleBox!.y + handleBox!.height / 2,
    );
    await page.mouse.down();

    // Move to col-2's LEFT EDGE (not center) to hit the column element itself
    // and avoid hitting child content blocks
    const col2Box = await col2.boundingBox();
    expect(col2Box).not.toBeNull();

    // Position at far left edge of col-2, vertically centered
    // Playwright's iframe.locator().boundingBox() already returns parent-relative coordinates
    const targetX = col2Box!.x + 5; // 5px into the column from left edge
    const targetY = col2Box!.y + col2Box!.height / 2;

    await page.mouse.move(targetX, targetY, { steps: 10 });

    // Check that drop indicator exists and is vertical
    const dropIndicator = iframe.locator('.volto-hydra-drop-indicator');
    await expect(dropIndicator).toBeVisible();

    // Get computed styles to verify it's vertical
    const indicatorStyles = await dropIndicator.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return {
        width: el.offsetWidth,
        height: el.offsetHeight,
        borderLeft: style.borderLeft,
        borderTop: style.borderTop,
      };
    });

    // Vertical indicator should be taller than wide (height > width)
    expect(indicatorStyles.height).toBeGreaterThan(indicatorStyles.width);

    // Clean up
    await page.mouse.up();
  });

  test('can reorder columns horizontally', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();

    // Get initial order of columns
    const columnsBlock = iframe.locator('[data-block-uid="columns-1"]');
    const columnsRow = columnsBlock.locator('.columns-row');
    const columns = columnsRow.locator(':scope > [data-block-uid]');
    const initialColumns = await columns.all();
    expect(initialColumns.length).toBe(2);

    const firstColUid = await initialColumns[0].getAttribute('data-block-uid');
    const secondColUid = await initialColumns[1].getAttribute('data-block-uid');
    expect(firstColUid).toBe('col-1');
    expect(secondColUid).toBe('col-2');

    // Select col-1
    await helper.clickContainerBlockInIframe('col-1', { waitForToolbar: false });
    await helper.waitForSidebarCurrentBlock('Column');

    // Drag col-1 to the right of col-2 using horizontal drag
    const dragHandle = await helper.getDragHandle();
    const col2 = iframe.locator('[data-block-uid="col-2"]');

    await helper.dragBlockWithMouseHorizontal(dragHandle, col2, true); // Insert after (right)

    // Wait for the reorder to complete
    await page.waitForTimeout(500);

    // Verify order changed - refresh the locators after DOM update
    const newColumnsRow = iframe.locator('[data-block-uid="columns-1"] .columns-row');
    const newColumns = await newColumnsRow.locator(':scope > [data-block-uid]').all();
    expect(newColumns.length).toBe(2);

    const newFirstColUid = await newColumns[0].getAttribute('data-block-uid');
    const newSecondColUid = await newColumns[1].getAttribute('data-block-uid');

    expect(newFirstColUid).toBe('col-2');
    expect(newSecondColUid).toBe('col-1');
  });

  test('drop indicator is vertical for grid cells (inferred from nesting depth)', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    // Wait for all blocks to render (Nuxt async components)
    await helper.getStableBlockCount();

    const iframe = helper.getIframe();

    // Grid cells are at nesting depth 1 (inside grid-1), so they should use horizontal layout
    // This tests that direction is inferred correctly even without explicit data-block-add attribute
    const gridCell1 = iframe.locator('[data-block-uid="grid-cell-1"]');
    await expect(gridCell1).toBeVisible();

    // Click on grid-cell-1 to select it
    await helper.clickContainerBlockInIframe('grid-cell-1', { waitForToolbar: false });
    await helper.waitForSidebarCurrentBlock('Teaser');

    // Start dragging
    const dragHandle = await helper.getDragHandle();
    const handleBox = await dragHandle.boundingBox();
    expect(handleBox).not.toBeNull();

    await page.mouse.move(
      handleBox!.x + handleBox!.width / 2,
      handleBox!.y + handleBox!.height / 2,
    );
    await page.mouse.down();

    // Move to grid-cell-2 (sibling in horizontal layout)
    const gridCell2 = iframe.locator('[data-block-uid="grid-cell-2"]');
    const cell2Box = await gridCell2.boundingBox();
    expect(cell2Box).not.toBeNull();

    // Move to right side of grid-cell-2
    await page.mouse.move(
      cell2Box!.x + cell2Box!.width * 0.75,
      cell2Box!.y + cell2Box!.height / 2,
      { steps: 10 },
    );

    // Drop indicator should be visible and VERTICAL (for horizontal layout)
    const dropIndicator = iframe.locator('.volto-hydra-drop-indicator');
    await expect(dropIndicator).toBeVisible();

    // Check that indicator is vertical (height > width)
    const indicatorBox = await dropIndicator.boundingBox();
    expect(indicatorBox).not.toBeNull();
    // Vertical indicator has small width and larger height
    expect(indicatorBox!.width).toBeLessThan(20); // Should be thin (around 4px)
    expect(indicatorBox!.height).toBeGreaterThan(50); // Should be tall

    // Clean up
    await page.mouse.up();
  });

  test('drop line snaps to the nearest valid target when the block is not allowed in the immediate slot', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();

    // Select text-1a (a slate block inside col-1)
    await helper.clickBlockInIframe('text-1a');
    await page.waitForTimeout(300);

    // Try to drag over col-1 (which is inside columns-1 that only allows 'column' blocks)
    const dragHandle = await helper.getDragHandle();

    // Get positions
    const handleBox = await dragHandle.boundingBox();
    expect(handleBox).not.toBeNull();

    // Start the drag
    await page.mouse.move(
      handleBox!.x + handleBox!.width / 2,
      handleBox!.y + handleBox!.height / 2,
    );
    await page.mouse.down();

    // Move to col-1 element itself (which is inside columns-1)
    // Slate can't be dropped as sibling of col-1 (columns only allows 'column')
    // But system walks up and finds page level allows slate
    const col1 = iframe.locator('[data-block-uid="col-1"]');
    const col1Box = await col1.boundingBox();
    expect(col1Box).not.toBeNull();

    // Move to left edge of col-1
    await page.mouse.move(col1Box!.x + 5, col1Box!.y + col1Box!.height / 2, {
      steps: 10,
    });

    // A drop line is always shown, at the nearest VALID edge. Slate can't be a sibling
    // of col-1 (the columns slot allows only 'column'), so — even though the cursor is
    // at col-1's edge, closest to that disallowed slot — the indicator must NOT sit at
    // the col-sibling slot; it snaps to the nearest place slate CAN go, which is INSIDE
    // col-1 (a column accepts slate). Assert the drop line is within col-1.
    const dropIndicator = iframe.locator('.volto-hydra-drop-indicator');
    await expect(dropIndicator).toBeVisible();

    const indicatorBox = await dropIndicator.boundingBox();
    const col1Rect = await col1.boundingBox();
    expect(indicatorBox).not.toBeNull();
    expect(col1Rect).not.toBeNull();
    const indCx = indicatorBox!.x + indicatorBox!.width / 2;
    const indCy = indicatorBox!.y + indicatorBox!.height / 2;
    const insideCol1 =
      indCx >= col1Rect!.x && indCx <= col1Rect!.x + col1Rect!.width &&
      indCy >= col1Rect!.y && indCy <= col1Rect!.y + col1Rect!.height;
    expect(insideCol1).toBe(true);

    // Clean up
    await page.mouse.up();
  });

  test('slate dropped over a slot that does not allow it snaps to the nearest valid place, not into the slot', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();

    // Get initial position of text-1a (a slate block inside col-1)
    const col1 = iframe.locator('[data-block-uid="col-1"]');
    const initialText1aInCol1 = await col1
      .locator('[data-block-uid="text-1a"]')
      .count();
    expect(initialText1aInCol1).toBe(1);

    // Select text-1a (a slate block)
    await helper.clickBlockInIframe('text-1a');
    await page.waitForTimeout(300);

    // Drag the slate to col-2's left edge, over the `columns` slot (allowedBlocks
    // ['column'] only). Under the nearest-droppable-edge model the drop line is never
    // shown at that disallowed slot — it snaps to the nearest place slate CAN go — so
    // the slate never becomes a direct child of the columns row; it lands at the
    // nearest valid target instead. Assert the drop LINE is shown + the rejection
    // invariant (not inserted into the columns slot), not a specific landing.
    const dragHandle = await helper.getDragHandle();
    const col2 = iframe.locator('[data-block-uid="col-2"]');

    const indicatorShown = await helper.dragBlockWithMouseHorizontal(
      dragHandle,
      col2,
      false, // insertAfter=false (left side, between col-1 and col-2)
      true,  // expectIndicator=true — a drop line is always shown, at the nearest valid edge
    );

    // A drop line IS shown (never hidden — it snaps to the nearest valid edge).
    expect(indicatorShown).toBe(true);

    // Slate moved to the nearest valid place — out of col-1...
    await expect(col1.locator('[data-block-uid="text-1a"]')).toHaveCount(0);

    // ...and it was NOT inserted into the columns slot (which rejects slate): it must
    // not be a direct child of the columns row.
    const columnsRowChildren = await iframe
      .locator('[data-block-uid="columns-1"] .columns-row > [data-block-uid]')
      .all();
    const columnsRowUids = await Promise.all(
      columnsRowChildren.map((b) => b.getAttribute('data-block-uid')),
    );
    expect(columnsRowUids).not.toContain('text-1a');
  });

  test('column dragged toward page level snaps to the columns block, not the page-level slot', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();

    // col-1 is a 'column' block which is NOT in page-level allowedBlocks
    // Page level allows: ['slate', 'image', 'hero', 'columns'] - NOT 'column'
    const col1 = iframe.locator('[data-block-uid="col-1"]');
    await expect(col1).toBeVisible();

    // Select col-1
    await helper.clickContainerBlockInIframe('col-1', { waitForToolbar: false });
    await helper.waitForSidebarCurrentBlock('Column');

    // Try to drag to page level (next to text-after which is a page-level block)
    const dragHandle = await helper.getDragHandle();
    const textAfter = iframe.locator('[data-block-uid="text-after"]');

    // Get positions
    const handleBox = await dragHandle.boundingBox();
    expect(handleBox).not.toBeNull();

    // Start the drag
    await page.mouse.move(
      handleBox!.x + handleBox!.width / 2,
      handleBox!.y + handleBox!.height / 2,
    );
    await page.mouse.down();

    // Move to text-after's bottom area (vertical layout at page level)
    const textAfterBox = await textAfter.boundingBox();
    expect(textAfterBox).not.toBeNull();

    await page.mouse.move(
      textAfterBox!.x + textAfterBox!.width / 2,
      textAfterBox!.y + textAfterBox!.height * 0.75,
      { steps: 10 },
    );

    // The drop line is always shown at the nearest VALID edge. 'column' isn't a
    // page-level block, so — even though the cursor is over the page-level slot at
    // text-after — the indicator must NOT sit there; it snaps to the nearest place a
    // column CAN go: inside the columns block (where columns live). Assert the drop
    // LINE is within the columns block, not the page-level slot.
    const dropIndicator = iframe.locator('.volto-hydra-drop-indicator');
    await expect(dropIndicator).toBeVisible();
    const columnsRect = await iframe.locator('[data-block-uid="columns-1"]').boundingBox();
    const indRect = await dropIndicator.boundingBox();
    expect(columnsRect).not.toBeNull();
    expect(indRect).not.toBeNull();
    const indCx = indRect!.x + indRect!.width / 2;
    const indCy = indRect!.y + indRect!.height / 2;
    const insideColumns =
      indCx >= columnsRect!.x && indCx <= columnsRect!.x + columnsRect!.width &&
      indCy >= columnsRect!.y && indCy <= columnsRect!.y + columnsRect!.height;
    expect(insideColumns).toBe(true);

    await page.mouse.up();
    await page.waitForTimeout(500);

    // The column must NOT have become a page-level block.
    const contentDiv = iframe.locator('#content');
    const pageLevelBlocks = await contentDiv.locator('> [data-block-uid]').all();
    const pageLevelUids = await Promise.all(
      pageLevelBlocks.map((b) => b.getAttribute('data-block-uid')),
    );
    expect(pageLevelUids).not.toContain('col-1');
  });

  test('column block cannot be dragged into grid (implicit container allowedBlocks)', async ({
    page,
  }) => {
    // gridBlock is an implicit container (uses blocks/blocks_layout without schema field)
    // It should have allowedBlocks from its block config, which doesn't include 'column'
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    // Wait for all blocks to render (Nuxt async components)
    await helper.getStableBlockCount();

    const iframe = helper.getIframe();

    // col-1 is a 'column' block
    const col1 = iframe.locator('[data-block-uid="col-1"]');
    await expect(col1).toBeVisible();

    // grid-1 is a gridBlock with children grid-cell-1 and grid-cell-2
    const gridCell1 = iframe.locator('[data-block-uid="grid-cell-1"]');
    await expect(gridCell1).toBeVisible();

    // Select col-1
    await helper.clickContainerBlockInIframe('col-1', { waitForToolbar: false });
    await helper.waitForSidebarCurrentBlock('Column');

    // Try to drag col-1 into the grid (next to grid-cell-1)
    const dragHandle = await helper.getDragHandle();

    // Get positions
    const handleBox = await dragHandle.boundingBox();
    expect(handleBox).not.toBeNull();

    // Start the drag
    await page.mouse.move(
      handleBox!.x + handleBox!.width / 2,
      handleBox!.y + handleBox!.height / 2,
    );
    await page.mouse.down();

    // Move to grid-cell-1's area
    const gridCellBox = await gridCell1.boundingBox();
    expect(gridCellBox).not.toBeNull();

    await page.mouse.move(
      gridCellBox!.x + gridCellBox!.width / 2,
      gridCellBox!.y + gridCellBox!.height / 2,
      { steps: 10 },
    );

    // The drop line is always shown at the nearest VALID edge. 'column' isn't
    // allowed in the grid, so — even though the cursor is over grid-cell-1 — the
    // indicator must NOT sit inside the grid; it snaps to the nearest place a column
    // CAN go (the columns block). Assert the drop LINE, not the block's landing.
    const dropIndicator = iframe.locator('.volto-hydra-drop-indicator');
    await expect(dropIndicator).toBeVisible();
    const gridRect = await iframe.locator('[data-block-uid="grid-1"]').boundingBox();
    const indRect = await dropIndicator.boundingBox();
    const indCx = indRect!.x + indRect!.width / 2;
    const indCy = indRect!.y + indRect!.height / 2;
    const insideGrid =
      indCx >= gridRect!.x && indCx <= gridRect!.x + gridRect!.width &&
      indCy >= gridRect!.y && indCy <= gridRect!.y + gridRect!.height;
    expect(insideGrid).toBe(false);

    await page.mouse.up();
    await page.waitForTimeout(500);

    // Whatever the nearest valid edge was, the column must NOT have entered the grid.
    const gridBlock = iframe.locator('[data-block-uid="grid-1"]');
    const col1InGrid = await gridBlock.locator('[data-block-uid="col-1"]').count();
    expect(col1InGrid).toBe(0);
  });

  test('add button is disabled when columns container is at maxLength', async ({
    page,
  }) => {
    // columns block has maxLength: 4 for its columns field
    // Currently has 2 columns (col-1, col-2), add 2 more to reach maxLength
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();

    // Verify columns-1 currently has 2 columns
    const columns1 = iframe.locator('[data-block-uid="columns-1"]');
    await expect(
      columns1.locator(':scope > .columns-row > [data-block-uid]'),
    ).toHaveCount(2);

    // Select col-2 container (use clickContainerBlockInIframe to avoid hitting nested content)
    await helper.clickContainerBlockInIframe('col-2', { waitForToolbar: false });
    await helper.waitForSidebarCurrentBlock('Column');

    // The add button is in the Admin UI (not iframe), positioned next to selected block
    const addButton = page.locator('.volto-hydra-add-button');
    await expect(addButton).toBeVisible();
    await addButton.click();

    // Wait for 3rd column to be created (columns has single allowedBlock: 'column')
    await expect(
      columns1.locator(':scope > .columns-row > [data-block-uid]'),
    ).toHaveCount(3);

    // Select the new (3rd) column and add 4th column
    const allColumns = columns1.locator(':scope > .columns-row > [data-block-uid]');
    const thirdColId = await allColumns.nth(2).getAttribute('data-block-uid');
    await helper.clickContainerBlockInIframe(thirdColId!, { waitForToolbar: false });
    await helper.waitForSidebarCurrentBlock('Column');

    await expect(addButton).toBeVisible();
    await addButton.click();

    // Wait for 4th column to be created
    await expect(
      columns1.locator(':scope > .columns-row > [data-block-uid]'),
    ).toHaveCount(4);

    // Select the new (4th) column
    const fourthColId = await allColumns.nth(3).getAttribute('data-block-uid');
    await helper.clickContainerBlockInIframe(fourthColId!, { waitForToolbar: false });
    await helper.waitForSidebarCurrentBlock('Column');

    // Add button should NOT be visible when container is at maxLength
    await expect(addButton).not.toBeVisible();
  });

  test('add button is disabled when grid container is at maxLength', async ({
    page,
  }) => {
    // gridBlock has maxLength: 4
    // Currently has 2 cells (grid-cell-1, grid-cell-2), add 2 more to reach maxLength
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    // Wait for all blocks to render (Nuxt async components)
    await helper.getStableBlockCount();

    const iframe = helper.getIframe();

    // Verify grid-1 currently has 2 cells
    // Note: grid children are inside a grid-row wrapper, not direct children
    const grid1 = iframe.locator('[data-block-uid="grid-1"]');
    const gridCells = grid1.locator('[data-block-uid]');
    await expect(gridCells).toHaveCount(2);

    // Select grid-cell-2 and add a new cell after it
    await helper.clickContainerBlockInIframe('grid-cell-2', { waitForToolbar: false });
    await helper.waitForSidebarCurrentBlock('Teaser');

    // The add button is in the Admin UI (not iframe)
    const addButton = page.locator('.volto-hydra-add-button');
    await expect(addButton).toBeVisible();
    await addButton.click();

    // Select teaser block type from chooser (gridBlock only allows teaser/image)
    await helper.selectBlockType('teaser');
    await helper.getStableBlockCount();

    // Wait for 3rd cell to be created
    await expect(gridCells).toHaveCount(3);

    // Select the new (3rd) cell and add 4th cell
    const thirdCellId = await gridCells.nth(2).getAttribute('data-block-uid');
    await helper.clickContainerBlockInIframe(thirdCellId!, { waitForToolbar: false });
    await helper.waitForSidebarCurrentBlock('Teaser');

    await expect(addButton).toBeVisible();
    await addButton.click();

    await helper.selectBlockType('teaser');
    await helper.getStableBlockCount();

    // Wait for 4th cell to be created
    await expect(gridCells).toHaveCount(4);

    // Select the new (4th) cell
    const fourthCellId = await gridCells.nth(3).getAttribute('data-block-uid');
    await helper.clickContainerBlockInIframe(fourthCellId!, { waitForToolbar: false });
    await helper.waitForSidebarCurrentBlock('Teaser');

    // Add button should NOT be visible when container is at maxLength
    await expect(addButton).not.toBeVisible();
  });

  test('can drag block on right side of screen', async ({ page }) => {
    // Test that drag works for blocks on the right side of the screen
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();

    // Get initial count of blocks in col-2 (right side of screen)
    const col2 = iframe.locator('[data-block-uid="col-2"]');
    const col2InitialCount = await col2
      .locator(':scope > [data-block-uid]')
      .count();
    expect(col2InitialCount).toBe(1); // Only text-2a

    // Select text-2a (right side block)
    await helper.clickBlockInIframe('text-2a');
    await page.waitForTimeout(300);

    // Get drag handle
    const dragHandle = await helper.getDragHandle();
    expect(dragHandle).not.toBeNull();

    // Try to drag text-2a to col-1 (which is on the left)
    const col1 = iframe.locator('[data-block-uid="col-1"]');
    const text1b = iframe.locator('[data-block-uid="text-1b"]');

    // Drag text-2a to after text-1b in col-1
    await helper.dragBlockWithMouse(dragHandle, text1b, true);

    // Wait for the move to complete
    await page.waitForTimeout(500);

    // Verify text-2a moved from col-2 to col-1
    // Note: col-2 will have 1 block (empty block created when last block was removed)
    const col2NewCount = await col2.locator(':scope > [data-block-uid]').count();
    expect(col2NewCount).toBe(1); // empty block created when text-2a was removed

    // Verify text-2a is no longer in col-2
    const text2aInCol2 = await col2
      .locator('[data-block-uid="text-2a"]')
      .count();
    expect(text2aInCol2).toBe(0);

    const col1NewCount = await col1.locator(':scope > [data-block-uid]').count();
    expect(col1NewCount).toBe(4); // text-1a, text-1b, col1-img-1, text-2a

    // Verify text-2a is now in col-1
    const text2aInCol1 = await col1
      .locator('[data-block-uid="text-2a"]')
      .count();
    expect(text2aInCol1).toBe(1);
  });

  test('dragging last block out of container creates empty block in source container', async ({
    page,
  }) => {
    // When dragging the last block out of a container, an empty block should be
    // created in the source container to maintain its structure
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();

    // col-2 only has one block (text-2a)
    const col2 = iframe.locator('[data-block-uid="col-2"]');
    const col2InitialCount = await col2
      .locator(':scope > [data-block-uid]')
      .count();
    expect(col2InitialCount).toBe(1); // Only text-2a

    // Select text-2a and drag it to col-1
    await helper.clickBlockInIframe('text-2a');
    await page.waitForTimeout(300);

    const dragHandle = await helper.getDragHandle();
    expect(dragHandle).not.toBeNull();

    // Drag to col-1 - target the bottom half of text-1b (inside col-1, not below it)
    const col1 = iframe.locator('[data-block-uid="col-1"]');
    const text1b = col1.locator('[data-block-uid="text-1b"]');
    const text1bBox = await text1b.boundingBox();
    expect(text1bBox).not.toBeNull();

    // Target bottom 75% of text-1b to insert AFTER it but stay INSIDE col-1
    const targetY = text1bBox!.y + text1bBox!.height * 0.75;

    // Use mouse.move instead of hover() to avoid iframe interception issues
    const dragHandleBox = await dragHandle!.boundingBox();
    expect(dragHandleBox).not.toBeNull();
    await page.mouse.move(
      dragHandleBox!.x + dragHandleBox!.width / 2,
      dragHandleBox!.y + dragHandleBox!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(text1bBox!.x + text1bBox!.width / 2, targetY, { steps: 10 });
    await page.waitForTimeout(100);
    await page.mouse.up();

    // Wait for text-2a to actually move to col-1 (don't rely on fixed timeout)
    await expect(col1.locator('[data-block-uid="text-2a"]')).toBeVisible({ timeout: 5000 });

    // CRITICAL: col-2 should now have a new default block, not be completely empty
    // Since column has defaultBlock: 'slate', it creates a properly initialized slate block
    const col2NewCount = await col2.locator(':scope > [data-block-uid]').count();
    expect(col2NewCount).toBe(1); // Should have a new default block

    // Verify it's a slate block (column's defaultBlock is 'slate')
    const newBlock = col2.locator(':scope > [data-block-uid]').first();
    await expect(helper.getSlateField(newBlock)).toBeVisible();
  });
});

test.describe('Sidebar Child Blocks Reordering', () => {
  test('can reorder child blocks by dragging in sidebar', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();

    // Select col-1 (col-1 has text-1a, text-1b, col1-img-1)
    await helper.clickContainerBlockInIframe('col-1', { waitForToolbar: false });
    await helper.waitForSidebarCurrentBlock('Column');

    // Verify initial order in iframe.
    const col1 = iframe.locator('[data-block-uid="col-1"]');
    const initialOrder = await col1
      .locator(':scope > [data-block-uid]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-block-uid')));
    expect(initialOrder).toEqual(['text-1a', 'text-1b', 'col1-img-1']);

    // Find the child blocks widget in sidebar (Order tab)
    await helper.openSidebarTab('Order');
    const childBlocksWidget = page.locator('.child-blocks-widget');
    await expect(childBlocksWidget).toBeVisible();

    // Find the drag handles for the three child blocks
    const dragHandles = childBlocksWidget.locator('.child-block-item .drag-handle');
    await expect(dragHandles).toHaveCount(3);

    // Drag text-1a below text-1b (the second item) to reorder text-1a.
    // Must drag from the drag handle for react-beautiful-dnd to work.
    const firstDragHandle = dragHandles.first();
    const secondItem = childBlocksWidget.locator('.child-block-item').nth(1);

    const firstHandleBox = await firstDragHandle.boundingBox();
    const secondBox = await secondItem.boundingBox();
    expect(firstHandleBox).not.toBeNull();
    expect(secondBox).not.toBeNull();

    // Drag from first item's drag handle to below second item, but
    // stop short of any third item's centre — col-1 has 3 children
    // (text-1a, text-1b, col1-img-1), so an aggressive y+height+10
    // would land inside col1-img-1's row and reorder past it.
    await page.mouse.move(
      firstHandleBox!.x + firstHandleBox!.width / 2,
      firstHandleBox!.y + firstHandleBox!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      secondBox!.x + secondBox!.width / 2,
      // Land in the lower half of text-1b — react-beautiful-dnd reads
      // that as "place after text-1b" without crossing into col1-img-1.
      secondBox!.y + secondBox!.height * 0.75,
      { steps: 10 },
    );
    await page.waitForTimeout(100); // Small delay for drag library to register position
    await page.mouse.up();

    // Verify order changed in iframe: text-1b now comes before text-1a
    // (col1-img-1 stays in its original third position).
    await expect(async () => {
      const newOrder = await col1
        .locator(':scope > [data-block-uid]')
        .evaluateAll((els) => els.map((el) => el.getAttribute('data-block-uid')));
      expect(newOrder).toEqual(['text-1b', 'text-1a', 'col1-img-1']);
    }).toPass({ timeout: 5000 });
  });

  test('implicit container (gridBlock) shows child blocks in Order tab', async ({
    page,
  }) => {
    // gridBlock is an implicit container - it has blocks/blocks_layout directly
    // without a schema field defining the container. The sidebar should still
    // show its children in the Order tab.
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    // Select grid-1 (an implicit container with grid-cell-1 and grid-cell-2)
    // Navigate from page level child blocks widget since clicking on grid selects a child
    await helper.waitForSidebarOpen();

    // Press Escape to deselect any auto-selected block and show page-level child blocks
    await helper.escapeToParent();

    // Find grid-1 in the page's child blocks widget and click it.
    // Match by data-rbd-draggable-id rather than `hasText: 'Grid'` —
    // the fixture has multiple gridBlocks (grid-1/grid-2/grid-empty)
    // all rendered as 'Grid' in the sidebar, so a text filter would
    // hit strict-mode violation.
    const pageChildBlocks = page.locator('#sidebar-order .child-blocks-widget');
    await expect(pageChildBlocks).toBeVisible({ timeout: 5000 });
    const gridItem = pageChildBlocks.locator('.child-block-item[data-rbd-draggable-id="grid-1"]');
    await expect(gridItem).toBeVisible({ timeout: 5000 });
    await gridItem.click();

    // The child blocks widget should show the grid's children
    const childBlocksWidget = page.locator('.child-blocks-widget');
    await expect(childBlocksWidget).toBeVisible();

    // Should show the two grid cells
    const childItems = childBlocksWidget.locator('.child-block-item');
    await expect(childItems).toHaveCount(2);

    // Verify the child blocks show their block type (Teaser shows type, slate showed plaintext)
    const childTexts = await childItems
      .locator('.block-type')
      .allTextContents();
    // Named by the shared namer (blockDisplayTitle): a child with its own
    // title reads by it, not by its type.
    expect(childTexts).toEqual(['Grid Teaser 1', 'Grid Teaser 2']);
  });
});

test.describe('data-block-selector Navigation', () => {
  /**
   * Test carousel with hidden slides.
   * Only one slide is visible at a time (like a real carousel).
   * data-block-selector buttons should:
   * 1. Select the target block
   * 2. Make the hidden block visible (frontend handles visibility)
   */

  test('clicking next button (+1) selects next sibling', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/carousel-test-page');

    // Wait for all blocks to render (Nuxt async components)
    await helper.getStableBlockCount();

    const iframe = helper.getIframe();

    // Verify slider structure is loaded
    const slider = iframe.locator('[data-block-uid="slider-1"]');
    await expect(slider).toBeVisible();

    // Initially slide-1 is visible, slide-2 is hidden
    // Use helper that handles both display:none and translate-based hiding
    expect(await helper.isBlockHiddenInIframe('slide-1')).toBe(false);
    expect(await helper.isBlockHiddenInIframe('slide-2')).toBe(true);

    // Click on slide-1 to select it first
    await helper.clickBlockInIframe('slide-1');
    expect(await helper.isQuantaToolbarVisibleInIframe('slide-1')).toBe(true);

    // Click the "next" button (→) with data-block-selector="+1"
    // This should select slide-2
    const nextButton = iframe.locator('[data-block-selector="+1"]');
    await expect(nextButton).toBeVisible();
    await nextButton.click();

    // Verify slide-2 is now selected (toolbar visible on slide-2)
    await helper.waitForBlockSelectedInAdmin('slide-2');
  });

  test('clicking prev button (-1) selects previous sibling', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/carousel-test-page');

    // Wait for all blocks to render (Nuxt async components)
    await helper.getStableBlockCount();

    const iframe = helper.getIframe();

    // Start by selecting slide-1 using robust helper
    await helper.clickBlockInIframe('slide-1');
    expect(await helper.isQuantaToolbarVisibleInIframe('slide-1')).toBe(true);

    // Navigate to slide-2 using next button (same pattern as passing test)
    const nextButton = iframe.locator('[data-block-selector="+1"]');
    await expect(nextButton).toBeVisible();
    await nextButton.click();
    await helper.waitForBlockSelectedInAdmin('slide-2');

    // Click the "prev" button (←) with data-block-selector="-1"
    const prevButton = iframe.locator('[data-block-selector="-1"]');
    await expect(prevButton).toBeVisible();
    await prevButton.click();

    // Verify slide-1 is now selected
    await helper.waitForBlockSelectedInAdmin('slide-1');
  });

  test('clicking +1 at last sibling stays on current block', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/carousel-test-page');

    // Wait for all blocks to render (Nuxt async components)
    await helper.getStableBlockCount();

    const iframe = helper.getIframe();

    // Navigate to slide-3 (last slide) by clicking +1 twice from slide-1
    // (slide-3 doesn't have a direct selector dot - we only show dots for first half)
    await helper.clickBlockInIframe('slide-1');
    await helper.waitForBlockSelectedInAdmin('slide-1');

    // Click +1 to go to slide-2
    const nextButton = iframe.locator('[data-block-selector="+1"]');
    await nextButton.click();
    await helper.waitForBlockSelectedInAdmin('slide-2');

    // Click +1 again to go to slide-3
    await nextButton.click();
    await helper.waitForBlockSelectedInAdmin('slide-3');

    // Click the "next" button at the last slide
    // Behavior depends on carousel implementation:
    // - Non-wrapping carousel: stays on slide-3
    // - Wrapping carousel (Flowbite): goes to slide-1
    await nextButton.click();

    // Accept either slide-3 (stayed) or slide-1 (wrapped)
    await expect(async () => {
      const slide3Selected = await helper.isQuantaToolbarVisibleInIframe('slide-3');
      const slide1Selected = await helper.isQuantaToolbarVisibleInIframe('slide-1');
      expect(slide3Selected || slide1Selected).toBeTruthy();
    }).toPass({ timeout: 10000 });
  });

  test('outline does not follow old block during +1 navigation animation', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/carousel-test-page');

    // Wait for all blocks to render (Nuxt async components)
    await helper.getStableBlockCount();

    const iframe = helper.getIframe();

    // Select slide-1
    await helper.clickBlockInIframe('slide-1');
    await helper.waitForBlockSelectedInAdmin('slide-1');

    // Get the initial outline position as baseline
    const initialBox = await helper.getBlockOutlineBoundingBox();
    expect(initialBox).not.toBeNull();
    const baselineX = initialBox!.x;
    console.log(`[TEST] Baseline outline X: ${baselineX}`);

    // Monitor outline position while clicking +1
    // The outline should never go significantly left of the baseline
    // (which would indicate it's following the old slide as it animates offscreen)
    const nextButton = iframe.locator('[data-block-selector="+1"]');

    const result = await helper.monitorOutlinePositionDuringAction(
      async () => {
        await nextButton.click();
        await helper.waitForBlockSelectedInAdmin('slide-2');
      },
      baselineX - 50, // Allow 50px tolerance for minor positioning variations
      16, // Check every 16ms (~60fps)
    );

    console.log(`[TEST] Monitor result: minXSeen=${result.minXSeen}, badPositionDetected=${result.badPositionDetected}`);
    console.log(`[TEST] Position samples: ${result.positions.length}`);

    // The outline should never have gone to a bad position (far left)
    expect(result.badPositionDetected).toBe(false);
  });

  test('clicking dot indicator selects that specific slide', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/carousel-test-page');

    // Wait for all blocks to render (Nuxt async components)
    await helper.getStableBlockCount();

    const iframe = helper.getIframe();

    // Click on slide-1 first
    await helper.clickBlockInIframe('slide-1');
    await helper.waitForBlockSelectedInAdmin('slide-1');

    // Click the dot indicator for slide-2 (data-block-selector="slide-2")
    // Note: Only first half of slides have dot indicators (slide-1, slide-2)
    // slide-3 does not have a direct selector to test +1/-1 fallback
    const slide2Dot = iframe.locator('[data-block-selector="slide-2"]');
    await expect(slide2Dot).toBeVisible();
    await slide2Dot.click();

    // Verify slide-2 is now selected
    await helper.waitForBlockSelectedInAdmin('slide-2');
  });

  // Sidebar-based selection tests
  // These test selecting blocks via the ChildBlocksWidget in the sidebar

  test('clicking hidden slide in sidebar ChildBlocksWidget selects it', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/carousel-test-page');

    // Wait for all blocks to render (Nuxt async components)
    await helper.getStableBlockCount();

    // For carousels, we can't click directly on the container because slides fill it.
    // Instead, click on a visible child first, then press Escape to go to parent.
    await helper.clickBlockInIframe('slide-1');
    await helper.waitForBlockSelectedInAdmin('slide-1');

    // Press Escape to navigate up to the parent container
    await helper.escapeToParent();
    await helper.waitForIframeBlockHandle('slider-1');
    await helper.waitForBlockSelectedInAdmin('slider-1');

    const sidebar = page.locator('.sidebar-container');
    // Wait for sidebar to show Slider as current block
    await helper.waitForSidebarCurrentBlock('Slider');
    // Wait for carousel's ChildBlocksWidget to show Slides section
    await expect(sidebar.locator('text=Slides').first()).toBeVisible({ timeout: 10000 });

    // Verify slide-2 is hidden in iframe (carousel shows only one slide at a time)
    // Use helper that handles both display:none and translate-based hiding
    expect(await helper.isBlockHiddenInIframe('slide-2')).toBe(true);

    // Click on the second slide entry in the sidebar's ChildBlocksWidget
    // The widget shows blocks as "⋮⋮ Slide ›" (using block type title)
    const slideButtons = sidebar.locator('.child-block-item');
    await expect(slideButtons.nth(1)).toBeVisible();
    await slideButtons.nth(1).click();

    // Wait for slide-2 to be selected (includes waiting for carousel transition)
    await helper.waitForBlockSelectedInAdmin('slide-2');
  });

  test('sidebar selection works for all carousel slides', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/carousel-test-page');

    // Wait for all blocks to render (Nuxt async components)
    await helper.getStableBlockCount();

    const sidebar = page.locator('.sidebar-container');

    // For carousels, navigate to container via child -> Escape
    await helper.clickBlockInIframe('slide-1');
    await helper.waitForBlockSelectedInAdmin('slide-1');
    await helper.escapeToParent();
    // Wait for sidebar to show Slider as current block (more reliable than toolbar positioning)
    await helper.waitForSidebarCurrentBlock('Slider');

    // Wait for carousel's ChildBlocksWidget to show Slides section
    await expect(sidebar.locator('text=Slides').first()).toBeVisible({ timeout: 10000 });

    // Get slide entries in the ChildBlocksWidget
    const slideButtons = sidebar.locator('.child-block-item');

    // Select slide-3 via sidebar (third entry, it's hidden initially)
    await expect(slideButtons.nth(2)).toBeVisible();
    await slideButtons.nth(2).click();

    // Wait for sidebar to show Slide as current (carousel transition happening)
    await helper.waitForSidebarCurrentBlock('Slide');
    // Wait for slide-3 to be selected (toolbar positioned correctly)
    await helper.waitForBlockSelectedInAdmin('slide-3');

    // Now go back to carousel container and select slide-1
    await helper.escapeToParent();
    // Wait for sidebar to show Slider as current block (more reliable than toolbar positioning)
    await helper.waitForSidebarCurrentBlock('Slider');

    // Select first slide entry
    await slideButtons.first().click();

    // Wait for sidebar to show Slide as current (carousel transition happening)
    await helper.waitForSidebarCurrentBlock('Slide');
    // Wait for slide-1 to be selected (toolbar positioned correctly)
    // Note: hydra.js debounces BLOCK_SELECTED during animations, so this waits for stable position
    await helper.waitForBlockSelectedInAdmin('slide-1');
  });

  test('adding a new slide selects the new slide', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/carousel-test-page');

    const sidebar = page.locator('.sidebar-container');

    // Navigate to carousel container: click slide-1, then press Escape
    await helper.clickBlockInIframe('slide-1');
    await helper.waitForBlockSelectedInAdmin('slide-1');
    await helper.escapeToParent();
    await helper.waitForBlockSelectedInAdmin('slider-1');

    // Wait for sidebar to show Slides section
    await expect(sidebar.locator('text=Slides').first()).toBeVisible();

    // Get initial slide count (should be 3)
    const slideItems = sidebar.locator('.child-block-item');
    const initialCount = await slideItems.count();
    expect(initialCount).toBe(3);

    // Add a new slide via the sidebar (typed object_list shows block chooser)
    await helper.addBlockViaSidebar('Slides', 'Slide');

    // The new slide should be auto-selected after adding
    // When a slide is selected, the sidebar shows its form fields (Kicker, Title, etc.)
    // not the ChildBlocksWidget list. So we verify by checking:
    // 1. The sidebar shows slide form fields (Kicker field visible means slide is selected)
    const kickerInput = sidebar.getByLabel('Kicker');
    await expect(kickerInput).toBeVisible({ timeout: 10000 });

    // 2. The Title field should be empty (new slide, not "Slide 1", "Slide 2", etc.)
    // Use .last() because there are two title fields: page title and slide title
    const titleInput = sidebar.locator('input[id="field-title"]').last();
    await expect(titleInput).toBeVisible();
    await expect(titleInput).toHaveValue('');

    // Find the new slide - the one not in the original list
    const iframe = helper.getIframe();
    const originalIds = ['slide-1', 'slide-2', 'slide-3'];
    const allSlides = await iframe
      .locator('[data-block-uid="slider-1"] [data-block-uid]')
      .all();
    let newSlideId: string | null = null;
    for (const slide of allSlides) {
      const id = await slide.getAttribute('data-block-uid');
      if (id && !originalIds.includes(id)) {
        newSlideId = id;
        break;
      }
    }
    expect(newSlideId).toBeTruthy();

    // Verify the new slide is selected (toolbar is on it)
    await helper.waitForBlockSelectedInAdmin(newSlideId!);

    // Use the helper to get the editor and verify it's empty
    const editor = await helper.getEditorLocator(newSlideId!);
    await expect(editor).toBeVisible();
    await expect(editor).toHaveText('');

    // 4. Navigate back to slider to verify 4 slides now exist
    await helper.escapeToParent();
    await helper.waitForBlockSelectedInAdmin('slider-1');
    await expect(sidebar.locator('text=Slides').first()).toBeVisible();
    await expect(slideItems).toHaveCount(4);
  });

  test('adding a new slide via iframe add button selects the new slide', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/carousel-test-page');

    const sidebar = page.locator('.sidebar-container');
    const iframe = helper.getIframe();

    // Select slide-1 to get the add button to appear
    await helper.clickBlockInIframe('slide-1');
    await helper.waitForBlockSelectedInAdmin('slide-1');

    // Click the add button in the iframe — typed object_list shows block chooser
    await helper.clickAddBlockButton();

    // Select 'Slide' from the block chooser
    const blockChooser = page.locator('.blocks-chooser');
    await expect(blockChooser).toBeVisible({ timeout: 5000 });
    await blockChooser.getByRole('button', { name: 'Slide' }).click();

    // Find the new slide - the one not in the original list
    const originalIds = ['slide-1', 'slide-2', 'slide-3'];
    let newSlideId: string | null = null;
    await expect(async () => {
      const allSlides = await iframe
        .locator('[data-block-uid="slider-1"] [data-block-uid]')
        .all();
      for (const slide of allSlides) {
        const id = await slide.getAttribute('data-block-uid');
        if (id && !originalIds.includes(id)) {
          newSlideId = id;
          break;
        }
      }
      expect(newSlideId).toBeTruthy();
    }).toPass({ timeout: 10000 });

    // The new slide should be auto-selected — sidebar shows its form fields
    const kickerInput = sidebar.getByLabel('Kicker');
    await expect(kickerInput).toBeVisible({ timeout: 10000 });

    // Confirm sidebar is showing the NEW slide (not an existing one)
    const titleInput = sidebar.locator('input[id="field-title"]').last();
    await expect(titleInput).toBeVisible();
    await expect(titleInput).not.toHaveValue('Slide 1');
    await expect(titleInput).not.toHaveValue('Slide 2');

    // Verify the new slide is selected (toolbar is on it)
    await helper.waitForBlockSelectedInAdmin(newSlideId!);

    // Use the helper to get the editor and verify it's empty
    const editor = await helper.getEditorLocator(newSlideId!);
    await expect(editor).toBeVisible();
    await expect(editor).toHaveText('');

    // Navigate back to slider to verify 4 slides now exist
    await helper.escapeToParent();
    await helper.waitForBlockSelectedInAdmin('slider-1');
    await expect(sidebar.locator('text=Slides').first()).toBeVisible();
    const slideItems = sidebar.locator('.child-block-item');
    await expect(slideItems).toHaveCount(4);
  });

  test('add button is positioned correctly for slide block', async ({ page }) => {
    // Use very wide viewport so there's enough margin for the add button
    // Sidebar is ~486px, slider is max-w-4xl (896px), need 38px margin for button
    // So iframe needs: 896 + 38 + some left margin = ~950px minimum
    // With 2000px viewport and ~486px sidebar, iframe should be ~1500px
    await page.setViewportSize({ width: 2000, height: 900 });

    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/carousel-test-page');

    const iframe = helper.getIframe();
    const iframeElement = page.locator('#previewIframe');

    // Wait for all blocks to render and stabilize
    await helper.getStableBlockCount();

    // Find the first slide
    const slide1 = iframe.locator('[data-block-uid="slide-1"]');
    await expect(slide1).toBeVisible({ timeout: 5000 });

    // Click on the slide to select it
    await helper.clickBlockInIframe('slide-1');
    await helper.waitForBlockSelectedInAdmin('slide-1');

    // Wait for add button to appear
    const addButton = page.locator('.volto-hydra-add-button');
    await expect(addButton).toBeVisible({ timeout: 5000 });

    // Get bounding boxes
    const slideBox = await slide1.boundingBox();
    const addButtonBox = await addButton.boundingBox();
    const iframeBox = await iframeElement.boundingBox();

    expect(slideBox).not.toBeNull();
    expect(addButtonBox).not.toBeNull();
    expect(iframeBox).not.toBeNull();

    console.log('[TEST] Slide box:', slideBox);
    console.log('[TEST] Add button box:', addButtonBox);
    console.log('[TEST] Iframe box:', iframeBox);

    // The add button should be:
    // - To the right of the slide (for horizontal container)
    // - NOT constrained inside the block (there should be space to the right)
    // Since slides use data-block-add="right", it should be positioned outside the slide

    // Check add button is within iframe bounds
    expect(addButtonBox!.x).toBeGreaterThanOrEqual(iframeBox!.x);
    expect(addButtonBox!.x + addButtonBox!.width).toBeLessThanOrEqual(iframeBox!.x + iframeBox!.width);

    // The add button should be to the RIGHT of the slide (not inside/overlapping)
    const slideRightEdge = slideBox!.x + slideBox!.width;
    const addButtonLeftEdge = addButtonBox!.x;

    console.log('[TEST] Slide right edge:', slideRightEdge);
    console.log('[TEST] Add button left edge:', addButtonLeftEdge);
    console.log('[TEST] Gap between slide and add button:', addButtonLeftEdge - slideRightEdge);

    // Add button should start at or after the slide's right edge (with small gap)
    // This verifies the add button is NOT constrained inside the slide
    expect(addButtonLeftEdge).toBeGreaterThanOrEqual(slideRightEdge);

    // Check add button is top-aligned with slide (for "right" direction)
    const topAlignTolerance = 20;
    expect(Math.abs(addButtonBox!.y - slideBox!.y)).toBeLessThan(topAlignTolerance);
  });
});

// ============================================================================
// Slider with listing - Listing block inside slider expands into individual slides
// ============================================================================
test.describe('Slider with listing expansion', () => {
  test('Listing block in slider expands images as individual slides', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/gallery-test-page');

    await helper.getStableBlockCount();

    const iframe = helper.getIframe();

    // Verify slider is loaded
    const slider = iframe.locator('[data-block-uid="gallery-slider"]');
    await expect(slider).toBeVisible();

    // The listing should expand the gallery's images (scoped to /images/
    // by path filter so docs screenshots don't bleed into the test count).
    // All listing items share the listing block's @uid ("gallery-listing").
    const gallerySlides = iframe.locator('[data-block-uid="gallery-listing"]');
    await expect(gallerySlides).toHaveCount(5, { timeout: 10000 });

    // Verify image slides are rendered as image blocks (have img or data-edit-media)
    const firstGallerySlide = gallerySlides.first();
    await expect(firstGallerySlide.locator('[data-edit-media="url"], img')).toBeAttached({ timeout: 5000 });
  });

  test('+1 navigates from listing slides to manual image', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/gallery-test-page');
    await helper.getStableBlockCount();

    const iframe = helper.getIframe();

    // Wait for listing expansion (5 listing + 1 manual image = 6 total slides;
    // the listing query is path-scoped to /images/ so the count is stable
    // even as docs sync adds new Image content elsewhere in the tree).
    await expect(iframe.locator('[data-block-uid="gallery-listing"]')).toHaveCount(5, { timeout: 10000 });

    // First visible slide is a listing slide — click it
    await helper.clickBlockInIframe('gallery-listing');
    await helper.waitForBlockSelectedInAdmin('gallery-listing');

    // Navigate +1 through all 5 listing slides to reach manual-image-1
    const nextButton = iframe.locator('[data-block-selector="+1"]');
    await expect(nextButton).toBeVisible();

    for (let i = 0; i < 5; i++) {
      await nextButton.click();
      if (i < 4) {
        await helper.waitForBlockSelectedInAdmin('gallery-listing');
      }
    }

    // After 5 clicks we should be on the manual image slide
    await helper.waitForBlockSelectedInAdmin('manual-image-1');
  });

  test('-1 navigates from manual image back to listing slide', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/gallery-test-page');
    await helper.getStableBlockCount();

    const iframe = helper.getIframe();

    // Wait for listing expansion (path-scoped to /images/ — see test above)
    await expect(iframe.locator('[data-block-uid="gallery-listing"]')).toHaveCount(5, { timeout: 10000 });

    // Select gallery-listing (first visible slide), navigate up to slider, then select manual-image-1
    await helper.clickBlockInIframe('gallery-listing');
    await helper.waitForBlockSelectedInAdmin('gallery-listing');
    // Click ‹ Listing in sidebar to go up to the Slider level
    await page.locator('.parent-nav:has-text("Listing") .nav-back').click();
    await helper.waitForBlockSelectedInAdmin('gallery-slider');
    // Select manual-image-1 from the slider's child blocks list
    await page.locator('#sidebar-order .child-block-item').last().click();
    await helper.waitForBlockSelectedInAdmin('manual-image-1');

    // Click -1 to go back to the last listing slide
    const prevButton = iframe.locator('[data-block-selector="-1"]');
    await expect(prevButton).toBeVisible();
    await prevButton.click();

    await helper.waitForBlockSelectedInAdmin('gallery-listing');
  });
});

// ============================================================================
// slateTable Tests - Nested object_list (rows contain cells)
// Tests that buildBlockPathMap traverses nested object_list structures
// ============================================================================
test.describe('slateTable Container', () => {
  test('table rows and cells are selectable', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/table-test-page');

    const iframe = helper.getIframe();

    // Verify table structure is loaded
    const table = iframe.locator('[data-block-uid="table-1"]');
    await expect(table).toBeVisible();

    // Verify rows are rendered with data-block-uid
    const row1 = iframe.locator('[data-block-uid="row-1"]');
    const row2 = iframe.locator('[data-block-uid="row-2"]');
    await expect(row1).toBeVisible();
    await expect(row2).toBeVisible();

    // Verify cells are rendered with data-block-uid
    const cell11 = iframe.locator('[data-block-uid="cell-1-1"]');
    const cell12 = iframe.locator('[data-block-uid="cell-1-2"]');
    const cell21 = iframe.locator('[data-block-uid="cell-2-1"]');
    await expect(cell11).toBeVisible();
    await expect(cell12).toBeVisible();
    await expect(cell21).toBeVisible();
  });

  test('clicking table cell selects it', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/table-test-page');

    const iframe = helper.getIframe();
    await iframe.locator('[data-block-uid="table-1"]').waitFor();

    // Click on a cell
    await helper.clickBlockInIframe('cell-1-1');

    // Verify cell is selected (toolbar visible)
    const hasToolbar = await helper.isQuantaToolbarVisibleInIframe('cell-1-1');
    expect(hasToolbar).toBe(true);
  });

  test('table cells have correct parent hierarchy in sidebar', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/table-test-page');

    const iframe = helper.getIframe();
    await iframe.locator('[data-block-uid="table-1"]').waitFor();

    // Click on cell-2-1 (row 2, cell 1)
    await helper.clickBlockInIframe('cell-2-1');
    await helper.waitForSidebarOpen();

    // Verify sidebar shows hierarchy: Page, Table, Row, Cell
    // Names are derived from field names: "rows" -> "Row", "cells" -> "Cell"
    const stickyHeaders = page.locator('.sidebar-section-header.sticky-header');
    await expect(stickyHeaders).toHaveCount(4);
    await expect(stickyHeaders.nth(0)).toContainText('Page');
    await expect(stickyHeaders.nth(1)).toContainText('Table');
    await expect(stickyHeaders.nth(2)).toContainText('Row');
    await expect(stickyHeaders.nth(3)).toContainText('Cell');

    // Verify the Cell section shows the "Content" slate field from itemSchema
    const sidebarProperties = page.locator('#sidebar-properties');
    await expect(sidebarProperties.locator('text=Content')).toBeVisible();

    // Navigate up via Escape: cell -> row -> table
    await helper.escapeToParent();

    // Now should have 3 headers: Page, Table, Row
    await expect(stickyHeaders).toHaveCount(3, { timeout: 5000 });
    await expect(stickyHeaders.nth(2)).toContainText('Row');

    await helper.escapeToParent();

    // Now should have 2 headers: Page, Table
    await expect(stickyHeaders).toHaveCount(2, { timeout: 5000 });
    await expect(stickyHeaders.nth(1)).toContainText('Table');

    // Verify table-1 is now selected (outline visible on table)
    const tableSelected = await helper.isBlockSelectedInIframe('table-1');
    expect(tableSelected.ok).toBe(true);

    // Click on a different cell to verify second selection still works
    // (This caught a bug where blockPathMap lost rows/cells after first FORM_DATA)
    await helper.clickBlockInIframe('cell-1-2');
    await page.waitForTimeout(300);

    // Verify sidebar shows correct hierarchy for second cell
    await expect(stickyHeaders).toHaveCount(4);
    await expect(stickyHeaders.nth(3)).toContainText('Cell');
    await expect(sidebarProperties.locator('text=Content')).toBeVisible();
  });

  test('clicking add button on row adds a new row below', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/table-test-page');

    const iframe = helper.getIframe();
    await iframe.locator('[data-block-uid="table-1"]').waitFor();

    // Count initial rows
    const initialRowCount = await iframe.locator('tr[data-block-uid]').count();
    expect(initialRowCount).toBe(3);

    // Click on cell-1-1 to select it (rows are fully covered by cells, so click cell first)
    await helper.clickBlockInIframe('cell-1-1');
    await helper.waitForSidebarOpen();

    // Navigate up to the row by clicking the back arrow on "Cell" in the sidebar
    const cellSection = page.locator('.parent-nav:has-text("Cell")');
    await cellSection.locator('.nav-back').click();

    // Verify sidebar shows cells as children of the row
    const childBlocksList = page.locator('.child-blocks-list');
    await expect(childBlocksList).toBeVisible();
    // Row should have 2 cells as children
    await expect(childBlocksList.locator('.child-block-item')).toHaveCount(2);

    // Wait for add button to be positioned for the row
    await expect(page.locator('.volto-hydra-add-button')).toBeVisible();

    // Click the add button (should add row below since data-block-add="bottom")
    await page.locator('.volto-hydra-add-button').click();

    // Verify a new row was added in the iframe (3 initial + 1 new = 4)
    await expect(iframe.locator('tr[data-block-uid]')).toHaveCount(4);

    // Verify the new row is selected (sidebar shows Row header for current block)
    const sidebarHeaders = page.locator('.sidebar-section-header[data-is-current="true"]');
    await expect(sidebarHeaders.locator('.parent-nav')).toContainText('Row');

    // Verify the new row shows cells as children (inherited from template or empty)
    await expect(page.locator('.child-blocks-list')).toBeVisible();

    // Verify the selection outline has minimum height (empty cells should still be clickable)
    const outline = page.locator('.volto-hydra-block-outline');
    await expect(outline).toBeVisible();
    // Use retry loop because boundingBox() may return null while element is repositioning
    await expect(async () => {
      const box = await outline.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(20);
    }).toPass({ timeout: 5000 });
  });

  test('clicking add button on cell adds a column to ALL rows', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/table-test-page');

    const iframe = helper.getIframe();
    await iframe.locator('[data-block-uid="table-1"]').waitFor();

    // Count initial cells in both rows (th/td with data-block-uid)
    const initialRow1CellCount = await iframe.locator('tr[data-block-uid="row-1"] th[data-block-uid], tr[data-block-uid="row-1"] td[data-block-uid]').count();
    const initialRow2CellCount = await iframe.locator('tr[data-block-uid="row-2"] th[data-block-uid], tr[data-block-uid="row-2"] td[data-block-uid]').count();
    expect(initialRow1CellCount).toBe(2);
    expect(initialRow2CellCount).toBe(2);

    // Click on cell-1-1 to select it
    await helper.clickBlockInIframe('cell-1-1');
    await helper.waitForSidebarOpen();

    // Click the add button (should add column - cell to ALL rows)
    await page.locator('.volto-hydra-add-button').click();

    // Verify a new cell was added to BOTH rows (column add)
    await expect(iframe.locator('tr[data-block-uid="row-1"] th[data-block-uid], tr[data-block-uid="row-1"] td[data-block-uid]')).toHaveCount(3);
    await expect(iframe.locator('tr[data-block-uid="row-2"] th[data-block-uid], tr[data-block-uid="row-2"] td[data-block-uid]')).toHaveCount(3);
  });

  test('new row has same cell count as existing rows', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/table-test-page');

    const iframe = helper.getIframe();
    await iframe.locator('[data-block-uid="table-1"]').waitFor();

    // First add a column so rows have 3 cells
    await helper.clickBlockInIframe('cell-1-1');
    await helper.waitForSidebarOpen();
    await page.locator('.volto-hydra-add-button').click();
    await expect(iframe.locator('tr[data-block-uid="row-1"] th[data-block-uid], tr[data-block-uid="row-1"] td[data-block-uid]')).toHaveCount(3);

    // Wait for the newly created cell to be selected (sidebar shows "Cell" as current)
    // The add button auto-selects the new cell, but we need to wait for the selection
    // to fully propagate to hydra.js before pressing Escape
    await helper.waitForSidebarCurrentBlock('Cell');
    // Extra wait to ensure hydra.js has updated its selectedBlockUid
    await page.waitForTimeout(200);

    // Navigate to row using Escape, then add a new row
    await helper.escapeToParent();
    // Wait for add button to change from "Add column" to "Add row" - more reliable than sidebar check
    const addButton = page.locator('.volto-hydra-add-button');
    await expect(addButton).toHaveAttribute('title', 'Add row', { timeout: 5000 });
    await addButton.click();

    // Wait for new row to appear (3 initial + 1 new = 4 rows total)
    await expect(iframe.locator('tr[data-block-uid]')).toHaveCount(4);

    // Verify new row has same cell count as existing rows (3 cells)
    const allRows = iframe.locator('tr[data-block-uid]');
    const rowCount = await allRows.count();
    for (let i = 0; i < rowCount; i++) {
      const row = allRows.nth(i);
      const cellCount = await row.locator('th[data-block-uid], td[data-block-uid]').count();
      expect(cellCount).toBe(3);
    }
  });

  test('add button shows column icon for cells', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/table-test-page');

    const iframe = helper.getIframe();
    await iframe.locator('[data-block-uid="table-1"]').waitFor();

    // Select a cell - should show "Add column" title with SVG icon
    await helper.clickBlockInIframe('cell-1-1');
    await helper.waitForSidebarOpen();
    const addButton = page.locator('.volto-hydra-add-button');
    await expect(addButton).toBeVisible();
    await expect(addButton).toHaveAttribute('title', 'Add column');
    // Icon should be an SVG (column-after icon)
    await expect(addButton.locator('svg')).toBeVisible();
  });

  test('add button shows row icon for rows', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/table-test-page');

    const iframe = helper.getIframe();
    await iframe.locator('[data-block-uid="table-1"]').waitFor();

    // Select a cell first, then navigate to row using Escape
    await helper.clickBlockInIframe('cell-1-1');
    await helper.waitForSidebarOpen();
    await helper.escapeToParent();
    await helper.waitForIframeBlockHandle('row-1');

    // Should show "Add row" title with SVG icon
    const addButton = page.locator('.volto-hydra-add-button');
    await expect(addButton).toBeVisible();
    await expect(addButton).toHaveAttribute('title', 'Add row');
    // Icon should be an SVG (row-after icon)
    await expect(addButton.locator('svg')).toBeVisible();
  });

  test('dropdown menu shows plain Remove for rows (not Remove Row)', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/table-test-page');

    const iframe = helper.getIframe();
    await iframe.locator('[data-block-uid="table-1"]').waitFor();

    // Select a cell, then press Escape to navigate to parent row
    await helper.clickBlockInIframe('cell-1-1');
    await helper.waitForSidebarOpen();
    await helper.escapeToParent();
    await helper.waitForIframeBlockHandle('row-1');

    // Open dropdown menu (three dots button)
    const menuButton = page.locator('.quanta-toolbar button:has-text("⋯")');
    await expect(menuButton).toBeVisible();
    await menuButton.click();

    // At row level, should show plain "Remove" — the row IS the block being removed.
    // "Remove Row" only appears at cell level (where you're removing the parent row).
    const dropdown = page.locator('.volto-hydra-dropdown-menu');
    await expect(dropdown).toBeVisible();
    const removeItem = dropdown.locator('.volto-hydra-dropdown-item').last();
    await expect(removeItem).toContainText('Remove');
    await expect(removeItem).not.toContainText('Remove Row');
  });

  test('dropdown menu shows Remove Column for cells', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/table-test-page');

    const iframe = helper.getIframe();
    await iframe.locator('[data-block-uid="table-1"]').waitFor();

    // Select a cell (has addDirection: 'right' so shows "Remove Column")
    await helper.clickBlockInIframe('cell-1-1');
    await helper.waitForSidebarOpen();

    // Open dropdown menu (three dots button)
    const menuButton = page.locator('.quanta-toolbar button:has-text("⋯")');
    await expect(menuButton).toBeVisible();
    await menuButton.click();

    // Should show "Remove Column" instead of just "Remove"
    const dropdown = page.locator('.volto-hydra-dropdown-menu');
    await expect(dropdown).toBeVisible();
    await expect(dropdown.getByText('Remove Column')).toBeVisible();
  });

  test('cell dropdown also shows Delete Row action', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/table-test-page');

    const iframe = helper.getIframe();
    await iframe.locator('[data-block-uid="table-1"]').waitFor();

    // Select a cell
    await helper.clickBlockInIframe('cell-1-1');
    await helper.waitForSidebarOpen();

    // Open dropdown menu
    const menuButton = page.locator('.quanta-toolbar button:has-text("⋯")');
    await menuButton.click();

    // Should show both "Remove Column" (primary) and "Remove Row" (additional action)
    const dropdown = page.locator('.volto-hydra-dropdown-menu');
    await expect(dropdown.getByText('Remove Column')).toBeVisible();
    await expect(dropdown.getByText('Remove Row')).toBeVisible();
  });

  test('Remove Row removes row and selects corresponding cell in previous row', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/table-test-page');

    const iframe = helper.getIframe();
    await iframe.locator('[data-block-uid="table-1"]').waitFor();

    // Count initial rows
    const table = iframe.locator('[data-block-uid="table-1"] table');
    const initialRowCount = await table.locator('tr[data-block-uid]').count();
    expect(initialRowCount).toBe(3);

    // Select second cell in second row (cell-2-2)
    await helper.clickBlockInIframe('cell-2-2');
    await helper.waitForSidebarOpen();

    // Open dropdown and click Remove Row (removes row-2 from within a cell)
    const menuButton = page.locator('.quanta-toolbar button:has-text("⋯")');
    await menuButton.click();
    const dropdown = page.locator('.volto-hydra-dropdown-menu');
    await dropdown.getByText('Remove Row').click();

    // Wait for row to be removed
    await expect(table.locator('tr[data-block-uid]')).toHaveCount(initialRowCount - 1);

    // Should select corresponding cell in previous row (cell-1-2 - same column position)
    await helper.waitForIframeBlockHandle('cell-1-2');
  });

  test('Remove Column removes cell from all rows and selects corresponding cell in previous column', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/table-test-page');

    const iframe = helper.getIframe();
    await iframe.locator('[data-block-uid="table-1"]').waitFor();

    // Count initial cells in first row
    const table = iframe.locator('[data-block-uid="table-1"] table');
    const firstRow = table.locator('tr[data-block-uid]').first();
    const initialCellCount = await firstRow.locator('th[data-block-uid], td[data-block-uid]').count();
    expect(initialCellCount).toBe(2);

    // Select SECOND cell in first row (cell-1-2) so we can verify selection of previous column
    await helper.clickBlockInIframe('cell-1-2');
    await helper.waitForSidebarOpen();

    // Open dropdown and click Remove Column
    const menuButton = page.locator('.quanta-toolbar button:has-text("⋯")');
    await menuButton.click();
    const dropdown = page.locator('.volto-hydra-dropdown-menu');
    await dropdown.getByText('Remove Column').click();

    // Wait for column to be removed from all rows
    await expect(firstRow.locator('th[data-block-uid], td[data-block-uid]')).toHaveCount(initialCellCount - 1);

    // Verify second row also lost a cell
    const secondRow = table.locator('tr[data-block-uid]').nth(1);
    await expect(secondRow.locator('th[data-block-uid], td[data-block-uid]')).toHaveCount(initialCellCount - 1);

    // Should select corresponding cell in previous column (cell-1-1 - same row, previous column position)
    await helper.waitForIframeBlockHandle('cell-1-1');
  });

  test('toolbar shows insert action buttons for cells', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/table-test-page');

    const iframe = helper.getIframe();
    await iframe.locator('[data-block-uid="table-1"]').waitFor();

    // Select a cell
    await helper.clickBlockInIframe('cell-1-1');
    await helper.waitForSidebarOpen();

    // Toolbar should have insert action buttons with icons
    const toolbar = page.locator('.quanta-toolbar');
    await expect(toolbar.locator('button[title="Add Column Before"]')).toBeVisible();
    await expect(toolbar.locator('button[title="Add Column After"]')).toBeVisible();
    await expect(toolbar.locator('button[title="Add Row Before"]')).toBeVisible();
    await expect(toolbar.locator('button[title="Add Row After"]')).toBeVisible();
  });

  test('toolbar shows insert action buttons for rows', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/table-test-page');

    const iframe = helper.getIframe();
    await iframe.locator('[data-block-uid="table-1"]').waitFor();

    // Select a cell, then press Escape to navigate to parent row
    await helper.clickBlockInIframe('cell-1-1');
    await helper.waitForSidebarOpen();
    await helper.escapeToParent();
    await helper.waitForIframeBlockHandle('row-1');

    // Toolbar should have insert row action buttons
    const toolbar = page.locator('.quanta-toolbar');
    await expect(toolbar.locator('button[title="Add Row Before"]')).toBeVisible();
    await expect(toolbar.locator('button[title="Add Row After"]')).toBeVisible();
  });

  test('Add Row Before creates row above current', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/table-test-page');

    const iframe = helper.getIframe();
    await iframe.locator('[data-block-uid="table-1"]').waitFor();

    const table = iframe.locator('[data-block-uid="table-1"] table');
    const initialRowCount = await table.locator('tr[data-block-uid]').count();
    expect(initialRowCount).toBe(3);

    // Select second row via Escape from its cell
    await helper.clickBlockInIframe('cell-2-1');
    await helper.waitForSidebarOpen();
    await helper.escapeToParent();
    await helper.waitForIframeBlockHandle('row-2');

    // Click Add Row Before button
    const toolbar = page.locator('.quanta-toolbar');
    await toolbar.locator('button[title="Add Row Before"]').click();

    // Wait for new row to be added
    await expect(table.locator('tr[data-block-uid]')).toHaveCount(initialRowCount + 1);

    // The new row should be at index 1 (before the second row which was at index 1)
    // And the new row should have the same number of cells as existing rows
    const newRow = table.locator('tr[data-block-uid]').nth(1);
    await expect(newRow.locator('th[data-block-uid], td[data-block-uid]')).toHaveCount(2);
  });

  test('Add Column Before creates column in all rows', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/table-test-page');

    const iframe = helper.getIframe();
    await iframe.locator('[data-block-uid="table-1"]').waitFor();

    const table = iframe.locator('[data-block-uid="table-1"] table');
    const firstRow = table.locator('tr[data-block-uid]').first();
    const secondRow = table.locator('tr[data-block-uid]').nth(1);
    const initialCellCount = await firstRow.locator('th[data-block-uid], td[data-block-uid]').count();
    expect(initialCellCount).toBe(2);

    // Select second cell in first row
    await helper.clickBlockInIframe('cell-1-2');
    await helper.waitForSidebarOpen();

    // Click Add Column Before button (may be in toolbar or overflow dropdown)
    await helper.clickBlockAction('Add Column Before');

    // Wait for column to be added to all rows
    await expect(firstRow.locator('th[data-block-uid], td[data-block-uid]')).toHaveCount(initialCellCount + 1);
    await expect(secondRow.locator('th[data-block-uid], td[data-block-uid]')).toHaveCount(initialCellCount + 1);
  });

  test('Add Row Before from cell creates row and selects corresponding cell', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/table-test-page');

    const iframe = helper.getIframe();
    await iframe.locator('[data-block-uid="table-1"]').waitFor();

    const table = iframe.locator('[data-block-uid="table-1"] table');
    const initialRowCount = await table.locator('tr[data-block-uid]').count();
    expect(initialRowCount).toBe(3);

    // Select SECOND cell in second row (cell-2-2)
    await helper.clickBlockInIframe('cell-2-2');
    await helper.waitForSidebarOpen();

    // Click Add Row Before button (may be in toolbar or overflow dropdown)
    await helper.clickBlockAction('Add Row Before');

    // Wait for new row to be added
    await expect(table.locator('tr[data-block-uid]')).toHaveCount(initialRowCount + 1);

    // The new row should have the correct number of cells (2, like existing rows)
    const newRow = table.locator('tr[data-block-uid]').nth(1);
    await expect(newRow.locator('th[data-block-uid], td[data-block-uid]')).toHaveCount(2);

    // Should select the SECOND cell in the new row (corresponding to the cell we were in)
    const secondCellInNewRow = newRow.locator('th[data-block-uid], td[data-block-uid]').nth(1);
    const selectedBlockUid = await secondCellInNewRow.getAttribute('data-block-uid');
    await helper.waitForIframeBlockHandle(selectedBlockUid!);
  });

  test('cell with multi-node slate value is flattened, not split', async ({
    page,
  }) => {
    // A slate field must hold a single top-level node. splitMultiNodeSlateBlocks
    // enforces that by splitting into sibling blocks — but a slateTable cell's
    // value is a slate field of a non-slate block: there is no sibling slate
    // block to create (the cell's container is a list of cells). Splitting it
    // corrupts the row (stray non-cell block) and, on Nuxt, loops until React
    // throws "Maximum update depth exceeded". The correct outcome is to
    // FLATTEN the multi-node value into one node. table-test-page never
    // caught this because all its cells are single-node; table-multinode-page
    // has a cell whose value is [h2, p].
    const helper = new AdminUIHelper(page);
    const updateDepthErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (e.message.includes('Maximum update depth')) {
        updateDepthErrors.push(e.message);
      }
    });

    await helper.login();
    await helper.navigateToEdit('/table-multinode-page');

    const iframe = helper.getIframe();
    await iframe.locator('[data-block-uid="table-mn"]').first().waitFor({
      state: 'attached',
      timeout: 10000,
    });
    await page.waitForTimeout(1500);

    // Not split: the row still has exactly one cell — no stray block leaked
    // into the cells list.
    const row2 = iframe.locator('tr[data-block-uid="mn-row-2"]');
    await expect(row2.locator('td[data-block-uid], th[data-block-uid]')).toHaveCount(1);

    // Flattened: the cell's value is now a single top-level slate node, and
    // the text from both original nodes is preserved.
    const cell2 = iframe.locator('[data-block-uid="mn-cell-2"]');
    await expect(cell2).toContainText('Cell heading');
    await expect(cell2).toContainText('Cell paragraph');
    const topLevelNodeCount = await cell2.evaluate(
      (el) => el.querySelectorAll(':scope > [data-node-id]').length,
    );
    expect(topLevelNodeCount, 'cell value must be flattened to one node').toBe(1);

    expect(
      updateDepthErrors,
      'splitMultiNodeSlateBlocks must flatten (not split) slate fields ' +
        'inside object_list items (table cells).',
    ).toEqual([]);
  });

  // The editing actions below each produce a second top-level node in a
  // table cell's slate value. A cell can't be split into sibling slate
  // blocks, so each must flatten back to a single node — never corrupt the
  // row or loop.
  async function cellTopLevelNodeCount(iframe: FrameLocator, cellUid: string) {
    return iframe
      .locator(`[data-block-uid="${cellUid}"]`)
      .evaluate((el) => el.querySelectorAll(':scope > [data-node-id]').length);
  }

  test('pressing Enter in a table cell flattens back to a single node', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);
    const updateDepthErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (e.message.includes('Maximum update depth')) updateDepthErrors.push(e.message);
    });

    await helper.login();
    await helper.navigateToEdit('/table-multinode-page');

    const editor = await helper.enterEditMode('mn-cell-3');
    await editor.press('End');
    await editor.press('Enter');
    await page.waitForTimeout(1500);

    const iframe = helper.getIframe();
    await expect(
      iframe
        .locator('tr[data-block-uid="mn-row-3"]')
        .locator('td[data-block-uid], th[data-block-uid]'),
    ).toHaveCount(1);
    expect(await cellTopLevelNodeCount(iframe, 'mn-cell-3')).toBe(1);
    expect(updateDepthErrors).toEqual([]);
  });

  test('pasting multi-paragraph content into a table cell flattens to a single node', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);
    const updateDepthErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (e.message.includes('Maximum update depth')) updateDepthErrors.push(e.message);
    });

    await helper.login();
    await helper.navigateToEdit('/table-multinode-page');

    const editor = await helper.enterEditMode('mn-cell-3');
    await editor.press('End');
    // Paste two paragraphs — would be two top-level nodes in the cell.
    await editor.evaluate((el) => {
      const dt = new DataTransfer();
      dt.setData('text/html', '<p>Pasted one</p><p>Pasted two</p>');
      dt.setData('text/plain', 'Pasted one\nPasted two');
      const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: dt });
      el.dispatchEvent(event);
    });
    await page.waitForTimeout(1500);

    const iframe = helper.getIframe();
    await expect(
      iframe
        .locator('tr[data-block-uid="mn-row-3"]')
        .locator('td[data-block-uid], th[data-block-uid]'),
    ).toHaveCount(1);
    expect(await cellTopLevelNodeCount(iframe, 'mn-cell-3')).toBe(1);
    expect(updateDepthErrors).toEqual([]);
  });

  test('Backspace-demoting a list item in a table cell flattens to a single node', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);
    const updateDepthErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (e.message.includes('Maximum update depth')) updateDepthErrors.push(e.message);
    });

    await helper.login();
    await helper.navigateToEdit('/table-multinode-page');

    // Backspace at the start of the second list item demotes it to a
    // paragraph — leaving [ul, p], two top-level nodes — which must flatten.
    const editor = await helper.enterEditMode('mn-cell-4');
    await editor.getByText('Second item').click();
    await editor.press('Home');
    await editor.press('Backspace');
    await page.waitForTimeout(1500);

    const iframe = helper.getIframe();
    await expect(
      iframe
        .locator('tr[data-block-uid="mn-row-4"]')
        .locator('td[data-block-uid], th[data-block-uid]'),
    ).toHaveCount(1);
    expect(await cellTopLevelNodeCount(iframe, 'mn-cell-4')).toBe(1);
    expect(updateDepthErrors).toEqual([]);
  });
});

// ============================================================================
// Multi-Container Field Tests
// Block UIDs are unique so admin derives container field from blockPathMap.
// Coverage uses two multi-slot blocks of different shapes:
//   - search: facets (object_list) + listing (blocks_layout) — parallel
//     slots of different widget kinds, exercising the object_list branch.
//   - columns: columns slot (blocks_layout) — same-kind nesting via
//     `Escape from column block` below.
// ============================================================================
test.describe('Multi-Container Field Operations', () => {
  test('selecting block in search facets field shows facet sidebar', async ({
    page,
  }) => {
    // The search block has two parallel slots: facets (object_list of
    // checkboxFacet/etc.) and listing (blocks_layout of listing). Clicking
    // a child of the facets slot should route the sidebar to that facet's
    // schema (e.g. checkboxFacet's Title field), not the search parent's
    // schema. Catches regressions where slot routing collapses to the
    // multi-slot parent.
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/search-test-page');

    const iframe = helper.getIframe();
    await iframe.locator('[data-block-uid="facet-type"]').waitFor();

    await helper.clickBlockInIframe('facet-type');

    const sidebar = page.locator('.sidebar-container');
    // checkboxFacet's "Title" field (the user-facing label) should be
    // editable in the sidebar.
    await expect(sidebar.getByLabel('Title').first()).toBeVisible({ timeout: 5_000 });
  });

  test('selecting block in columns field shows Column sidebar', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();
    await iframe.locator('[data-block-uid="col-1"]').waitFor();

    // Click the first column block
    await helper.clickContainerBlockInIframe('col-1', { waitForToolbar: false });
    await helper.waitForSidebarCurrentBlock('Column');
  });

  test('Escape from search facet navigates to search parent', async ({
    page,
  }) => {
    // Escape from a child of the facets slot must navigate UP to the
    // search block parent — not page level, not a sibling slot. Verifies
    // the parent-chain resolution lands on the multi-slot parent.
    // The search block's sidebar exposes facets/headline that a facet
    // child does not, so the field swap proves the navigation.
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/search-test-page');

    const iframe = helper.getIframe();
    await iframe.locator('[data-block-uid="facet-type"]').waitFor();

    await helper.clickBlockInIframe('facet-type');
    const sidebar = page.locator('.sidebar-container');
    // Confirm the facet's sidebar is up before escape (Title field is on
    // checkboxFacet's schema).
    await expect(sidebar.getByLabel('Title').first()).toBeVisible({ timeout: 5_000 });

    // Escape → search parent. Search block has the Headline field which
    // facet children don't have.
    await helper.escapeToParent();
    await expect(sidebar.getByLabel(/Headline/i).first()).toBeVisible({ timeout: 5_000 });
  });

  test('Escape from column block navigates to columns parent', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();
    await iframe.locator('[data-block-uid="col-1"]').waitFor();

    // Click the first column to select it
    await helper.clickContainerBlockInIframe('col-1', { waitForToolbar: false });
    await helper.waitForSidebarCurrentBlock('Column');

    // Press Escape to navigate to parent (columns)
    await helper.escapeToParent();

    // Verify the columns block is now selected - Title field should be editable
    const sidebar = page.locator('.sidebar-container');
    await expect(sidebar.getByLabel('Title')).toBeVisible();
  });

  test('clicking block in sidebar ChildBlocksWidget selects it in iframe', async ({
    page,
  }) => {
    // The sidebar's ChildBlocksWidget renders the selected container's
    // children as buttons. Clicking one navigates the sidebar (and the
    // iframe selection) to that child. Used to test against `Image`
    // entries when columns had a top_images slot; now columns-1's only
    // children are columns, so this navigates to a Column entry instead.
    // Same selection-routing mechanism either way.
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();
    await iframe.locator('[data-block-uid="columns-1"]').waitFor();

    // Select the columns block via its title heading (clicking the
    // bbox center would land inside col-1's slate, since columns-1
    // has no top-level row above its column children).
    await helper.clickBlockInIframe('columns-1', { selector: 'h3' });

    // Wait for sidebar to show columns block with child blocks widget
    const sidebar = page.locator('.sidebar-container');
    await expect(sidebar.getByLabel('Title')).toBeVisible();

    // ChildBlocksWidget lists each column child as a row button. Click
    // the first Column entry — col-1 — to navigate sidebar focus.
    const columnButton = sidebar.getByRole('button', { name: /Column/ }).first();
    await expect(columnButton).toBeVisible();
    await columnButton.click();

    // Sidebar's current block should now be the column (col-1).
    await helper.waitForSidebarCurrentBlock('Column', 5_000);
  });

  test('ChildBlocksWidget renders all slots of a multi-slot container and child clicks select across slots', async ({
    page,
  }) => {
    // The search block has two container fields: `facets` (typed
    // object_list, "Facets" section) and `listing` (blocks_layout,
    // "Results Listing" section). ChildBlocksWidget must render BOTH
    // sections, and clicking a child from the non-primary slot
    // (results-listing under "Results Listing") must select that block.
    //
    // This test replaces the multi-slot coverage previously provided by
    // columns' top_images + columns slots — those collapsed to single-
    // slot when top_images was removed from the public docs schema.
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/search-test-page');
    await helper.getStableBlockCount();

    // Select the search block (search-block-1) so its ChildBlocksWidget
    // renders.
    await helper.clickBlockInIframe('search-block-1', { selector: 'h2' });
    await helper.waitForBlockSelectedInAdmin('search-block-1');

    const sidebar = page.locator('.sidebar-container');
    await helper.waitForSidebarCurrentBlock('Search');

    // Both slot sections must render — proves multi-slot widget output.
    const facetsSection = sidebar
      .locator('.container-field-section')
      .filter({ has: page.locator('.widget-title', { hasText: 'Facets' }) })
      .first();
    const listingSection = sidebar
      .locator('.container-field-section')
      .filter({ has: page.locator('.widget-title', { hasText: 'Results Listing' }) })
      .first();
    await expect(facetsSection).toBeVisible({ timeout: 5_000 });
    await expect(listingSection).toBeVisible({ timeout: 5_000 });

    // Click the listing slot's child (results-listing) to verify
    // child-click navigation works for a non-primary blocks_layout slot.
    const listingItem = listingSection.locator('.child-block-item').first();
    await expect(listingItem).toBeVisible({ timeout: 5_000 });
    await listingItem.click();

    await helper.waitForBlockSelectedInAdmin('results-listing');
    await helper.waitForSidebarCurrentBlock('Listing', 5_000);
  });

  test('can clear image inside container using inline toolbar', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();

    // Click on the image inside col-1 (col1-img-1)
    const imageBlock = iframe.locator('[data-block-uid="col1-img-1"]');
    await expect(imageBlock).toBeVisible({ timeout: 10000 });
    await imageBlock.click();

    // Wait for block to be selected (outline appears)
    const outline = page.locator('.volto-hydra-block-outline');
    await expect(outline).toBeVisible({ timeout: 5000 });

    // Get initial image src
    const imageElement = imageBlock.locator('img');
    const initialSrc = await imageElement.getAttribute('src');
    expect(initialSrc).toBeTruthy();

    // Click the clear button in toolbar overlay (X button appears on filled images)
    // Use iframeContainer scope to avoid matching sidebar's clear button
    const clearButton = page.locator('#iframeContainer button[title="Clear image"]');
    await expect(clearButton).toBeVisible({ timeout: 5000 });
    await clearButton.click();

    // Verify the image was cleared - src should change and empty-image-overlay should appear
    await expect(async () => {
      const imgCount = await imageBlock.locator('img').count();
      if (imgCount === 0) return; // img removed entirely — cleared
      const src = await imageBlock.locator('img').getAttribute('src');
      expect(src).not.toBe(initialSrc);
    }).toPass({ timeout: 5000 });
    const emptyOverlay = page.locator('.empty-image-overlay');
    await expect(emptyOverlay).toBeVisible({ timeout: 5000 });
  });

  test('creating a new gridBlock shows toolbar and has visible size', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    // Wait for all blocks to render (Nuxt async components)
    await helper.getStableBlockCount();

    const iframe = helper.getIframe();

    // Click on a page-level block (title-block) to enable add button
    await helper.clickBlockInIframe('title-block');
    await helper.waitForBlockSelectedInAdmin('title-block');

    // Add a new gridBlock
    await helper.clickAddBlockButton();
    await helper.selectBlockType('gridBlock');

    // Wait for the sidebar to show Grid as the current block
    await helper.waitForSidebarOpen();
    await helper.waitForSidebarCurrentBlock('Grid', 10000);

    // Find the new gridBlock by looking for blocks with .grid-row child,
    // excluding all fixture gridBlocks on /container-test-page.
    const newGridBlock = iframe.locator(
      '[data-block-uid]:has(> .grid-row):not([data-block-uid="grid-1"]):not([data-block-uid="grid-2"]):not([data-block-uid="grid-empty"])',
    );
    await expect(newGridBlock).toBeVisible({ timeout: 5000 });

    // The gridBlock should contain at least one child block (ensureEmptyBlockIfEmpty creates it)
    const gridRow = newGridBlock.locator('> .grid-row');
    const childBlocks = gridRow.locator('[data-block-uid]');
    await expect(childBlocks).toHaveCount(1, { timeout: 5000 });

    // The child block should be selected (toolbar visible for it)
    // After creating a container, the child gets selected for immediate editing
    const toolbar = page.locator('.quanta-toolbar');
    await expect(toolbar).toBeVisible({ timeout: 5000 });

    // The gridBlock should have a reasonable size (not collapsed)
    const blockBox = await newGridBlock.boundingBox();
    expect(blockBox).not.toBeNull();
    expect(blockBox!.width).toBeGreaterThan(100);
    expect(blockBox!.height).toBeGreaterThan(50);
  });

  test('creating a new columns block auto-creates a selectable column child', async ({
    page,
  }) => {
    // The columns slot has allowedBlocks: ['column'] with no
    // defaultBlockType. When the BlockChooser adds a new columns block,
    // the factory must initialise its `columns` slot via the single-
    // allowedBlock fallback (same path Test 1 exercises) — creating one
    // column child so the user has somewhere to drop content.
    //
    // Original test asserted on an auto-init image child in top_images;
    // that slot is gone. The same factory mechanism still applies to the
    // columns slot — this test now verifies it via the column child
    // (split from the empty-image min-size mechanism, which gets its
    // own test below using a page-level image block).
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();

    // Add a new columns block at page level.
    await helper.clickBlockInIframe('title-block');
    await helper.waitForBlockSelectedInAdmin('title-block');
    await helper.clickAddBlockButton();
    await helper.selectBlockType('columns');

    await helper.waitForSidebarOpen();
    await helper.waitForSidebarCurrentBlock('Columns', 10_000);

    // Find the new columns block by excluding the existing columns-1
    // fixture. Mirrors the gridBlock test's pattern.
    const newColumnsBlock = iframe.locator(
      '[data-block-uid]:has(> .columns-row):not([data-block-uid="columns-1"])',
    );
    await expect(newColumnsBlock).toBeVisible({ timeout: 5_000 });

    // The new columns block's columns-row has at least one auto-init
    // column child (via single-allowedBlock fallback).
    const newColumnChild = newColumnsBlock
      .locator('> .columns-row > [data-block-uid]')
      .first();
    await expect(newColumnChild).toBeVisible({ timeout: 5_000 });

    // Selection routing on factory-fresh children: clicking the new
    // column should select it; sidebar shows Column. Click the top-left
    // corner so the click lands on the column itself and not on whatever
    // empty-state child happens to fill its center.
    await newColumnChild.click({ position: { x: 5, y: 5 } });
    await helper.waitForSidebarCurrentBlock('Column', 5_000);
  });

  test('an empty image block gets a minimum size so it stays clickable', async ({
    page,
  }) => {
    // Split from the columns-factory test. An empty <img> renders 0×0
    // by default; without ensureElementsHaveMinSize injecting a min
    // size, users can't click into it to assign a source. Verifies the
    // chrome-injection mechanism for empty media-editable fields.
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();

    // Add an empty image block at page level.
    await helper.clickBlockInIframe('title-block');
    await helper.waitForBlockSelectedInAdmin('title-block');
    await helper.clickAddBlockButton();
    await helper.selectBlockType('image');

    await helper.waitForSidebarOpen();
    await helper.waitForSidebarCurrentBlock('Image', 10_000);

    // The empty image's media-editable element should have min dims so
    // it's clickable — even though the underlying <img> has no src.
    const imageMediaFields = iframe.locator('[data-edit-media="url"]');
    await expect(imageMediaFields.last()).toBeVisible({ timeout: 5_000 });
    const box = await imageMediaFields.last().boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(50);
    expect(box!.height).toBeGreaterThan(50);

    // Clicking the empty media field selects the image block.
    await imageMediaFields.last().click();
    await helper.waitForSidebarCurrentBlock('Image', 5_000);
  });

  test('gridBlock only shows allowed block types in chooser', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    // Wait for all blocks to render (Nuxt async components)
    await helper.getStableBlockCount();

    const iframe = helper.getIframe();

    // Click on an existing grid cell (grid-cell-1 is inside grid-1)
    await helper.clickBlockInIframe('grid-cell-1');
    await helper.waitForBlockSelectedInAdmin('grid-cell-1');

    // Click the add button to open block chooser
    await helper.clickAddBlockButton();

    // Wait for block chooser to appear
    const blockChooser = page.locator('.blocks-chooser');
    await expect(blockChooser).toBeVisible({ timeout: 5000 });

    // gridBlock allowedBlocks: ['image', 'listing', 'slate', 'teaser']
    // Image should be visible as an allowed type
    expect(await helper.isBlockTypeVisible('image')).toBe(true);

    // BUG: Grid and Hero should NOT be available inside a grid
    // They are not in gridBlock's allowedBlocks but currently appear
    expect(await helper.isBlockTypeVisible('gridBlock')).toBe(false);
    expect(await helper.isBlockTypeVisible('hero')).toBe(false);
  });
});

test.describe('Single-Schema Object_List (table rows)', () => {
  /**
   * Tests for single-schema object_list containers.
   * The slateTable block uses widget: 'object_list' for rows, each row
   * sharing the same schema. These tests verify add/delete/reorder of
   * object_list items via the sidebar.
   */

  test('no block chooser appears when adding a row (single-schema auto-creates)', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/table-test-page');

    const iframe = helper.getIframe();
    await iframe.locator('[data-block-uid="table-1"]').waitFor();

    // Click a cell, Escape to row level (table addMode needs a selected row to copy cell structure)
    await helper.clickBlockInIframe('cell-1-1');
    await helper.waitForSidebarOpen();
    await helper.escapeToParent();
    await helper.waitForIframeBlockHandle('row-1');

    const sidebar = page.locator('.sidebar-container');
    const table = iframe.locator('[data-block-uid="table-1"] table');
    const initialRowCount = await table.locator('tr[data-block-uid]').count();

    // Click the add button on the toolbar — for single-schema object_list,
    // no block chooser should appear — auto-creates with matching cell count
    const addButton = page.locator('.volto-hydra-add-button');
    await expect(addButton).toBeVisible({ timeout: 5000 });
    await addButton.click();

    // The block chooser should NOT have appeared (no type selection needed)
    const blockChooser = page.locator('.blocks-chooser');
    const chooserVisible = await blockChooser
      .isVisible()
      .catch(() => false);
    expect(chooserVisible).toBe(false);

    // A new row should have been added — verify row count increased
    await expect(table.locator('tr[data-block-uid]')).toHaveCount(initialRowCount + 1, { timeout: 10000 });
  });

  test('deleting a row via sidebar selects previous sibling', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/table-test-page');

    const iframe = helper.getIframe();
    await iframe.locator('[data-block-uid="table-1"]').waitFor();

    // Click a cell, Escape twice to reach table level
    await helper.clickBlockInIframe('cell-1-1');
    await helper.waitForSidebarOpen();
    await helper.escapeToParent();
    await helper.waitForIframeBlockHandle('row-1');
    await helper.escapeToParent();
    await helper.waitForIframeBlockHandle('table-1');

    const sidebar = page.locator('.sidebar-container');
    await expect(sidebar.locator('text=rows').first()).toBeVisible();
    const rowItems = sidebar.locator('.child-block-item');
    await expect(rowItems).toHaveCount(3, { timeout: 5000 });

    // Click row-2 (middle item) in sidebar — this drills into it
    await rowItems.nth(1).click();

    // Now at row level — sidebar shows "‹ Row" breadcrumb with menu trigger
    const currentBlockHeader = sidebar.locator('[data-is-current="true"]');
    await expect(currentBlockHeader.filter({ hasText: 'Row' })).toBeVisible({ timeout: 5000 });

    // Delete via the current block's sidebar dropdown
    const menuTrigger = currentBlockHeader.locator('.menu-trigger');
    await menuTrigger.click();
    const removeOption = page.locator('.volto-hydra-dropdown-item').filter({ hasText: 'Remove' });
    await expect(removeOption).toBeVisible({ timeout: 3000 });
    await removeOption.click();

    // After deleting row-2, selection should move to previous sibling (row-1)
    // Use waitForBlockSelectedInAdmin which verifies outline rect matches the block
    await helper.waitForBlockSelectedInAdmin('row-1');

    // Navigate back to table level to verify child count
    await helper.escapeToParent();
    await helper.waitForBlockSelectedInAdmin('table-1');
    const rowItemsAfter = sidebar.locator('.child-block-item');
    await expect(rowItemsAfter).toHaveCount(2, { timeout: 5000 });
  });

  test('reordering rows in sidebar updates the array order', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/table-test-page');

    const iframe = helper.getIframe();
    await iframe.locator('[data-block-uid="table-1"]').waitFor();

    // Click a cell, Escape twice to reach table level
    await helper.clickBlockInIframe('cell-1-1');
    await helper.waitForSidebarOpen();
    await helper.escapeToParent();
    await helper.waitForIframeBlockHandle('row-1');
    await helper.escapeToParent();
    await helper.waitForIframeBlockHandle('table-1');

    const sidebar = page.locator('.sidebar-container');
    await expect(sidebar.locator('text=rows').first()).toBeVisible();

    // Get initial order
    const rowItems = sidebar.locator('.child-block-item');
    await expect(rowItems).toHaveCount(3);

    // Get initial first item text — sidebar shows "Item 1", "Item 2", etc.
    const firstItemText = await rowItems.first().textContent();
    expect(firstItemText).toContain('Item 1');

    // Drag first item below last to reorder (manual mouse moves for react-beautiful-dnd)
    const firstDragHandle = rowItems.first().locator('.drag-handle');
    const lastItem = rowItems.last();

    await firstDragHandle.scrollIntoViewIfNeeded();
    await lastItem.scrollIntoViewIfNeeded();
    await firstDragHandle.scrollIntoViewIfNeeded();

    const firstHandleBox = await firstDragHandle.boundingBox();
    const lastBox = await lastItem.boundingBox();
    expect(firstHandleBox).not.toBeNull();
    expect(lastBox).not.toBeNull();

    await page.mouse.move(
      firstHandleBox!.x + firstHandleBox!.width / 2,
      firstHandleBox!.y + firstHandleBox!.height / 2,
    );
    await page.mouse.down();
    // Small initial move to trigger DnD activation
    await page.mouse.move(
      firstHandleBox!.x + firstHandleBox!.width / 2,
      firstHandleBox!.y + firstHandleBox!.height / 2 + 5,
      { steps: 5 },
    );
    await page.waitForTimeout(200);
    await page.mouse.move(
      lastBox!.x + lastBox!.width / 2,
      lastBox!.y + lastBox!.height + 10,
      { steps: 10 },
    );
    await page.waitForTimeout(200);
    await page.mouse.up();

    // Verify order changed - first item should now be different
    await expect(async () => {
      const newFirstText = await rowItems.first().textContent();
      expect(newFirstText).not.toContain('Item 1');
    }).toPass({ timeout: 5000 });
  });
});

test.describe('Typed Object_List (search facets with allowedBlocks)', () => {
  /**
   * Tests for typed object_list containers.
   * The search block's facets field uses widget: 'object_list' with
   * allowedBlocks: ['checkboxFacet', 'selectFacet', ...] and typeField: 'type'.
   * Items have real types and schemas from blocksConfig.
   */

  test('facets are selectable via sidebar', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/search-test-page');
    await helper.getStableBlockCount();

    // Select the search block
    await helper.clickBlockInIframe('search-block-1', { selector: 'h2' });
    await helper.waitForBlockSelectedInAdmin('search-block-1');

    const sidebar = page.locator('.sidebar-container');
    await helper.waitForSidebarCurrentBlock('Search');

    // Scope to Facets section (search block also has Results Listing section)
    const facetsSection = sidebar.locator('.container-field-section').filter({ hasText: 'Facets' }).first();
    const facetItems = facetsSection.locator('.child-block-item');
    // Wait for the list to populate; how many facets the fixture ships is not
    // what these tests are about, and hardcoding it blocks adding an example
    // of a facet type that has none.
    await expect(facetItems.first()).toBeVisible({ timeout: 5000 });
    const facetCount = await facetItems.count();
    expect(facetCount).toBeGreaterThan(0);

    // Click on the first facet in the sidebar to select it
    await facetItems.first().click();

    // Wait for facet-type to be selected (quanta toolbar visible on it)
    await helper.waitForBlockSelectedInAdmin('facet-type');
    expect(
      await helper.isQuantaToolbarVisibleInIframe('facet-type')
    ).toBe(true);
  });

  test('sidebar shows typed facet items with correct labels', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/search-test-page');
    await helper.getStableBlockCount();

    // Select the search block
    await helper.clickBlockInIframe('search-block-1', { selector: 'h2' });
    await helper.waitForBlockSelectedInAdmin('search-block-1');

    const sidebar = page.locator('.sidebar-container');
    await helper.waitForSidebarCurrentBlock('Search');

    // Scope to Facets section (search block also has Results Listing section)
    const facetsSection = sidebar.locator('.container-field-section').filter({ hasText: 'Facets' }).first();
    const facetItems = facetsSection.locator('.child-block-item');

    // Wait for the list to populate. What matters below is that each item is
    // labelled with its facet's title, not how many the fixture ships.
    await expect(facetItems.first()).toBeVisible({ timeout: 5000 });

    // Verify the facet titles are shown correctly
    // ChildBlocksWidget shows item.title (the facet label), not the block type
    const facetLabels = await facetItems
      .locator('.block-type')
      .allTextContents();
    expect(facetLabels[0]).toBe('Content Type');
    expect(facetLabels[1]).toBe('Review State');
    expect(facetLabels[2]).toBe('Subject');
  });

  test('block chooser shows only allowed facet types', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/search-test-page');
    await helper.getStableBlockCount();

    // Select search block, then select a facet via sidebar
    await helper.clickBlockInIframe('search-block-1', { selector: 'h2' });
    await helper.waitForBlockSelectedInAdmin('search-block-1');

    const sidebar = page.locator('.sidebar-container');
    await helper.waitForSidebarCurrentBlock('Search');
    const facetsSection = sidebar.locator('.container-field-section').filter({ hasText: 'Facets' }).first();
    const facetItems = facetsSection.locator('.child-block-item');
    // Wait for the list to populate; how many facets the fixture ships is not
    // what these tests are about, and hardcoding it blocks adding an example
    // of a facet type that has none.
    await expect(facetItems.first()).toBeVisible({ timeout: 5000 });
    const facetCount = await facetItems.count();
    expect(facetCount).toBeGreaterThan(0);

    // Click first facet in sidebar to select it
    await facetItems.first().click();
    await helper.waitForBlockSelectedInAdmin('facet-type');

    // Click add button
    await helper.clickAddBlockButton();

    // Wait for block chooser
    const blockChooser = page.locator('.blocks-chooser');
    await expect(blockChooser).toBeVisible({ timeout: 5000 });

    // Expand the Common section (facet types are grouped there, collapsed by default)
    const commonSection = blockChooser.locator('text=Common');
    if (await commonSection.isVisible()) {
      await commonSection.click();
    }

    // Allowed types use display names from blocksConfig.title
    expect(await helper.isBlockTypeVisible('Checkbox')).toBe(true);
    expect(await helper.isBlockTypeVisible('Select')).toBe(true);
    expect(await helper.isBlockTypeVisible('slate')).toBe(true);
    expect(await helper.isBlockTypeVisible('image')).toBe(true);

    // NOT allowed: hero, columns, slider
    expect(await helper.isBlockTypeVisible('hero')).toBe(false);
    expect(await helper.isBlockTypeVisible('columns')).toBe(false);
    expect(await helper.isBlockTypeVisible('slider')).toBe(false);
  });

  test('adding a typed item (selectFacet) via sidebar', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/search-test-page');
    const initialBlockCount = await helper.getStableBlockCount();

    // Select the search block
    await helper.clickBlockInIframe('search-block-1', { selector: 'h2' });
    await helper.waitForBlockSelectedInAdmin('search-block-1');

    const sidebar = page.locator('.sidebar-container');
    await helper.waitForSidebarCurrentBlock('Search');

    // Scope to Facets section
    const facetsSection = sidebar.locator('.container-field-section').filter({ hasText: 'Facets' }).first();
    const facetItems = facetsSection.locator('.child-block-item');
    // Wait for the list to populate; how many facets the fixture ships is not
    // what these tests are about, and hardcoding it blocks adding an example
    // of a facet type that has none.
    await expect(facetItems.first()).toBeVisible({ timeout: 5000 });
    const facetCount = await facetItems.count();
    expect(facetCount).toBeGreaterThan(0);

    // Add a new selectFacet via sidebar
    await helper.addBlockViaSidebar('Facets', 'Select');

    // Wait for new facet to appear in iframe (ensures iframe state is synced)
    await helper.waitForBlockCountToBe(initialBlockCount + 1);

    // Wait for the new facet to be selected (sidebar shows its form)
    await helper.waitForSidebarCurrentBlock('Select');

    // Verify it's the selectFacet schema (has "Hide facet?" but NOT "Multiple choices?" or "Facet widget")
    await expect(sidebar.locator('label').filter({ hasText: 'Hide facet?' })).toBeVisible({ timeout: 3000 });
    await expect(sidebar.locator('label').filter({ hasText: 'Multiple choices?' })).not.toBeVisible();
    await expect(sidebar.locator('label').filter({ hasText: 'Facet widget' })).not.toBeVisible();

    // Navigate back to search block by clicking current block's parent-nav (goes to parent)
    await sidebar.locator('[data-is-current="true"] .nav-back').click();
    await helper.waitForSidebarCurrentBlock('Search');

    await expect(facetItems).toHaveCount(facetCount + 1, { timeout: 5000 });
  });

  test('adding a typed item (checkboxFacet) via toolbar add button', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/search-test-page');
    const initialBlockCount = await helper.getStableBlockCount();

    // Select search block, then select a facet via sidebar
    await helper.clickBlockInIframe('search-block-1', { selector: 'h2' });
    await helper.waitForBlockSelectedInAdmin('search-block-1');

    const sidebar = page.locator('.sidebar-container');
    await helper.waitForSidebarCurrentBlock('Search');
    const facetsSection = sidebar.locator('.container-field-section').filter({ hasText: 'Facets' }).first();
    const facetItems = facetsSection.locator('.child-block-item');
    // Wait for the list to populate; how many facets the fixture ships is not
    // what these tests are about, and hardcoding it blocks adding an example
    // of a facet type that has none.
    await expect(facetItems.first()).toBeVisible({ timeout: 5000 });
    const facetCount = await facetItems.count();
    expect(facetCount).toBeGreaterThan(0);

    // Select a facet to enable the toolbar add button
    await facetItems.first().click();
    await helper.waitForBlockSelectedInAdmin('facet-type');

    // Click the toolbar add button (iframe "+")
    await helper.clickAddBlockButton();

    // Block chooser should appear with filtered types
    const blockChooser = page.locator('.blocks-chooser');
    await expect(blockChooser).toBeVisible({ timeout: 5000 });

    // Expand Common section and select Checkbox
    const commonSection = blockChooser.locator('text=Common');
    if (await commonSection.isVisible()) {
      await commonSection.click();
    }
    await blockChooser.getByRole('button', { name: /Checkbox/i }).click();
    await blockChooser.waitFor({ state: 'hidden', timeout: 5000 });

    // Wait for the new facet to appear in iframe and be selected
    await helper.waitForBlockCountToBe(initialBlockCount + 1);
    const iframe = helper.getIframe();
    const newFacet = iframe.locator('.facet-item').nth(3); // 4th facet (0-indexed)
    await expect(newFacet).toBeVisible({ timeout: 5000 });
    const newBlockId = await newFacet.getAttribute('data-block-uid');
    await helper.waitForIframeBlockHandle(newBlockId!);

    // Sidebar should show the new facet's form
    await helper.waitForSidebarCurrentBlock('Checkbox');

    // Verify it's the checkboxFacet schema (has "Multiple choices?" AND "Hide facet?", NOT "Facet widget")
    await expect(sidebar.locator('label').filter({ hasText: 'Multiple choices?' })).toBeVisible({ timeout: 3000 });
    await expect(sidebar.locator('label').filter({ hasText: 'Hide facet?' })).toBeVisible({ timeout: 3000 });
    await expect(sidebar.locator('label').filter({ hasText: 'Facet widget' })).not.toBeVisible();

    // Navigate back to search block by clicking current block's parent-nav (goes to parent)
    await sidebar.locator('[data-is-current="true"] .nav-back').click();
    await helper.waitForSidebarCurrentBlock('Search');

    // Re-scope facets section after navigating back
    const facetsSectionAfter = sidebar.locator('.container-field-section').filter({ hasText: 'Facets' }).first();
    await expect(facetsSectionAfter.locator('.child-block-item')).toHaveCount(facetCount + 1, { timeout: 5000 });
  });

  test('deleting a typed facet selects previous sibling and removes it', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/search-test-page');
    await helper.getStableBlockCount();

    // Select search block, then select second facet via sidebar
    // Facets order: facet-type, facet-state, facet-subject
    await helper.clickBlockInIframe('search-block-1', { selector: 'h2' });
    await helper.waitForBlockSelectedInAdmin('search-block-1');

    const sidebar = page.locator('.sidebar-container');
    await helper.waitForSidebarCurrentBlock('Search');
    const facetsSection = sidebar.locator('.container-field-section').filter({ hasText: 'Facets' }).first();
    const facetItems = facetsSection.locator('.child-block-item');
    // Wait for the list to populate; how many facets the fixture ships is not
    // what these tests are about, and hardcoding it blocks adding an example
    // of a facet type that has none.
    await expect(facetItems.first()).toBeVisible({ timeout: 5000 });
    const facetCount = await facetItems.count();
    expect(facetCount).toBeGreaterThan(0);

    // Delete facet-state (second item) — should select facet-type (previous sibling)
    await facetItems.nth(1).click();
    await helper.waitForBlockSelectedInAdmin('facet-state');

    await helper.openQuantaToolbarMenu('facet-state');
    await helper.clickQuantaToolbarMenuOption('facet-state', 'Remove');

    // After deleting facet-state, selection should move to previous sibling (facet-type)
    await helper.waitForBlockSelectedInAdmin('facet-type');

    // Navigate back to search by clicking current block's parent-nav
    await sidebar.locator('[data-is-current="true"] .nav-back').click();
    await helper.waitForSidebarCurrentBlock('Search');

    const updatedFacetsSection = sidebar.locator('.container-field-section').filter({ hasText: 'Facets' }).first();
    await expect(updatedFacetsSection.locator('.child-block-item')).toHaveCount(facetCount - 1, { timeout: 5000 });
  });

  test('reordering typed facets in sidebar updates order', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/search-test-page');
    await helper.getStableBlockCount();

    // Select the search block
    await helper.clickBlockInIframe('search-block-1', { selector: 'h2' });
    await helper.waitForBlockSelectedInAdmin('search-block-1');

    const sidebar = page.locator('.sidebar-container');
    await helper.waitForSidebarCurrentBlock('Search');
    const facetsSection = sidebar.locator('.container-field-section').filter({ hasText: 'Facets' }).first();
    const facetItems = facetsSection.locator('.child-block-item');
    // Wait for the list to populate; how many facets the fixture ships is not
    // what these tests are about, and hardcoding it blocks adding an example
    // of a facet type that has none.
    await expect(facetItems.first()).toBeVisible({ timeout: 5000 });
    const facetCount = await facetItems.count();
    expect(facetCount).toBeGreaterThan(0);

    // Get initial order - first should be "Content Type" (checkboxFacet)
    const firstItemText = await facetItems.first().textContent();
    expect(firstItemText).toContain('Content Type');

    // Drag first item below last to reorder (manual mouse moves for react-beautiful-dnd)
    const firstDragHandle = facetItems.first().locator('.drag-handle');
    const lastItem = facetItems.last();

    // Scroll both into view within the sidebar
    await firstDragHandle.scrollIntoViewIfNeeded();
    await lastItem.scrollIntoViewIfNeeded();
    await firstDragHandle.scrollIntoViewIfNeeded();

    const firstHandleBox = await firstDragHandle.boundingBox();
    const lastBox = await lastItem.boundingBox();
    expect(firstHandleBox).not.toBeNull();
    expect(lastBox).not.toBeNull();

    await page.mouse.move(
      firstHandleBox!.x + firstHandleBox!.width / 2,
      firstHandleBox!.y + firstHandleBox!.height / 2,
    );
    await page.mouse.down();
    // Small initial move to trigger DnD activation
    await page.mouse.move(
      firstHandleBox!.x + firstHandleBox!.width / 2,
      firstHandleBox!.y + firstHandleBox!.height / 2 + 5,
      { steps: 5 },
    );
    await page.waitForTimeout(200);
    await page.mouse.move(
      lastBox!.x + lastBox!.width / 2,
      lastBox!.y + lastBox!.height + 10,
      { steps: 10 },
    );
    await page.waitForTimeout(200);
    await page.mouse.up();

    // Verify order changed - first item should no longer be "Content Type"
    await expect(async () => {
      const newFirstText = await facetItems.first().textContent();
      expect(newFirstText).not.toContain('Content Type');
    }).toPass({ timeout: 5000 });
  });

  test('DnD reorder within typed object_list via iframe drag', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/search-test-page');
    await helper.getStableBlockCount();

    const iframe = helper.getIframe();

    // Verify initial facet order: facet-type, facet-state, facet-subject
    const facetItems = iframe.locator('.facet-item');
    await expect(facetItems.first()).toBeVisible({ timeout: 5000 });
    const facetCount = await facetItems.count();
    expect(facetCount).toBeGreaterThan(1);
    expect(await facetItems.first().getAttribute('data-block-uid')).toBe('facet-type');
    // WHICH facet is last is the fixture's business — this test drags the first
    // one past whatever the last one is. Naming it pinned the fixture's size.
    const lastFacetId = await facetItems.last().getAttribute('data-block-uid');
    expect(lastFacetId).not.toBe('facet-type');

    // Click on facet title to select it (avoid checkboxes in the facet body)
    await helper.clickBlockInIframe('facet-type', { selector: '[data-edit-text="title"]' });
    await helper.waitForBlockSelectedInAdmin('facet-type');

    // Drag after last facet
    const targetBlock = iframe.locator(`[data-block-uid="${lastFacetId}"]`).first();
    await helper.dragBlockWithMouse(targetBlock, targetBlock, true);

    // Verify the order changed: facet-type should now be last
    await expect(async () => {
      const newFirstId = await facetItems.first().getAttribute('data-block-uid');
      expect(newFirstId).not.toBe('facet-type');
    }).toPass({ timeout: 5000 });
    expect(await facetItems.last().getAttribute('data-block-uid')).toBe('facet-type');
  });
});

// ============================================================================
// Accordion Block Tests (object_list with blocks_layout inside items)
// ============================================================================
test.describe('Accordion Block', () => {
  test('accordion panel title is visible', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/accordion-test-page');

    const iframe = helper.getIframe();
    const accordion = iframe.locator('[data-block-uid="accordion-1"]');
    await expect(accordion).toBeVisible();

    // Panel title should be rendered
    await expect(accordion).toContainText('Accordion Header Text');
  });

  test('accordion child blocks are visible', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/accordion-test-page');

    const iframe = helper.getIframe();
    const accordion = iframe.locator('[data-block-uid="accordion-1"]');
    await expect(accordion).toBeVisible();

    // Child slate blocks inside the panel should be rendered
    await expect(accordion).toContainText('Accordion Content Text');
    await expect(accordion).toContainText('More content');
  });

  test('accordion panel has data-block-uid', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/accordion-test-page');

    const iframe = helper.getIframe();
    const panel = iframe.locator('[data-block-uid="panel-1"]');
    await expect(panel).toBeVisible();
  });

  test('clicking accordion child block selects it', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/accordion-test-page');

    const iframe = helper.getIframe();

    // Wait for content to render
    await expect(iframe.locator('[data-block-uid="accordion-1"]')).toBeVisible();
    await expect(iframe.locator('[data-block-uid="accordion-1"]')).toContainText('Accordion Content Text');

    // Click child block
    await helper.clickBlockInIframe('content-text-1');
    const hasToolbar = await helper.isQuantaToolbarVisibleInIframe('content-text-1');
    expect(hasToolbar).toBe(true);
  });

  test('accordion panel title is inline editable', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/accordion-test-page');

    const iframe = helper.getIframe();

    // Wait for panel to render with title
    const panel = iframe.locator('[data-block-uid="panel-1"]');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Accordion Header Text');

    // The title element should have data-edit-text="title"
    const titleEl = panel.locator('[data-edit-text="title"]');
    await expect(titleEl).toBeVisible();
    await expect(titleEl).toContainText('Accordion Header Text');
  });

  test('clicking an accordion panel title selects the panel', async ({ page }, testInfo) => {
    // The Nuxt accordion panel header is a <button data-block-selector="…">
    // — the word-list is there for tryMakeBlockVisible's programmatic
    // reveal click. A user click on the title text (data-edit-text) inside
    // that button must still select the panel: blockClickHandler must not
    // hijack a click on an editable element into data-block-selector
    // navigation.
    // admin-nuxt only — the test-frontend accordion header has no
    // data-block-selector (always-expanded, no collapse mechanism).
    test.skip(
      testInfo.project.name !== 'admin-nuxt',
      'Nuxt accordion only — test-frontend header has no data-block-selector',
    );
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/accordion-test-page');

    const iframe = helper.getIframe();
    const titleEl = iframe.locator(
      '[data-block-uid="panel-1"] [data-edit-text="title"]',
    );
    await expect(titleEl).toBeVisible();
    await titleEl.click();

    await helper.waitForBlockSelectedInAdmin('panel-1');
  });

  test('bridge expose: selecting hidden block inside collapsed panel opens the panel', async ({ page }, testInfo) => {
    // Companion to 'clicking hidden slide in sidebar ChildBlocksWidget selects it'
    // — but for accordion's panel-collapse mechanism. Accordion's first
    // panel starts open and subsequent panels start closed (Nuxt's
    // openPanels default). The block inside the second panel is hidden;
    // when the admin selects it, the bridge's tryMakeBlockVisible() finds
    // the panel-2 button via the word-list `data-block-selector~=` match
    // (carries panel uid + every child uid) and clicks it, which calls
    // the toggle() handler and opens the panel.
    //
    // admin-nuxt only: the test-frontend accordion is always-expanded
    // (no collapse mechanism, no data-block-selector on header), so the
    // bridge path doesn't apply there. Skip on admin-mock.
    test.skip(
      testInfo.project.name !== 'admin-nuxt',
      'accordion bridge-expose only runs on admin-nuxt (test-frontend accordion has no collapse mechanism)',
    );

    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/accordion-test-page');

    const iframe = helper.getIframe();
    await expect(iframe.locator('[data-block-uid="accordion-1"]')).toBeVisible();

    // Sanity: panel-2 outer div is visible (the panel container always
    // is) but its content child is hidden (v-show on collapsed panel).
    const panel2 = iframe.locator('[data-block-uid="panel-2"]');
    await expect(panel2).toBeVisible();
    const hiddenChild = iframe.locator('[data-block-uid="panel2-hidden-text"]');
    await expect(hiddenChild).toBeAttached();
    expect(await helper.isBlockHiddenInIframe('panel2-hidden-text')).toBe(true);

    // The button header must be marked open=false so we know the bridge
    // actually changes state — not a precondition that's already met.
    const panel2Button = panel2.locator('button[aria-expanded]');
    await expect(panel2Button).toHaveAttribute('aria-expanded', 'false');

    // Drive selection of the hidden grandchild like the admin would.
    await page.evaluate((uid) => {
      const iframeEl = document.querySelector('iframe');
      iframeEl.contentWindow.postMessage({ type: 'SELECT_BLOCK', uid }, '*');
    }, 'panel2-hidden-text');

    // Bridge expose: panel-2 button click → toggle() → openPanels[panel-2]=true
    // → v-show reveals content → hidden child visible.
    await expect.poll(
      async () => panel2Button.getAttribute('aria-expanded'),
      { timeout: 5000 },
    ).toBe('true');
    await expect(hiddenChild).toBeVisible();
  });
});
