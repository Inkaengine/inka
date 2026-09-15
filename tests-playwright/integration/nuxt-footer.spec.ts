/**
 * Tests for the Nuxt site footer rendered via forced template.
 *
 * The footer uses a forced template (/templates/site-footer) containing:
 * - A socialLinks block with icon links (GitHub, Discord, Plone, YouTube)
 * - A slate block with copyright text
 *
 * Since the template blocks are readOnly, editing requires entering
 * template edit mode first.
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

test.use({
  storageState: 'tests-playwright/.generated/storage-nuxt.json',
});

test.describe('Nuxt site footer', () => {

  test('footer renders social links and copyright', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const iframe = helper.getIframe();

    await helper.login();
    await helper.navigateToEdit('/test-page');
    await helper.waitForIframeReady();

    // Footer should be visible in the iframe
    const footer = iframe.locator('footer');
    await expect(footer).toBeVisible({ timeout: 15000 });

    // Social links block should render with "Follow us:" label
    await expect(footer.locator('text=Follow us:')).toBeVisible();

    // Should have social icon links
    const socialLinks = footer.locator('a[target="_blank"]');
    await expect(socialLinks.first()).toBeVisible();
    const count = await socialLinks.count();
    expect(count).toBeGreaterThanOrEqual(3);

    // GitHub link should be present
    await expect(footer.locator('a[href*="github.com"]')).toBeVisible();

    // Copyright text should render
    await expect(footer).toContainText('Plone Foundation');
  });

  test('link items are readonly without template edit mode', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const iframe = helper.getIframe();

    await helper.login();
    await helper.navigateToEdit('/test-page');
    await helper.waitForIframeReady();

    const footer = iframe.locator('footer');
    await expect(footer).toBeVisible({ timeout: 15000 });

    // Click a link item in the iframe to select it
    const firstLink = footer.locator('[data-block-uid] a[target="_blank"]').first();
    await expect(firstLink).toBeVisible();
    const linkBlockUid = await firstLink.evaluate(el => {
      const blockEl = el.closest('[data-block-uid]');
      return blockEl?.getAttribute('data-block-uid');
    });

    await helper.clickBlockInIframe(linkBlockUid!);
    await helper.waitForSidebarOpen();

    // Link item should be readonly in the iframe (hydra-locked class)
    await helper.waitForBlockReadonly(linkBlockUid!);

    // Iframe: no add button between fixed link items
    const iframeAddButton = page.locator('.volto-hydra-add-button');
    await expect(iframeAddButton).not.toBeVisible({ timeout: 3000 });

    // Sidebar: the URL field should NOT be editable
    await expect(page.locator('#sidebar-properties .field-wrapper-url input')).not.toBeVisible({ timeout: 3000 });

    // Navigate up to SocialLinks parent to check sidebar [+]
    await helper.escapeToParent();
    await helper.waitForSidebarOpen();
    const linksSection = page.locator('.container-field-section').filter({
      has: page.locator('.widget-title', { hasText: 'Links' }),
    });
    const sidebarAddButton = linksSection.locator('.widget-actions button');
    await expect(sidebarAddButton).not.toBeVisible({ timeout: 3000 });
  });

  test('link items are editable after entering template edit mode', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const iframe = helper.getIframe();

    await helper.login();
    await helper.navigateToEdit('/test-page');
    await helper.waitForIframeReady();

    const footer = iframe.locator('footer');
    await expect(footer).toBeVisible({ timeout: 15000 });

    // Unlock the template for editing.
    const { blockId: socialBlockId } = await helper.waitForBlockByContent('Follow us:');
    await helper.unlockTemplate(socialBlockId);

    // Click a link item — should now be editable
    const firstLink = footer.locator('[data-block-uid] a[target="_blank"]').first();
    const linkBlockUid = await firstLink.evaluate(el => {
      const blockEl = el.closest('[data-block-uid]');
      return blockEl?.getAttribute('data-block-uid');
    });

    await helper.clickBlockInIframe(linkBlockUid!);
    await helper.waitForSidebarOpen();

    // Link item should NOT be readonly in template edit mode
    await helper.waitForBlockEditable(linkBlockUid!);

    // Sidebar: the URL field should be editable
    await expect(page.locator('#sidebar-properties .field-wrapper-url input')).toBeVisible({ timeout: 5000 });

    // Iframe: add button should be visible on the selected link item
    const addButton = page.locator('.volto-hydra-add-button');
    await expect(addButton).toBeVisible({ timeout: 5000 });

    // Navigate up to SocialLinks parent to check sidebar [+]
    await helper.escapeToParent();
    await helper.waitForSidebarOpen();
    const linksSection = page.locator('.container-field-section').filter({
      has: page.locator('.widget-title', { hasText: 'Links' }),
    });
    const sidebarAddButton = linksSection.locator('.widget-actions button');
    await expect(sidebarAddButton).toBeVisible({ timeout: 5000 });
  });

  test('newly added link item has add button visible', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const iframe = helper.getIframe();

    await helper.login();
    await helper.navigateToEdit('/test-page');
    await helper.waitForIframeReady();

    const footer = iframe.locator('footer');
    await expect(footer).toBeVisible({ timeout: 15000 });

    // Unlock the template for editing.
    const { blockId: socialBlockId } = await helper.waitForBlockByContent('Follow us:');
    await helper.unlockTemplate(socialBlockId);

    // Click a link item and add a new one via iframe [+]
    const firstLink = footer.locator('[data-block-uid] a[target="_blank"]').first();
    const linkBlockUid = await firstLink.evaluate(el => {
      const blockEl = el.closest('[data-block-uid]');
      return blockEl?.getAttribute('data-block-uid');
    });

    await helper.clickBlockInIframe(linkBlockUid!);
    await helper.waitForBlockEditable(linkBlockUid!);
    await helper.clickAddBlockButton();

    // The new link should be selected and editable
    await helper.waitForSidebarCurrentBlock('Link');

    // The iframe [+] add button should be visible on the new link
    const addButton = page.locator('.volto-hydra-add-button');
    await expect(addButton).toBeVisible({ timeout: 5000 });
  });
});
