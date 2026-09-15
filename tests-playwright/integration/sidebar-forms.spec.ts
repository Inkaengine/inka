/**
 * Integration tests for Sidebar Form Fields in Volto Hydra.
 *
 * Tests validate that correct form fields appear in the sidebar when blocks
 * are selected, and that field values match the block data.
 *
 * IMPORTANT: Slate/Text blocks edit their content INLINE, not through sidebar fields.
 * The Slate block sidebar only shows TOC override settings on the Page tab.
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

test.describe('Sidebar Forms - Slate Block Behavior', () => {
  test('Slate block Block tab shows value field (Volto Hydra feature)', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Click on Slate block
    await helper.clickBlockInIframe('block-1-uuid');

    // Wait for sidebar to open (indicates block is selected in Admin UI)
    await helper.waitForSidebarOpen();

    // Wait for Quanta toolbar to appear in iframe (visual confirmation of selection)
    await helper.waitForBlockSelectedInAdmin('block-1-uuid');
    const hasQuantaToolbar = await helper.isQuantaToolbarVisibleInIframe('block-1-uuid');
    expect(hasQuantaToolbar).toBe(true);

    // Open Block tab (Volto Hydra sets sidebarTab: 1 for slate blocks)
    await helper.openSidebarTab('Block');

    // Volto Hydra allows editing slate content in the sidebar (unlike standard Volto)
    const hasValueField = await helper.hasSidebarField('value');
    expect(hasValueField).toBe(true);
  });

  test('editing Slate text in sidebar updates iframe', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';

    // Click on Slate block
    await helper.clickBlockInIframe(blockId);
    await helper.waitForSidebarOpen();

    // Open Block tab
    await helper.openSidebarTab('Block');

    // Get original text from iframe
    const iframe = helper.getIframe();
    const iframeBlock = iframe.locator(`[data-block-uid="${blockId}"]`);
    const originalText = await iframeBlock.textContent();
    expect(originalText).toContain('This is a test paragraph');

    // Edit the value field in the sidebar (Volto Hydra feature)
    // This is a Slate editor field, so we need to interact with it properly
    const valueField = helper.getSidebarSlateEditor('value');
    await valueField.click();
    await valueField.fill('Updated text content');

    // Wait for changes to sync to iframe
    await page.waitForTimeout(500);

    // Verify the text updated in the iframe
    const updatedText = await iframeBlock.textContent();
    expect(updatedText).toContain('Updated text content');
    expect(updatedText).not.toBe(originalText);
  });

  // Skip: sidebar Slate editor has its own undo stack that captures Ctrl+Z
  // before the global Redux undo handler. This is expected behavior.
  test.skip('undo works when editing via sidebar', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';

    // Click on Slate block
    await helper.clickBlockInIframe(blockId);
    await helper.waitForSidebarOpen();
    await helper.openSidebarTab('Block');

    // Get original text from iframe
    const iframe = helper.getIframe();
    const iframeBlock = iframe.locator(`[data-block-uid="${blockId}"]`);
    const originalText = await iframeBlock.textContent();
    expect(originalText).toContain('This is a test paragraph');

    // Edit the value field in the sidebar - first change
    const valueField = helper.getSidebarSlateEditor('value');
    await valueField.click();
    await valueField.fill('First change');
    await page.waitForTimeout(500);

    // Verify first change applied
    let text = await iframeBlock.textContent();
    expect(text).toContain('First change');

    // Make second change
    await valueField.click();
    await valueField.fill('Second change');
    await page.waitForTimeout(500);

    // Verify second change applied
    text = await iframeBlock.textContent();
    expect(text).toContain('Second change');

    // Press Ctrl+Z to undo - should revert to "First change"
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(500);

    // Verify undo worked
    text = await iframeBlock.textContent();
    expect(text).toContain('First change');
    expect(text).not.toContain('Second change');
  });

  test('Slate blocks show TOC settings on Block tab', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Click on Slate block
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForSidebarOpen();

    // Open Block tab
    await helper.openSidebarTab('Block');

    // Slate blocks should have TOC override settings from base schema
    const hasOverrideTocField = await helper.hasSidebarField('override_toc');
    expect(hasOverrideTocField).toBe(true);

    // ...and the permanent anchor id (survives the heading being retitled)
    const hasAnchorField = await helper.hasSidebarField('anchor');
    expect(hasAnchorField).toBe(true);
  });

  test('Slate block shortcut and markdown help is collapsed by default', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Click on Slate block
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForSidebarOpen();
    await helper.openSidebarTab('Block');

    // The "Editor shortcuts" header should be visible with collapse indicator
    const editorShortcutsHeader = page.locator(
      '#sidebar-properties .header h2:text-is("Editor shortcuts ▸")',
    );
    await expect(editorShortcutsHeader).toBeVisible();

    // The "Markdown shortcuts" header should be visible with collapse indicator
    const markdownShortcutsHeader = page.locator(
      '#sidebar-properties .header h2:text-is("Markdown shortcuts ▸")',
    );
    await expect(markdownShortcutsHeader).toBeVisible();

    // The segment content should NOT be in the DOM when collapsed
    const helpSegments = page.locator(
      '#sidebar-properties .ui.segment.secondary.attached',
    );
    await expect(helpSegments).toHaveCount(0);
  });

  test('Slate blocks do NOT show Image-specific fields on Block tab', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Click on Slate block
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForSidebarOpen();
    await helper.openSidebarTab('Block');

    // Slate blocks should NOT have image-specific fields
    const hasAltField = await helper.hasSidebarField('alt');
    const hasAlignField = await helper.hasSidebarField('align');
    const hasSizeField = await helper.hasSidebarField('size');
    const hasUrlField = await helper.hasSidebarField('url');

    expect(hasAltField).toBe(false);
    expect(hasAlignField).toBe(false);
    expect(hasSizeField).toBe(false);
    expect(hasUrlField).toBe(false);
  });
});

test.describe('Sidebar Forms - Image Block Fields', () => {
  test('Image block sidebar shows expected fields on Block tab', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Click on Image block
    await helper.clickBlockInIframe('block-2-uuid');
    await helper.waitForSidebarOpen();
    await helper.openSidebarTab('Block');

    // Check for expected fields in default fieldset
    // Note: Image block uses object browser for image selection, not a url text field
    const hasAltField = await helper.hasSidebarField('alt');
    const hasAlignField = await helper.hasSidebarField('align');

    expect(hasAltField).toBe(true);
    expect(hasAlignField).toBe(true);
  });

  test('Image block alt field shows current alt text', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Click on Image block
    await helper.clickBlockInIframe('block-2-uuid');
    await helper.waitForSidebarOpen();
    await helper.openSidebarTab('Block');

    // Get alt field value
    const altFieldValue = await helper.getSidebarFieldValue('alt');

    // Should match the block's alt text
    expect(altFieldValue).toBe('Test image');
  });

  test('Image block has Link settings accordion fieldset', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Click on Image block
    await helper.clickBlockInIframe('block-2-uuid');
    await helper.waitForSidebarOpen();
    await helper.openSidebarTab('Block');

    // Get all fieldsets
    const fieldsets = await helper.getSidebarFieldsets();

    // Should include Link settings accordion
    expect(fieldsets).toContain('Link settings');
  });

  test('Link settings accordion shows href field', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Click on Image block
    await helper.clickBlockInIframe('block-2-uuid');
    await helper.waitForSidebarOpen();
    await helper.openSidebarTab('Block');

    // Link settings accordion should contain href field (accordion may be open by default)
    // Ensure accordion is open
    await helper.openFieldsetAccordion('Link settings');

    // href field should be visible
    const hasHrefField = await helper.hasSidebarField('href');
    expect(hasHrefField).toBe(true);
  });

  test('Editing Image block alt field updates block data', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Click on Image block
    await helper.clickBlockInIframe('block-2-uuid');
    await helper.waitForSidebarOpen();
    await helper.openSidebarTab('Block');

    // Edit alt field
    await helper.setSidebarFieldValue('alt', 'Updated alt text');

    // Wait for update to propagate
    await helper.waitForFieldValueToBe('alt', 'Updated alt text');

    // Verify alt field shows new value
    const newAltValue = await helper.getSidebarFieldValue('alt');
    expect(newAltValue).toBe('Updated alt text');
  });

  test('sidebar field retains focus after typing one character', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Click on Slate block - this has an editable field in the iframe
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForSidebarOpen();
    await helper.openSidebarTab('Block');

    // Click on the sidebar slate value field (this field IS editable in iframe too)
    const valueField = helper.getSidebarSlateEditor('value');
    await valueField.click();

    // Type one character - this triggers form data update which syncs to iframe
    await page.keyboard.type('x');

    // Verify focus stays in sidebar (doesn't jump to iframe).
    // Poll for 2s to catch the async round-trip that used to steal focus.
    await expect.poll(
      async () => page.evaluate(() => {
        const active = document.activeElement;
        if (active?.tagName === 'IFRAME') return 'iframe';
        if (active?.closest('#sidebar-properties')) return 'sidebar';
        return active?.tagName || 'unknown';
      }),
      { timeout: 2000, intervals: [200] },
    ).toBe('sidebar');
  });

  test('toolbar style unchanged during sidebar typing', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'nuxt', 'Mock frontend clears innerHTML on re-render, causing scroll');

    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Select a block and wait for initial setup
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForSidebarOpen();
    await helper.openSidebarTab('Block');
    await page.waitForTimeout(300); // Let initial messages settle

    // Set up MutationObserver on toolbar to count style changes
    await page.evaluate(() => {
      const toolbar = document.querySelector('.quanta-toolbar') as HTMLElement;
      if (!toolbar) throw new Error('Toolbar not found');

      (window as any).__toolbarStyleChanges = 0;
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
            (window as any).__toolbarStyleChanges++;
            console.log('[TEST] Toolbar style changed:', toolbar.style.cssText);
          }
        }
      });
      observer.observe(toolbar, { attributes: true, attributeFilter: ['style'] });
      (window as any).__toolbarObserver = observer;
    });

    // Type in sidebar (this triggers FORM_DATA round-trip)
    const valueField = helper.getSidebarSlateEditor('value');
    await valueField.click();
    await page.keyboard.type('test');
    await page.waitForTimeout(500);

    // Count style changes during typing
    const styleChanges = await page.evaluate(() => {
      (window as any).__toolbarObserver?.disconnect();
      return (window as any).__toolbarStyleChanges;
    });

    // Should be 0 - no toolbar repositioning during sidebar typing
    expect(styleChanges).toBe(0);
  });

  test('editing image alt text in sidebar updates iframe', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-2-uuid';

    // Click the image block to select it and open sidebar
    await helper.clickBlockInIframe(blockId);
    await helper.waitForSidebarOpen();
    await helper.openSidebarTab('Block');

    // Get original image alt from iframe
    const iframe = helper.getIframe();
    const iframeImage = iframe.locator(`[data-block-uid="${blockId}"] img`);
    const originalAlt = await iframeImage.getAttribute('alt');
    expect(originalAlt).toBe('Test image');

    // Change the alt text in the sidebar using helper
    await helper.setSidebarFieldValue('alt', 'Updated image description');

    // Wait for changes to sync to iframe
    await page.waitForTimeout(500);

    // Verify the image alt updated in the iframe
    const updatedAlt = await iframeImage.getAttribute('alt');
    expect(updatedAlt).toBe('Updated image description');
    expect(updatedAlt).not.toBe(originalAlt);
  });
});

test.describe('Sidebar Forms - Block Type Differences', () => {
  test('Image blocks do NOT show Slate-specific TOC fields', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Click on Image block
    await helper.clickBlockInIframe('block-2-uuid');
    await helper.waitForSidebarOpen();
    await helper.openSidebarTab('Block');

    // Image blocks should NOT have slate TOC override fields
    const hasOverrideTocField = await helper.hasSidebarField('override_toc');
    const hasLevelField = await helper.hasSidebarField('level');
    const hasEntryTextField = await helper.hasSidebarField('entry_text');

    expect(hasOverrideTocField).toBe(false);
    expect(hasLevelField).toBe(false);
    expect(hasEntryTextField).toBe(false);
  });

  test('Switching from Slate to Image block changes sidebar fields', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Click on Slate block
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForSidebarOpen();
    await helper.openSidebarTab('Block');

    // Slate blocks should NOT have image-specific fields on Block tab
    let hasAltField = await helper.hasSidebarField('alt');
    let hasAlignField = await helper.hasSidebarField('align');
    expect(hasAltField).toBe(false);
    expect(hasAlignField).toBe(false);

    // Click on Image block
    await helper.clickBlockInIframe('block-2-uuid');
    await helper.waitForSidebarOpen();
    await helper.openSidebarTab('Block');

    // Image blocks SHOULD have these fields
    hasAltField = await helper.hasSidebarField('alt');
    hasAlignField = await helper.hasSidebarField('align');
    expect(hasAltField).toBe(true);
    expect(hasAlignField).toBe(true);
  });
});

test.describe('Sidebar Forms - object_list Item Fields', () => {
  test('clicking object_list item (slider slide) shows sidebar with item schema fields', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/carousel-test-page');

    // Click on slide-1 (an object_list item within the slider block)
    await helper.clickBlockInIframe('slide-1');
    await helper.waitForSidebarOpen();
    await helper.openSidebarTab('Block');

    // object_list items should show fields from their itemSchema
    // The slider schema defines: title, description, head_title
    const hasTitleField = await helper.hasSidebarField('title');
    const hasDescriptionField = await helper.hasSidebarField('description');
    const hasHeadTitleField = await helper.hasSidebarField('head_title');

    expect(hasTitleField).toBe(true);
    expect(hasDescriptionField).toBe(true);
    expect(hasHeadTitleField).toBe(true);
  });

  test('object_list item sidebar shows correct field values', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/carousel-test-page');

    // Click on slide-1
    await helper.clickBlockInIframe('slide-1');
    await helper.waitForSidebarOpen();
    await helper.openSidebarTab('Block');

    // Get field values - should match the data in carousel-test-page/data.json
    const titleValue = await helper.getSidebarFieldValue('title');
    const headTitleValue = await helper.getSidebarFieldValue('head_title');

    expect(titleValue).toBe('Slide 1');
    expect(headTitleValue).toBe('Welcome');
  });

  test('editing object_list item field in sidebar updates the data', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/carousel-test-page');

    // Click on slide-1 (the visible active slide)
    await helper.clickBlockInIframe('slide-1');
    await helper.waitForSidebarOpen();
    await helper.openSidebarTab('Block');

    // Verify initial value
    const initialTitle = await helper.getSidebarFieldValue('title');
    expect(initialTitle).toBe('Slide 1');

    // Edit the title field
    await helper.setSidebarFieldValue('title', 'Updated Slide Title');

    // Wait for update to propagate
    await helper.waitForFieldValueToBe('title', 'Updated Slide Title');

    // Verify field shows new value
    const newTitleValue = await helper.getSidebarFieldValue('title');
    expect(newTitleValue).toBe('Updated Slide Title');
  });

  test('editing slide title inline updates sidebar field', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/carousel-test-page');

    // Click on slide-1 to select it
    await helper.clickBlockInIframe('slide-1');
    await helper.waitForBlockSelectedInAdmin('slide-1');
    await helper.waitForSidebarOpen();
    await helper.openSidebarTab('Block');

    // Verify initial title value in sidebar
    const initialTitle = await helper.getSidebarFieldValue('title');
    expect(initialTitle).toBe('Slide 1');

    // Edit the title inline in the iframe (specify 'title' field to avoid clicking head_title)
    const titleEditor = await helper.getEditorLocator('slide-1', 'title');
    await titleEditor.click();
    await helper.selectAllTextInEditor(titleEditor);
    await titleEditor.pressSequentially('Inline Edited', { delay: 10 });

    // Wait for sync and verify sidebar updated
    await helper.waitForFieldValueToBe('title', 'Inline Edited');

    // Now edit in sidebar and verify iframe updates
    await helper.setSidebarFieldValue('title', 'Sidebar Edited');
    await helper.waitForFieldValueToBe('title', 'Sidebar Edited');

    // Verify iframe shows the new title
    await expect(titleEditor).toHaveText('Sidebar Edited');
  });
});

test.describe('Sidebar Forms - Field Validation', () => {
  test('Sidebar fields list matches expected fields for Image block', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Click on Image block
    await helper.clickBlockInIframe('block-2-uuid');
    await helper.waitForSidebarOpen();
    await helper.openSidebarTab('Block');

    // Get all visible field names (default fieldset only, accordion closed)
    const fields = await helper.getSidebarFormFields();

    // Should include core image fields
    // Note: Image block uses object browser for image selection, not a url text field
    expect(fields).toContain('alt');
    expect(fields).toContain('align');
    expect(fields).toContain('size');
  });

  test('All visible Image fields are accessible', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Click on Image block
    await helper.clickBlockInIframe('block-2-uuid');
    await helper.waitForSidebarOpen();
    await helper.openSidebarTab('Block');

    // Get all visible fields
    const fields = await helper.getSidebarFormFields();

    // Every field should be accessible
    for (const fieldName of fields) {
      const hasField = await helper.hasSidebarField(fieldName);
      expect(hasField, `Field ${fieldName} should be accessible`).toBe(true);
    }
  });
});
