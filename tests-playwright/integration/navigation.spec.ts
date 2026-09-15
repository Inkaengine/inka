import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';
import { TEST_DATA_PREFIX } from '../helpers/test-paths';
import { PORTS, URLS } from '../ports';

test.describe('Navigation and URL Handling', () => {
  test('External URLs do not load in iframe', async ({ page }, testInfo) => {

    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Wait for iframe to have content
    const iframe = helper.getIframe();

    // Verify the test page loaded in the iframe (not an external URL)
    // Check for content that exists on test-page in both mock and Nuxt frontends
    await expect(iframe.locator('text=This is a test paragraph'), 'Iframe should load test page content').toBeVisible({ timeout: 10000 });

    // Get iframe element to check its src
    const iframeElement = page.locator('#previewIframe');
    const iframeSrc = await iframeElement.getAttribute('src');

    // Iframe src should exist and point to localhost
    expect(iframeSrc, 'Iframe src attribute should exist').toBeTruthy();
    expect(iframeSrc).toContain('localhost');
    expect(iframeSrc).not.toContain('example.com');
  });

  // Test hash-based routing with different URL formats
  const hashFormats = [
    { name: '#/', url: `${URLS.testFrontend}/#/`, expectedHash: `#${TEST_DATA_PREFIX}/test-page` },
    { name: '#!/', url: `${URLS.testFrontend}/#!/`, expectedHash: `#!${TEST_DATA_PREFIX}/test-page` },
  ];

  for (const format of hashFormats) {
    test(`Hash-based frontend routing works with ${format.name} format`, async ({ page }, testInfo) => {
      // Skip on Nuxt - this test uses the mock frontend which supports hash URLs
      test.skip(testInfo.project.name.includes('nuxt'), 'Mock frontend test only');

      const helper = new AdminUIHelper(page);

      await helper.login();
      await helper.navigateToEdit('/test-page');

      // Open frontend switcher panel
      await page.locator('#toolbar-frontend-switcher').click();
      const panel = page.locator('.frontend-switcher-panel');
      await expect(panel).toBeVisible({ timeout: 5000 });

      // Open settings modal to add the hash-based URL
      await panel.locator('.frontend-switcher-settings-btn').click();
      const modal = page.locator('.frontend-settings-modal');
      await expect(modal).toBeVisible({ timeout: 5000 });

      // Add the hash-based frontend URL
      const urlInput = modal.locator('.frontend-settings-url-input');
      await urlInput.fill(format.url);
      await modal.locator('.frontend-settings-add-btn').click();

      // Close the settings modal
      await modal.locator('.frontend-settings-close').click();
      await expect(modal).not.toBeVisible({ timeout: 5000 });

      // Ensure the panel is open and select the newly added URL
      if (!await panel.isVisible()) {
        await page.locator('#toolbar-frontend-switcher').click();
        await expect(panel).toBeVisible({ timeout: 5000 });
      }
      const hashUrlItem = panel.locator('.frontend-switcher-url-item', { hasText: format.url.replace(/^https?:\/\//, '') });
      await expect(hashUrlItem).toBeVisible({ timeout: 5000 });
      await hashUrlItem.click();

      // Wait for iframe to load with the hash-based URL
      const iframeElement = page.locator('#previewIframe');
      await iframeElement.waitFor({ state: 'visible', timeout: 10000 });

      // Verify iframe src uses hash-based URL format (hash comes after query params)
      // Note: _edit param is no longer used - edit mode is communicated via window.name
      await expect(async () => {
        const iframeSrc = await iframeElement.getAttribute('src');
        expect(iframeSrc, `Iframe src should contain ${format.expectedHash}`).toContain(format.expectedHash);
      }).toPass({ timeout: 10000 });

      // Verify iframe content shows the correct page
      const iframe = helper.getIframe();
      await expect(iframe.locator('h1:has-text("Test Page")')).toBeVisible({ timeout: 10000 });
      await expect(iframe.locator('text=This is a test paragraph')).toBeVisible({ timeout: 5000 });

      // Click a block and verify sidebar shows correct page data
      await iframe.locator('[data-block-uid]').first().click();
      await helper.waitForSidebarOpen();
      await expect(page.locator('.sidebar-container input[name="title"]')).toHaveValue('Test Page', { timeout: 5000 });
    });
  }

  test('Switching to hash-based frontend stays in edit mode', async ({ page }) => {
    // Requires F7 running on its dedicated port
    const response = await page.request.get(URLS.f7).catch(() => null);
    test.skip(!response?.ok(), `F7 not running on port ${PORTS.f7}`);

    // Reproduces production bug: F7 uses hash-bang routing (#!/path).
    // When switching to F7, the iframe should stay in edit mode and render content.
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');
    await helper.waitForIframeReady();

    // Open frontend switcher settings and add hash-based URL
    const switcherBtn = page.locator('#toolbar-frontend-switcher');
    await switcherBtn.click();
    const panel = page.locator('.frontend-switcher-panel');
    await expect(panel).toBeVisible();

    const settingsBtn = panel.locator('.frontend-switcher-settings-btn');
    await settingsBtn.click();

    const modal = page.locator('.frontend-settings-modal');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Add F7 hash-based URL
    const input = modal.locator('.frontend-settings-url-input');
    await input.fill(`${URLS.f7}/#!`);
    await modal.locator('.frontend-settings-add-btn').click();

    // Close modal
    await modal.locator('.frontend-settings-close').click();
    await expect(modal).not.toBeVisible({ timeout: 5000 });

    // Select the F7 URL in the switcher panel
    const f7Item = panel.locator('.frontend-switcher-url-item', { hasText: `localhost:${PORTS.f7}/#!` });
    await expect(f7Item).toBeVisible();
    await f7Item.click();

    // Wait for iframe to load F7 and render content
    const iframe = helper.getIframe();
    await expect(iframe.locator('[data-block-uid]').first()).toBeVisible({ timeout: 15000 });

    // Verify we're still in edit mode (URL ends with /edit)
    expect(page.url()).toContain('/edit');

    // Verify the iframe has F7 content (not a blank page or redirect)
    const blockCount = await iframe.locator('[data-block-uid]').count();
    expect(blockCount).toBeGreaterThan(0);
  });

  test('Navigation links work in iframe when clicking header nav', async ({ page }, testInfo) => {

    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');
    await helper.waitForSidebarOpen();

    // Wait for iframe content to be stable
    const iframe = helper.getIframe();
    await expect(iframe.locator('text=This is a test paragraph')).toBeVisible();

    // Open the "Test Data" mega menu to reveal its children.
    // Reveal "Test Data"'s children, then click one. The Nuxt mega-menu hides
    // them behind a chevron disclosure button (its title link navigates); the
    // mock frontend renders every child as an always-visible <a>. Open the
    // panel when that button exists, otherwise the child link is already shown.
    const testDataToggle = iframe.locator('nav').getByRole('button', { name: 'Show Test Data sections' });
    if (await testDataToggle.count()) await testDataToggle.click();

    // Click "Another Page" under Test Data (filter by href to avoid matching
    // a different "Another Page" in another section like Content Types)
    const navLink = iframe.locator('nav a[href*="_test_data"]').filter({ hasText: 'Another Page' }).first();
    await navLink.waitFor({ state: 'visible' });
    await navLink.click();

    // Verify the admin URL changed to reflect the new page (view mode)
    await expect(page).toHaveURL(/another-page/, { timeout: 10000 });

    // Verify the iframe navigated and rendered the new page content
    await expect(iframe.locator('main')).toBeVisible({ timeout: 10000 });
    await expect(iframe.locator('text=This is another test page')).toBeVisible({ timeout: 5000 });

    // Click Edit button to enter edit mode (navigateToEdit detects we're on view page)
    await helper.navigateToEdit('/another-page');

    // Verify we're now in edit mode
    await expect(page).toHaveURL(/another-page\/edit/, { timeout: 10000 });

    // Verify the iframe still shows the correct page content
    await expect(iframe.locator('main')).toBeVisible({ timeout: 10000 });
    await expect(iframe.locator('text=This is another test page')).toBeVisible({ timeout: 5000 });

    // Click a block and verify sidebar shows correct page title in the title input
    await iframe.locator('[data-block-uid]').first().click();
    await expect(page.locator('.sidebar-container input[name="title"]')).toHaveValue('Another Page', { timeout: 5000 });
  });

  test('Clicking linked image block in edit mode does not navigate', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');
    await helper.waitForSidebarOpen();

    const iframe = helper.getIframe();

    // Track if beforeunload dialog appears (it shouldn't - link should be prevented)
    let dialogAppeared = false;
    page.on('dialog', async (dialog) => {
      dialogAppeared = true;
      await dialog.accept();
    });

    // Find and click the linked image block (block-5-linked-image has href="https://example.com")
    const linkedImageBlock = iframe.locator('[data-block-uid="block-5-linked-image"]');
    await linkedImageBlock.waitFor({ state: 'visible', timeout: 5000 });

    // Click the image/link inside the block
    const imageOrLink = linkedImageBlock.locator('a, img').first();
    await imageOrLink.click();

    // Wait a moment to ensure no navigation occurs
    await page.waitForTimeout(500);

    // Verify we're still on the edit page - no navigation happened
    await expect(page).toHaveURL(/test-page\/edit/);

    // Verify no beforeunload warning appeared (link was prevented at click level)
    expect(dialogAppeared, 'No beforeunload warning should appear - link click should be prevented').toBe(false);

    // Verify the block got selected (Quanta toolbar should appear)
    await helper.waitForBlockSelectedInAdmin('block-5-linked-image');
  });

  test('Cancelling navigation warning stays on edit page', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');
    await helper.waitForSidebarOpen();

    // Set up dialog handler to dismiss (cancel) the beforeunload dialog
    page.on('dialog', async (dialog) => {
      expect(dialog.type()).toBe('beforeunload');
      await dialog.dismiss(); // Cancel navigation
    });

    // Try to navigate away by clicking a nav link in the iframe
    // First open the Test Data mega menu, then click a child link to trigger real navigation
    const iframe = helper.getIframe();
    // Reveal "Test Data"'s children, then click one. The Nuxt mega-menu hides
    // them behind a chevron disclosure button (its title link navigates); the
    // mock frontend renders every child as an always-visible <a>. Open the
    // panel when that button exists, otherwise the child link is already shown.
    const testDataToggle = iframe.locator('nav').getByRole('button', { name: 'Show Test Data sections' });
    if (await testDataToggle.count()) await testDataToggle.click();
    const navLink = iframe.locator('nav a[href*="_test_data"]').filter({ hasText: 'Accordion Test Page' }).first();
    await navLink.waitFor({ state: 'visible' });
    await navLink.click();

    // Give time for dialog to be handled
    await page.waitForTimeout(500);

    // Verify we're still on the edit page
    await expect(page).toHaveURL(/test-page\/edit/);
    await expect(page.locator('#sidebar-properties')).toBeVisible();
  });

  test('Confirming navigation warning leaves edit page', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');
    await helper.waitForSidebarOpen();

    // Wait for iframe content to be stable
    const iframe = helper.getIframe();
    await expect(iframe.locator('text=This is a test paragraph')).toBeVisible();

    // Set up dialog handler to accept all beforeunload dialogs
    page.on('dialog', async (dialog) => {
      if (dialog.type() === 'beforeunload') {
        await dialog.accept(); // Confirm navigation
      }
    });

    // Open Test Data mega menu, then click a child link to navigate away
    // Reveal "Test Data"'s children, then click one. The Nuxt mega-menu hides
    // them behind a chevron disclosure button (its title link navigates); the
    // mock frontend renders every child as an always-visible <a>. Open the
    // panel when that button exists, otherwise the child link is already shown.
    const testDataToggle = iframe.locator('nav').getByRole('button', { name: 'Show Test Data sections' });
    if (await testDataToggle.count()) await testDataToggle.click();
    const navLink = iframe.locator('nav a[href*="_test_data"]').filter({ hasText: 'Accordion Test Page' }).first();
    await navLink.waitFor({ state: 'visible' });
    await navLink.click();

    // Wait for navigation to complete - expect to be on the new page in view mode
    await expect(page).toHaveURL(/\/accordion-test-page$/, { timeout: 15000 });
    // Verify not in edit mode
    await expect(page).not.toHaveURL(/\/edit$/);
  });

  test('Root page has top-level navigation in iframe', async ({ page }, testInfo) => {

    const helper = new AdminUIHelper(page);

    await helper.login();

    // Navigate to root in edit mode
    await page.goto(`${URLS.voltoSsr}/edit`);

    // Wait for iframe element to be visible
    await page.locator('#previewIframe').waitFor({ state: 'visible', timeout: 10000 });

    // Check that navigation items are visible in the iframe
    const iframe = helper.getIframe();
    // The mock frontend displays navigation from API's @components.navigation.items
    // Nuxt mega menu uses buttons for top-level items, mock uses <a> links
    const navItems = iframe.locator('nav a, nav button, header a, .navigation a');
    await expect(navItems.first()).toBeVisible({ timeout: 10000 });

    // Verify top-level nav items exist (Test Data is a top-level mount)
    // Top-level items may be <a> (mock) or <button> (Nuxt mega menu)
    const testDataLink = iframe.locator('nav').getByText('Test Data', { exact: true });
    await expect(testDataLink.first()).toBeVisible({ timeout: 5000 });
  });

  test('Navigation works in view mode without warning', async ({ page }, testInfo) => {

    const helper = new AdminUIHelper(page);

    await helper.login();

    // Go to view mode (not edit)
    await page.goto(helper.contentUrl('/test-page'));

    // Wait for iframe content to load
    const iframe = helper.getIframe();
    await expect(iframe.locator('text=This is a test paragraph')).toBeVisible({ timeout: 10000 });

    // Track if beforeunload dialog appears (it shouldn't in view mode)
    let dialogAppeared = false;
    page.on('dialog', async (dialog) => {
      dialogAppeared = true;
      await dialog.accept();
    });

    // Open Test Data mega menu, then click Accordion Test Page to navigate
    // Reveal "Test Data"'s children, then click one. The Nuxt mega-menu hides
    // them behind a chevron disclosure button (its title link navigates); the
    // mock frontend renders every child as an always-visible <a>. Open the
    // panel when that button exists, otherwise the child link is already shown.
    const testDataToggle = iframe.locator('nav').getByRole('button', { name: 'Show Test Data sections' });
    if (await testDataToggle.count()) await testDataToggle.click();
    const navLink = iframe.locator('nav a[href*="_test_data"]').filter({ hasText: 'Accordion Test Page' }).first();
    await navLink.waitFor({ state: 'visible' });
    await navLink.click();

    // Wait for admin URL to change
    await expect(page).toHaveURL(/\/accordion-test-page$/, { timeout: 10000 });

    // Verify no warning dialog appeared during navigation
    expect(dialogAppeared, 'No beforeunload warning should appear in view mode').toBe(false);
  });

  test('Grid block paging works in view mode', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();

    // Go to view mode (not edit)
    await page.goto(helper.contentUrl('/test-page'));

    // No quiescence wait here: the assertion below IS the condition (the
    // paragraph is visible once the blocks have rendered), and it fails with a
    // useful message if they never do.
    const iframe = helper.getIframe();
    await expect(iframe.locator('text=This is a test paragraph')).toBeVisible({ timeout: 10000 });

    // Grid block (block-8-grid) should have paging since it has >6 elements
    // (1 manual teaser + query results from listing-in-grid)
    // Wait for paging controls to appear
    // Use aria-label selector that works for both mock (.grid-paging) and Nuxt (.paging)
    // Use .first() since there may be multiple paging navs (grid + listing)
    const pagingNav = iframe.locator('nav[aria-label="Page Navigation"]').first();
    await expect(pagingNav).toBeVisible({ timeout: 10000 });

    // Track if beforeunload dialog appears (it shouldn't in view mode)
    let dialogAppeared = false;
    page.on('dialog', async (dialog) => {
      dialogAppeared = true;
      await dialog.accept();
    });

    // Click the "Next" or page 2 paging link
    const pagingLink = pagingNav.locator('a').filter({ hasText: /Next|2/ }).first();
    await pagingLink.click();

    // Wait for the iframe to reload with page 2 content
    // The paging link has data-linkable-allow so navigation should work without warning
    // After navigation, the "Prev" link should become visible (indicating we're on page 2)
    // Re-get iframe reference since navigation may have invalidated it
    const iframeAfter = helper.getIframe();
    // Mock frontend uses "← Prev", Nuxt uses "Previous"
    await expect(iframeAfter.locator('a.paging-prev')).toBeVisible({ timeout: 10000 });

    // Verify no warning dialog appeared during navigation
    expect(dialogAppeared, 'No beforeunload warning should appear for paging in view mode').toBe(false);

    // Verify the iframe still shows the page content (didn't break)
    await expect(iframeAfter.locator('main')).toBeVisible({ timeout: 5000 });
  });

  test('Iframe does not double-load when clicking nav link', async ({ page }, testInfo) => {
    // Skip on Nuxt - this test uses mock frontend's load counter
    test.skip(testInfo.project.name.includes('nuxt'), 'Mock frontend test only');

    const helper = new AdminUIHelper(page);

    await helper.login();

    // Go to view mode
    await page.goto(helper.contentUrl('/test-page'));
    await page.waitForLoadState('networkidle');

    const iframe = helper.getIframe();
    await expect(iframe.locator('text=This is a test paragraph')).toBeVisible({ timeout: 10000 });

    // Click nav link to navigate
    const navLink = iframe.locator('a').filter({ hasText: 'Another Page' }).first();
    await navLink.waitFor({ state: 'attached' });
    await navLink.click();

    // Wait for navigation to complete
    await expect(page).toHaveURL(/another-page/, { timeout: 10000 });
    await expect(iframe.locator('text=This is another test page')).toBeVisible({ timeout: 10000 });

    // Wait a moment for any potential admin-forced reload to occur
    await page.waitForTimeout(500);

    // Verify admin didn't force an extra reload
    // Without fix: 1 (initial) + 1 (nav) + 1 (admin reload) = 3
    // With fix: 1 (initial) + 1 (nav) = 2
    // Counter persists in sessionStorage across page loads within the session
    const loadCount = parseInt(await iframe.locator('#render-counter').textContent() || '0', 10);
    expect(loadCount, `Iframe loaded ${loadCount} times, should be 2 (not 3+ from admin reload)`).toBeLessThan(3);
  });

  test('Changing frontend URL via switcher reloads iframe', async ({ page }, testInfo) => {
    // Skip on Nuxt - this test changes frontend URL which would conflict
    test.skip(testInfo.project.name.includes('nuxt'), 'Mock frontend test only');

    const helper = new AdminUIHelper(page);

    await helper.login();

    // Go to test-page in view mode
    await page.goto(helper.contentUrl('/test-page'));

    const iframe = helper.getIframe();
    await expect(iframe.locator('text=This is a test paragraph')).toBeVisible({ timeout: 10000 });

    // Get the current iframe src (should be path-based: test-frontend host/test-page)
    const iframeElement = page.locator('#previewIframe');
    const srcBefore = await iframeElement.getAttribute('src');
    expect(srcBefore).toContain(`localhost:${PORTS.testFrontend}${TEST_DATA_PREFIX}/test-page`);
    expect(srcBefore).not.toContain('#');

    // Open frontend switcher panel
    await page.locator('#toolbar-frontend-switcher').click();
    const panel = page.locator('.frontend-switcher-panel');
    await expect(panel).toBeVisible({ timeout: 5000 });

    // Open settings modal to add a hash-based URL
    await panel.locator('.frontend-switcher-settings-btn').click();
    const modal = page.locator('.frontend-settings-modal');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Add hash-based frontend URL
    const urlInput = modal.locator('.frontend-settings-url-input');
    await urlInput.fill(`${URLS.testFrontend}/#/`);
    await modal.locator('.frontend-settings-add-btn').click();

    // Close the settings modal
    await modal.locator('.frontend-settings-close').click();
    await expect(modal).not.toBeVisible({ timeout: 5000 });

    // Ensure the panel is open and select the hash-based URL
    if (!await panel.isVisible()) {
      await page.locator('#toolbar-frontend-switcher').click();
      await expect(panel).toBeVisible({ timeout: 5000 });
    }
    const hashUrlItem = panel.locator('.frontend-switcher-url-item', { hasText: `localhost:${PORTS.testFrontend}/#/` });
    await expect(hashUrlItem).toBeVisible({ timeout: 5000 });
    await hashUrlItem.click();

    // Wait for iframe src to change to hash-based format
    await expect(async () => {
      const src = await iframeElement.getAttribute('src');
      expect(src).toContain(`#${TEST_DATA_PREFIX}/test-page`);
    }).toPass({ timeout: 10000 });

    const srcAfter = await iframeElement.getAttribute('src');
    expect(srcAfter, 'Iframe src should have changed to hash-based URL').toContain(`#${TEST_DATA_PREFIX}/test-page`);

    // Re-get iframe reference after reload and verify content still shows
    const iframeAfter = helper.getIframe();
    await expect(iframeAfter.locator('text=This is a test paragraph')).toBeVisible({ timeout: 10000 });
  });

  test('Contents action is available on folderish pages', async ({ page }, testInfo) => {
    // Skip on Nuxt - test-page may have different behavior

    const helper = new AdminUIHelper(page);

    await helper.login();

    // Navigate to view mode (not edit) to see Contents action in toolbar
    await page.goto(helper.contentUrl('/test-page'));

    // Look for the contents/folder action in the toolbar
    // This should be visible because test-page is folderish (is_folderish: true in fixture)
    const contentsButton = page.locator('#toolbar a[href*="contents"], #toolbar [aria-label*="Contents" i]');
    await expect(contentsButton.first()).toBeVisible({ timeout: 5000 });
  });

  test('Frontend switcher button is visible and opens panel', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const switcherBtn = page.locator('#toolbar-frontend-switcher');
    await expect(switcherBtn).toBeVisible({ timeout: 10000 });
    await switcherBtn.click();

    const panel = page.locator('.frontend-switcher-panel');
    await expect(panel).toBeVisible({ timeout: 5000 });

    // Should have viewport buttons
    await expect(panel.locator('.frontend-switcher-viewport-btn')).toHaveCount(3);
    // Should have at least one frontend URL
    expect(await panel.locator('.frontend-switcher-url-item').count()).toBeGreaterThan(0);
    // Should have settings button
    await expect(panel.locator('.frontend-switcher-settings-btn')).toBeVisible();
  });

  test('Viewport switching constrains iframe width', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const iframe = page.locator('#previewIframe');
    const switcherBtn = page.locator('#toolbar-frontend-switcher');
    const panel = page.locator('.frontend-switcher-panel');

    const openPanel = async () => {
      if (await panel.isVisible()) return;
      await switcherBtn.click();
      await expect(panel).toBeVisible({ timeout: 5000 });
    };

    await expect(iframe).toBeVisible({ timeout: 10000 });
    const initialStyle = await iframe.getAttribute('style');
    expect(initialStyle || '').not.toContain('max-width');

    await openPanel();
    await panel.locator('.frontend-switcher-viewport-btn').first().click();
    await expect(iframe).toHaveAttribute('style', /max-width:\s*375px/, { timeout: 5000 });

    await panel.locator('.frontend-switcher-viewport-btn').nth(1).click();
    await expect(iframe).toHaveAttribute('style', /max-width:\s*768px/, { timeout: 5000 });

    await panel.locator('.frontend-switcher-viewport-btn').nth(2).click();
    await expect(async () => {
      const style = await iframe.getAttribute('style');
      expect(style || '').not.toContain('max-width');
    }).toPass({ timeout: 5000 });
  });

  test('Switching frontend mid-edit preserves form data without leave warning', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';
    const editor = await helper.enterEditMode(blockId);
    await helper.selectAllTextInEditor(editor);
    await editor.pressSequentially('Unsaved changes test', { delay: 20 });
    await page.waitForTimeout(500);

    const iframe = helper.getIframe();
    await expect(iframe.locator(`[data-block-uid="${blockId}"]`)).toContainText('Unsaved changes test');

    let dialogAppeared = false;
    page.on('dialog', async (dialog: any) => {
      dialogAppeared = true;
      await dialog.accept();
    });

    const switcherBtn = page.locator('#toolbar-frontend-switcher');
    await switcherBtn.click();
    const panel = page.locator('.frontend-switcher-panel');
    await expect(panel).toBeVisible();

    const iframeEl = page.locator('#previewIframe');
    const srcBefore = await iframeEl.getAttribute('src');
    const currentOrigin = new URL(srcBefore!).origin;

    const urlItems = panel.locator('.frontend-switcher-url-item');
    const urlCount = await urlItems.count();
    let targetUrl: string | null = null;
    for (let i = 0; i < urlCount; i++) {
      const item = urlItems.nth(i);
      const urlText = await item.getAttribute('title');
      if (urlText && new URL(urlText).origin !== currentOrigin) {
        try {
          // Check the frontend can actually serve edit content (not just respond)
          const testUrl = `${urlText.replace(/\/$/, '')}${TEST_DATA_PREFIX}/test-page?_edit=true`;
          const resp = await page.request.get(testUrl, { timeout: 5000 });
          if (resp.ok() && (await resp.text()).includes('data-block-uid')) {
            targetUrl = urlText;
            await item.click();
            break;
          }
        } catch { /* Not reachable or can't render, try next */ }
      }
    }

    if (!targetUrl) {
      test.skip(true, 'No reachable frontend with different origin available');
      return;
    }

    expect(dialogAppeared).toBe(false);

    await expect(async () => {
      const srcAfter = await iframeEl.getAttribute('src');
      expect(srcAfter).not.toBeNull();
      expect(new URL(srcAfter!).origin).not.toBe(currentOrigin);
    }).toPass({ timeout: 10000 });

    await helper.waitForIframeReady();

    const newIframe = helper.getIframe();
    await expect(newIframe.locator(`[data-block-uid="${blockId}"]`)).toContainText('Unsaved changes test', { timeout: 10000 });
    await helper.waitForBlockSelectedInAdmin(blockId);
  });

  test('Frontend switcher button visible in view mode', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await page.goto(`${URLS.voltoSsr}/test-page`);
    await page.waitForLoadState('networkidle');

    const switcherBtn = page.locator('#toolbar-frontend-switcher');
    await expect(switcherBtn).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Page Creation', () => {
  // Parametrized over content type so the same journey covers both
  // sides of the Hydra Add shadow's post-create redirect logic:
  //
  //   - Document has the volto.blocks behavior → shadow sends user to
  //     /<newpath>/edit so they land in the bridge's block editor.
  //   - Folder has NO blocks behavior → shadow sends user to the
  //     canonical view (bridge has nothing to drive on a flat metadata
  //     edit page; /edit would be a worse default for these types).
  //
  // The shadow distinguishes by inspecting `nextProps.content.blocks_layout`
  // on the POST 201 response — Plone populates that field iff the type
  // has the volto.blocks behavior. Document gets it, Folder doesn't.
  //
  // /_test_data is folderish in the fixture, so the toolbar Add button
  // is shown. Avoiding navigateToEdit's prefix here — we're navigating
  // *into* the test mount root, not editing a specific child.
  const ADD_CASES = [
    {
      typeId: 'Document',
      submenuItem: '#toolbar-add-document',
      titleFieldFill: 'TDD Created Document',
      expectedRedirectKind: 'edit' as const, // → /<newpath>/edit
      expectsIframe: true,                   // iframe loads with a block
    },
    {
      typeId: 'Folder',
      submenuItem: '#toolbar-add-folder',
      titleFieldFill: 'TDD Created Folder',
      expectedRedirectKind: 'view' as const, // → /<newpath> (canonical)
      expectsIframe: false,
    },
  ] as const;
  for (const tc of ADD_CASES) {
  test(`adding a new ${tc.typeId} via the toolbar Add button redirects to ${tc.expectedRedirectKind}`, async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await page.goto(`${helper.adminUrl}/_test_data`);

    // Capture the POST 201 response from createContent so we can navigate
    // to the new item by its server-assigned @id.
    let createdAtId: string | null = null;
    page.on('response', async (resp) => {
      if (resp.request().method() !== 'POST' || resp.status() !== 201) return;
      try {
        const body = await resp.json();
        if (body && body['@type'] === tc.typeId && body['@id']) {
          createdAtId = body['@id'];
        }
      } catch {
        /* not JSON */
      }
    });

    // Open toolbar Add menu and pick the type.
    await page.locator('#toolbar-add').click();
    await page.locator(tc.submenuItem).click();
    await page.waitForURL(new RegExp(`\\/add\\?type=${tc.typeId}`), { timeout: 10000 });

    // Fill Title and save. Add shadow forces `visual = false` so the form
    // renders the flat schema input (a real <input> for title), not
    // Volto's in-page visual block editor.
    const titleField = page.locator('#field-title input, input[name="title"]').first();
    await expect(titleField).toBeVisible({ timeout: 5000 });
    await titleField.fill(tc.titleFieldFill);
    await page.locator('#toolbar-save, button:has-text("Save")').click();

    await expect.poll(() => createdAtId, { timeout: 10000 }).toBeTruthy();

    // Type-aware redirect from the Hydra Add shadow:
    //   - Document (has volto.blocks behavior) → /<newpath>/edit
    //   - Folder (no blocks behavior) → /<newpath> (canonical view)
    const newPath = new URL(createdAtId!).pathname;
    const expectedPattern =
      tc.expectedRedirectKind === 'edit'
        ? new RegExp(`${newPath.replace(/\//g, '\\/')}\\/edit$`)
        : new RegExp(`${newPath.replace(/\//g, '\\/')}$`);
    await page.waitForURL(expectedPattern, { timeout: 10000 });

    if (tc.expectsIframe) {
      await helper.waitForIframeReady();

      // Iframe must have navigated to the new content's URL — not still
      // showing the previous folder's content.
      await expect.poll(
        async () => {
          const src = await page.locator('#previewIframe').getAttribute('src');
          return src || '';
        },
        { timeout: 10000 },
      ).toContain(newPath);

      // Iframe must NOT be showing a 404. The user-reported bug: Volto
      // creates content + redirects, the iframe loads the new URL, but
      // the frontend returns 404 because the new content isn't fetchable
      // (e.g. session token not threaded through).
      const iframeBody = page.frameLocator('#previewIframe').locator('body');
      await expect(iframeBody, 'iframe must not show 404 for the new content').not.toContainText('404', { timeout: 5000 });

      // New document renders at least one block (Volto auto-creates an
      // empty slate on new pages). Visible proves the round trip
      // actually rendered the new content.
      const iframe = helper.getIframe();
      const anyBlock = iframe.locator('[data-block-uid]').first();
      await expect(anyBlock).toBeVisible({ timeout: 10000 });
    }
  });
  }

  /**
   * Regression: when the Add button is shown in the toolbar, clicking
   * it MUST surface at least one addable content type. The earlier
   * test above only exercises the happy path on /_test_data where
   * Document IS addable. It can't catch the silent-empty-state bug
   * the user reported (Add visible, click opens an empty chooser
   * with no .toolbar-add-* items).
   *
   * The fix the user agreed on: hide the Add button entirely when
   * there are no addable types. So this test couples two invariants:
   *   1. If the Add button is in the DOM, it must be backed by at
   *      least one type (clicking surfaces ≥1 .toolbar-add-*).
   *   2. If types is empty, the button must NOT be rendered.
   *
   * Stock Volto already gates Add behind
   * `is_folderish && (types.length > 0 || translations)` — but the
   * translations branch can surface the button with zero addable
   * types in a multilingual setup, which is what produces the empty
   * chooser. The fix tightens the gate to require types > 0.
   */
  test('Add button is hidden when no addable types exist; visible click always surfaces ≥1 type', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    // /_test_data IS folderish and has Document as an addable type —
    // happy path. Asserts the button is visible AND clicking it
    // surfaces at least one #toolbar-add-* item.
    await page.goto(`${helper.adminUrl}/_test_data`);

    const addBtn = page.locator('#toolbar-add');
    await expect(addBtn).toBeVisible({ timeout: 5000 });
    await addBtn.click();

    // Any link with id `toolbar-add-<type>` proves the submenu is
    // populated. If the chooser ever silently renders empty, this
    // count check fires.
    const typeItems = page.locator('[id^="toolbar-add-"]');
    await expect(typeItems.first()).toBeVisible({ timeout: 3000 });
    const count = await typeItems.count();
    expect(
      count,
      'Add chooser must contain at least one type item when visible',
    ).toBeGreaterThan(0);
  });

  /**
   * Mobile mirror of the toolbar-Add-creates-and-edits happy path above.
   * Sets a portrait phone viewport, walks the SAME journey:
   *   - tap #toolbar-add → submenu opens with type items
   *   - tap #toolbar-add-document → navigate to /add?type=Document
   *   - fill title, tap Save → POST 201 → redirect to /edit on new item
   *
   * Catches: the submenu doesn't get hidden off-screen by mobile-tablet
   * CSS; the Add form is reachable; Save isn't behind a horizontal scroll
   * or covered by the bottom toolbar.
   */
  test('mobile: adding a new Document via the toolbar Add button creates and edits it', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 }); // iPhone-12 portrait

    const helper = new AdminUIHelper(page);
    await helper.login();
    await page.goto(`${helper.adminUrl}/_test_data`);

    let createdAtId: string | null = null;
    page.on('response', async (resp) => {
      if (resp.request().method() !== 'POST' || resp.status() !== 201) return;
      try {
        const body = await resp.json();
        if (body && body['@type'] === 'Document' && body['@id']) {
          createdAtId = body['@id'];
        }
      } catch {
        /* not JSON */
      }
    });

    // The Add button must be visible (Volto already filters it on
    // small viewports via Semantic UI's responsive classes — if a
    // mobile-tablet CSS rule hides it, this fires first).
    const addBtn = page.locator('#toolbar-add');
    await expect(addBtn).toBeVisible({ timeout: 5000 });
    await addBtn.click();

    // Submenu must surface ≥1 type link AND the Document item must be
    // reachable by a real tap (not just present in the DOM behind the
    // bottom toolbar).
    const docLink = page.locator('#toolbar-add-document');
    await expect(docLink).toBeVisible({ timeout: 5000 });
    await docLink.click();
    await page.waitForURL(/\/add\?type=Document/, { timeout: 10000 });

    // Title field, Save, same as the desktop counterpart — but the
    // mobile-tablet rules must not have hidden either.
    const titleField = page.locator('#field-title input, input[name="title"]').first();
    await expect(titleField).toBeVisible({ timeout: 5000 });
    await titleField.fill('TDD Mobile Document');
    const saveBtn = page.locator('#toolbar-save, button:has-text("Save")').first();
    await expect(saveBtn).toBeVisible({ timeout: 5000 });
    await saveBtn.click();

    await expect.poll(() => createdAtId, { timeout: 10000 }).toBeTruthy();

    const newDocPath = new URL(createdAtId!).pathname;
    await page.waitForURL(
      new RegExp(`${newDocPath.replace(/\//g, '\\/')}\\/edit$`),
      { timeout: 10000 },
    );
    await helper.waitForIframeReady();

    // Iframe must have navigated to the new content URL (not stale).
    await expect.poll(
      async () => {
        const src = await page.locator('#previewIframe').getAttribute('src');
        return src || '';
      },
      { timeout: 10000 },
    ).toContain(newDocPath);

    // The user-reported bug surface: iframe loads but the frontend
    // shows 404 because the bridge handshake didn't complete (e.g.
    // INITIAL_DATA never received, session-token mismatch).
    const iframeBody = page.frameLocator('#previewIframe').locator('body');
    await expect(iframeBody, 'iframe must not show 404 for the new content').not.toContainText('404', { timeout: 5000 });

    const iframe = helper.getIframe();
    const anyBlock = iframe.locator('[data-block-uid]').first();
    await expect(anyBlock).toBeVisible({ timeout: 10000 });
  });
});
