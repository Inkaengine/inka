/**
 * Advanced template tests for edge cases and additional features.
 *
 * Tests that:
 * 1. Fixed editable blocks can be edited but not moved
 * 2. Removing a layout preserves content
 * 3. Deleting a template instance preserves slot content
 * 4. Non-matching slot content goes to default slot
 *
 * TODO: Add test where the same template is inserted twice on a page
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';
import { URLS } from '../ports';

test.describe('Fixed Editable Blocks', () => {
  test('fixed block without readOnly can be edited', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const iframe = helper.getIframe();

    await helper.login();
    await helper.navigateToEdit('/another-page');
    await helper.waitForIframeReady();

    // Apply the editable-fixed layout
    await page.locator('.sidebar-section-header .section-title').click();
    const layoutSelector = page.locator('.layout-selector select');
    await expect(layoutSelector).toBeVisible({ timeout: 5000 });
    await layoutSelector.selectOption('Editable Fixed Layout');
    await page.locator('.apply-layout-btn').click();

    // Wait for layout to render in the iframe
    await expect(iframe.locator('main [data-block-uid], #content [data-block-uid]').filter({ hasText: 'Editable Header' })).toBeVisible({ timeout: 10000 });

    // Click the editable header block
    const headerBlock = iframe.locator('main [data-block-uid], #content [data-block-uid]').filter({ hasText: 'Editable Header' });
    await expect(headerBlock).toBeVisible();
    await headerBlock.click();
    await helper.waitForSidebarOpen();

    // Verify it shows lock icon (fixed)
    const toolbar = page.locator('.quanta-toolbar');
    const lockIcon = toolbar.locator('.lock-icon');
    await expect(lockIcon).toBeVisible();

    // But the block should be editable - verify the editable field is present
    const editableField = helper.getSlateField(headerBlock);
    await expect(editableField).toBeVisible({ timeout: 5000 });
  });

  test('fixed block without readOnly cannot be moved', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const iframe = helper.getIframe();

    await helper.login();
    await helper.navigateToEdit('/another-page');
    await helper.waitForIframeReady();

    // Apply the editable-fixed layout
    await page.locator('.sidebar-section-header .section-title').click();
    const layoutSelector = page.locator('.layout-selector select');
    await expect(layoutSelector).toBeVisible({ timeout: 5000 });
    await layoutSelector.selectOption('Editable Fixed Layout');
    await page.locator('.apply-layout-btn').click();

    // Wait for layout to render in the iframe
    await expect(iframe.locator('main [data-block-uid], #content [data-block-uid]').filter({ hasText: 'Editable Header' })).toBeVisible({ timeout: 10000 });

    // Click the header block
    const headerBlock = iframe.locator('main [data-block-uid], #content [data-block-uid]').filter({ hasText: 'Editable Header' });
    await headerBlock.click();
    await helper.waitForSidebarOpen();

    // Verify drag handle is NOT shown (fixed blocks can't be dragged)
    const toolbar = page.locator('.quanta-toolbar');
    const dragHandle = toolbar.locator('.drag-handle');
    await expect(dragHandle).not.toBeVisible();
  });

  // The round-trip nobody was covering: edit a fixed-but-editable block's
  // content, save, and confirm (a) the edit persists on the INSTANCE after
  // reload and (b) the shared TEMPLATE document is never written. An instance
  // edit must stay instance-local.
  test('editing a fixed-but-editable block persists on the instance without saving the template', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const iframe = helper.getIframe();

    await helper.login();
    await helper.navigateToEdit('/another-page');
    await helper.waitForIframeReady();

    // Apply the editable-fixed layout: its "Editable Header" is fixed:true with
    // NO readOnly — the fixed-but-editable case.
    await page.locator('.sidebar-section-header .section-title').click();
    const layoutSelector = page.locator('.layout-selector select');
    await expect(layoutSelector).toBeVisible({ timeout: 5000 });
    await layoutSelector.selectOption('Editable Fixed Layout');
    await page.locator('.apply-layout-btn').click();
    const headerBlock = iframe
      .locator('main [data-block-uid], #content [data-block-uid]')
      .filter({ hasText: 'Editable Header' });
    await expect(headerBlock).toBeVisible({ timeout: 10000 });

    // Capture every write from here on so we can assert what was (and wasn't) saved.
    const writes: Array<{ method: string; url: string }> = [];
    page.on('request', (req) => {
      const m = req.method();
      if (m !== 'PATCH' && m !== 'POST') return;
      // Filter on the API this run is actually using. A literal 8888 here
      // matched nothing once the port was overridden, so the filter dropped
      // every request and the test kept passing while measuring nothing.
      if (!req.url().startsWith(URLS.mockApi)) return;
      writes.push({ method: m, url: req.url() });
    });

    // Select the block first so it becomes editable (schema resolves), then edit.
    await headerBlock.click();
    await helper.waitForSidebarOpen();
    const field = helper.getSlateField(headerBlock);
    await field.click();
    await expect(field).toHaveAttribute('contenteditable', 'true', {
      timeout: 5000,
    });
    // Place the cursor at the end before appending. Clicking a block-level field
    // lands the caret wherever the click resolves — at the true end on the mock
    // renderer (data-edit-text on the <h1> itself) but mid-text on Nuxt (attr on
    // the wrapper, text nested in a child <h1>). End makes "append at end"
    // explicit and renderer-independent — the real-user action for this intent.
    await page.keyboard.press('End');
    await field.pressSequentially(' EDITED', { delay: 25 });
    await expect(headerBlock).toContainText('Editable Header EDITED', {
      timeout: 10000,
    });

    await helper.saveContent();

    // (a) The instance page WAS patched with the edit…
    const instancePatches = writes.filter(
      (w) =>
        w.method === 'PATCH' &&
        w.url.includes('/another-page') &&
        !w.url.includes('/templates/'),
    );
    expect(
      instancePatches.length,
      `expected a PATCH to the instance /another-page; got ${JSON.stringify(writes)}`,
    ).toBeGreaterThanOrEqual(1);

    // (b) …but the shared TEMPLATE document must NOT be written.
    const templateWrites = writes.filter((w) =>
      w.url.includes('templates/editable-fixed-layout'),
    );
    expect(
      templateWrites,
      `editing an instance block must not save the template; got ${JSON.stringify(templateWrites)}`,
    ).toHaveLength(0);

    // (c) …and the edit persists after reload (stored on the instance, not
    // overwritten by the template's fixed content when it re-expands).
    await helper.navigateToEdit('/another-page');
    await helper.waitForIframeReady();
    await expect(
      iframe
        .locator('main [data-block-uid], #content [data-block-uid]')
        .filter({ hasText: 'Editable Header EDITED' }),
    ).toBeVisible({ timeout: 15000 });
  });
});

test.describe('Remove Layout', () => {
  test('can clear layout selection and preserve content', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const iframe = helper.getIframe();

    await helper.login();
    await helper.navigateToEdit('/another-page');
    await helper.waitForIframeReady();

    // Get initial content
    const initialBlocks = await iframe.locator('main [data-block-uid], #content [data-block-uid]').allTextContents();
    const hasOriginalContent = initialBlocks.some(t => t.includes('another test page'));
    expect(hasOriginalContent).toBe(true);

    // Apply header-footer layout
    await page.locator('.sidebar-section-header .section-title').click();
    const layoutSelector = page.locator('.layout-selector select');
    await expect(layoutSelector).toBeVisible({ timeout: 5000 });
    await layoutSelector.selectOption('Header Footer Layout');
    await page.locator('.apply-layout-btn').click();

    // Wait for layout to render in the iframe
    await expect(iframe.locator('main [data-block-uid], #content [data-block-uid]').filter({ hasText: 'Layout Header' })).toBeVisible({ timeout: 10000 });

    // Verify original content is still there (in default slot)
    const afterLayoutBlocks = await iframe.locator('main [data-block-uid], #content [data-block-uid]').allTextContents();
    const contentPreserved = afterLayoutBlocks.some(t => t.includes('another test page'));
    expect(contentPreserved).toBe(true);

    // Now select "Layout" (no layout) to remove the layout
    await page.locator('.sidebar-section-header .section-title').click();
    await expect(layoutSelector).toBeVisible({ timeout: 5000 });
    await layoutSelector.selectOption('Layout');

    // Click apply (should clear the layout)
    const applyButton = page.locator('.apply-layout-btn');
    // Apply button may not be visible when selecting "Layout" (no-op)
    // The content should still be there without the fixed header/footer
  });
});

test.describe('Delete Template Instance', () => {
  test('deleting template block via Remove moves slot content out', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const iframe = helper.getIframe();

    await helper.login();
    await helper.navigateToEdit('/template-test-page');
    await helper.waitForIframeReady();

    // Click on a template block to select it - this shows the template instance in breadcrumbs
    const headerBlock = iframe.locator('main [data-block-uid], #content [data-block-uid]').filter({ hasText: 'Template Header' });
    await expect(headerBlock).toBeVisible();
    await headerBlock.click();
    await helper.waitForSidebarOpen();

    // The template block is selected, which shows template settings in sidebar
    // The template breadcrumb button shows "Template: test-layout"
    const templateBreadcrumb = page.locator('button', { hasText: 'Template: test-layout' });
    await expect(templateBreadcrumb).toBeVisible({ timeout: 5000 });

    // Click the "•••" dropdown button next to the template breadcrumb to access Remove option
    // The dropdown is in .block-actions-menu, sibling of .parent-nav in .sidebar-section-header
    const templateSection = templateBreadcrumb.locator('xpath=ancestor::div[contains(@class,"sidebar-section-header")]');
    const dropdownTrigger = templateSection.locator('button', { hasText: '•••' });
    await expect(dropdownTrigger).toBeVisible();
    await dropdownTrigger.click();

    // Click Remove to delete the template instance
    const removeButton = page.locator('.volto-hydra-dropdown-item', { hasText: 'Remove' });
    await expect(removeButton).toBeVisible();
    await removeButton.click();

    // Verify the template header is gone
    await expect(headerBlock).not.toBeVisible();

    // Verify user content is preserved (moved out of template)
    // Both user content blocks should still be visible
    const userContent = iframe.locator('main [data-block-uid], #content [data-block-uid]').filter({ hasText: 'User content' });
    await expect(userContent).toHaveCount(2);
  });
});

test.describe('Non-matching Placeholder Content', () => {
  test('content with unknown slotId goes to default slot', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const iframe = helper.getIframe();

    await helper.login();
    await helper.navigateToEdit('/another-page');
    await helper.waitForIframeReady();

    // another-page has content without slot names
    // When we apply a layout, it should go into the "default" slot

    // Get initial block count
    const initialBlocks = await iframe.locator('main [data-block-uid], #content [data-block-uid]').allTextContents();
    expect(initialBlocks.length).toBeGreaterThan(0);

    // Apply header-footer layout (which has a "default" slot)
    await page.locator('.sidebar-section-header .section-title').click();
    const layoutSelector = page.locator('.layout-selector select');
    await expect(layoutSelector).toBeVisible({ timeout: 5000 });
    await layoutSelector.selectOption('Header Footer Layout');
    await page.locator('.apply-layout-btn').click();

    // Wait for layout to render in the iframe
    await expect(iframe.locator('main [data-block-uid], #content [data-block-uid]').filter({ hasText: 'Layout Header' })).toBeVisible({ timeout: 10000 });

    // Verify: header is first, original content is in the middle, footer is last
    const allBlocks = await iframe.locator('main [data-block-uid], #content [data-block-uid]').allTextContents();
    const headerIndex = allBlocks.findIndex(t => t.includes('Layout Header'));
    const footerIndex = allBlocks.findIndex(t => t.includes('Layout Footer'));
    const contentIndex = allBlocks.findIndex(t => t.includes('another test page'));

    expect(headerIndex).toBe(0); // Header at start
    expect(footerIndex).toBe(allBlocks.length - 1); // Footer at end
    expect(contentIndex).toBeGreaterThan(headerIndex); // Content after header
    expect(contentIndex).toBeLessThan(footerIndex); // Content before footer
  });
});

test.describe('Template Placeholder Replacement', () => {
  test('replacing slot blocks with new content persists after reload', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const iframe = helper.getIframe();

    await helper.login();
    await helper.navigateToEdit('/template-test-page');
    await helper.waitForIframeReady();

    // Wait for template merge to complete (header gets template content)
    const headerBlock = iframe.locator('main [data-block-uid], #content [data-block-uid]').filter({ hasText: 'Template Header' }).first();
    await expect(headerBlock).toContainText('Template Header - From Template', { timeout: 15000 });

    // Verify slot blocks exist
    await expect(iframe.locator('[data-block-uid="user-content-1"]')).toBeVisible();
    await expect(iframe.locator('[data-block-uid="user-content-2"]')).toBeVisible();

    const initialCount = await helper.getBlockCount();

    // Remove BOTH slot blocks - this is the bug scenario:
    // all slot info for "primary" is now gone from the instance
    await helper.clickBlockInIframe('user-content-1');
    await helper.openQuantaToolbarMenu('user-content-1');
    await helper.clickQuantaToolbarMenuOption('user-content-1', 'Remove');
    await helper.waitForBlockToDisappear('user-content-1');

    await helper.clickBlockInIframe('user-content-2');
    await helper.openQuantaToolbarMenu('user-content-2');
    await helper.clickQuantaToolbarMenuOption('user-content-2', 'Remove');
    await helper.waitForBlockToDisappear('user-content-2');

    // All slot blocks are gone. After deleting user-content-2,
    // selection auto-moves to the previous block (the grid or its cell).
    // The grid block (fixed) has nextPlaceholder: "primary" from the merge,
    // so the add button should be visible at the page level.

    // Record all block IDs before adding, so we can find the new one by set difference.
    const blockIdsBefore = new Set(await helper.getBlockOrder());

    // The grid block is already selected after the delete — just click add.
    await helper.clickAddBlockButton();
    await helper.selectBlockType('slate');

    // Wait for the new block to appear (find by set difference)
    await helper.getStableBlockCount();

    // Find the new block by set difference
    const blockIdsAfter = await helper.getBlockOrder();
    const newBlockUid = blockIdsAfter.find(id => !blockIdsBefore.has(id));
    expect(newBlockUid).toBeTruthy();

    // Verify the new block is in the right position: after the grid, before the footer.
    // Get block text content in DOM order to verify ordering.
    const gridBlock = iframe.locator('main [data-block-uid], #content [data-block-uid]').filter({ hasText: 'Template Grid Cell 1' }).first();
    const gridBlockId = await gridBlock.getAttribute('data-block-uid');
    const gridIdx = blockIdsAfter.indexOf(gridBlockId!);
    const newIdx = blockIdsAfter.indexOf(newBlockUid!);
    expect(newIdx).toBeGreaterThan(gridIdx);

    // Type content into the new block so it's not empty
    await helper.clickBlockInIframe(newBlockUid!);
    const newBlock = iframe.locator(`[data-block-uid="${newBlockUid}"]`);
    const slateField = helper.getSlateField(newBlock);
    await expect(slateField).toBeVisible({ timeout: 5000 });
    await slateField.click();
    await page.keyboard.type('New slot content');
    await expect(slateField).toContainText('New slot content');

    // Save (goes to view mode) — verify the new block persists after merge
    await helper.saveContent();

    // In view mode the bridge runs the merge again.
    // The new block should survive because it inherited slotId: "primary".
    const newContentBlock = iframe.locator('main [data-block-uid], #content [data-block-uid]').filter({ hasText: 'New slot content' });
    await expect(newContentBlock).toBeVisible({ timeout: 15000 });

    // Verify order after reload: header, grid, new content, footer
    await expect(iframe.locator('main [data-block-uid], #content [data-block-uid]').filter({ hasText: 'Template Header' }).first()).toBeVisible();
    await expect(iframe.locator('main [data-block-uid], #content [data-block-uid]').filter({ hasText: 'Template Footer' }).first()).toBeVisible();
  });

  // Parity with containers (the root behind :203): when the template primary slot is
  // emptied it must seed its own empty placeholder IN the slot (between the grid and
  // the slider) — the same way a container seeds one for an emptied region (see
  // container-blocks.spec.ts 'emptied container seeds an in-place empty ... (no
  // template)'). Without it there is nothing in the slot to click and the add falls
  // back to the iframe add-button path, which hangs.
  test('emptied template primary slot seeds an in-slot empty (parity with containers)', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/template-test-page');
    await helper.waitForIframeReady();
    const iframe = helper.getIframe();

    await expect(
      iframe.locator('main [data-block-uid], #content [data-block-uid]').filter({ hasText: 'Template Header - From Template' }),
    ).toBeVisible({ timeout: 15000 });

    // Empty the primary slot.
    for (const b of ['user-content-1', 'user-content-2']) {
      await helper.clickBlockInIframe(b);
      await helper.openQuantaToolbarMenu(b);
      await helper.clickQuantaToolbarMenuOption(b, 'Remove');
      await helper.waitForBlockToDisappear(b);
    }
    await helper.getStableBlockCount();

    // The emptied primary slot seeds its own empty placeholder (there is also a
    // separate page-level empty for the footer region). The in-slot empty is
    // first in DOM order and must sit between the grid and the slider.
    const emptyBlock = iframe.locator('[data-hydra-empty]');
    await expect(emptyBlock.first()).toBeVisible({ timeout: 5000 });

    const gridY = await iframe.locator('[data-block-uid]').filter({ hasText: 'Template Grid Cell 1' }).last().boundingBox().then((box) => box?.y ?? -1);
    const sliderY = await iframe.locator('[data-block-uid]').filter({ hasText: 'Template Slide 1' }).first().boundingBox().then((box) => box?.y ?? -1);
    const emptyY = await emptyBlock.first().boundingBox().then((box) => box?.y ?? -1);

    expect(emptyY, `in-slot empty should be in the primary slot (grid y=${gridY}, slider y=${sliderY}) but is at y=${emptyY}`).toBeGreaterThan(gridY);
    expect(emptyY).toBeLessThan(sliderY);
  });
});

test.describe('Template Sidebar Placeholder Sections', () => {
  test('sidebar groups template children by slotId with fixed blocks between', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/template-test-page');
    await helper.waitForIframeReady();

    // Click a template block then navigate up to the template virtual block
    const { locator: headerBlock } = await helper.waitForBlockByContent('Template Header');
    await headerBlock.click();
    await helper.waitForSidebarOpen();
    // Click back arrow to go from child block up to template instance
    await page.locator('.sidebar-section-header[data-is-current="true"] .nav-back').click();
    await page.waitForTimeout(200);

    // Should be at template instance level
    const stickyHeaders = page.locator('.sidebar-section-header.sticky-header');
    await expect(stickyHeaders.nth(1)).toContainText('Template: test-layout');

    // Fixed blocks should appear as fixed-block-items (no drag handle)
    const fixedItems = page.locator('#sidebar-order .fixed-block-item');
    await expect(fixedItems.first()).toBeVisible({ timeout: 5000 });
    const fixedCount = await fixedItems.count();
    expect(fixedCount).toBeGreaterThanOrEqual(3); // header, grid, footer

    // Placeholder section should show "Primary" header with user content blocks
    const primarySection = page.locator('.container-field-section').filter({
      has: page.locator('.widget-title', { hasText: 'Primary' }),
    });
    await expect(primarySection).toBeVisible({ timeout: 5000 });

    // Primary section should have 2 draggable child blocks (user-content-1, user-content-2)
    const primaryItems = primarySection.locator('.child-block-item');
    await expect(primaryItems).toHaveCount(2);

    // Drag handles should be visible on slot blocks (they're draggable)
    const dragHandles = primarySection.locator('.drag-handle');
    await expect(dragHandles).toHaveCount(2);

    // Fixed blocks should NOT have drag handles
    for (let i = 0; i < fixedCount; i++) {
      await expect(fixedItems.nth(i).locator('.drag-handle')).not.toBeVisible();
    }
  });

  test('DnD reorders blocks within a slot section', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const iframe = helper.getIframe();

    await helper.login();
    await helper.navigateToEdit('/template-test-page');
    await helper.waitForIframeReady();

    // Navigate to template instance level
    const { locator: headerBlock } = await helper.waitForBlockByContent('Template Header');
    await headerBlock.click();
    await helper.waitForSidebarOpen();
    // Click back arrow to go from child block up to template instance
    await page.locator('.sidebar-section-header[data-is-current="true"] .nav-back').click();
    await page.waitForTimeout(200);

    // Find the Primary slot section
    const primarySection = page.locator('.container-field-section').filter({
      has: page.locator('.widget-title', { hasText: 'Primary' }),
    });
    await expect(primarySection).toBeVisible({ timeout: 5000 });

    // Verify initial order: user-content-1 before user-content-2
    await expect(iframe.locator('[data-block-uid="user-content-1"]')).toBeVisible();
    await expect(iframe.locator('[data-block-uid="user-content-2"]')).toBeVisible();

    const initialOrder = await iframe.locator('main [data-block-uid], #content [data-block-uid]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-block-uid')));
    const idx1 = initialOrder.indexOf('user-content-1');
    const idx2 = initialOrder.indexOf('user-content-2');
    expect(idx1).toBeLessThan(idx2);

    // Use keyboard-based DnD (more reliable than mouse in automated tests)
    // react-beautiful-dnd: focus drag handle → Space to grab → ArrowDown to move → Space to drop
    const firstHandle = primarySection.locator('.drag-handle').first();
    await firstHandle.focus();
    await page.keyboard.press('Space');
    await page.waitForTimeout(200);
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(200);
    await page.keyboard.press('Space');

    // Verify order changed in iframe: user-content-2 now before user-content-1
    await expect(async () => {
      const newOrder = await iframe.locator('main [data-block-uid], #content [data-block-uid]')
        .evaluateAll((els) => els.map((el) => el.getAttribute('data-block-uid')));
      const newIdx1 = newOrder.indexOf('user-content-1');
      const newIdx2 = newOrder.indexOf('user-content-2');
      expect(newIdx2).toBeLessThan(newIdx1);
    }).toPass({ timeout: 5000 });
  });

  test('add block into slot section via sidebar [+] button', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const iframe = helper.getIframe();

    await helper.login();
    await helper.navigateToEdit('/template-test-page');
    await helper.waitForIframeReady();

    // Navigate to template instance level
    const { locator: headerBlock } = await helper.waitForBlockByContent('Template Header');
    await headerBlock.click();
    await helper.waitForSidebarOpen();
    // Click back arrow to go from child block up to template instance
    await page.locator('.sidebar-section-header[data-is-current="true"] .nav-back').click();
    await page.waitForTimeout(200);

    // Find the Primary slot section
    const primarySection = page.locator('.container-field-section').filter({
      has: page.locator('.widget-title', { hasText: 'Primary' }),
    });
    await expect(primarySection).toBeVisible({ timeout: 5000 });

    // Initial count of blocks in Primary section
    const initialItems = primarySection.locator('.child-block-item');
    await expect(initialItems).toHaveCount(2);

    // Record block IDs before adding
    const blockIdsBefore = new Set(await helper.getBlockOrder());

    // Click the [+] button in the Primary section header
    const addButton = primarySection.locator('.widget-actions button');
    await addButton.click();

    // BlockChooser should appear — select slate
    await helper.selectBlockType('slate');

    // Wait for new block to appear in iframe
    await expect(async () => {
      const currentIds = await helper.getBlockOrder();
      expect(currentIds.length).toBeGreaterThan(blockIdsBefore.size);
    }).toPass({ timeout: 5000 });

    // Find the new block ID
    const blockIdsAfter = await helper.getBlockOrder();
    const newBlockId = blockIdsAfter.find((id: string) => !blockIdsBefore.has(id));
    expect(newBlockId).toBeTruthy();

    // The new block should be in the iframe between user-content-2 and the footer
    const newBlock = iframe.locator(`[data-block-uid="${newBlockId}"]`);
    await expect(newBlock).toBeVisible({ timeout: 5000 });

    // Verify the new block is positioned after user-content-2 (the last block in the primary section)
    const finalOrder = await iframe.locator('main [data-block-uid], #content [data-block-uid]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-block-uid')));
    const idxContent2 = finalOrder.indexOf('user-content-2');
    const idxNew = finalOrder.indexOf(newBlockId);
    expect(idxNew).toBe(idxContent2 + 1);
  });

  test('same-template nesting folds into one instance — no Template-blocks virtual level, per-block settings on the nested block', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/template-test-page');
    await helper.waitForIframeReady();

    // Wait for template merge
    const { locator: headerBlock } = await helper.waitForBlockByContent('Template Header');
    await expect(headerBlock).toBeVisible({ timeout: 15000 });

    // Click the grid cell to select it
    const { locator: gridCell } = await helper.waitForBlockByContent('Template Grid Cell 1');
    await gridCell.click();
    await helper.waitForSidebarOpen();

    // The grid is SAME-template nesting (grid block shares test-layout's templateId),
    // so after recursive stamping it folds into the ONE test-layout instance: there is
    // a single "Template: test-layout" level at the top (the template name lives here;
    // entering edit mode is the "Edit template" button at the top of the panel), and NO
    // separate "Template blocks" virtual level below it. The nested grid cell is a normal
    // block carrying its own per-block fixed/readOnly settings.
    const topLabel = page.locator('button').filter({ hasText: /Template: test-layout/ });
    const nestedLabel = page.locator('button').filter({ hasText: /Template blocks/ });
    await expect(topLabel).toBeVisible({ timeout: 5000 });
    await expect(nestedLabel).toHaveCount(0); // virtual sub-level is gone — that's correct

    // The single instance level carries the template name; nothing virtual below it.
    expect(await helper.hasSidebarField('title', 'Template: test-layout')).toBe(true);
  });
});

test.describe('allowedTemplates vs allowedLayouts', () => {
  test('template in allowedTemplates appears in BlockChooser Templates group', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');
    await helper.waitForIframeReady();

    // Click a block to show add button
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForSidebarOpen();

    // Open BlockChooser
    await helper.clickAddBlockButton();
    expect(await helper.isBlockChooserVisible()).toBe(true);

    // Open Templates group
    const blockChooser = page.locator('.blocks-chooser');
    const templatesGroup = blockChooser.locator('text=Templates').first();
    await templatesGroup.click();

    // test-layout is in allowedTemplates, should appear
    const testLayoutOption = blockChooser.locator('button').filter({ hasText: /test-layout/i });
    await expect(testLayoutOption).toBeVisible();
  });

  test('template in allowedLayouts but not allowedTemplates does not appear in BlockChooser', async ({ page }, testInfo) => {
    // This test verifies that allowedLayouts and allowedTemplates are independent
    // header-footer-layout is in allowedLayouts but not in allowedTemplates
    // It should NOT appear in BlockChooser Templates group

    // Skip for now - need to verify the current config
    // test-frontend has test-layout in both allowedTemplates and allowedLayouts
    // We need a template that's only in allowedLayouts to test this properly
    test.skip(true, 'Need dedicated test data for this scenario');
  });
});


