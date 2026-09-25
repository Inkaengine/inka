/**
 * Integration tests for adding and removing blocks in Volto Hydra.
 *
 * These are CRITICAL tests for core CMS functionality - the ability to actually
 * add new blocks to a page and remove existing ones.
 *
 * IMPORTANT: These tests verify that blocks are ACTUALLY added/removed, not just
 * that UI elements appear. They check:
 * - Block appears in iframe
 * - Block count changes
 * - Changes sync with Admin UI
 * TODO: Extra tests
 * - removing last block adds new blank block
 * 
 * Container tests
 * - empty container shows add block
 * - empty container shows only allowed block type
 * - add appears in direction block will be added
 * - can add another block in a container
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

test.describe('Adding Blocks', () => {
  test('clicking Add button opens block chooser', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Click on a block to select it and show Quanta toolbar
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForSidebarOpen();

    // Click the Add button
    await helper.clickAddBlockButton();

    // Verify block chooser appears
    const chooserVisible = await helper.isBlockChooserVisible();
    expect(chooserVisible).toBe(true);
  });

  test('can add a Slate/Text block to the page', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Get initial block count (don't hardcode - fixture may change)
    const initialCount = await helper.getBlockCount();
    expect(initialCount).toBeGreaterThan(0);

    // Select a block and click Add
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.clickAddBlockButton();

    // Select Slate block type
    await helper.selectBlockType('slate');

    // Wait for block to be added
    await helper.waitForBlockCountToBe(initialCount + 1);

    // Verify block count increased
    const newCount = await helper.getBlockCount();
    expect(newCount).toBe(initialCount + 1);
  });

  // Regression: when a container's last child is deleted, View.jsx +
  // ensureEmptyBlockIfEmpty auto-creates a new empty slate block of the
  // container's defaultBlockType. That code path does NOT initialise
  // `value: [{type: 'p', children: [{text: ''}]}]` (only the add-block flow
  // does). The renderer then falls back to its empty-state placeholder
  // `<p data-edit-text="value">Empty block</p>` with no data-node-id.
  // Clicking into the placeholder trips hydra.js's selection-sync warning
  // overlay (#hydra-dev-warning).
  test('deleting last child of a container auto-creates slate without triggering Missing data-node-id warning', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/section-test-page');

    const iframe = helper.getIframe();

    // section-1 starts with one slate child (section-child-1). Remove it
    // via the Quanta toolbar's ⋯ menu so the whole block is deleted (not
    // just one character of its text).
    await helper.clickBlockInIframe('section-child-1');
    await helper.openQuantaToolbarMenu('section-child-1');
    await helper.clickQuantaToolbarMenuOption('section-child-1', 'Remove');

    // ensureEmptyBlockIfEmpty creates a fresh slate child in the section.
    // It has a generated uid, so look for "any data-block-uid descendant".
    const newChild = iframe
      .locator('[data-block-uid="section-1"] [data-block-uid]')
      .first();
    await expect(newChild).toBeVisible({ timeout: 5000 });

    // Click into the new placeholder slate block to trigger selection sync.
    await newChild.click();
    await page.waitForTimeout(300);

    // The developer-warning overlay must not appear.
    const warning = iframe.locator('#hydra-dev-warning');
    await expect(warning).toHaveCount(0);
  });

  // Repro (the gap the section test above doesn't cover): a container with NO
  // defaultBlockType and MULTIPLE allowed types. contextNavigation.items has
  // allowedBlocks ['navItem','listing'] and no default, so it seeds a bare '@type: empty'
  // child (not a resolvable slate). That seeded empty is born outside View.jsx's add-flow,
  // so it never gets typed by the chooser — and getAddDirection returns 'hidden' for an
  // empty, so no '+' appears either. The admin must still surface a '+' on the selected
  // empty (getBlockAddability marks it canReplace) so its type can be picked in place;
  // otherwise the container is stuck empty with no way to add the first child.
  test('a seeded empty in a no-default multi-allowed container gets a + to pick its type', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const iframe = helper.getIframe();

    // Add a contextNavigation; initializeContainerBlock seeds an 'empty' subblock.
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.clickAddBlockButton();
    await helper.selectBlockType('contextNavigation');

    // The seeded empty renders as a plain, selectable placeholder inside the new nav.
    const emptyChild = iframe.locator('.context-navigation [data-block-uid]').first();
    await expect(emptyChild).toBeVisible({ timeout: 5000 });

    // Select it — the admin must show a '+' so its type (navItem/listing) can be picked
    // (the BlockChooser mutates the empty in place). This is the bug: no '+' appeared.
    await emptyChild.click();
    const addBtn = page.locator('.volto-hydra-add-button');
    await expect(addBtn).toBeVisible({ timeout: 5000 });

    // The '+' opens the BlockChooser, offering the container's allowed types (navItem/
    // listing) so the empty can be typed in place (View.jsx routes an empty's pick through
    // onMutateBlock). The empty is no longer stranded.
    await addBtn.click();
    const chooser = page.locator('.blocks-chooser');
    await expect(chooser).toBeVisible({ timeout: 5000 });
    // The chooser offers the container's allowed types (navItem present) — so the empty is
    // pickable in place (not stranded).
    await expect(chooser.locator('button.navItem')).toBeAttached({ timeout: 5000 });

    // Pick navItem: the empty mutates in place into a navItem, which must render. A fresh
    // navItem has no href yet, so the renderer must show an editable placeholder, not crash.
    await helper.selectBlockType('navItem');
    await expect(iframe.locator('.context-navigation a[data-block-uid]')).toBeVisible({ timeout: 5000 });
  });

  test('can add an Image block to the page', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const initialCount = await helper.getBlockCount();

    // Select a block and add an Image block
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.clickAddBlockButton();
    await helper.selectBlockType('image');

    await helper.waitForBlockCountToBe(initialCount + 1);

    // Verify block was added
    const newCount = await helper.getBlockCount();
    expect(newCount).toBe(initialCount + 1);
  });

  test('new block appears in iframe immediately', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Get current block IDs
    const initialBlocks = await helper.getBlockOrder();

    // Add a new block
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.clickAddBlockButton();
    await helper.selectBlockType('slate');

    await helper.waitForBlockCountToBe(initialBlocks.length + 1);

    // Get new block IDs
    const newBlocks = await helper.getBlockOrder();

    // Should have one more block
    expect(newBlocks.length).toBe(initialBlocks.length + 1);

    // Find the new block ID (the one that's not in initialBlocks)
    const newBlockId = newBlocks.find(id => !initialBlocks.includes(id));
    expect(newBlockId).toBeDefined();

    // Verify the new block exists in iframe
    const exists = await helper.blockExists(newBlockId!);
    expect(exists).toBe(true);
  });

  test('can add multiple blocks in succession', async ({ page }) => {
    // This tests adding blocks mixing Enter and Add button:
    // 1. Add first block via Add button
    // 2. Press Enter in that block to create second block
    // 3. Click Add button to create third block
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const initialCount = await helper.getBlockCount();
    const initialBlocks = await helper.getBlockOrder();

    // Add first block via Add button
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForSidebarOpen();
    await helper.clickAddBlockButton();
    await helper.selectBlockType('slate');
    await helper.waitForBlockCountToBe(initialCount + 1);

    // Find the first new block
    let currentBlocks = await helper.getBlockOrder();
    const firstNewBlockUid = currentBlocks.find(id => !initialBlocks.includes(id));
    expect(firstNewBlockUid).toBeTruthy();

    // Click on first new block and press Enter to create second block
    const iframe = helper.getIframe();
    const firstNewEditor = await helper.getEditorLocator(firstNewBlockUid!);
    await firstNewEditor.click();
    await firstNewEditor.press('Enter');
    await helper.waitForBlockCountToBe(initialCount + 2);

    // Find the second new block (created via Enter)
    currentBlocks = await helper.getBlockOrder();
    const secondNewBlockUid = currentBlocks.find(id => !initialBlocks.includes(id) && id !== firstNewBlockUid);
    expect(secondNewBlockUid).toBeTruthy();

    // Now click Add button to create third block
    await helper.clickBlockInIframe(secondNewBlockUid!);
    await helper.waitForIframeBlockHandle(secondNewBlockUid!);
    await helper.clickAddBlockButton();
    await helper.selectBlockType('slate');
    await helper.waitForBlockCountToBe(initialCount + 3);

    const finalCount = await helper.getBlockCount();
    expect(finalCount).toBe(initialCount + 3);
  });

  test('new block appears in correct position', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Get initial block order
    const initialBlocks = await helper.getBlockOrder();

    // Click on the second block (index 1)
    await helper.clickBlockInIframe(initialBlocks[1]);
    await helper.clickAddBlockButton();
    await helper.selectBlockType('slate');

    await helper.waitForBlockCountToBe(initialBlocks.length + 1);

    // Get new block order
    const newBlocks = await helper.getBlockOrder();

    // New block should be inserted after the selected block
    // So it should be at position 2 (index 2) if we selected block at index 1
    expect(newBlocks.length).toBe(initialBlocks.length + 1);

    // The first two blocks should be the same
    expect(newBlocks[0]).toBe(initialBlocks[0]);
    expect(newBlocks[1]).toBe(initialBlocks[1]);

    // Position 2 should be a new block
    const newBlockId = newBlocks[2];
    expect(initialBlocks).not.toContain(newBlockId);
  });

  test('block chooser shows common block types', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Click on a block to select it
    await helper.clickBlockInIframe('block-1-uuid');

    // Click the Add button
    await helper.clickAddBlockButton();

    // Verify block chooser appears
    const chooserVisible = await helper.isBlockChooserVisible();
    expect(chooserVisible).toBe(true);

    // Verify common block types are present - at minimum, Slate/Text and Image blocks should be available
    expect(await helper.isBlockTypeVisible('slate')).toBe(true);
    expect(await helper.isBlockTypeVisible('image')).toBe(true);
  });
});

test.describe('Removing Blocks', () => {
  test('clicking Remove from menu deletes block', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const initialCount = await helper.getBlockCount();
    const blockIdToRemove = 'block-1-uuid';

    // Verify block exists
    expect(await helper.blockExists(blockIdToRemove)).toBe(true);

    // Select block, open menu, and click Remove
    await helper.clickBlockInIframe(blockIdToRemove);
    await helper.openQuantaToolbarMenu(blockIdToRemove);
    await helper.clickQuantaToolbarMenuOption(blockIdToRemove, 'Remove');

    // Wait for block to be removed
    await helper.waitForBlockCountToBe(initialCount - 1);

    // Verify block count decreased
    const newCount = await helper.getBlockCount();
    expect(newCount).toBe(initialCount - 1);
  });

  test('block disappears from iframe after removal', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Use block-3-uuid (slate block), not block-2-uuid (image block has timing issues)
    const blockIdToRemove = 'block-3-uuid';

    // Verify block exists initially
    expect(await helper.blockExists(blockIdToRemove)).toBe(true);

    // Remove the block
    await helper.clickBlockInIframe(blockIdToRemove);
    await helper.openQuantaToolbarMenu(blockIdToRemove);
    await helper.clickQuantaToolbarMenuOption(blockIdToRemove, 'Remove');

    // Wait for block to disappear
    await helper.waitForBlockToDisappear(blockIdToRemove);

    // Verify block no longer exists
    expect(await helper.blockExists(blockIdToRemove)).toBe(false);
  });

  test('selection moves to previous block after deletion', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blocks = await helper.getBlockOrder();
    // Use index 2 (block-3-uuid slate block), not index 1 (block-2-uuid image has timing issues)
    const prevBlock = blocks[1];
    const blockToDelete = blocks[2];

    // Select the block to delete
    await helper.clickBlockInIframe(blockToDelete);
    await helper.waitForBlockSelectedInAdmin(blockToDelete);

    // Verify block is selected (toolbar positioned on it)
    const toolbarCheck = await helper.isBlockSelectedInIframe(blockToDelete);
    expect(toolbarCheck.ok).toBe(true);

    // Delete the block via toolbar menu
    await helper.openQuantaToolbarMenu(blockToDelete);
    await helper.clickQuantaToolbarMenuOption(blockToDelete, 'Remove');

    // Wait for block to disappear
    await helper.waitForBlockToDisappear(blockToDelete);

    // Toolbar should now be on the previous block
    await helper.waitForBlockSelectedInAdmin(prevBlock);
    const newToolbarCheck = await helper.isBlockSelectedInIframe(prevBlock);
    expect(newToolbarCheck.ok).toBe(true);
  });

  test('removing block updates blocks_layout', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Get initial block order (don't hardcode - fixture may change)
    const initialBlocks = await helper.getBlockOrder();
    expect(initialBlocks.length).toBeGreaterThan(2); // Need at least 3 blocks

    // Remove a block (index 2, not 1 - index 1 is an image block with loading timing issues)
    const blockToRemove = initialBlocks[2];
    await helper.clickBlockInIframe(blockToRemove);
    await helper.openQuantaToolbarMenu(blockToRemove);
    await helper.clickQuantaToolbarMenuOption(blockToRemove, 'Remove');

    await helper.waitForBlockCountToBe(initialBlocks.length - 1);

    // Get new block order
    const newBlocks = await helper.getBlockOrder();

    // Should have one less block
    expect(newBlocks.length).toBe(initialBlocks.length - 1);

    // Removed block should not be in the list
    expect(newBlocks).not.toContain(blockToRemove);

    // First and second blocks should still be there (we removed third)
    expect(newBlocks).toContain(initialBlocks[0]);
    expect(newBlocks).toContain(initialBlocks[1]);
  });

  test('removing middle block preserves order of remaining blocks', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const initialBlocks = await helper.getBlockOrder();
    // Remove the third block (index 2) - not index 1 which is an image block with timing issues
    const blockToRemove = initialBlocks[2];

    // Remove middle block
    await helper.clickBlockInIframe(blockToRemove);
    await helper.openQuantaToolbarMenu(blockToRemove);
    await helper.clickQuantaToolbarMenuOption(blockToRemove, 'Remove');

    await helper.waitForBlockCountToBe(initialBlocks.length - 1);

    const newBlocks = await helper.getBlockOrder();

    // Order should be preserved: all blocks except the removed one, in original order
    const expectedBlocks = initialBlocks.filter((b) => b !== blockToRemove);
    expect(newBlocks).toEqual(expectedBlocks);
  });

  test('can remove multiple blocks sequentially', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const initialBlocks = await helper.getBlockOrder();
    const firstBlockToRemove = initialBlocks[0]; // block-1-uuid (slate)

    // Remove first block
    await helper.clickBlockInIframe(firstBlockToRemove);
    await helper.openQuantaToolbarMenu(firstBlockToRemove);
    await helper.clickQuantaToolbarMenuOption(firstBlockToRemove, 'Remove');

    // Wait for the block to actually disappear
    await helper.waitForBlockToDisappear(firstBlockToRemove);

    // Verify block is gone from the order
    await expect(async () => {
      const blocks = await helper.getBlockOrder();
      expect(blocks).not.toContain(firstBlockToRemove);
    }).toPass({ timeout: 5000 });

    // Remove another block - use index 1 to skip block-2-uuid (image block has timing issues)
    // After removing block-1-uuid: [block-2-uuid, block-3-uuid, ...]
    // So remainingBlocks[1] = block-3-uuid (slate block)
    const remainingBlocks = await helper.getBlockOrder();
    const secondBlockToRemove = remainingBlocks[1]; // Skip image block at index 0
    await helper.clickBlockInIframe(secondBlockToRemove);
    await helper.openQuantaToolbarMenu(secondBlockToRemove);
    await helper.clickQuantaToolbarMenuOption(secondBlockToRemove, 'Remove');

    // Verify second block is gone
    await helper.waitForBlockToDisappear(secondBlockToRemove);
    await expect(async () => {
      const blocks = await helper.getBlockOrder();
      expect(blocks).not.toContain(secondBlockToRemove);
    }).toPass({ timeout: 5000 });
  });
});

test.describe('Add and Remove Combined', () => {
  test('can add a block then immediately remove it', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const initialCount = await helper.getBlockCount();
    const initialBlocks = await helper.getBlockOrder();

    // Add a block
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.clickAddBlockButton();
    await helper.selectBlockType('slate');
    await helper.waitForBlockCountToBe(initialCount + 1);

    // Verify it was added
    const countAfterAdd = await helper.getBlockCount();
    expect(countAfterAdd).toBe(initialCount + 1);

    // Find the new block ID
    const blocksAfterAdd = await helper.getBlockOrder();
    const newBlockId = blocksAfterAdd.find(id => !initialBlocks.includes(id));
    expect(newBlockId).toBeDefined();

    // Now remove the newly added block
    await helper.clickBlockInIframe(newBlockId!);
    await helper.openQuantaToolbarMenu(newBlockId!);
    await helper.clickQuantaToolbarMenuOption(newBlockId!, 'Remove');
    await helper.waitForBlockCountToBe(initialCount);

    // Should be back to original count
    const finalCount = await helper.getBlockCount();
    expect(finalCount).toBe(initialCount);

    // Block should no longer exist
    expect(await helper.blockExists(newBlockId!)).toBe(false);
  });

  test('can remove a block then add a new one', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const initialCount = await helper.getBlockCount();

    // Remove a block
    await helper.clickBlockInIframe('block-2-uuid');
    await helper.openQuantaToolbarMenu('block-2-uuid');
    await helper.clickQuantaToolbarMenuOption('block-2-uuid', 'Remove');
    await helper.waitForBlockCountToBe(initialCount - 1);

    const countAfterRemove = await helper.getBlockCount();
    expect(countAfterRemove).toBe(initialCount - 1);

    // Add a new block
    const remainingBlocks = await helper.getBlockOrder();
    await helper.clickBlockInIframe(remainingBlocks[0]);
    await helper.clickAddBlockButton();
    await helper.selectBlockType('image');
    await helper.waitForBlockCountToBe(initialCount);

    // Should be back to original count
    const finalCount = await helper.getBlockCount();
    expect(finalCount).toBe(initialCount);
  });
});

test.describe('Footer Blocks Add/Remove', () => {
  // These tests are specific to the mock frontend's footer_blocks configuration
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name.includes('nuxt'), 'Skipping on nuxt - tests mock frontend config');
  });

  test('can add a block to footer', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Get initial footer block count
    const initialFooterBlocks = await helper.getBlockOrder('footer');
    expect(initialFooterBlocks.length).toBeGreaterThan(0);

    // Click on a footer block to select it
    await helper.clickBlockInIframe(initialFooterBlocks[0]);
    await helper.waitForSidebarOpen();

    // Click the Add button
    await helper.clickAddBlockButton();

    // Select Slate block type
    await helper.selectBlockType('slate');

    // Wait for block to be added to footer
    await expect(async () => {
      const newFooterBlocks = await helper.getBlockOrder('footer');
      expect(newFooterBlocks.length).toBe(initialFooterBlocks.length + 1);
    }).toPass({ timeout: 5000 });

    // Verify new block appears in footer
    const newFooterBlocks = await helper.getBlockOrder('footer');
    expect(newFooterBlocks.length).toBe(initialFooterBlocks.length + 1);
  });

  test('can remove a block from footer', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Get initial footer blocks
    const initialFooterBlocks = await helper.getBlockOrder('footer');
    expect(initialFooterBlocks.length).toBeGreaterThan(0);

    const blockToRemove = initialFooterBlocks[0];

    // Select footer block
    await helper.clickBlockInIframe(blockToRemove);
    await helper.waitForSidebarOpen();

    // Open menu and click Remove
    await helper.openQuantaToolbarMenu(blockToRemove);
    await helper.clickQuantaToolbarMenuOption(blockToRemove, 'Remove');

    // Wait for block to be removed
    await helper.waitForBlockToDisappear(blockToRemove);

    // Verify footer block count decreased
    const newFooterBlocks = await helper.getBlockOrder('footer');
    expect(newFooterBlocks.length).toBe(initialFooterBlocks.length - 1);
    expect(newFooterBlocks).not.toContain(blockToRemove);
  });

});

test.describe('Enter Key to Add/Navigate', () => {
  test('Enter on image block (no focused field) adds new block after', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const initialCount = await helper.getBlockCount();
    const initialBlocks = await helper.getBlockOrder();

    // Click on the image block (no editable text fields)
    await helper.clickBlockInIframe('block-2-uuid');
    await helper.waitForSidebarOpen();

    // Press Enter — should add a new block after the image
    await page.keyboard.press('Enter');
    await helper.waitForBlockCountToBe(initialCount + 1);

    // New block should be right after block-2-uuid
    const newBlocks = await helper.getBlockOrder();
    const imageIdx = newBlocks.indexOf('block-2-uuid');
    const newBlockId = newBlocks[imageIdx + 1];
    expect(initialBlocks).not.toContain(newBlockId);
  });


  // Two related bugs reproduced by the same scenario:
  //
  //   (A) hydra.src.js:1590 gates the block-mode Enter handler on
  //       `this.isInlineEditing`. By the time _handleBlockModeKey is reached
  //       (line 4142), the document handler has already returned for any
  //       active edit field (line 4104), so we're in block mode by
  //       definition — the flag is leftover state from a prior selection.
  //       The gate just blocks Enter in exactly the case it's most useful
  //       (creating a new block from block-mode), so no block is created.
  //
  //   (B) Even when ADD_BLOCK_AFTER fires and a new block is added, the
  //       FORM_DATA-driven select path in afterContentRender (line 6131)
  //       calls selectBlock(el) without fieldToFocus. selectBlock respects
  //       the current editMode and only focuses an editable field when
  //       fieldToFocus is passed, so the user lands on a "selected but in
  //       block mode" new block and can't type until they click into it.
  //       The SELECT_BLOCK direct path at line 8738 handles this correctly,
  //       so this is an oversight in the FORM_DATA branch.
  //
  // Repro: click into a teaser inside a grid (text mode), press Escape to
  // get block-mode on the teaser, Escape again to get block-mode on the grid
  // parent, then press Enter. Expectation: a new block is created and is
  // immediately ready for typing.
  test('Enter in block mode (no field focus) creates new block and focuses it for typing', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/section-test-page');

    const iframe = helper.getIframe();
    const initialBlocks = await helper.getBlockOrder();

    // 1. Enter the slate-before value field (page-level slate).
    // Use getSlateField — Nuxt puts data-edit-text on the same element as
    // data-block-uid, while the mock renderer puts it on a child element.
    await helper.enterEditMode('slate-before', 'value');
    const slateBeforeBlock = iframe.locator('[data-block-uid="slate-before"]');
    const valueField = helper.getSlateField(slateBeforeBlock);
    await expect(valueField).toHaveAttribute('contenteditable', 'true');
    await helper.waitForIframeBlockHandle('slate-before');

    // 2. Escape → block mode on the same slate (selectedBlockUid stays).
    await page.keyboard.press('Escape');
    // ASSERT: value is no longer contenteditable, but slate is still selected.
    await expect(valueField).not.toHaveAttribute('contenteditable', 'true');
    await helper.waitForIframeBlockHandle('slate-before');

    // 3. Enter — should create a new block AFTER slate-before (bug A: gate).
    //    Source is a slate (in page's allowed types) → another slate.
    await page.keyboard.press('Enter');
    await helper.waitForBlockCountToBe(initialBlocks.length + 1);

    // Find the new block by id-set exclusion.
    const newBlocks = await helper.getBlockOrder();
    const newBlockId = newBlocks.find((id) => !initialBlocks.includes(id));
    expect(newBlockId, 'expected exactly one new block to appear').toBeDefined();
    // ASSERT: the new block is selected.
    await helper.waitForIframeBlockHandle(newBlockId!);

    // 4. Typing should land in the new block (bug B: focus).
    await page.keyboard.type('hello', { delay: 10 });

    const newBlock = iframe.locator(`[data-block-uid="${newBlockId}"]`);
    await expect(newBlock).toContainText('hello', { timeout: 3000 });
  });

  // Failing on purpose: documents bug B's container-source variant.
  // When the source block is a container (e.g. user selected the section
  // via Escape-to-parent and pressed Enter), ADD_BLOCK_AFTER's "another one
  // of these" rule creates another container, and that new container
  // auto-initialises one default child via initializeContainerBlock. The
  // user expects to type into the new container's first leaf editable field.
  // Currently `selectBlock(fieldToFocus: 'first')` only walks own fields
  // (not nested blocks' fields), so for a container the focus has no
  // target and typing is lost.
  test('Enter in block mode on a container source focuses the new container\'s first nested editable field', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/section-test-page');

    const iframe = helper.getIframe();
    const initialBlocks = await helper.getBlockOrder();

    // 1. Click into the slate child to get a focused contenteditable.
    // Use getSlateField — Nuxt puts data-edit-text on the same element as
    // data-block-uid, while the mock renderer puts it on a child element.
    await helper.enterEditMode('section-child-1', 'value');
    const sectionChildBlock = iframe.locator('[data-block-uid="section-child-1"]');
    const valueField = helper.getSlateField(sectionChildBlock);
    await expect(valueField).toHaveAttribute('contenteditable', 'true');

    // 2. Escape → block mode on the slate.
    await page.keyboard.press('Escape');
    await expect(valueField).not.toHaveAttribute('contenteditable', 'true');
    await helper.waitForIframeBlockHandle('section-child-1');

    // 3. Escape → escalates to parent (section-1).
    await page.keyboard.press('Escape');
    await helper.waitForIframeBlockHandle('section-1');

    // 4. Enter creates another section (and an auto-init slate child inside it).
    await page.keyboard.press('Enter');
    await helper.waitForBlockCountToBe(initialBlocks.length + 2);

    const newBlocks = await helper.getBlockOrder();
    const candidates = newBlocks.filter((id) => !initialBlocks.includes(id));
    expect(candidates.length).toBe(2);
    let newSectionId: string | undefined;
    for (const id of candidates) {
      const isPageLevel = await iframe
        .locator(`[data-block-uid="${id}"]`)
        .first()
        .evaluate((el) => !el.parentElement?.closest('[data-block-uid]'));
      if (isPageLevel) {
        newSectionId = id;
        break;
      }
    }
    expect(newSectionId).toBeDefined();
    // The new section auto-creates a slate child. Keyboard-Enter intent is
    // "ready to type", so the admin's ADD_BLOCK_AFTER handler drills the
    // pendingSelectBlockUid down to the new container's first leaf rather
    // than the container shell. Look up that leaf and assert IT is selected.
    const newSectionChildId = await iframe
      .locator(`[data-block-uid="${newSectionId!}"] [data-block-uid]`)
      .first()
      .getAttribute('data-block-uid');
    expect(newSectionChildId).toBeTruthy();
    await helper.waitForIframeBlockHandle(newSectionChildId!);

    // 5. Typing should land in the new section's auto-initialised slate child.
    await page.keyboard.type('hello', { delay: 10 });

    const newBlock = iframe.locator(`[data-block-uid="${newSectionId}"]`);
    await expect(newBlock).toContainText('hello', { timeout: 3000 });
  });

  test('Enter on hero heading (non-last field) moves focus to next field', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const initialCount = await helper.getBlockCount();
    const iframe = helper.getIframe();

    // Enter edit mode on the hero heading field
    const editor = await helper.enterEditMode('block-4-hero', 'heading');

    // Press Enter — should move focus to the next field (subheading), NOT add a block
    await editor.press('Enter');

    // Block count should stay the same
    const countAfter = await helper.getBlockCount();
    expect(countAfter).toBe(initialCount);

    // The subheading field should now be focused — typing should go into it
    const subheadingField = iframe.locator('[data-block-uid="block-4-hero"] .hero-subheading');
    // Type into the now-focused subheading field and verify text appears there
    await page.keyboard.type('test-focus', { delay: 10 });
    await expect(subheadingField).toContainText('test-focus', { timeout: 5000 });
  });

  test('Enter on hero last field (buttonText) adds new block after', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const initialCount = await helper.getBlockCount();
    const initialBlocks = await helper.getBlockOrder();

    // Enter edit mode on the hero's last editable field (buttonText)
    const editor = await helper.enterEditMode('block-4-hero', 'buttonText');

    // Press Enter — should add a new block after the hero block
    await editor.press('Enter');
    await helper.waitForBlockCountToBe(initialCount + 1);

    // New block should be after the hero block
    const newBlocks = await helper.getBlockOrder();
    const heroIdx = newBlocks.indexOf('block-4-hero');
    const newBlockId = newBlocks[heroIdx + 1];
    expect(initialBlocks).not.toContain(newBlockId);
  });

  test('Backspace at start of empty paragraph block removes it', async ({ page }, testInfo) => {
    const RUN = `[RUN-${testInfo.repeatEachIndex}]`;
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Enable debug logging with run ID
    await page.evaluate((id) => {
      (window as any).HYDRA_DEBUG = true;
      (window as any).__testRunId = id;
    }, testInfo.repeatEachIndex);
    const iframe = helper.getIframe();
    await iframe.locator('body').evaluate((_, id) => {
      (window as any).HYDRA_DEBUG = true;
      (window as any).__testRunId = id;
    }, testInfo.repeatEachIndex);

    const blockId = 'block-1-uuid';

    // Create a new empty block via Enter
    const editor = await helper.enterEditMode(blockId);
    await helper.selectAllTextInEditor(editor);
    await editor.pressSequentially('Some text', { delay: 10 });
    await helper.waitForEditorText(editor, /Some text/);

    const initialBlocks = await helper.getStableBlockCount();
    await editor.press('Enter');
    await helper.waitForBlockCountToBe(initialBlocks + 1, 5000);

    // Find the new empty block
    const blockOrder = await helper.getBlockOrder();
    const originalBlockIndex = blockOrder.indexOf(blockId);
    const newBlockUid = blockOrder[originalBlockIndex + 1];
    expect(newBlockUid).toBeTruthy();

    // Wait for editable field to appear and block to be fully selected
    const newEditor = await helper.getEditorLocator(newBlockUid);
    await expect(newEditor).toBeAttached({ timeout: 10000 });
    await helper.waitForBlockSelectedInAdmin(newBlockUid);

    // Backspace in the empty block should remove it
    await newEditor.press('Backspace');

    // Wait for the block to be deleted
    await helper.waitForBlockCountToBe(initialBlocks, 10000);

    // The new block should be gone
    await expect(iframe.locator(`[data-block-uid="${newBlockUid}"]`)).not.toBeVisible({ timeout: 5000 });
  });

  test('Backspace to delete last block on page triggers new default block', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/another-page');

    const blockId = 'block-1-uuid';
    const iframe = helper.getIframe();

    // Enter edit mode on the only block
    const editor = await helper.enterEditMode(blockId);

    // Select all text and delete it
    await helper.selectAllTextInEditor(editor);
    await editor.press('Backspace');

    // Now the block should be empty — backspace again should trigger delete
    await editor.press('Backspace');

    // The delete is an iframe→admin→iframe round-trip. Wait on the POSITIVE condition first — a
    // NEW default block (a data-block-uid that isn't the deleted one) rendered in main — which is
    // what actually signals the re-render completed. Without this, the negative assertions below
    // race the round-trip on slower CI: the deleted uid lingers in the DOM for a frame (the
    // "[ParentBlocksWidget] Block data undefined for block-1-uuid" log is that stale frame).
    await expect
      .poll(async () => (await helper.getBlockOrder()).filter((uid) => uid !== blockId), {
        timeout: 15000,
      })
      .toHaveLength(1);

    // Now the original block is gone (page-level uses defaultBlockType 'slate', not 'empty')...
    await expect(iframe.locator(`[data-block-uid="${blockId}"]`)).not.toBeVisible({ timeout: 5000 });

    // ...and the main content holds exactly the one new default block.
    await expect.poll(() => helper.getBlockOrder(), { timeout: 5000 }).toHaveLength(1);
  });
});

test.describe('Allowed Blocks from Frontend', () => {
  // These tests check the MOCK frontend's allowedBlocks configuration (no video,
  // a custom block of its own). Every other frontend declares its own list — nuxt
  // includes video and excludes hero, the Next.js example allows video — so they
  // apply to the mock frontend only.
  test.beforeEach(async ({}, testInfo) => {
    test.skip(!testInfo.project.name.includes('mock'), 'tests the mock frontend\'s own allowedBlocks config');
  });

  test('block chooser hides blocks not in allowedBlocks list', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Click a block to select it, then click the add button
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.clickAddBlockButton();

    // Wait for the block chooser to appear
    const chooserVisible = await helper.isBlockChooserVisible();
    expect(chooserVisible).toBe(true);

    // Frontend allows: ['slate', 'image', 'hero'] (configured in test-frontend/index.html)
    // Video block should NOT be visible (not in allowed list)
    expect(await helper.isBlockTypeVisible('video')).toBe(false);
  });

  test('custom block from frontend appears in block chooser', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Click a block to select it, then click the add button
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.clickAddBlockButton();

    // Wait for the block chooser to appear
    const chooserVisible = await helper.isBlockChooserVisible();
    expect(chooserVisible).toBe(true);

    // Custom 'hero' block should be visible (defined in test-frontend/index.html)
    expect(await helper.isBlockTypeVisible('hero')).toBe(true);
  });

  test('can add custom block defined by frontend', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const initialCount = await helper.getBlockCount();

    // Click a block to select it, then add a hero block
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.clickAddBlockButton();
    await helper.selectBlockType('hero');

    // Verify block was added
    await helper.waitForBlockCountToBe(initialCount + 1);
    const newCount = await helper.getBlockCount();
    expect(newCount).toBe(initialCount + 1);
  });
});

test.describe('Undo history', () => {
  // Mobile viewport so the Quanta chevrons (move) and the bottom-bar Undo button
  // are available — the exact controls the reproduction used.
  test.use({ viewport: { width: 375, height: 812 } });

  const gridOrder = (iframe: ReturnType<AdminUIHelper['getIframe']>) =>
    iframe
      .locator('[data-block-uid="gs-grid"] [data-block-uid]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-block-uid')));

  // Repro: move a slate within a grid, then remove it. Undo brings the slate
  // back (undoes the remove); a SECOND undo must undo the MOVE before it. The
  // bug: undo stalled after one step — the move was unreachable. Cause: the undo
  // snapshot included selection, and after each undo the iframe re-settles the
  // selection, saving a duplicate-formData entry that wastes an undo step.
  test('undo reverts a remove AND the move before it (one step each)', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/grid-slates-test-page');

    const iframe = helper.getIframe();
    expect(await gridOrder(iframe)).toEqual([
      'gs-slate-1',
      'gs-slate-2',
      'gs-slate-3',
    ]);

    // Move the first slate down within the grid.
    await iframe.locator('[data-block-uid="gs-slate-1"]').first().click();
    const chevronDown = page.locator('.quanta-toolbar .chevron-down');
    await expect(chevronDown).toBeVisible();
    await chevronDown.click();
    await expect
      .poll(() => gridOrder(iframe))
      .toEqual(['gs-slate-2', 'gs-slate-1', 'gs-slate-3']);

    // Remove that slate.
    await iframe.locator('[data-block-uid="gs-slate-1"]').first().click();
    await helper.openQuantaToolbarMenu('gs-slate-1');
    await helper.clickQuantaToolbarMenuOption('gs-slate-1', 'Remove');
    await expect
      .poll(() => gridOrder(iframe))
      .toEqual(['gs-slate-2', 'gs-slate-3']);

    const undoBtn = page.locator('#toolbar-body .undo');

    // Undo #1 → the remove is undone (slate back, still at its moved position).
    await undoBtn.click();
    await expect
      .poll(() => gridOrder(iframe))
      .toEqual(['gs-slate-2', 'gs-slate-1', 'gs-slate-3']);

    // Undo #2 → the MOVE is undone (original order restored). This is the step
    // that used to stall.
    await undoBtn.click();
    await expect
      .poll(() => gridOrder(iframe))
      .toEqual(['gs-slate-1', 'gs-slate-2', 'gs-slate-3']);
  });
});
