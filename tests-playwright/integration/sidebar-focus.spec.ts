/**
 * A sidebar widget must not take the caret away from the preview.
 *
 * Selecting a block renders that block's form. Any image field with no value
 * renders its empty state — an inline AddLinkForm — and AddLinkForm focused
 * itself on mount, unconditionally, 50ms later. It was written as the toolbar
 * link popup, where the author has just opened it and taking focus is correct.
 * Mounted as a widget it fires on something the author never asked for.
 *
 * What an author saw: click a text field in the preview, get a caret, and lose
 * it ~400ms later. The field kept contenteditable="true", the element was never
 * replaced, and nothing called blur() — focus had simply left the iframe, so
 * keystrokes went to the sidebar input instead. Clicking a second time appeared
 * to fix it, because by then the form was mounted and did not re-fire.
 *
 * The fixture's highlight block has text and NO image, which is the whole
 * trigger: an image field with no value renders its picker on every selection.
 * (A hero with an empty image does NOT reproduce it — verified — so the fixture
 * is not incidental.)
 *
 * Adding it made `highlight` discoverable for the first time, which promptly
 * failed block-sanity's media-coverage check: the nuxt example painted
 * highlight.image as a CSS background and never annotated it, so the field was
 * uneditable everywhere it appeared. A block type with no example escapes that
 * check entirely. Annotating it here is the smaller half of this PR.
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

const PAGE = '/sidebar-focus-page';

test.describe('sidebar widgets and the preview caret', () => {
  test('clicking a field keeps focus in the preview iframe', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit(PAGE);

    const field = helper.getIframe().locator('[data-block-uid="highlight-1"] [data-edit-text="title"]');
    await expect(field).toBeVisible({ timeout: 10_000 });
    const before = (await field.textContent())?.trim();

    await field.click();
    // Longer than AddLinkForm's 50ms mount timer, and than the selection
    // round-trip that mounts it — the theft happened ~400ms after the click.
    await page.waitForTimeout(1500);

    // The admin must still be handing input to the preview, not to a widget.
    const adminActive = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el ? `${el.tagName}.${(el.className || '').toString().split(' ')[0]}` : 'none';
    });
    expect(adminActive, 'focus must stay on the preview iframe').toContain('IFRAME');

    expect(
      await field.evaluate((el) => document.activeElement === el),
      'the clicked field holds the caret',
    ).toBe(true);

    // The contract an author experiences: one click, then type.
    await page.keyboard.type('ZZ');
    await page.waitForTimeout(800);
    expect((await field.textContent())?.trim(), 'typing lands in the clicked field').not.toBe(before);
  });
});

// Choosing a block in the sidebar's block list selects it in the page — and
// doesn't take the keyboard into the page. Selecting from the sidebar is
// working in the sidebar: a keyboard author must not be thrown into the page. A block the page can take the
// caret in (text) and one it can't (an image) both went: the bridge focused the
// text field, or the block itself, whenever the admin selected a block.
test.describe('choosing a block in the sidebar', () => {
  // Each listed by what it shows: block-3's text, block-2 the first Image.
  for (const { label, uid, item } of [
    { label: 'Text', uid: 'block-3-uuid', item: 'Another paragraph for testing' },
    { label: 'Image', uid: 'block-2-uuid', item: 'Image' },
  ]) {
    test(`a ${label} block: focus stays in the sidebar`, async ({ page }) => {
      const helper = new AdminUIHelper(page);
      await helper.login();
      await helper.navigateToEdit('/test-page');
      await helper.clickBlockInIframe('block-1-uuid');
      await helper.waitForSidebarOpen();
      await page.locator('.sidebar-section-header .nav-back').click();

      const list = page.locator('#sidebar-order .child-blocks-widget');
      await list.locator('.child-block-item', { hasText: item }).first().click();
      await helper.waitForBlockSelectedInAdmin(uid);
      // The bridge's focus came two frames after the selection; let it.
      await page.evaluate(() => new Promise((r) => setTimeout(r, 500)));

      expect(
        await page.evaluate(() => document.activeElement?.tagName),
        'focus is not taken into the page',
      ).not.toBe('IFRAME');
    });
  }
});

// Choosing a block in the sidebar leaves focus there, not in the page, so the
// page's block shortcuts can't hear the keys: the admin answers them itself.
test.describe('block shortcuts with focus in the sidebar', () => {
  const text = 'Another paragraph for testing';

  async function chooseInSidebar(page, helper: AdminUIHelper) {
    await helper.login();
    await helper.navigateToEdit('/test-page');
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForSidebarOpen();
    await page.locator('.sidebar-section-header .nav-back').click();
    await page
      .locator('#sidebar-order .child-blocks-widget .child-block-item', { hasText: text })
      .first()
      .click();
    await helper.waitForBlockSelectedInAdmin('block-3-uuid');
    expect(
      await page.evaluate(() => document.activeElement?.tagName),
      'focus is in the admin',
    ).not.toBe('IFRAME');
  }

  test('copy and paste the chosen block', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await chooseInSidebar(page, helper);
    const copies = helper.getIframe().locator('[data-block-uid]', { hasText: text });
    await expect(copies).toHaveCount(1);

    await page.keyboard.press('ControlOrMeta+c');
    await expect(page.locator('#toolbar-paste-blocks'), 'it is on the clipboard').toBeVisible();

    await page.keyboard.press('ControlOrMeta+v');
    await expect(copies, 'pasted after it').toHaveCount(2);
  });

  test('cut the chosen block', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await chooseInSidebar(page, helper);

    await page.keyboard.press('ControlOrMeta+x');
    const copies = helper.getIframe().locator('[data-block-uid]', { hasText: text });
    await expect(copies, 'cut from the page').toHaveCount(0);

    // It is on the clipboard: paste it back after the first block.
    await helper.clickBlockInIframe('block-1-uuid');
    await page.keyboard.press('Escape');
    await page.keyboard.press('ControlOrMeta+v');
    await expect(copies, 'pasted back').toHaveCount(1);
  });

  test('in a sidebar field, the keys are the field’s', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await chooseInSidebar(page, helper);
    const field = page.locator('#sidebar-properties #field-anchor');
    await field.fill('anchor text');
    await field.selectText();

    await page.keyboard.press('ControlOrMeta+c');
    await page.keyboard.press('ControlOrMeta+x');
    await expect(page.locator('#toolbar-paste-blocks'), 'no block copied').toHaveCount(0);
    await expect(helper.getIframe().locator('[data-block-uid="block-3-uuid"]'), 'no block cut').toHaveCount(1);
  });
});
