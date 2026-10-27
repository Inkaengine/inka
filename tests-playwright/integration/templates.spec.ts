/**
 * Integration tests for template functionality in Volto Hydra.
 *
 * Tests that:
 * 1. Template content is merged on page load (fixed blocks get content from template)
 * 2. Fixed template blocks show lock icon instead of drag handle
 * 3. Fixed template blocks cannot be edited or deleted
 * 4. Placeholder content remains fully editable
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';
import { URLS } from '../ports';

test.describe('Templates', () => {
  test('template content is merged on page load', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    const iframe = helper.getIframe();

    // Wait for the fixed template block (header) to be visible - find by content since block IDs are UUIDs
    const { locator: headerBlock } = await helper.waitForBlockByContent('Template Header');

    // The header should show content from the TEMPLATE, not the stale page content
    // Page has "Stale Header - Should Be Replaced By Merge"
    // Template has "Template Header - From Template"
    await expect(headerBlock).toContainText('Template Header - From Template');
    await expect(headerBlock).not.toContainText('Stale Header');

    // User content in placeholder should be preserved (not replaced)
    const userContent = iframe.locator('[data-block-uid="user-content-1"]');
    await expect(userContent).toContainText('User content - different from template default');
  });

  test('new fixed blocks from template are inserted during merge', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    const iframe = helper.getIframe();

    // Wait for merge to complete (header gets template content) - find by content
    const headerBlock = iframe.locator('main [data-block-uid], #content [data-block-uid]').filter({ hasText: 'Template Header' }).first();
    await expect(headerBlock).toContainText('Template Header - From Template', { timeout: 15000 });

    // The grid block exists in the template but NOT in the page's original data
    // It should be inserted during merge - find by .grid-row parent (grid block contains grid-row)
    const gridBlock = iframe.locator('[data-block-uid]:has(.grid-row)').filter({ hasText: 'Template Grid Cell 1' });
    await expect(gridBlock).toBeVisible();

    // Verify the grid block is positioned between header and user content
    // by checking the visual order on the page
    const { locator: header } = await helper.waitForBlockByContent('Template Header');
    const userContent1 = iframe.locator('[data-block-uid="user-content-1"]');

    const headerBox = await header.boundingBox();
    const gridBox = await gridBlock.boundingBox();
    const userContentBox = await userContent1.boundingBox();

    // Grid should be below header and above user content
    expect(gridBox!.y).toBeGreaterThan(headerBox!.y);
    expect(userContentBox!.y).toBeGreaterThan(gridBox!.y);
  });

  // A nested block without template fields is malformed and the merge drops it.
  // That content is broken on purpose, so the test makes it — in this login's
  // session, never as a committed fixture the content check would have to
  // excuse: a template whose grid holds one marked and one unmarked cell, and a
  // page that uses it.
  test('nested blocks without template fields are NOT synced from template', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    const token = (await page.context().cookies()).find((c) => c.name === 'auth_token')!.value;
    const create = (parent: string, data: object) =>
      page.request.post(`${URLS.mockApi}${parent}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
        data,
      });
    expect((await create('/_test_data/templates', {
        "@type": "Document",
        "id": "orphan-cell-layout",
        "title": "Orphan cell layout",
        "blocks": {
          "oc-header": {
            "@type": "slate",
            "value": [
              {
                "type": "p",
                "children": [
                  {
                    "text": "Orphan Cell Header"
                  }
                ]
              }
            ],
            "plaintext": "Orphan Cell Header",
            "templateId": "/_test_data/templates/orphan-cell-layout",
            "templateInstanceId": "orphan-cell-def-instance",
            "slotId": "header",
            "fixed": true,
            "readOnly": true
          },
          "oc-grid": {
            "@type": "gridBlock",
            "templateId": "/_test_data/templates/orphan-cell-layout",
            "templateInstanceId": "orphan-cell-def-instance",
            "slotId": "grid",
            "fixed": true,
            "readOnly": true,
            "blocks": {
              "oc-cell-1": {
                "@type": "slate",
                "value": [
                  {
                    "type": "p",
                    "children": [
                      {
                        "text": "Marked Grid Cell"
                      }
                    ]
                  }
                ],
                "plaintext": "Marked Grid Cell",
                "templateId": "/_test_data/templates/orphan-cell-layout",
                "templateInstanceId": "orphan-cell-def-instance",
                "slotId": "oc-cell-1",
                "fixed": true,
                "readOnly": true
              },
              "oc-cell-2": {
                "@type": "slate",
                "value": [
                  {
                    "type": "p",
                    "children": [
                      {
                        "text": "Unmarked Grid Cell"
                      }
                    ]
                  }
                ],
                "plaintext": "Unmarked Grid Cell"
              }
            },
            "blocks_layout": {
              "items": [
                "oc-cell-1",
                "oc-cell-2"
              ]
            }
          },
          "oc-main": {
            "@type": "slate",
            "value": [
              {
                "type": "p",
                "children": [
                  {
                    "text": ""
                  }
                ]
              }
            ],
            "plaintext": "",
            "templateId": "/_test_data/templates/orphan-cell-layout",
            "templateInstanceId": "orphan-cell-def-instance",
            "slotId": "primary",
            "fixed": false
          }
        },
        "blocks_layout": {
          "items": [
            "oc-header",
            "oc-grid",
            "oc-main"
          ]
        }
      })).status()).toBe(201);
    expect((await create('/_test_data', {
        "@type": "Document",
        "id": "orphan-cell-page",
        "title": "Orphan cell page",
        "blocks": {
          "oc-page-header": {
            "@type": "slate",
            "value": [
              {
                "type": "p",
                "children": [
                  {
                    "text": "Orphan Cell Header"
                  }
                ]
              }
            ],
            "plaintext": "Orphan Cell Header",
            "templateId": "/_test_data/templates/orphan-cell-layout",
            "templateInstanceId": "oc-inst",
            "slotId": "header",
            "fixed": true,
            "readOnly": true
          },
          "oc-page-content": {
            "@type": "slate",
            "value": [
              {
                "type": "p",
                "children": [
                  {
                    "text": "The page content"
                  }
                ]
              }
            ],
            "plaintext": "The page content",
            "templateId": "/_test_data/templates/orphan-cell-layout",
            "templateInstanceId": "oc-inst",
            "slotId": "primary"
          }
        },
        "blocks_layout": {
          "items": [
            "oc-page-header",
            "oc-page-content"
          ]
        }
      })).status()).toBe(201);

    await helper.navigateToEdit('/orphan-cell-page');
    const iframe = helper.getIframe();
    const gridBlock = iframe.locator('[data-block-uid]:has(.grid-row)').filter({ hasText: 'Marked Grid Cell' });
    await expect(gridBlock).toBeVisible({ timeout: 15000 });

    // The marked cell is synced; the unmarked one is not.
    await expect(gridBlock).toContainText('Marked Grid Cell');
    await expect(gridBlock).not.toContainText('Unmarked Grid Cell');
  });

  test('placeholder content is preserved during merge', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    const iframe = helper.getIframe();

    // Wait for merge to complete - find by content
    const headerBlock = iframe.locator('main [data-block-uid], #content [data-block-uid]').filter({ hasText: 'Template Header' }).first();
    await expect(headerBlock).toContainText('Template Header - From Template', { timeout: 15000 });

    // User content should have the PAGE's content, not the template default
    // Page has "User content - different from template default"
    // Template default is "Default placeholder content - should be replaced by user content"
    const userContent1 = iframe.locator('[data-block-uid="user-content-1"]');
    await expect(userContent1).toContainText('User content - different from template default');
    await expect(userContent1).not.toContainText('Default placeholder content');

    // Second user content block should also be preserved
    const userContent2 = iframe.locator('[data-block-uid="user-content-2"]');
    await expect(userContent2).toContainText('Second user content block in placeholder');
  });

  test('merged template content persists after editing placeholder', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    const iframe = helper.getIframe();

    // Wait for merged content to appear
    const { locator: headerBlock, blockId: headerBlockId } = await helper.waitForBlockByContent('Template Header');
    await expect(headerBlock).toContainText('Template Header - From Template', { timeout: 15000 });

    // Edit the placeholder content (user-content-1)
    await helper.clickBlockInIframe('user-content-1');
    await helper.waitForBlockSelectedInAdmin('user-content-1');

    const userBlock = iframe.locator('[data-block-uid="user-content-1"]');
    const editor = helper.getSlateField(userBlock);
    await expect(editor).toHaveAttribute('contenteditable', 'true', { timeout: 5000 });

    // Type something new
    await editor.click();
    await page.keyboard.type(' - EDITED');

    // Wait for the edit to propagate (FORM_DATA sent back to frontend)
    await page.waitForTimeout(500);

    // The merged template header should STILL show template content, not stale page content
    // This catches the bug where edits trigger a re-merge or reload
    await expect(headerBlock).toContainText('Template Header - From Template');
    await expect(headerBlock).not.toContainText('Stale Header');

    // Footer should also still have merged content
    const { locator: footerBlock, blockId: footerBlockId } = await helper.waitForBlockByContent('Template Footer');
    await expect(footerBlock).toContainText('Template Footer - From Template');
    await expect(footerBlock).not.toContainText('Stale Footer');
  });

  test('fixed template blocks show lock icon instead of drag handle', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    const iframe = helper.getIframe();

    // Wait for the fixed template block (header) to be visible
    // The template-test-page has pre-applied template with fixed header block
    await helper.waitForBlockByContent('Template Header');

    // Click the fixed template block
    const headerBlockId = await helper.clickBlockByContent('Template Header');

    // The toolbar is rendered in admin UI
    const toolbar = page.locator('.quanta-toolbar');
    await expect(toolbar).toBeVisible();

    // Lock icon should be visible instead of drag handle
    const lockIcon = toolbar.locator('.lock-icon');
    await expect(lockIcon).toBeVisible();

    // Drag handle should NOT be visible for fixed template blocks
    const dragHandle = toolbar.locator('.drag-handle');
    await expect(dragHandle).not.toBeVisible();
  });

  test('fixed template blocks cannot be edited', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    const iframe = helper.getIframe();

    // Wait for merged content to appear (template merge must complete)
    const { locator: headerBlock } = await helper.waitForBlockByContent('Template Header');
    await expect(headerBlock).toContainText('Template Header - From Template', { timeout: 15000 });

    // Click the fixed template block
    await helper.clickBlockByContent('Template Header');

    // 1. Check inline editing is disabled (contenteditable should not be true)
    const h1Element = headerBlock.locator('h1');
    await expect(h1Element).toBeVisible();
    const isEditable = await h1Element.getAttribute('contenteditable');
    expect(isEditable).not.toBe('true');

    // 2. Check toolbar has NO slate formatting buttons (Bold, Italic, etc.)
    const toolbarButtons = await helper.getQuantaToolbarButtons();
    const buttonTitles = toolbarButtons.filter(b => b.visible).map(b => b.title.toLowerCase());

    // Slate formatting buttons should NOT be visible for readonly blocks
    expect(buttonTitles).not.toContain('bold');
    expect(buttonTitles).not.toContain('italic');
    expect(buttonTitles).not.toContain('underline');
    expect(buttonTitles).not.toContain('strikethrough');

    // 3. The sidebar shows the block's content READ-ONLY — visible as static text,
    // but with no editable control (ReadOnlyForm). It used to show nothing at all.
    await helper.waitForSidebarOpen();
    const props = page.locator('#sidebar-properties');
    await expect(props.locator('.readonly-form')).toBeVisible({ timeout: 5000 });
    // The value is shown (read-only), and there's no editable input for it.
    await expect(props.locator('.field-wrapper-value .readonly-field-value')).toBeVisible();
    await expect(props.locator('input, textarea, [contenteditable="true"]')).toHaveCount(0);

    // 4. Try typing in iframe - nothing should happen
    await h1Element.click();
    const textBefore = await h1Element.textContent();
    await page.keyboard.type('SHOULD NOT APPEAR');
    const textAfter = await h1Element.textContent();
    expect(textAfter).toBe(textBefore);
  });

  test('fixed template blocks cannot be deleted', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    const iframe = helper.getIframe();

    // Wait for the fixed template block
    await helper.waitForBlockByContent('Template Header');

    // Click the fixed template block
    const headerBlockId = await helper.clickBlockByContent('Template Header');

    // Open the toolbar menu
    await helper.openQuantaToolbarMenu(headerBlockId);
    const menuOptions = await helper.getQuantaToolbarMenuOptions(headerBlockId);
    const optionLabels = menuOptions.map(o => o.toLowerCase());

    // Should NOT have delete/remove option
    expect(optionLabels).not.toContain('remove');
    expect(optionLabels).not.toContain('delete');
  });

  test('placeholder content is fully editable', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    const iframe = helper.getIframe();

    // Wait for user content block (in placeholder region)
    await expect(iframe.locator('[data-block-uid="user-content-1"]')).toBeVisible({ timeout: 15000 });

    // Click the user content block
    await helper.clickBlockInIframe('user-content-1');
    await helper.waitForBlockSelectedInAdmin('user-content-1');

    // The toolbar (in admin UI) should show drag handle (not lock)
    const toolbar = page.locator('.quanta-toolbar');
    const dragHandle = toolbar.locator('.drag-handle');
    await expect(dragHandle).toBeVisible();

    // Lock icon should NOT be visible
    const lockIcon = toolbar.locator('.lock-icon');
    await expect(lockIcon).not.toBeVisible();

    // Content should be editable
    const userBlock = iframe.locator('[data-block-uid="user-content-1"]');
    const editor = helper.getSlateField(userBlock);
    await expect(editor).toHaveAttribute('contenteditable', 'true', { timeout: 5000 });

    // Should have delete option in menu
    await helper.openQuantaToolbarMenu('user-content-1');
    const menuOptions = await helper.getQuantaToolbarMenuOptions('user-content-1');
    const optionLabels = menuOptions.map(o => o.toLowerCase());
    expect(optionLabels.some(o => o.includes('remove') || o.includes('delete'))).toBe(true);
  });

  // Phase 2: Virtual Container Tests

  test('sidebar shows template instance in hierarchy when selecting template block', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    const iframe = helper.getIframe();
    // Find header block by content - block IDs are UUIDs after template merge
    const { locator: headerBlock } = await helper.waitForBlockByContent('Template Header');

    // Click the template header block
    await headerBlock.click();
    await helper.waitForSidebarOpen();

    // Sidebar should show hierarchy: Page > Template Instance > Text (block title)
    // The template instance uses "Template: {path}" format
    const stickyHeaders = page.locator('.sidebar-section-header.sticky-header');
    await expect(stickyHeaders).toHaveCount(3);
    await expect(stickyHeaders.nth(0)).toContainText('Page');
    await expect(stickyHeaders.nth(1)).toContainText('Template: test-layout');
    await expect(stickyHeaders.nth(2)).toContainText('Text'); // slate block's display name
  });

  test('Escape key navigates up to template instance', async ({ page }) => {

    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    const iframe = helper.getIframe();
    // Find header block by content - block IDs are UUIDs after template merge
    const { locator: headerBlock } = await helper.waitForBlockByContent('Template Header');

    // Click the template header block
    await headerBlock.click();
    await helper.waitForSidebarOpen();

    // Initially 3 headers: Page > Template Instance > Slate
    const stickyHeaders = page.locator('.sidebar-section-header.sticky-header');
    await expect(stickyHeaders).toHaveCount(3);

    // Press Escape to navigate up to template instance
    await helper.escapeToParent();
    await page.waitForTimeout(200);

    // Now should have 2 headers: Page > Template Instance
    await expect(stickyHeaders).toHaveCount(2);
    await expect(stickyHeaders.nth(1)).toContainText('Template: test-layout');

    // Sidebar should show placeholder children of the template
    const childBlocksList = page.locator('.child-blocks-list');
    await expect(childBlocksList).toBeVisible();
  });

  test('dragging template instance moves all template blocks together', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    const iframe = helper.getIframe();
    // Wait for blocks to be visible - find by content since template blocks get new UUIDs
    await expect(iframe.locator('[data-block-uid="standalone-block-1"]')).toBeVisible({ timeout: 15000 });
    const { locator: headerBlock } = await helper.waitForBlockByContent('Template Header');
    const headerBlockId = await headerBlock.getAttribute('data-block-uid');

    // Find the grid block ID dynamically (it's a UUID generated during merge)
    const gridBlock = iframe.locator('[data-block-uid]:has(.grid-row)');
    await expect(gridBlock).toBeVisible({ timeout: 5000 });
    const gridBlockId = await gridBlock.getAttribute('data-block-uid');

    // Find the footer block ID dynamically
    const footerBlock = iframe.locator('main [data-block-uid], #content [data-block-uid]').filter({ hasText: 'Template Footer' }).first();
    const footerBlockId = await footerBlock.getAttribute('data-block-uid');

    // Get initial block order - verify key positions
    const initialOrder = await helper.getBlockOrder();
    expect(initialOrder[0]).toBe('standalone-block-1');
    expect(initialOrder[1]).toBe(headerBlockId);
    expect(initialOrder).toContain(gridBlockId);
    expect(initialOrder).toContain('user-content-1');
    expect(initialOrder).toContain(footerBlockId);

    // Select template header, then navigate up to template instance
    await headerBlock.click();
    await helper.waitForBlockSelectedInAdmin(headerBlockId!);
    await helper.escapeToParent();

    // Wait for the template instance toolbar to appear with a drag handle
    // Template instances are virtual (no DOM element), so just check toolbar visibility
    const toolbar = page.locator('.quanta-toolbar');
    const dragHandle = toolbar.locator('.drag-handle');
    await expect(dragHandle).toBeVisible({ timeout: 5000 });

    // Drag the template instance before standalone-block-1
    // This moves the entire template (header + user-content + footer) to the top
    const standaloneBlock1 = iframe.locator('[data-block-uid="standalone-block-1"]');
    await helper.dragBlockWithMouse(dragHandle, standaloneBlock1, false); // insertAfter=false means before

    // Get new block order - template blocks should all be at the top now
    const newOrder = await helper.getBlockOrder();
    // Template blocks should be first, followed by standalone blocks
    expect(newOrder[0]).toBe(headerBlockId);
    // Grid and grid cell positions may vary, but they should be before standalone-block-1
    const standaloneIndex = newOrder.indexOf('standalone-block-1');
    expect(newOrder.indexOf(footerBlockId!)).toBeLessThan(standaloneIndex);
    expect(newOrder.indexOf('user-content-1')).toBeLessThan(standaloneIndex);
    expect(newOrder.indexOf('user-content-2')).toBeLessThan(standaloneIndex);
  });

  test('cannot insert blocks between two fixed template blocks', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    const iframe = helper.getIframe();

    // Wait for merged content to appear
    const { locator: templateHeader } = await helper.waitForBlockByContent('Template Header - From Template');

    // Find the grid block (UUID-based ID)
    const gridBlock = iframe.locator('[data-block-uid]:has(.grid-row)');
    await expect(gridBlock).toBeVisible({ timeout: 5000 });
    const gridBlockId = await gridBlock.getAttribute('data-block-uid');

    // Select the template header (first fixed block)
    // template-header is followed by the grid block (both fixed)
    const headerBlockId = await helper.clickBlockByContent('Template Header');

    // The add button should NOT be visible because you can't insert
    // between two adjacent fixed blocks
    const addButton = page.locator('.volto-hydra-add-button');
    await expect(addButton).not.toBeVisible();

    // Verify blocks are still adjacent (no blocks in between)
    const blockOrder = await helper.getBlockOrder();
    const headerIndex = blockOrder.indexOf(headerBlockId);
    const gridIndex = blockOrder.indexOf(gridBlockId!);
    expect(gridIndex).toBe(headerIndex + 1);
  });

  test('cannot insert blocks at container edges around fixed nested block', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    const iframe = helper.getIframe();

    // Wait for the grid block to be visible with merged content
    const gridBlock = iframe.locator('[data-block-uid]:has(.grid-row)');
    await expect(gridBlock).toBeVisible({ timeout: 15000 });

    // Find the grid cell by its content - use .grid-cell class to distinguish from parent
    const gridCell = iframe.locator('.grid-cell[data-block-uid]').filter({ hasText: 'Template Grid Cell 1' });
    await expect(gridCell).toBeVisible();
    const gridCellId = await gridCell.getAttribute('data-block-uid');

    // Click on the fixed grid cell (it's the only block in the grid, so it's at both edges)
    await helper.clickBlockInIframe(gridCellId!);
    await helper.waitForBlockSelectedInAdmin(gridCellId!);

    // The add button should NOT be visible because:
    // 1. It's a fixed block at the end of the container (no placeholder after it)
    // 2. Can't insert between fixed block and container edge
    const addButton = page.locator('.volto-hydra-add-button');
    await expect(addButton).not.toBeVisible();
  });

  test('cannot drag block between two fixed template blocks', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    const iframe = helper.getIframe();

    // Wait for blocks to be visible
    await expect(iframe.locator('[data-block-uid="standalone-block-1"]')).toBeVisible({ timeout: 15000 });
    const { blockId: headerBlockId } = await helper.waitForBlockByContent('Template Header');

    // Find the grid block (UUID-based ID)
    const gridBlock = iframe.locator('[data-block-uid]:has(.grid-row)');
    await expect(gridBlock).toBeVisible();
    const gridBlockId = await gridBlock.getAttribute('data-block-uid');

    // Get initial block order - header and grid should be adjacent
    const initialOrder = await helper.getBlockOrder();
    expect(initialOrder.indexOf(headerBlockId) + 1).toBe(initialOrder.indexOf(gridBlockId!));

    // Select the standalone block (not fixed)
    await helper.clickBlockInIframe('standalone-block-1');
    await helper.waitForSidebarOpen();

    // Get drag handle and start drag
    const dragHandle = await helper.getDragHandle();
    const handleBox = await dragHandle.boundingBox();
    expect(handleBox).not.toBeNull();

    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
    await page.mouse.down();

    // Move to after template-header (which is followed by the grid block, also fixed)
    const { locator: headerBlock } = await helper.waitForBlockByContent('Template Header');
    const headerBox = await headerBlock.boundingBox();
    expect(headerBox).not.toBeNull();

    // Position for "insert after" - bottom area of header block
    await page.mouse.move(
      headerBox!.x + headerBox!.width / 2,
      headerBox!.y + headerBox!.height * 0.75,
      { steps: 10 },
    );

    // Drop indicator should NOT be positioned between header and grid
    // (it may appear elsewhere, like before the header, but not in the gap)
    const dropIndicator = iframe.locator('.volto-hydra-drop-indicator');
    const gridBox = await gridBlock.boundingBox();
    expect(gridBox).not.toBeNull();

    // If indicator is visible, verify it's NOT between header and grid
    const indicatorVisible = await dropIndicator.isVisible();
    if (indicatorVisible) {
      const indicatorBox = await dropIndicator.boundingBox();
      if (indicatorBox) {
        // Indicator should NOT be in the gap between header bottom and grid top
        const headerBottom = headerBox!.y + headerBox!.height;
        const gridTop = gridBox!.y;
        const indicatorCenter = indicatorBox.y + indicatorBox.height / 2;

        // Indicator should be either above header or below grid, not in between
        const isBetweenFixedBlocks = indicatorCenter > headerBottom - 10 && indicatorCenter < gridTop + 10;
        expect(isBetweenFixedBlocks).toBe(false);
      }
    }

    // Also move over the grid and check - indicator should NOT show before grid (between header and grid)
    await page.mouse.move(
      gridBox!.x + gridBox!.width / 2,
      gridBox!.y + gridBox!.height * 0.25, // Top area of grid = "insert before"
      { steps: 10 },
    );

    // Check indicator position when hovering over grid
    const indicatorVisible2 = await dropIndicator.isVisible();
    if (indicatorVisible2) {
      const indicatorBox2 = await dropIndicator.boundingBox();
      if (indicatorBox2) {
        const headerBottom = headerBox!.y + headerBox!.height;
        const gridTop = gridBox!.y;
        const indicatorCenter2 = indicatorBox2.y + indicatorBox2.height / 2;

        // Indicator should NOT be between header and grid
        const isBetweenFixedBlocks2 = indicatorCenter2 > headerBottom - 10 && indicatorCenter2 < gridTop + 10;
        expect(isBetweenFixedBlocks2).toBe(false);
      }
    }

    // Drop
    await page.mouse.up();

    // Verify block order - template-header and grid should still be adjacent
    const newOrder = await helper.getBlockOrder();
    const headerIndex = newOrder.indexOf(headerBlockId);
    const gridIndex = newOrder.indexOf(gridBlockId!);

    // The key assertion: header and grid must remain adjacent
    expect(gridIndex).toBe(headerIndex + 1);
  });

  test('can drag block into placeholder region', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    const iframe = helper.getIframe();

    // Wait for blocks to be visible
    await expect(iframe.locator('[data-block-uid="standalone-block-2"]')).toBeVisible({ timeout: 15000 });
    await expect(iframe.locator('[data-block-uid="user-content-1"]')).toBeVisible();

    // Get the footer block ID dynamically (template blocks get new UUIDs)
    const { blockId: footerBlockId } = await helper.waitForBlockByContent('Template Footer');

    // Get initial block order - standalone-block-2 should be after template-footer
    const initialOrder = await helper.getBlockOrder();
    expect(initialOrder.indexOf('standalone-block-2')).toBeGreaterThan(initialOrder.indexOf(footerBlockId));

    // Wait for all template blocks to finish rendering
    await helper.getStableBlockCount();

    // Drag standalone-block-2 to after user-content-1 (which is in the placeholder region)
    await helper.dragBlockAfter('standalone-block-2', 'user-content-1');

    // Wait for standalone-block-2 to appear right after user-content-1
    // (async frameworks may take multiple frames to re-render template-expanded blocks)
    await expect(async () => {
      const newOrder = await helper.getBlockOrder();
      const newUserContentIndex = newOrder.indexOf('user-content-1');
      const newStandalone2Index = newOrder.indexOf('standalone-block-2');
      expect(newStandalone2Index).toBe(newUserContentIndex + 1);
    }).toPass({ timeout: 10000 });
  });

  test('inserted template fixed blocks render when not in allowedLayouts', async ({ page }) => {
    // Bug: When allowedLayouts is set (e.g. [null, '/templates/test-layout', ...])
    // and the page contains an inserted template whose templateId is NOT in allowedLayouts,
    // expandTemplatesSync overrides templateId to allowedLayouts[0] (null) and nulls
    // existingInstanceId, causing the template removal flow to strip fixed blocks.
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/inserted-template-test-page');

    const iframe = helper.getIframe();

    // The regular (non-template) blocks should always render
    await expect(iframe.locator('[data-block-uid="regular-block-1"]')).toBeVisible({ timeout: 15000 });
    await expect(iframe.locator('[data-block-uid="regular-block-2"]')).toBeVisible();

    // The snippet template's fixed+readOnly header block should be visible
    // with content from the TEMPLATE (not the stale page content).
    // BUG: allowedLayouts causes this block to be stripped entirely.
    const { locator: snippetHeader } = await helper.waitForBlockByContent('Snippet Header');
    await expect(snippetHeader).toContainText('Snippet Header - From Template');

    // The user content in the placeholder should also be preserved
    const snippetContent = iframe.locator('main [data-block-uid], #content [data-block-uid]').filter({ hasText: 'User snippet content' });
    await expect(snippetContent).toBeVisible();
  });

  test('template instance toolbar remains visible after scrolling', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    const iframe = helper.getIframe();

    // Wait for template blocks to be visible
    await helper.waitForBlockByContent('Template Header');

    // Select template header, then Escape to navigate up to template instance
    const headerBlockId = await helper.clickBlockByContent('Template Header');
    await helper.escapeToParent();

    // Find the footer block to get its ID for toolbar positioning
    const { blockId: footerBlockId } = await helper.waitForBlockByContent('Template Footer');

    // Template instance child block IDs (the outline should cover all of these)
    // Use the dynamic IDs we found, plus the user content blocks which have fixed IDs
    const templateChildBlocks = [headerBlockId, 'user-content-1', 'user-content-2', footerBlockId];

    // Wait for template instance toolbar to be positioned correctly
    await helper.waitForBlockSelectedInAdmin(templateChildBlocks);

    // Scroll the iframe content down
    await iframe.locator('body').evaluate((body) => body.ownerDocument.defaultView?.scrollBy(0, 200));

    // After scrolling, the toolbar should still be visible and positioned
    // correctly for the template instance.
    await helper.waitForBlockSelectedInAdmin(templateChildBlocks);
  });
});
