import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

/**
 * An object_list with `subBlocks: false` is a plain list of objects: Volto's
 * object-list widget edits it in the sidebar, and its items are not blocks —
 * nothing is seeded, nothing is selectable on the canvas. (For items that
 * cannot be edited where they are drawn, like a dropdown's options.)
 */
test.describe('object_list with subBlocks: false', () => {
  // The hero's plain `tags` list is declared by the MOCK test frontend only —
  // a page-path switch in its index.html (same idiom as the restricted-styles
  // page). Other frontends serve the page without it.
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'admin-mock', 'the plain-list field is declared by the mock frontend');
  });

  test('is edited in the sidebar, stored as plain objects, and is not a region', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/object-list-plain-page');
    const iframe = helper.getIframe();
    const bridge = <T,>(read: (b: any) => T) =>
      iframe.locator('body').evaluate((_, src) => new Function('b', `return (${src})(b)`)((window as any).__hydraBridge), read.toString());

    // Not a region: no item is seeded into it and it has no sub-blocks.
    await expect.poll(() => bridge((b) => b.formData?.blocks?.['hero-1']?.heading)).toBe('Plain list hero');
    expect(await bridge((b) => b.formData.blocks['hero-1'].tags ?? null)).toBeNull();
    expect(
      await bridge((b) => Object.keys(b.blockPathMap || {}).filter((uid) => b.blockPathMap[uid]?.parentId === 'hero-1')),
    ).toEqual([]);

    // The sidebar edits it with Volto's object-list widget.
    await helper.clickBlockInIframe('hero-1');
    const field = page
      .locator('#sidebar-properties .objectlist-widget')
      .filter({ has: page.locator('[class*="field-wrapper-tags"]') });
    await expect(field).toBeVisible();
    const add = field.locator('.add-item-button-wrapper button');
    await expect(add).toHaveAttribute('aria-label', /Tag/);
    await add.click();
    const value = field.locator('[class*="field-wrapper-value"] input');
    const label = field.locator('[class*="field-wrapper-label"] input');
    await value.click();
    await page.keyboard.type('urgent');
    await label.click();
    await page.keyboard.type('Urgent');

    // Stored on the block as a plain object, and still not a region.
    await expect
      .poll(() => bridge((b) => (b.formData.blocks['hero-1'].tags || []).map((t: any) => [t.value, t.label])))
      .toEqual([['urgent', 'Urgent']]);
    expect(
      await bridge((b) => Object.keys(b.blockPathMap || {}).filter((uid) => b.blockPathMap[uid]?.parentId === 'hero-1')),
    ).toEqual([]);
  });
});
