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

    // The sidebar edits it with Volto's object-list widget — after the caret
    // was in one of the hero's own canvas fields, as it is after adding a block.
    await helper.clickBlockInIframe('hero-1');
    await helper.enterEditMode('hero-1', 'heading');
    const field = page
      .locator('#sidebar-properties .objectlist-widget')
      .filter({ has: page.locator('[class*="field-wrapper-tags"]') });
    await expect(field).toBeVisible();
    const add = field.locator('.add-item-button-wrapper button');
    await expect(add).toHaveAttribute('aria-label', /Tag/);
    await add.click();
    const value = field.locator('[class*="field-wrapper-value"] input');
    // The item's label field is named `heading`, like the hero's own canvas
    // field: typing it must stay in the sidebar, not move to the canvas.
    const label = field.locator('[class*="field-wrapper-heading"] input');
    await value.click();
    await page.keyboard.type('urgent');
    await label.click();
    await page.keyboard.type('Urgent and important', { delay: 20 });
    await expect(label).toHaveValue('Urgent and important');
    await expect(label).toBeFocused();

    // Stored on the block as a plain object, and still not a region; the
    // hero's own heading is untouched.
    await expect
      .poll(() => bridge((b) => (b.formData.blocks['hero-1'].tags || []).map((t: any) => [t.value, t.heading])))
      .toEqual([['urgent', 'Urgent and important']]);
    expect(await bridge((b) => b.formData.blocks['hero-1'].heading)).toBe('Plain list hero');
    expect(
      await bridge((b) => Object.keys(b.blockPathMap || {}).filter((uid) => b.blockPathMap[uid]?.parentId === 'hero-1')),
    ).toEqual([]);
  });

  test('typing in an item of a question\'s plain list stays in the sidebar', async ({ page }) => {
    // A form question (an object_list item itself), selected with the caret in
    // its label on the canvas; its options are a plain list whose items also
    // have a `label`. Typing one must not move the caret to the canvas.
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/object-list-plain-page');
    const iframe = helper.getIframe();
    const questions = iframe.locator('.form-block [data-block-uid]');
    const before = await questions.evaluateAll((els) => els.map((e) => e.getAttribute('data-block-uid')));
    // Add a question with + — the new question is selected with the caret in
    // its label, and nothing renders again until the sidebar edit.
    await helper.clickBlockInIframe('q-1');
    await helper.clickAddBlockButton();
    await helper.selectBlockType('single_choice');
    await expect(questions).toHaveCount(before.length + 1);
    const added = (await questions.evaluateAll((els) => els.map((e) => e.getAttribute('data-block-uid')))).find(
      (u) => !before.includes(u),
    )!;
    await helper.waitForBlockSelectedInAdmin(added);
    const field = page
      .locator('#sidebar-properties .objectlist-widget')
      .filter({ has: page.locator('[class*="field-wrapper-display_values"]') });
    await expect(field).toBeVisible();
    await field.locator('.add-item-button-wrapper button').click();
    const label = field.locator('[class*="field-wrapper-label"] input');
    await label.click();
    await page.keyboard.type('Citizen of another country', { delay: 20 });
    await expect(label).toHaveValue('Citizen of another country');
    await expect(label).toBeFocused();
    await expect(iframe.locator(`[data-block-uid="${added}"] label`).first()).not.toContainText('another');
  });
});
