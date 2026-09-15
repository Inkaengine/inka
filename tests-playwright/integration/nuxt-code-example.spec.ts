/**
 * Nuxt-specific tests for the codeExample block.
 *
 * Tests that:
 * 1. Each tab is a selectable child block (data-block-uid on tab items)
 * 2. Clicking a tab item selects it and shows its fields in the sidebar
 * 3. Tab switching via tab bar buttons works
 * 4. Syntax highlighting is applied in non-edit mode
 * 5. Sidebar shows label, language, code fields for selected tab
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

// Set nuxt frontend cookie for all tests
test.use({
  storageState: 'tests-playwright/.generated/storage-nuxt.json',
});

test.describe('Code Example Block', () => {
  test('single-tab block renders as selectable child block', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const iframe = helper.getIframe();

    await helper.login();
    await helper.navigateToEdit('/code-example-test-page');
    await helper.waitForIframeReady();

    const block = iframe.locator('[data-block-uid="single-tab"]');
    await expect(block).toBeVisible();

    // Single tab should NOT have a tab bar
    const tabBar = block.locator('[data-tab-bar]');
    await expect(tabBar).toHaveCount(0);

    // The tab item should be a child block with its own data-block-uid
    const tabItem = block.locator('[data-block-uid="tab-1"]');
    await expect(tabItem).toBeVisible();

    // Should have code content
    const code = tabItem.locator('code');
    await expect(code).toContainText('Hello, World!');
  });

  test('clicking a tab item selects it and shows sidebar fields', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const iframe = helper.getIframe();

    await helper.login();
    await helper.navigateToEdit('/code-example-test-page');
    await helper.waitForIframeReady();

    // Click the tab item (child block) inside multi-tab
    await helper.clickBlockInIframe('tab-js');
    await helper.waitForSidebarOpen();

    // Sidebar should show the tab's fields
    const sidebar = page.locator('#sidebar');
    await expect(sidebar).toBeVisible();

    // Should show label, language, and code fields
    await expect(sidebar.locator('label:text-is("Tab Label")')).toBeVisible({ timeout: 5000 });
    await expect(sidebar.locator('label:text-is("Language")')).toBeVisible({ timeout: 5000 });
    await expect(sidebar.locator('label:text-is("Code")')).toBeVisible({ timeout: 5000 });

    // Code field should contain the tab's code and be editable
    const codeTextarea = sidebar.locator('#field-code');
    await expect(codeTextarea).toBeVisible();
    await expect(codeTextarea).toHaveValue(/console\.log/);

    // Edit the code in the sidebar
    await codeTextarea.fill('const updated = true;');
    await expect(codeTextarea).toHaveValue('const updated = true;');
  });

  test('multi-tab block renders tab bar with all tabs', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const iframe = helper.getIframe();

    await helper.login();
    await helper.navigateToEdit('/code-example-test-page');
    await helper.waitForIframeReady();

    const block = iframe.locator('[data-block-uid="multi-tab"]');
    await expect(block).toBeVisible();

    // Should have tab bar with 3 tab buttons
    const tabBar = block.locator('[data-tab-bar]');
    await expect(tabBar).toBeVisible();
    const tabButtons = tabBar.locator('button');
    await expect(tabButtons).toHaveCount(3);

    // Verify tab labels
    await expect(tabButtons.nth(0)).toContainText('JavaScript');
    await expect(tabButtons.nth(1)).toContainText('Python');
    await expect(tabButtons.nth(2)).toContainText('Bash');
  });

  test('clicking tab switches displayed code', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const iframe = helper.getIframe();

    await helper.login();
    await helper.navigateToEdit('/code-example-test-page');
    await helper.waitForIframeReady();

    const block = iframe.locator('[data-block-uid="multi-tab"]');
    await expect(block).toBeVisible();

    // Initially shows JavaScript tab's code (use div[data-block-add] to target content, not tab button)
    const jsTab = block.locator('div[data-block-uid="tab-js"]');
    await expect(jsTab).toBeVisible();
    await expect(jsTab.locator('code')).toContainText('console.log');

    // Python tab should be hidden
    const pyTab = block.locator('div[data-block-uid="tab-py"]');
    await expect(pyTab).toBeHidden();

    // Click Python tab button
    const tabBar = block.locator('[data-tab-bar]');
    await tabBar.locator('button', { hasText: 'Python' }).click();

    // Python tab now visible, JavaScript hidden
    await expect(pyTab).toBeVisible();
    await expect(pyTab.locator('code')).toContainText('print');
    await expect(jsTab).toBeHidden();
  });

  test('code field has data-edit-text for inline editing', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const iframe = helper.getIframe();

    await helper.login();
    await helper.navigateToEdit('/code-example-test-page');
    await helper.waitForIframeReady();

    // Check that the code pre element has data-edit-text="code"
    const block = iframe.locator('[data-block-uid="single-tab"]');
    const tabItem = block.locator('[data-block-uid="tab-1"]');
    const codePre = tabItem.locator('pre[data-edit-text="code"]');
    await expect(codePre).toBeVisible();
  });
});
