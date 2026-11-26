/**
 * Changing a block's type from the sidebar (Inkaengine/inka#749).
 *
 * The current block's title in the sidebar header is a dropdown of the types
 * it can be changed to — the same list, and the same conversion, as the
 * toolbar's "Convert to…". Picking a type converts straight away. A value the
 * new type has no field for stays on the block, so converting back brings it
 * back.
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

      await expect(
        iframe.locator('[data-block-uid="s-2"] [data-conv-type="convTargetA"]'),
      ).toHaveText('Source without a note');
      // A target converts to nothing, so its title is a plain one.
      await expect(currentTitle(page)).toContainText('Conv Target A');
      await expect(typeDropdown(page)).toHaveCount(0);
    });

    test('a block with a field the new type has no place for converts straight away; one undo brings it back', async ({ page }) => {
      const helper = new AdminUIHelper(page);
      await helper.login();
      await helper.navigateToEdit('/sidebar-convert-page');
      const iframe = helper.getIframe();
      const note = iframe.locator('[data-block-uid="s-1"] [data-conv-note]');

      await helper.clickBlockInIframe('s-1');
      await helper.waitForSidebarOpen();
      await expect(note).toHaveText('Only a source has a note');

      // A target has no note: it converts straight away and the note is not shown.
      await typeDropdown(page).click();
      await typeOption(page, 'convTargetA').click();
      await expect(
        iframe.locator('[data-block-uid="s-1"] [data-conv-type="convTargetA"]'),
      ).toHaveText('Source with a note');
      await expect(note).toHaveCount(0);

      // One undo, and the source is back with its note.
      await page.locator('#toolbar-body .undo').click();
      await expect(
        iframe.locator('[data-block-uid="s-1"] [data-conv-type="convSource"]'),
      ).toHaveText('Source with a note');
      await expect(note).toHaveText('Only a source has a note');
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

    await expect(iframe.locator('[data-block-uid="grid-cell-1"]').first()).toBeVisible();
    await expect(iframe.locator('[data-block-uid="grid-cell-2"]').first()).toBeVisible();
    const parentUid = await iframe.locator('[data-block-uid="grid-cell-1"]').evaluate(
      (el) => el.parentElement?.closest('[data-block-uid]')?.getAttribute('data-block-uid') || null,
    );
    expect(parentUid).toBe('grid-1');
    await expect(typeDropdown(page)).toContainText('Section');
  });
});
