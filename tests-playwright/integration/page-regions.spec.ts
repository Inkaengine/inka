/**
 * A page's regions other than its main content — here the footer
 * (formData.blocks_layout.footer): blocks can be added to and removed from it.
 * Runs on every frontend that draws a footer region.
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

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
