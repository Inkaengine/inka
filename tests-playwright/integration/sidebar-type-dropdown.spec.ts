/**
 * Changing a block's type from the sidebar (Inkaengine/inka#749).
 *
 * The current block's title in the sidebar header is a dropdown of the types
 * it can be changed to — the same list, and the same conversion, as the
 * toolbar's "Convert to…". Picking a type converts straight away, unless a
 * field with a value has no field of the new type to go to: then it asks
 * first, naming the fields.
 *
 * Fixtures: sidebar-convert-page — convSource (title + note) converts to
 * convTargetA / convTargetB (title only); boxall-1 takes all three: s-1 is a
 * source with a note, s-2 one without. dnd-convert-page — alien-1 converts to
 * nothing.
 * container-test-page — grid-1 holds two teasers and converts to section.
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';
import type { Page } from '@playwright/test';

const typeDropdown = (page: Page) =>
  page.locator('.parent-block-section [data-testid="block-type-dropdown"]');
const typeOption = (page: Page, type: string) =>
  page.locator(`.volto-hydra-block-type-menu [data-testid="block-type-option"][data-type="${type}"]`);
const lossConfirm = (page: Page) => page.locator('[data-testid="convert-loss-confirm"]');
const lossConfirmButton = (page: Page, name: string) =>
  page.locator('.ui.modal').filter({ has: lossConfirm(page) }).getByRole('button', { name, exact: true });
const currentTitle = (page: Page) =>
  page.locator('.sidebar-section-header[data-is-current="true"] .nav-title');

test.describe('Sidebar: change a block type from its title', () => {
  test.describe('conversion graph blocks', () => {
    // The toy conversion graph lives only in the mock frontend's schemas.
    test.beforeEach(({}, testInfo) => {
      test.skip(
        testInfo.project.name !== 'admin-mock',
        'mock-only synthetic conversion blocks',
      );
    });

    test('a conversion that loses nothing happens straight away', async ({ page }) => {
      const helper = new AdminUIHelper(page);
      await helper.login();
      await helper.navigateToEdit('/sidebar-convert-page');
      const iframe = helper.getIframe();

      await helper.clickBlockInIframe('s-2');
      await helper.waitForSidebarOpen();
      await expect(typeDropdown(page)).toContainText('Conv Source');

      await typeDropdown(page).click();
      // The same targets the toolbar offers.
      await expect(typeOption(page, 'convTargetA')).toBeVisible();
      await expect(typeOption(page, 'convTargetB')).toBeVisible();
      await typeOption(page, 'convTargetA').click();

      await expect(lossConfirm(page)).toHaveCount(0);
      await expect(
        iframe.locator('[data-block-uid="s-2"] [data-conv-type="convTargetA"]'),
      ).toHaveText('Source without a note');
      // A target converts to nothing, so its title is a plain one.
      await expect(currentTitle(page)).toContainText('Conv Target A');
      await expect(typeDropdown(page)).toHaveCount(0);
    });

    test('a conversion that would lose a field asks first and names it', async ({ page }) => {
      const helper = new AdminUIHelper(page);
      await helper.login();
      await helper.navigateToEdit('/sidebar-convert-page');
      const iframe = helper.getIframe();
      const source = iframe.locator('[data-block-uid="s-1"] [data-conv-type="convSource"]');

      await helper.clickBlockInIframe('s-1');
      await helper.waitForSidebarOpen();
      await expect(iframe.locator('[data-block-uid="s-1"] [data-conv-note]')).toHaveText(
        'Only a source has a note',
      );
      await expect(typeDropdown(page)).toContainText('Conv Source');

      // Cancel leaves the block as it was.
      await typeDropdown(page).click();
      await typeOption(page, 'convTargetA').click();
      await expect(lossConfirm(page)).toBeVisible();
      await expect(lossConfirm(page)).toContainText('Conv Source → Conv Target A: Note');
      await lossConfirmButton(page, 'Cancel').click();
      await expect(lossConfirm(page)).toHaveCount(0);
      await expect(source).toHaveText('Source with a note');
      await expect(typeDropdown(page)).toContainText('Conv Source');

      // Convert goes ahead.
      await typeDropdown(page).click();
      await typeOption(page, 'convTargetA').click();
      await expect(lossConfirm(page)).toBeVisible();
      await lossConfirmButton(page, 'Convert').click();
      await expect(
        iframe.locator('[data-block-uid="s-1"] [data-conv-type="convTargetA"]'),
      ).toHaveText('Source with a note');
      await expect(source).toHaveCount(0);

      // One undo brings the source back, note and all.
      await page.locator('#toolbar-body .undo').click();
      await expect(source).toHaveText('Source with a note');
      await expect(iframe.locator('[data-block-uid="s-1"] [data-conv-note]')).toHaveText(
        'Only a source has a note',
      );
    });

    test('"Convert to…" in the sidebar block menu opens the same list', async ({ page }) => {
      const helper = new AdminUIHelper(page);
      await helper.login();
      await helper.navigateToEdit('/sidebar-convert-page');
      const iframe = helper.getIframe();

      await helper.clickBlockInIframe('s-2');
      await helper.waitForSidebarOpen();
      await page.locator('.sidebar-section-header[data-is-current="true"] .menu-trigger').click();
      await page.locator('.volto-hydra-dropdown-menu [data-testid="convert-block"]').click();
      await typeOption(page, 'convTargetB').click();

      await expect(
        iframe.locator('[data-block-uid="s-2"] [data-conv-type="convTargetB"]'),
      ).toHaveText('Source without a note');
    });

    test('a block with nothing to change to keeps a plain title', async ({ page }) => {
      const helper = new AdminUIHelper(page);
      await helper.login();
      await helper.navigateToEdit('/dnd-convert-page');

      await helper.clickBlockInIframe('alien-1');
      await helper.waitForSidebarOpen();
      await expect(currentTitle(page)).toContainText('Conv Alien');
      await expect(typeDropdown(page)).toHaveCount(0);
    });
  });

  test('a container keeps its children, as from the toolbar', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'admin-mock', 'container-test-page is a mock fixture');
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/container-test-page');
    const iframe = helper.getIframe();

    // Select grid-1 itself (a click on a teaser would select the teaser).
    await iframe.locator('[data-block-uid="grid-1"]').first().evaluate((el) => {
      (window as any).bridge?.selectBlock(el);
    });
    await helper.waitForIframeBlockHandle('grid-1');
    await helper.waitForSidebarOpen();

    await typeDropdown(page).click();
    await typeOption(page, 'section').click();
    await expect(lossConfirm(page)).toHaveCount(0);

    await expect(iframe.locator('[data-block-uid="grid-cell-1"]').first()).toBeVisible();
    await expect(iframe.locator('[data-block-uid="grid-cell-2"]').first()).toBeVisible();
    const parentUid = await iframe.locator('[data-block-uid="grid-cell-1"]').evaluate(
      (el) => el.parentElement?.closest('[data-block-uid]')?.getAttribute('data-block-uid') || null,
    );
    expect(parentUid).toBe('grid-1');
    await expect(typeDropdown(page)).toContainText('Section');
  });
});
