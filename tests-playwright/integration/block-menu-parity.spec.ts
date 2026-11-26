/**
 * A block's ⋯ menu is the same wherever it opens: on the Quanta toolbar and on
 * the block's own header in the sidebar. Both draw it from one list of the
 * block's actions, so an action that works from one works from the other. The
 * one difference is Settings, which opens the sidebar: from inside the sidebar
 * there is nothing to open.
 */
import { test, expect, type Page } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

/** The items of the open ⋯ menu, as an editor reads them. */
async function openMenuItems(page: Page): Promise<string[]> {
  const items = page.locator('.volto-hydra-dropdown-menu .volto-hydra-dropdown-item');
  await expect(items.first()).toBeVisible();
  const texts = await items.allTextContents();
  return texts.map((t) => t.replace(/^[^\w]*/, '').trim()).filter(Boolean);
}

async function closeMenu(page: Page): Promise<void> {
  await page.mouse.click(1, 1);
  await expect(page.locator('.volto-hydra-dropdown-menu')).toHaveCount(0);
}

/** The toolbar's menu and the sidebar's menu for the selected block. */
async function bothMenus(page: Page): Promise<{ toolbar: string[]; sidebar: string[] }> {
  await page.locator('.quanta-toolbar .volto-hydra-menu-trigger').click();
  const toolbar = await openMenuItems(page);
  await closeMenu(page);
  await page.locator('.sidebar-section-header[data-is-current="true"] .menu-trigger').click();
  const sidebar = await openMenuItems(page);
  await closeMenu(page);
  return { toolbar, sidebar };
}

function expectSameMenu({ toolbar, sidebar }: { toolbar: string[]; sidebar: string[] }) {
  expect(toolbar).toContain('Settings');
  expect(sidebar).toEqual(toolbar.filter((item) => item !== 'Settings'));
}

test.describe('A block has one ⋯ menu, on the toolbar and in the sidebar', () => {
  test('a container: the same items, Unwrap included', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/section-test-page');
    await helper.clickBlockInIframe('section-child-1');
    await helper.waitForIframeBlockHandle('section-child-1');
    await helper.escapeFromEditing();
    await page.keyboard.press('Escape');
    await helper.waitForIframeBlockHandle('section-1');

    const menus = await bothMenus(page);
    expect(menus.toolbar).toContain('Unwrap container');
    expectSameMenu(menus);
  });

  test('a text block with something copied: the same items, Paste included', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForBlockSelectedInAdmin('block-1-uuid');

    await page.locator('.quanta-toolbar .volto-hydra-menu-trigger').click();
    await page.locator('[data-action="copy-block"]').click();
    await expect(page.locator('.volto-hydra-dropdown-menu')).toHaveCount(0);
    // Copying leaves nothing selected; select the block again.
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForBlockSelectedInAdmin('block-1-uuid');

    const menus = await bothMenus(page);
    expect(menus.toolbar).toContain('Paste');
    expectSameMenu(menus);
  });

  test('a table cell: the same items, its row and column actions included', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/table-test-page');
    await helper.clickBlockInIframe('cell-1-1');
    await helper.waitForBlockSelectedInAdmin('cell-1-1');

    const menus = await bothMenus(page);
    expect(menus.toolbar).toContain('Remove Column');
    expectSameMenu(menus);
  });

  test('a block in a locked template: the same items, Edit template included', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/template-test-page');
    const { blockId } = await helper.waitForBlockByContent('Template Header - From Template');
    await helper.clickBlockInIframe(blockId);
    await helper.waitForBlockSelectedInAdmin(blockId);

    const menus = await bothMenus(page);
    expect(menus.toolbar).toContain('Edit template');
    expectSameMenu(menus);
  });

  test('Make Template from the sidebar makes the block a template, as from the toolbar', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForBlockSelectedInAdmin('block-1-uuid');

    await page.locator('.sidebar-section-header[data-is-current="true"] .menu-trigger').click();
    await page
      .locator('.volto-hydra-dropdown-menu .volto-hydra-dropdown-item')
      .filter({ hasText: /make.*template/i })
      .click();

    const stickyHeaders = page.locator('.sidebar-section-header.sticky-header');
    await expect(stickyHeaders).toHaveCount(3); // Page > Template > Block
    await expect(stickyHeaders.nth(1)).toContainText(/Template:/i);
  });
});
