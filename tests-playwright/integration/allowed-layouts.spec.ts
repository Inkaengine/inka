/**
 * Integration tests for allowedLayouts configuration.
 *
 * Tests that:
 * 1. LayoutSelector visibility is controlled by allowedLayouts (not allowedTemplates)
 * 2. allowedLayouts and allowedTemplates work independently
 * 3. Applying a layout merges existing content correctly
 * 4. Fixed edge blocks prevent insertion outside them
 * 5. Layouts can be switched while preserving content
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';
import type { Page } from '@playwright/test';

/**
 * Read a column's stored slotId from the template-settings panel, robustly.
 *
 * Clicking a column selects its inner CELL, so click a known cell and escape up
 * to the column, whose slotId then shows in `#sidebar-template-settings`. That
 * panel re-renders async on selection; the old code read it immediately, which
 * was a ~30% nuxt-admin flake (empty read). waitForSidebarOpen doesn't help — the
 * sidebar is already open, so it's a no-op. A column's slotId is deterministic
 * data, so an empty read only ever means the panel hasn't re-rendered yet, never
 * a genuinely missing slotId — poll until it shows a value.
 *
 * `distinctFrom` guards the second read against a stale value from the previously
 * selected column: require the field to differ from the neighbour's slotId, so we
 * only accept the newly-selected column's OWN value (each column is its own slot).
 */
async function readColumnSlotId(
  page: Page,
  helper: AdminUIHelper,
  cellId: string,
  distinctFrom?: string,
): Promise<string> {
  await helper.clickBlockInIframe(cellId);
  await helper.escapeToParent(); // cell -> column
  const field = page.locator('#sidebar-template-settings #field-slotId');
  let slotId = '';
  await expect
    .poll(
      async () => {
        slotId = await field.inputValue().catch(() => '');
        return slotId && slotId !== distinctFrom ? slotId : '';
      },
      { timeout: 8000 },
    )
    .toBeTruthy();
  return slotId;
}

test.describe('allowedLayouts', () => {
  test.describe('LayoutSelector Visibility', () => {
    test('shows Layout dropdown when allowedLayouts is configured', async ({ page }) => {
      const helper = new AdminUIHelper(page);

      await helper.login();
      // test-page should have allowedLayouts configured
      await helper.navigateToEdit('/test-page');
      await helper.waitForIframeReady();

      // Click to deselect blocks and show page-level sidebar
      await page.locator('.sidebar-section-header .section-title').click();

      // Verify Layout dropdown is visible in sidebar (first one is the page-level layout)
      const layoutSelector = page.locator('.layout-selector').first();
      await expect(layoutSelector).toBeVisible();
    });

    test('hides Layout dropdown when allowedLayouts is empty', async ({ page }) => {
      const helper = new AdminUIHelper(page);
      const iframe = helper.getIframe();

      await helper.login();
      // template-test-page has a grid block from the template - grid containers don't have allowedLayouts
      await helper.navigateToEdit('/template-test-page');
      await helper.waitForIframeReady();

      // Click on a grid cell to select it and show the grid container in sidebar
      await helper.clickBlockByContent('Template Grid Cell 1');
      await helper.waitForSidebarOpen();

      // The grid container section should not have a layout selector (no allowedLayouts configured)
      const gridSection = page.locator('.container-field-section').filter({ has: page.locator('.widget-title', { hasText: /Grid/i }) });
      const gridLayoutSelector = gridSection.locator('.layout-selector');
      await expect(gridLayoutSelector).not.toBeVisible();
    });
  });

  test.describe('allowedLayouts vs allowedTemplates Independence', () => {
    test('template in allowedLayouts appears in Layout dropdown', async ({ page }) => {
      const helper = new AdminUIHelper(page);

      await helper.login();
      await helper.navigateToEdit('/test-page');
      await helper.waitForIframeReady();

      // Show page-level sidebar
      await page.locator('.sidebar-section-header .section-title').click();

      // Open layout dropdown - wait for it to be visible first
      const layoutSelector = page.locator('.layout-selector select');
      await expect(layoutSelector).toBeVisible({ timeout: 5000 });
      await layoutSelector.click();

      // Verify template appears as option
      const options = await layoutSelector.locator('option').allTextContents();
      expect(options.some(o => o.toLowerCase().includes('header footer'))).toBe(true);
    });
  });

  test.describe('Apply Layout Merging', () => {
    test('existing blocks move into default placeholder', async ({ page }) => {
      const helper = new AdminUIHelper(page);
      const iframe = helper.getIframe();

      await helper.login();
      // Use another-page which has no listings (avoids listing expansion duplicates)
      await helper.navigateToEdit('/another-page');
      await helper.waitForIframeReady();

      // Wait for initial block selection to settle (first block auto-selected on page load)
      await helper.waitForBlockSelectedInAdmin('block-1-uuid');

      // Remember initial block order
      const initialBlocks = await iframe.locator('[data-block-uid]').allTextContents();
      expect(initialBlocks.length).toBeGreaterThan(0);

      // Show page-level sidebar
      await page.locator('.sidebar-section-header .section-title').click();

      // Select header-footer-layout and apply
      const layoutSelector = page.locator('.layout-selector select');
      await layoutSelector.selectOption('Header Footer Layout');

      const applyButton = page.locator('.apply-layout-btn');
      await applyButton.click();

      // Wait for layout to be applied - sidebar shows stable admin state
      await expect(iframe.locator('main [data-block-uid], #content [data-block-uid]').filter({ hasText: 'Layout Header' })).toBeVisible({ timeout: 10000 });
      await expect(iframe.locator('main [data-block-uid], #content [data-block-uid]').filter({ hasText: 'Layout Footer' })).toBeVisible({ timeout: 10000 });

      // Verify structure: header, existing content, footer
      // Use main/content selector for broader compatibility (test frontend uses #content, Nuxt uses main)
      const allBlocks = await iframe.locator('main [data-block-uid], #content [data-block-uid]').allTextContents();
      const headerIndex = allBlocks.findIndex(t => t.includes('Layout Header'));
      const footerIndex = allBlocks.findIndex(t => t.includes('Layout Footer'));

      expect(headerIndex).toBe(0); // Header at start
      expect(footerIndex).toBe(allBlocks.length - 1); // Footer at end
      expect(footerIndex - headerIndex).toBeGreaterThan(1); // Content between them
    });

    test('fixed header block appears at start and is locked', async ({ page }) => {
      const helper = new AdminUIHelper(page);
      const iframe = helper.getIframe();

      await helper.login();
      await helper.navigateToEdit('/test-page');
      await helper.waitForIframeReady();

      // Apply layout
      await page.locator('.sidebar-section-header .section-title').click();
      const layoutSelector = page.locator('.layout-selector select');
      await layoutSelector.selectOption('Header Footer Layout');
      await page.locator('.apply-layout-btn').click();

      // Wait for header to appear
      const { locator: headerBlock } = await helper.waitForBlockByContent('Layout Header');

      // Click header block
      await headerBlock.click();
      await helper.waitForSidebarOpen();

      // Verify lock icon in toolbar
      const toolbar = page.locator('.quanta-toolbar');
      const lockIcon = toolbar.locator('.lock-icon');
      await expect(lockIcon).toBeVisible();
    });

  });

  test.describe('Fixed Edge Blocks Prevent Insertion', () => {
    test('cannot add block before fixed header at edge', async ({ page }) => {
      const helper = new AdminUIHelper(page);
      const iframe = helper.getIframe();

      await helper.login();
      await helper.navigateToEdit('/test-page');
      await helper.waitForIframeReady();

      // Apply layout
      await page.locator('.sidebar-section-header .section-title').click();
      const layoutSelector = page.locator('.layout-selector select');
      await layoutSelector.selectOption('Header Footer Layout');
      await page.locator('.apply-layout-btn').click();

      // Wait for header
      const { locator: headerBlock } = await helper.waitForBlockByContent('Layout Header');

      // Click header block
      await headerBlock.click();
      await helper.waitForSidebarOpen();

      // Check that "add before" is not available
      // The add button in quanta toolbar should not offer "add before" for edge fixed block
      const toolbar = page.locator('.quanta-toolbar');
      const addBeforeButton = toolbar.locator('[aria-label*="before"], [title*="before"]');
      await expect(addBeforeButton).not.toBeVisible();
    });

    test('cannot add block after fixed footer at edge', async ({ page }) => {
      const helper = new AdminUIHelper(page);
      const iframe = helper.getIframe();

      await helper.login();
      // Use another-page which has no listings (avoids listing expansion duplicates)
      await helper.navigateToEdit('/another-page');
      await helper.waitForIframeReady();

      // Apply layout
      await page.locator('.sidebar-section-header .section-title').click();
      const layoutSelector = page.locator('.layout-selector select');
      await layoutSelector.selectOption('Header Footer Layout');
      await page.locator('.apply-layout-btn').click();

      // Wait for layout to be applied - sidebar shows stable admin state
      await expect(iframe.locator('main [data-block-uid], #content [data-block-uid]').filter({ hasText: 'Layout Footer' })).toBeVisible({ timeout: 10000 });

      // Click footer block in iframe (use main/content selector for broader compatibility)
      const footerBlock = iframe.locator('main [data-block-uid], #content [data-block-uid]').filter({ hasText: 'Layout Footer' });
      await footerBlock.click();
      await helper.waitForSidebarOpen();

      // Check that "add after" is not available
      const toolbar = page.locator('.quanta-toolbar');
      const addAfterButton = toolbar.locator('[aria-label*="after"], [title*="after"]');
      await expect(addAfterButton).not.toBeVisible();
    });

    test('CAN add block between fixed header and content', async ({ page }) => {
      const helper = new AdminUIHelper(page);
      const iframe = helper.getIframe();

      await helper.login();
      await helper.navigateToEdit('/test-page');
      await helper.waitForIframeReady();

      // Apply layout
      await page.locator('.sidebar-section-header .section-title').click();
      const layoutSelector = page.locator('.layout-selector select');
      await layoutSelector.selectOption('Header Footer Layout');
      await page.locator('.apply-layout-btn').click();

      // Wait for layout
      await helper.waitForBlockByContent('Layout Header');

      // Find the first non-fixed block (existing content that was moved)
      const allBlocks = iframe.locator('[data-block-uid]');
      const blockCount = await allBlocks.count();

      // Click second block (should be user content, after header)
      if (blockCount > 1) {
        const secondBlock = allBlocks.nth(1);
        await secondBlock.click();
        await helper.waitForSidebarOpen();

        // There should be an add button available
        await helper.clickAddBlockButton();
        const chooserVisible = await helper.isBlockChooserVisible();
        expect(chooserVisible).toBe(true);
      }
    });
  });

  test.describe('Fixed Edge Blocks Prevent DnD', () => {
    test('cannot drag block to before fixed header at edge', async ({ page }) => {
      const helper = new AdminUIHelper(page);
      const iframe = helper.getIframe();

      await helper.login();
      await helper.navigateToEdit('/test-page');
      await helper.waitForIframeReady();

      // Apply layout
      await page.locator('.sidebar-section-header .section-title').click();
      const layoutSelector = page.locator('.layout-selector select');
      await layoutSelector.selectOption('Header Footer Layout');
      await page.locator('.apply-layout-btn').click();

      // Wait for layout
      const { locator: headerBlock } = await helper.waitForBlockByContent('Layout Header');

      // Get block positions before drag
      const allBlocks = iframe.locator('[data-block-uid]');
      const blockCount = await allBlocks.count();
      expect(blockCount).toBeGreaterThan(2);

      // Try to drag second block (content) to before header
      const contentBlock = allBlocks.nth(1);
      const headerBox = await headerBlock.boundingBox();
      const contentBox = await contentBlock.boundingBox();

      if (headerBox && contentBox) {
        // Drag content block to above header
        await contentBlock.hover();
        await page.mouse.down();
        await page.mouse.move(headerBox.x + headerBox.width / 2, headerBox.y - 10);
        await page.mouse.up();

        // Verify header is still first (drag was prevented/reverted)
        const firstBlockText = await allBlocks.first().textContent();
        expect(firstBlockText).toContain('Layout Header');
      }
    });

    test('cannot drag block to after fixed footer at edge', async ({ page }) => {
      const helper = new AdminUIHelper(page);
      const iframe = helper.getIframe();

      await helper.login();
      // Use another-page which has no listings (avoids listing expansion duplicates)
      await helper.navigateToEdit('/another-page');
      await helper.waitForIframeReady();

      // Wait for initial block selection to settle (first block auto-selected on page load)
      await helper.waitForBlockSelectedInAdmin('block-1-uuid');

      // Apply layout
      await page.locator('.sidebar-section-header .section-title').click();
      const layoutSelector = page.locator('.layout-selector select');
      await layoutSelector.selectOption('Header Footer Layout');
      await page.locator('.apply-layout-btn').click();

      // Wait for layout to be applied - sidebar shows stable admin state
      await expect(iframe.locator('main [data-block-uid], #content [data-block-uid]').filter({ hasText: 'Layout Footer' })).toBeVisible({ timeout: 10000 });

      // Get footer block and block positions (use main/content selector for broader compatibility)
      const footerBlock = iframe.locator('main [data-block-uid], #content [data-block-uid]').filter({ hasText: 'Layout Footer' });
      const allBlocks = iframe.locator('main [data-block-uid], #content [data-block-uid]');
      const blockCount = await allBlocks.count();
      expect(blockCount).toBeGreaterThan(2);

      // Try to drag second block (content) to after footer
      const contentBlock = allBlocks.nth(1);
      const footerBox = await footerBlock.boundingBox();
      const contentBox = await contentBlock.boundingBox();

      if (footerBox && contentBox) {
        // Drag content block to below footer
        await contentBlock.hover();
        await page.mouse.down();
        await page.mouse.move(footerBox.x + footerBox.width / 2, footerBox.y + footerBox.height + 10);
        await page.mouse.up();

        // Verify footer is still last (drag was prevented/reverted)
        const lastBlockText = await allBlocks.last().textContent();
        expect(lastBlockText).toContain('Layout Footer');
      }
    });
  });

  test.describe('Switching Layouts', () => {
    test('content preserved when switching layouts with matching placeholders', async ({ page }) => {
      const helper = new AdminUIHelper(page);
      const iframe = helper.getIframe();

      await helper.login();
      await helper.navigateToEdit('/test-page');
      await helper.waitForIframeReady();

      // Get initial content text
      const initialContent = await iframe.locator('[data-block-uid="block-1-uuid"]').textContent();

      // Apply header-footer layout (has "default" placeholder)
      await page.locator('.sidebar-section-header .section-title').click();
      const layoutSelector = page.locator('.layout-selector select');
      await layoutSelector.selectOption('Header Footer Layout');
      await page.locator('.apply-layout-btn').click();

      // Wait for layout
      await helper.waitForBlockByContent('Layout Header');

      // Verify original content is still there (moved to default placeholder)
      const contentAfterLayout = await iframe.locator('[data-block-uid]').allTextContents();
      const contentPreserved = contentAfterLayout.some(t => t.includes(initialContent || 'Block'));
      expect(contentPreserved).toBe(true);
    });

    test('multiple blocks in matching placeholder preserved when switching layouts', async ({ page }) => {
      const helper = new AdminUIHelper(page);

      await helper.login();
      // test-page has multiple blocks - including "Block 1" and "Welcome" (hero heading)
      await helper.navigateToEdit('/test-page');
      await helper.waitForIframeReady();

      // Wait for initial block selection to settle (first block auto-selected on page load)
      await helper.waitForBlockSelectedInAdmin('block-1-uuid');

      // Verify multiple user blocks exist before layout
      const { locator: block1 } = await helper.waitForBlockByContent('test paragraph');
      const { locator: block2 } = await helper.waitForBlockByContent('Another paragraph');
      await expect(block1).toBeVisible();
      await expect(block2).toBeVisible();

      // Apply header-footer layout
      await page.locator('.sidebar-section-header .section-title').click();
      const layoutSelector = page.locator('.layout-selector select');
      await expect(layoutSelector).toBeVisible({ timeout: 5000 });
      await layoutSelector.selectOption('Header Footer Layout');
      await page.locator('.apply-layout-btn').click();

      // Wait for layout
      await helper.waitForBlockByContent('Layout Header');

      // Verify both user blocks still exist after first layout
      await expect(block1).toBeVisible();
      await expect(block2).toBeVisible();

      // Switch to editable-fixed layout
      await page.locator('.sidebar-section-header .section-title').click();
      await expect(layoutSelector).toBeVisible({ timeout: 5000 });
      await layoutSelector.selectOption('Editable Fixed Layout');
      await page.locator('.apply-layout-btn').click();

      // Wait for new layout
      await helper.waitForBlockByContent('Editable Header');

      // Old fixed blocks should be replaced
      const iframe = helper.getIframe();
      await expect(iframe.locator('[data-block-uid]').filter({ hasText: 'Layout Header' }).first()).not.toBeVisible();

      // BOTH user blocks should still be preserved after switching
      await expect(block1).toBeVisible();
      await expect(block2).toBeVisible();
    });

    test('non-matching placeholder content goes to default', async ({ page }) => {
      const helper = new AdminUIHelper(page);
      const iframe = helper.getIframe();

      await helper.login();
      await helper.navigateToEdit('/another-page');
      await helper.waitForIframeReady();

      // Wait for initial block selection to settle (first block auto-selected on page load)
      await helper.waitForBlockSelectedInAdmin('block-1-uuid');

      const originalContent = 'another test page';

      // Apply header-footer layout (has header, default, footer placeholders)
      await page.locator('.sidebar-section-header .section-title').click();
      const layoutSelector = page.locator('.layout-selector select');
      await expect(layoutSelector).toBeVisible({ timeout: 5000 });
      await layoutSelector.selectOption('Header Footer Layout');
      await page.locator('.apply-layout-btn').click();

      // Wait for layout
      await expect(iframe.locator('main [data-block-uid], #content [data-block-uid]').filter({ hasText: 'Layout Footer' })).toBeVisible({ timeout: 5000 });

      // Switch to header-only layout (has header, default but NO footer placeholder)
      // Deselect block to show page sidebar with layout selector
      await page.locator('.sidebar-section-header .section-title').click();
      await expect(layoutSelector).toBeVisible({ timeout: 10000 });
      await layoutSelector.selectOption('Header Only Layout');
      await page.locator('.apply-layout-btn').click();

      // Wait for new layout
      await expect(iframe.locator('main [data-block-uid], #content [data-block-uid]').filter({ hasText: 'Header Only' })).toBeVisible({ timeout: 5000 });

      // Old fixed blocks gone (no matching footer placeholder in new layout)
      const allBlocks = await iframe.locator('main [data-block-uid], #content [data-block-uid]').allTextContents();
      expect(allBlocks.some(t => t.includes('Layout Footer'))).toBe(false);
      expect(allBlocks.some(t => t.includes('Layout Header'))).toBe(false);

      // User content preserved in default placeholder
      expect(allBlocks.some(t => t.includes(originalContent))).toBe(true);
    });
  });

  test.describe('Single Fixed Edge (Header Only)', () => {
    test('fixed header at top, content flows to free bottom edge', async ({ page }) => {
      const helper = new AdminUIHelper(page);
      const iframe = helper.getIframe();

      await helper.login();
      await helper.navigateToEdit('/another-page');
      await helper.waitForIframeReady();

      // Apply header-only layout
      await page.locator('.sidebar-section-header .section-title').click();
      const layoutSelector = page.locator('.layout-selector select');
      await layoutSelector.selectOption('Header Only Layout');
      await page.locator('.apply-layout-btn').click();

      // Wait for layout - sidebar shows stable state
      await expect(iframe.locator('main [data-block-uid], #content [data-block-uid]').filter({ hasText: 'Header Only' })).toBeVisible({ timeout: 10000 });

      // Verify structure: header at top, content after, NO fixed footer (use main/content selector for broader compatibility)
      const allBlocks = await iframe.locator('main [data-block-uid], #content [data-block-uid]').allTextContents();
      const headerIndex = allBlocks.findIndex(t => t.includes('Header Only'));
      const footerIndex = allBlocks.findIndex(t => t.includes('Layout Footer'));

      expect(headerIndex).toBe(0); // Header at start
      expect(footerIndex).toBe(-1); // No footer
      expect(allBlocks.length).toBeGreaterThan(1); // Header + content
    });

    test('cannot add block before fixed header (constrained edge)', async ({ page }) => {
      const helper = new AdminUIHelper(page);
      const iframe = helper.getIframe();

      await helper.login();
      await helper.navigateToEdit('/another-page');
      await helper.waitForIframeReady();

      // Apply header-only layout
      await page.locator('.sidebar-section-header .section-title').click();
      const layoutSelector = page.locator('.layout-selector select');
      await layoutSelector.selectOption('Header Only Layout');
      await page.locator('.apply-layout-btn').click();

      // Wait for layout
      await expect(iframe.locator('main [data-block-uid], #content [data-block-uid]').filter({ hasText: 'Header Only' })).toBeVisible({ timeout: 10000 });

      // Click header block (use main/content selector for broader compatibility)
      const headerBlock = iframe.locator('main [data-block-uid], #content [data-block-uid]').filter({ hasText: 'Header Only' });
      await headerBlock.click();
      await helper.waitForSidebarOpen();

      // Check that "add before" is not available for fixed header at edge
      const toolbar = page.locator('.quanta-toolbar');
      const addBeforeButton = toolbar.locator('[aria-label*="before"], [title*="before"]');
      await expect(addBeforeButton).not.toBeVisible();
    });

    test('CAN add block after last block (free bottom edge)', async ({ page }) => {
      const helper = new AdminUIHelper(page);
      const iframe = helper.getIframe();

      await helper.login();
      await helper.navigateToEdit('/another-page');
      await helper.waitForIframeReady();

      // Apply header-only layout
      await page.locator('.sidebar-section-header .section-title').click();
      const layoutSelector = page.locator('.layout-selector select');
      await layoutSelector.selectOption('Header Only Layout');
      await page.locator('.apply-layout-btn').click();

      // Wait for layout
      await expect(iframe.locator('main [data-block-uid], #content [data-block-uid]').filter({ hasText: 'Header Only' })).toBeVisible({ timeout: 10000 });

      // Click last block (should be content, not header) - use main/content selector for broader compatibility
      const allBlocks = iframe.locator('main [data-block-uid], #content [data-block-uid]');
      const lastBlock = allBlocks.last();
      await lastBlock.click();
      await helper.waitForSidebarOpen();

      // Should be able to add block after (free edge)
      await helper.clickAddBlockButton();
      const chooserVisible = await helper.isBlockChooserVisible();
      expect(chooserVisible).toBe(true);
    });
  });

  test.describe('Forced Layouts', () => {
    test('footer_blocks with allowedLayouts auto-applies layout in edit mode', async ({ page }) => {
      const helper = new AdminUIHelper(page);
      const iframe = helper.getIframe();

      await helper.login();
      // another-page has footer_blocks data (no template markers) and allowedLayouts forces footer-layout
      await helper.navigateToEdit('/another-page');
      await helper.waitForIframeReady();

      // Verify the forced layout was applied - fixed branding block should appear
      const footerContent = iframe.locator('#footer-content');
      const brandingBlock = footerContent.locator('[data-block-uid]').filter({ hasText: 'Footer Branding - Forced Layout' });
      await expect(brandingBlock).toBeVisible({ timeout: 10000 });

      // The forced layout also contains a nested `columns` container whose
      // children live in a non-`items` region — the regions shape (#234) the
      // template merge must walk. Its cell must render (dropped/threw before the
      // helpers' expandTemplates iterated every region).
      // innermost [data-block-uid] (the cell slate) — ancestors also contain the text
      const columnCell = footerContent.locator('[data-block-uid]').filter({ hasText: 'Footer Column Cell' }).last();
      await expect(columnCell).toBeVisible({ timeout: 10000 });

      // User content should still be there (moved to default placeholder)
      const userContent = footerContent.locator('[data-block-uid]').filter({ hasText: 'Footer user content' });
      await expect(userContent).toBeVisible();

      // Branding block should be first (fixed at top)
      const allFooterBlocks = footerContent.locator('[data-block-uid]');
      const firstBlockText = await allFooterBlocks.first().textContent();
      expect(firstBlockText).toContain('Footer Branding');
    });

    test('footer_blocks with allowedLayouts auto-applies layout in view mode', async ({ page }) => {
      const helper = new AdminUIHelper(page);
      const iframe = helper.getIframe();

      // Navigate to view mode (not edit mode) through the admin UI
      await helper.login();
      await helper.navigateToView('/another-page');
      await helper.waitForIframeReady();

      // Wait for footer to render with forced layout in iframe
      const footerContent = iframe.locator('#footer-content');
      await footerContent.waitFor({ timeout: 10000 });

      // Verify the forced layout was applied
      const brandingBlock = footerContent.locator('[data-block-uid]').filter({ hasText: 'Footer Branding - Forced Layout' });
      await expect(brandingBlock).toBeVisible({ timeout: 10000 });

      // Nested columns container (non-items region) must render too (#234).
      // innermost [data-block-uid] (the cell slate) — ancestors also contain the text
      const columnCell = footerContent.locator('[data-block-uid]').filter({ hasText: 'Footer Column Cell' }).last();
      await expect(columnCell).toBeVisible({ timeout: 10000 });

      // User content should still be there
      const userContent = footerContent.locator('[data-block-uid]').filter({ hasText: 'Footer user content' });
      await expect(userContent).toBeVisible();
    });

    test('editing a nested columns cell in a forced footer persists after save', async ({ page }) => {
      const helper = new AdminUIHelper(page);
      const iframe = helper.getIframe();

      await helper.login();
      await helper.navigateToEdit('/another-page');
      await helper.waitForIframeReady();

      const footerContent = iframe.locator('#footer-content');
      // The forced footer's branding block is a direct child of the footer
      // instance (used to enter template edit mode); the columns cell is nested
      // 3 levels deep (columns -> column -> slate) — the block we actually edit.
      const branding = footerContent.locator('[data-block-uid]').filter({ hasText: 'Footer Branding' }).last();
      await expect(branding).toBeVisible({ timeout: 10000 });
      const brandingId = await branding.getAttribute('data-block-uid');
      const cell = footerContent.locator('[data-block-uid]').filter({ hasText: 'Footer Column Cell' }).last();
      await expect(cell).toBeVisible({ timeout: 10000 });
      const cellId = await cell.getAttribute('data-block-uid');

      // Unlock the template for editing.
      await helper.unlockTemplate(brandingId);

      // Select the deeply-nested columns cell — it must unlock in edit mode
      // (approach B ancestry unlock; the bridge sets contenteditable on selection).
      await helper.clickBlockInIframe(cellId);
      await helper.waitForBlockSelectedInAdmin(cellId);
      const cellEditor = helper.getSlateField(iframe.locator(`[data-block-uid="${cellId}"]`));
      await expect(cellEditor).toHaveAttribute('contenteditable', 'true', { timeout: 5000 });

      // Edit the nested cell with a unique marker.
      await cellEditor.click();
      await expect(cellEditor).toBeFocused({ timeout: 2000 });
      await page.keyboard.press('End');
      await page.keyboard.type(' FOOTEREDIT');
      await expect(iframe.locator(`[data-block-uid="${cellId}"]`)).toContainText('FOOTEREDIT', { timeout: 5000 });

      // Lock with "Change on all pages" — commits + saves the footer template.
      await helper.lockTemplate(brandingId, 'commit');

      // Save the page too (allowed now that nothing is unlocked).
      await page.keyboard.press('Control+s');
      const pencilIcon = page.locator('.toolbar-actions .edit, [aria-label="Edit"]');
      await expect(pencilIcon).toBeVisible({ timeout: 10000 });

      // PROOF OF SAVE: navigate to a DIFFERENT page (/another-page-2) that
      // independently forces the SAME footer-layout. The edit can only appear
      // there if it was saved back into the footer-layout TEMPLATE and re-applied
      // on load — reloading the same page we edited would not distinguish a real
      // template save from this page's own local/footer state.
      await helper.navigateToView('/another-page-2');
      await helper.waitForIframeReady();
      // Sanity: page-2's own content rules out a stale /another-page render.
      await expect(iframe.locator('[data-block-uid]').filter({ hasText: 'second forced-footer page' }).first()).toBeVisible({ timeout: 15000 });
      const persistedCell = iframe.locator('#footer-content [data-block-uid]').filter({ hasText: 'FOOTEREDIT' }).last();
      await expect(persistedCell).toBeVisible({ timeout: 15000 });
    });

    test('a page block dragged into an unlocked forced footer is saved into the footer template', async ({ page }) => {
      // Moving content INTO a template while editing it: the block comes from the
      // page's own region (outside every template) and is dropped inside the
      // forced footer's columns container. Locking with "Change on all pages"
      // must save it into the footer template, so every page forcing that
      // footer shows it.
      const helper = new AdminUIHelper(page);
      const iframe = helper.getIframe();

      await helper.login();
      await helper.navigateToEdit('/another-page');
      await helper.waitForIframeReady();

      const footerContent = iframe.locator('#footer-content');
      const branding = footerContent.locator('[data-block-uid]').filter({ hasText: 'Footer Branding' }).last();
      await expect(branding).toBeVisible({ timeout: 10000 });
      const brandingId = await branding.getAttribute('data-block-uid');
      const cell = footerContent.locator('[data-block-uid]').filter({ hasText: 'Footer Column Cell' }).last();
      await expect(cell).toBeVisible({ timeout: 10000 });
      const cellId = await cell.getAttribute('data-block-uid');

      // The page's own block, in the main region — not in the footer yet.
      const movedId = 'block-1-uuid';
      const movedText = 'This is another test page';
      await expect(iframe.locator(`#content [data-block-uid="${movedId}"]`)).toContainText(movedText);
      await expect(footerContent.locator(`[data-block-uid="${movedId}"]`)).toHaveCount(0);

      // Unlock the footer template, then drop the page block into its columns
      // container, after the column's own cell.
      await helper.unlockTemplate(brandingId);
      await helper.dragBlockAfter(movedId, cellId);

      // It left the page region and sits in the footer, beside the cell.
      await expect(footerContent.locator(`[data-block-uid="${movedId}"]`)).toContainText(movedText, { timeout: 5000 });
      await expect(iframe.locator(`#content [data-block-uid="${movedId}"]`)).toHaveCount(0);

      // Lock with "Change on all pages" — commits + saves the footer template.
      await helper.lockTemplate(brandingId, 'commit');

      // Save the page too (allowed now that nothing is unlocked).
      await page.keyboard.press('Control+s');
      const pencilIcon = page.locator('.toolbar-actions .edit, [aria-label="Edit"]');
      await expect(pencilIcon).toBeVisible({ timeout: 10000 });

      // PROOF OF SAVE: another page forcing the same footer template shows the
      // moved block in its footer — only possible if it was saved into the
      // template.
      await helper.navigateToView('/another-page-2');
      await helper.waitForIframeReady();
      await expect(iframe.locator('[data-block-uid]').filter({ hasText: 'second forced-footer page' }).first()).toBeVisible({ timeout: 15000 });
      await expect(iframe.locator('#footer-content [data-block-uid]').filter({ hasText: movedText }).last()).toBeVisible({ timeout: 15000 });
    });

    test('committing a forced footer on a page with another template saves only the footer', async ({ page }) => {
      // The page's main region holds a DIFFERENT template instance (test-layout)
      // beside the forced footer. Committing the footer saves the footer
      // template from what the page shows — and only the footer's own blocks:
      // the layout's blocks and the page's own content stay out of it.
      const helper = new AdminUIHelper(page);
      const iframe = helper.getIframe();

      await helper.login();
      await helper.navigateToEdit('/another-page-with-layout');
      await helper.waitForIframeReady();

      // Both templates are on the page.
      const content = iframe.locator('#content');
      await expect(content.locator('[data-block-uid]').filter({ hasText: 'Template Header - From Template' }).first()).toBeVisible({ timeout: 10000 });
      const footerContent = iframe.locator('#footer-content');
      const branding = footerContent.locator('[data-block-uid]').filter({ hasText: 'Footer Branding' }).last();
      await expect(branding).toBeVisible({ timeout: 10000 });
      const brandingId = await branding.getAttribute('data-block-uid');
      const cell = footerContent.locator('[data-block-uid]').filter({ hasText: 'Footer Column Cell' }).last();
      await expect(cell).toBeVisible({ timeout: 10000 });
      const cellId = await cell.getAttribute('data-block-uid');

      // Unlock the footer and edit its cell (locking an unchanged template
      // saves nothing).
      await helper.unlockTemplate(brandingId);
      await helper.clickBlockInIframe(cellId);
      await helper.waitForBlockSelectedInAdmin(cellId);
      const cellEditor = helper.getSlateField(iframe.locator(`[data-block-uid="${cellId}"]`));
      await expect(cellEditor).toHaveAttribute('contenteditable', 'true', { timeout: 5000 });
      await cellEditor.click();
      await expect(cellEditor).toBeFocused({ timeout: 2000 });
      await page.keyboard.press('End');
      await page.keyboard.type(' FOOTERONLY');
      await expect(iframe.locator(`[data-block-uid="${cellId}"]`)).toContainText('FOOTERONLY', { timeout: 5000 });

      // Lock with "Change on all pages" — saves the footer template.
      await helper.lockTemplate(brandingId, 'commit');
      await page.keyboard.press('Control+s');
      const pencilIcon = page.locator('.toolbar-actions .edit, [aria-label="Edit"]');
      await expect(pencilIcon).toBeVisible({ timeout: 10000 });

      // Another page forcing the same footer merges the saved template: the
      // edit is there, and nothing from the other template or this page is.
      await helper.navigateToView('/another-page-2');
      await helper.waitForIframeReady();
      await expect(iframe.locator('[data-block-uid]').filter({ hasText: 'second forced-footer page' }).first()).toBeVisible({ timeout: 15000 });
      const otherFooter = iframe.locator('#footer-content');
      await expect(otherFooter.locator('[data-block-uid]').filter({ hasText: 'FOOTERONLY' }).last()).toBeVisible({ timeout: 15000 });
      for (const fromElsewhere of [
        'Template Header - From Template',
        'Template Footer - From Template',
        'standalone block',
        'Footer user content on the page with a layout',
      ]) {
        await expect(otherFooter.locator('[data-block-uid]').filter({ hasText: fromElsewhere })).toHaveCount(0);
      }
    });

    test('editing a forced-footer template lets you add + remove columns in the footer container (footer region)', async ({ page }) => {
      const helper = new AdminUIHelper(page);
      const iframe = helper.getIframe();

      await helper.login();
      await helper.navigateToEdit('/another-page');
      await helper.waitForIframeReady();

      const footerContent = iframe.locator('#footer-content');
      const branding = footerContent.locator('[data-block-uid]').filter({ hasText: 'Footer Branding' }).last();
      await expect(branding).toBeVisible({ timeout: 10000 });
      const brandingId = await branding.getAttribute('data-block-uid');
      const cell = footerContent.locator('[data-block-uid]').filter({ hasText: 'Footer Column Cell' }).last();
      await expect(cell).toBeVisible({ timeout: 10000 });
      const cellId = await cell.getAttribute('data-block-uid');

      // Unlock the template for editing.
      await helper.unlockTemplate(brandingId);

      // Navigate up to the columns container (cell -> column -> columns). This is a
      // container in the FOOTER region — the forced-region canAdd case the recursive
      // stamping fixes (the nested columns now carry the footer instance id).
      await helper.clickBlockInIframe(cellId);
      await helper.waitForBlockSelectedInAdmin(cellId);
      await helper.escapeToParent(); // -> column
      await helper.escapeToParent(); // -> columns

      // Add + remove a COLUMN in the forced-footer columns container.
      const columns = footerContent.locator('.columns-row > [data-block-uid]');
      await expect(columns).toHaveCount(1);
      const firstColId = await columns.first().getAttribute('data-block-uid');
      await helper.addBlockViaSidebar('Columns'); // columns slot allowedBlocks: ['column'] → auto-insert
      await expect(columns).toHaveCount(2);

      // The added column must be a REAL member of the slot region. Each column is its
      // OWN slot (like the fixed footer-col-1), so the new column gets its own distinct
      // stored slotId — not undefined, and not a copy of the neighbour's. Reading it
      // from #sidebar-template-settings only succeeds when the new column IS a template
      // member: that panel renders only for a block carrying templateId + the edited
      // instanceId, so a truthy read here proves membership (store-on-add inherited
      // template membership from its neighbour). A count-only assertion would still pass
      // if store-on-add produced a non-member.
      // Read each column's slotId from its template-settings panel (see helper —
      // clicking a column selects its cell, so escape up; the read is hardened
      // against the panel's async re-render).
      const newCellId = await columns.nth(1).locator('[data-block-uid]').first().getAttribute('data-block-uid');
      const neighbourSlotId = await readColumnSlotId(page, helper, cellId);
      const newSlotId = await readColumnSlotId(page, helper, newCellId!, neighbourSlotId);

      expect(neighbourSlotId).toBeTruthy(); // the existing fixed column is a member
      expect(newSlotId).toBeTruthy();       // the new column is ALSO a member (own stored slotId)
      expect(newSlotId).not.toBe(neighbourSlotId); // each column is its OWN distinct slot

      // Remove the column.
      await page.evaluate((id) => {
        document.dispatchEvent(new CustomEvent('hydra-delete-blocks', { detail: { blockIds: [id] } }));
      }, firstColId);
      await expect(columns).toHaveCount(1);
    });

    test('fixed block from forced layout is locked', async ({ page }) => {
      const helper = new AdminUIHelper(page);
      const iframe = helper.getIframe();

      await helper.login();
      await helper.navigateToEdit('/another-page');
      await helper.waitForIframeReady();

      // Click the fixed branding block in the footer area
      const footerContent = iframe.locator('#footer-content');
      const brandingBlock = footerContent.locator('[data-block-uid]').filter({ hasText: 'Footer Branding - Forced Layout' });
      await expect(brandingBlock).toBeVisible({ timeout: 10000 });
      await brandingBlock.click();
      await helper.waitForSidebarOpen();

      // Wait for toolbar to appear and verify lock icon
      const toolbar = page.locator('.quanta-toolbar');
      await expect(toolbar).toBeVisible({ timeout: 5000 });
      const lockIcon = toolbar.locator('.lock-icon');
      await expect(lockIcon).toBeVisible({ timeout: 5000 });
    });
  });

  test.describe('None Option in allowedLayouts', () => {
    test('pages without template stay template-free when null is in allowedLayouts', async ({ page }) => {
      const helper = new AdminUIHelper(page);
      const iframe = helper.getIframe();

      await helper.login();
      // test-page has no template markers in its data, and allowedLayouts includes null
      // so it should NOT auto-apply a template
      await helper.navigateToEdit('/test-page');
      await helper.waitForIframeReady();

      // Verify NO template fixed blocks were auto-applied
      // (test-layout has "Template Header - From Template" as fixed header)
      const templateHeader = iframe.locator('[data-block-uid]').filter({ hasText: 'Template Header - From Template' });
      await expect(templateHeader).not.toBeVisible();

      // User's original content should be at the top (not pushed down by template)
      const firstBlock = iframe.locator('[data-block-uid]').first();
      const firstBlockText = await firstBlock.textContent();
      // First block should be user content, not template content
      expect(firstBlockText).not.toContain('Template Header');
      expect(firstBlockText).not.toContain('Layout Header');
    });

    test('Layout dropdown shows None option when null is in allowedLayouts', async ({ page }) => {
      const helper = new AdminUIHelper(page);

      await helper.login();
      await helper.navigateToEdit('/test-page');
      await helper.waitForIframeReady();

      // Show page-level sidebar
      await page.locator('.sidebar-section-header .section-title').click();

      // Open layout dropdown
      const layoutSelector = page.locator('.layout-selector select');
      await expect(layoutSelector).toBeVisible({ timeout: 5000 });

      // Verify "None" option exists
      const options = await layoutSelector.locator('option').allTextContents();
      expect(options.some(o => o.toLowerCase() === 'none' || o.toLowerCase() === 'no layout')).toBe(true);
    });

    test('selecting None removes template and restores content', async ({ page }) => {
      const helper = new AdminUIHelper(page);
      const iframe = helper.getIframe();

      await helper.login();
      await helper.navigateToEdit('/test-page');
      await helper.waitForIframeReady();

      // First apply a layout
      await page.locator('.sidebar-section-header .section-title').click();
      const layoutSelector = page.locator('.layout-selector select');
      await layoutSelector.selectOption('Header Footer Layout');
      await page.locator('.apply-layout-btn').click();

      // Wait for layout to be applied - check sidebar shows the fixed blocks
      await expect(iframe.locator('main [data-block-uid], #content [data-block-uid]').filter({ hasText: 'Layout Header' })).toBeVisible({ timeout: 10000 });
      await expect(iframe.locator('main [data-block-uid], #content [data-block-uid]').filter({ hasText: 'Layout Footer' })).toBeVisible({ timeout: 10000 });

      // Now select None to remove the layout
      // Click Page to deselect block and show layout selector
      await page.locator('.sidebar-section-header .section-title').click();
      await expect(layoutSelector).toBeVisible({ timeout: 10000 });
      await layoutSelector.selectOption({ label: 'None' });
      await page.locator('.apply-layout-btn').click();

      // Wait for template fixed blocks to be removed from sidebar
      await expect(page.locator('.child-block-item', { hasText: 'Layout Header' })).not.toBeVisible({ timeout: 5000 });
      await expect(page.locator('.child-block-item', { hasText: 'Layout Footer' })).not.toBeVisible({ timeout: 5000 });

      // User content should still be there
      await helper.waitForBlockByContent('test paragraph');
    });
  });

  test.describe('Empty Page Blocks Fields', () => {
    test('page without footer_blocks data gets default block injected', async ({ page }) => {
      const helper = new AdminUIHelper(page);
      const iframe = helper.getIframe();

      await helper.login();
      // template-test-page has no footer_blocks in its data, but schema defines footer_blocks field
      await helper.navigateToEdit('/template-test-page');
      await helper.waitForIframeReady();

      // footer_blocks has allowedBlocks: ['slate', 'image'], so the default block is 'slate'
      // (config.settings.defaultBlockType is allowed). Verify a block is injected.
      const footerContent = iframe.locator('#footer-content');
      const footerBlocks = footerContent.locator('[data-block-uid]');
      await expect(footerBlocks.first()).toBeVisible({ timeout: 5000 });

      // Click the footer block — it should be selectable (slate block, not empty)
      const blockId = await footerBlocks.first().getAttribute('data-block-uid');
      await helper.clickBlockInIframe(blockId!);
      await helper.waitForSidebarOpen();
    });

    test('unlocking a header template does not change the footer block’s editability (v2: no page lock)', async ({ page }) => {
      const helper = new AdminUIHelper(page);
      const iframe = helper.getIframe();

      await helper.login();
      await helper.navigateToEdit('/template-test-page');
      await helper.waitForIframeReady();

      // The footer block's read-only marker is set by its OWN status: a plain page
      // footer block (admin-mock) is editable; a readOnly footer-template block
      // (admin-nuxt's forced footer) is not. Capture it BEFORE unlocking anything.
      const footerBlock = iframe.locator('#footer-content [data-block-uid]').first();
      await expect(footerBlock).toBeVisible({ timeout: 10000 });
      const lockedBefore = (await footerBlock.evaluate((el) =>
        getComputedStyle(el).getPropertyValue('--hydra-block-locked').trim(),
      ));

      // Select a header template block and unlock that template.
      const headerBlock = iframe.locator('main [data-block-uid], #content [data-block-uid]').filter({ hasText: 'Template Header' }).first();
      await expect(headerBlock).toBeVisible();
      const headerBlockId = await headerBlock.getAttribute('data-block-uid');
      await helper.unlockTemplate(headerBlockId!);

      // v2: unlocking the header template does NOT lock the rest of the page, so the
      // footer's editability is UNCHANGED (whatever it was on its own).
      await expect(async () => {
        const lockedAfter = await footerBlock.evaluate((el) =>
          getComputedStyle(el).getPropertyValue('--hydra-block-locked').trim(),
        );
        expect(lockedAfter).toBe(lockedBefore);
      }).toPass({ timeout: 5000 });
    });
  });
});
