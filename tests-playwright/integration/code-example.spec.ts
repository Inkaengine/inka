/**
 * Tests for the codeExample block using the mock test frontend.
 *
 * Tests that:
 * 1. Each tab renders as a child block with data-block-uid
 * 2. Clicking a tab selects it and shows sidebar fields (label, language, code)
 * 3. Editing code in the sidebar textarea updates the iframe
 * 4. Enter key inserts a newline in <pre> (not a <div>)
 * 5. Tab key inserts spaces in <pre> (not focus change)
 * 6. Single-tab block shows no tab bar
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

test.describe('Code Example Block', () => {
  test('single-tab: no tab bar, tab item is selectable child block', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const iframe = helper.getIframe();

    await helper.login();
    await helper.navigateToEdit('/code-example-test-page');
    await helper.waitForIframeReady();

    const block = iframe.locator('[data-block-uid="single-tab"]');
    await expect(block).toBeVisible();

    // No tab bar for single tab
    await expect(block.locator('[data-tab-bar]')).toHaveCount(0);

    // Tab is a child block
    const tabItem = block.locator('[data-block-uid="tab-1"]');
    await expect(tabItem).toBeVisible();

    // Code is in a <pre> with data-edit-text="code"
    const codePre = tabItem.locator('pre[data-edit-text="code"]');
    await expect(codePre).toBeVisible();
    await expect(codePre).toContainText('Hello, World!');
  });

  test('multi-tab: tab bar shows all tabs', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const iframe = helper.getIframe();

    await helper.login();
    await helper.navigateToEdit('/code-example-test-page');
    await helper.waitForIframeReady();

    const block = iframe.locator('[data-block-uid="multi-tab"]');
    await expect(block).toBeVisible();

    const tabBar = block.locator('[data-tab-bar]');
    await expect(tabBar).toBeVisible();
    const buttons = tabBar.locator('button');
    await expect(buttons).toHaveCount(3);
    await expect(buttons.nth(0)).toContainText('JavaScript');
    await expect(buttons.nth(1)).toContainText('Python');
    await expect(buttons.nth(2)).toContainText('Bash');
  });

  // The label on a tab's button is editable — that is the whole point of putting
  // it there rather than on the panel. Every other tab test clicks the BUTTON;
  // none of them clicked the label, so the editable-label feature shipped with
  // no coverage at all, and block-sanity was the only thing catching it.
  test('clicking an inactive tab\'s label switches to it and puts the caret in the label', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);
    const iframe = helper.getIframe();

    await helper.login();
    await helper.navigateToEdit('/code-example-test-page');
    await helper.waitForIframeReady();

    const block = iframe.locator('[data-block-uid="multi-tab"]');
    await expect(block).toBeVisible();
    // Python starts hidden — clicking its label has to reveal it, exactly as
    // clicking its button does.
    await expect(block.locator('[data-block-uid="tab-py"]')).toBeHidden();

    const pythonLabel = block
      .locator('[data-tab-bar] button', { hasText: 'Python' })
      .locator('[data-edit-text="label"]');
    await pythonLabel.click();

    await expect(
      block.locator('[data-block-uid="tab-py"]'),
      'clicking a tab label should switch to that tab',
    ).toBeVisible({ timeout: 5000 });

    await expect(
      pythonLabel,
      'the label the author clicked should be editable',
    ).toHaveAttribute('contenteditable', 'true', { timeout: 5000 });

    // Editable is not enough — the caret has to be IN it, or the first
    // keystroke goes somewhere else.
    await expect
      .poll(
        () =>
          pythonLabel
            .evaluate((node) => {
              const doc = node.ownerDocument;
              if (doc.activeElement !== node) return `activeElement=${doc.activeElement?.tagName}`;
              const sel = doc.getSelection();
              if (!sel || sel.rangeCount === 0) return 'no selection';
              return node.contains(sel.getRangeAt(0).startContainer)
                ? 'caret in label'
                : 'caret elsewhere';
            })
            .catch((e) => `evaluate failed: ${String(e).slice(0, 60)}`),
        { timeout: 5000, message: 'clicking a tab label should put the caret in it' },
      )
      .toBe('caret in label');
  });

  test('clicking tab item opens sidebar with label, language, code fields', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/code-example-test-page');
    await helper.waitForIframeReady();

    await helper.clickBlockInIframe('tab-js');
    await helper.waitForSidebarOpen();

    const sidebar = page.locator('#sidebar');
    await expect(sidebar.locator('label:text-is("Tab Label")')).toBeVisible({ timeout: 5000 });
    await expect(sidebar.locator('label:text-is("Language")')).toBeVisible({ timeout: 5000 });
    await expect(sidebar.locator('label:text-is("Code")')).toBeVisible({ timeout: 5000 });

    // Code textarea should have the JS code
    const codeTextarea = sidebar.locator('#field-code');
    await expect(codeTextarea).toBeVisible();
    await expect(codeTextarea).toHaveValue(/console\.log/);
  });

  test('editing code in sidebar updates iframe', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const iframe = helper.getIframe();

    await helper.login();
    await helper.navigateToEdit('/code-example-test-page');
    await helper.waitForIframeReady();

    // Click the single-tab code block's tab
    await helper.clickBlockInIframe('tab-1');
    await helper.waitForSidebarOpen();

    const sidebar = page.locator('#sidebar');
    const codeTextarea = sidebar.locator('#field-code');
    await expect(codeTextarea).toBeVisible();

    // Edit the code in sidebar
    await codeTextarea.fill('const updated = true;');

    // Verify iframe updates with new code
    const tabItem = iframe.locator('[data-block-uid="tab-1"]');
    await expect(tabItem.locator('pre')).toContainText('const updated = true;', { timeout: 5000 });
  });

  test('Enter key in <pre> inserts newline, not <div>', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const iframe = helper.getIframe();

    await helper.login();
    await helper.navigateToEdit('/code-example-test-page');
    await helper.waitForIframeReady();

    // Click into the code area of single-tab
    await helper.clickBlockInIframe('tab-1');
    await helper.waitForSidebarOpen();

    const tabItem = iframe.locator('[data-block-uid="tab-1"]');
    const codePre = tabItem.locator('pre[data-edit-text="code"]');
    await expect(codePre).toBeVisible();

    // Click into the code to get cursor there
    await codePre.click();
    await helper.waitForEditorFocus(codePre);

    // Press End to go to end of first line, then Enter
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('// new line');

    // Check that no <div> elements were inserted inside the pre
    const divCount = await codePre.locator('div').count();
    expect(divCount).toBe(0);

    // The new line text should be present
    await expect(codePre).toContainText('// new line');
  });

  test('Tab key in <pre> inserts spaces, not focus change', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const iframe = helper.getIframe();

    await helper.login();
    await helper.navigateToEdit('/code-example-test-page');
    await helper.waitForIframeReady();

    await helper.clickBlockInIframe('tab-1');
    await helper.waitForSidebarOpen();

    const tabItem = iframe.locator('[data-block-uid="tab-1"]');
    const codePre = tabItem.locator('pre[data-edit-text="code"]');
    await codePre.click();
    await helper.waitForEditorFocus(codePre);

    // Move cursor to start using helper, then press Tab
    await helper.moveCursorToStart(codePre);
    await page.keyboard.press('Tab');

    // Pre should now contain the spaces at the start
    const textContent = await codePre.evaluate((el: any) => el.textContent);
    expect(textContent).toMatch(/^ {2}/); // starts with 2 spaces
  });

  // End-to-end guard for the object_list field-default seed: the codeExample `tabs` field
  // declares a `default` of one JavaScript tab. Adding a new codeExample must keep that
  // default — applyBlockDefaults populates it, and the container initializer must NOT replace
  // it with a blank item. Regression: initializeContainerBlock used to overwrite it.
  test('adding a codeExample seeds its schema-default tab (JavaScript), not a blank', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Capture the page save so we can inspect the new codeExample's persisted data.
    let savedBlocks: Record<string, any> | null = null;
    page.on('request', (req) => {
      if (req.method() !== 'PATCH' || !/test-page/.test(req.url())) return;
      try {
        const body = req.postDataJSON();
        if (body?.blocks) savedBlocks = body.blocks;
      } catch {
        /* not JSON */
      }
    });

    await helper.clickBlockInIframe('block-1-uuid');
    await helper.clickAddBlockButton();
    await helper.selectBlockType('codeExample');
    // Wait for the new codeExample to render (its seeded tab's code area) before saving.
    await expect(
      helper.getIframe().locator('pre[data-edit-text="code"]').first(),
    ).toBeAttached({ timeout: 10000 });
    await helper.saveContent();

    await expect
      .poll(
        () =>
          !!savedBlocks &&
          Object.values(savedBlocks).some((b: any) => b['@type'] === 'codeExample'),
        { message: 'the saved page should contain the added codeExample block', timeout: 5000 },
      )
      .toBe(true);

    const codeBlock = Object.values(savedBlocks!).find(
      (b: any) => b['@type'] === 'codeExample',
    ) as any;
    // The field default (one JavaScript tab) survived — not replaced by a blank item.
    expect(codeBlock.tabs).toHaveLength(1);
    expect(codeBlock.tabs[0].label).toBe('JavaScript');
  });
});
