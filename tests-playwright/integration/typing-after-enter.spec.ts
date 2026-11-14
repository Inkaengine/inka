import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

/**
 * Typing straight after Enter (inka#645).
 *
 * Enter at the end of a paragraph makes a new block; an author who keeps
 * typing doesn't wait for it to be drawn. Every key typed after Enter belongs
 * in the new block, in order. The other Enter specs wait for the new block and
 * its focus before typing, so none covered this: the first keys were lost and
 * the new block began with a zero-width space.
 */
for (const [where, blockId] of [['at page level', 'slate-before'], ['in a section\'s region', 'section-child-1']] as const) {
  test(`every key typed straight after Enter lands in the new block, ${where}`, async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/section-test-page');
    const iframe = helper.getIframe();
    const before = await helper.getBlockOrder();

    await helper.enterEditMode(blockId, 'value');
    const field = helper.getSlateField(iframe.locator(`[data-block-uid="${blockId}"]`));
    await expect(field).toHaveAttribute('contenteditable', 'true');
    await helper.selectAllTextInEditor(field);
    await page.keyboard.press('ArrowRight');

    await page.keyboard.press('Enter');
    await page.keyboard.type('A new paragraph.', { delay: 20 });

    await helper.waitForBlockCountToBe(before.length + 1);
    const newId = (await helper.getBlockOrder()).find((id) => !before.includes(id));
    expect(newId, 'Enter made one new block').toBeDefined();
    const newField = helper.getSlateField(iframe.locator(`[data-block-uid="${newId}"]`));
    await expect.poll(async () => helper.getCleanTextContent(newField)).toBe('A new paragraph.');
    expect(await newField.textContent(), 'no zero-width space is left in it').not.toContain('​');
  });
}
