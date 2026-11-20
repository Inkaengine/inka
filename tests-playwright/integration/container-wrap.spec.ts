import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

test.describe('Container UX: Wrap', () => {
  test('Wrap two selected slates in a section container', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/section-test-page');

    const iframe = helper.getIframe();

    // Multi-select slate-before and slate-after at page level via Ctrl+Click
    await helper.clickBlockInIframe('slate-before');
    await helper.waitForIframeBlockHandle('slate-before');
    await helper.escapeFromEditing();

    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await iframe.locator('[data-block-uid="slate-after"]').click({ modifiers: [modifier] });
    await helper.waitForMultiSelectOutlines(2);

    // Open the quanta toolbar 3-dot menu and click "Wrap in container…"
    const menuButton = page.locator('.quanta-toolbar .volto-hydra-menu-trigger');
    await expect(menuButton).toBeVisible({ timeout: 3000 });
    await menuButton.click();
    const wrapButton = page.locator('[data-testid="wrap-selected"]');
    await expect(wrapButton).toBeVisible({ timeout: 3000 });
    await wrapButton.click();

    // BlockChooser opens filtered to compatible container types — section is
    // compatible (accepts any), and so is columns: it only takes `column`, but
    // a column (its default child) takes slates, so the wrap adds one (#790).
    await expect(page.locator('.blocks-chooser button.columns')).toHaveCount(1);
    await helper.selectBlockType('section');

    // slate-before and slate-after are now children of a new section block
    // (not page-level siblings). Verify via DOM hierarchy: the closest
    // [data-block-uid] ancestor of each slate should be the new section,
    // not the page container.
    await expect(iframe.locator('[data-block-uid="slate-before"]')).toBeVisible({ timeout: 3000 });

    // Read the new parent UID by walking up from slate-before.
    const newParentUid = await iframe.locator('[data-block-uid="slate-before"]').evaluate(
      (el) => el.parentElement?.closest('[data-block-uid]')?.getAttribute('data-block-uid'),
    );
    expect(newParentUid).toBeTruthy();
    expect(newParentUid).not.toBe('section-1'); // not the pre-existing section

    // slate-after has the same new parent (same wrap operation)
    const afterParentUid = await iframe.locator('[data-block-uid="slate-after"]').evaluate(
      (el) => el.parentElement?.closest('[data-block-uid]')?.getAttribute('data-block-uid'),
    );
    expect(afterParentUid).toBe(newParentUid);

    // The new section renders as a <section class> with the expected block type attribute
    // (we registered section renderer that wraps children in a .section-body div).
    await expect(
      iframe.locator(`[data-block-uid="${newParentUid}"] .section-body`),
    ).toBeVisible();
  });

  // A container whose region only takes its default child (columns → column) is
  // offered for blocks that child takes: the wrap adds the child around them.
  // Unwrapping that lone column unwraps the columns too, giving the page back.
  test('Wrap two slates in columns: they sit in one new column; unwrapping the column gives them back', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/section-test-page');

    const iframe = helper.getIframe();
    const parentOf = (uid: string) =>
      iframe.locator(`[data-block-uid="${uid}"]`).evaluate(
        (el) => el.parentElement?.closest('[data-block-uid]')?.getAttribute('data-block-uid') || null,
      );

    await helper.clickBlockInIframe('slate-before');
    await helper.waitForIframeBlockHandle('slate-before');
    await helper.escapeFromEditing();
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await iframe.locator('[data-block-uid="slate-after"]').click({ modifiers: [modifier] });
    await helper.waitForMultiSelectOutlines(2);

    const menuButton = page.locator('.quanta-toolbar .volto-hydra-menu-trigger');
    await expect(menuButton).toBeVisible({ timeout: 3000 });
    await menuButton.click();
    await page.locator('[data-testid="wrap-selected"]').click();
    await helper.selectBlockType('columns');

    // Both slates are in the same new column, and that column is in a new columns block.
    await expect(iframe.locator('[data-block-uid="slate-before"]')).toBeVisible({ timeout: 3000 });
    const columnUid = await parentOf('slate-before');
    expect(columnUid).toBeTruthy();
    expect(await parentOf('slate-after')).toBe(columnUid);
    const columnsUid = await parentOf(columnUid!);
    expect(columnsUid).toBeTruthy();
    expect(await parentOf(columnsUid!)).toBeNull();

    // Select the column (up from a slate) and unwrap it: the page doesn't take
    // a column's slates inside columns, and it's the only column, so the
    // columns block goes too.
    await helper.clickBlockInIframe('slate-before');
    await helper.waitForIframeBlockHandle('slate-before');
    await helper.escapeFromEditing();
    await page.keyboard.press('Escape');
    await helper.waitForIframeBlockHandle(columnUid!);
    await menuButton.click();
    const unwrapButton = page.locator('[data-testid="unwrap-container"]');
    await expect(unwrapButton).toBeEnabled({ timeout: 3000 });
    await unwrapButton.click();

    await expect(iframe.locator(`[data-block-uid="${columnsUid}"]`)).toHaveCount(0, { timeout: 3000 });
    await expect(iframe.locator(`[data-block-uid="${columnUid}"]`)).toHaveCount(0);
    expect(await parentOf('slate-before')).toBeNull();
    expect(await parentOf('slate-after')).toBeNull();
  });

  // End-to-end guard for the object_list-CHILD dimension: wrap page blocks INTO a slider (whose
  // child field is the object_list `slides`, not blocks_layout), then unwrap it back. Exercises
  // the descriptor/funnel path + the region-aware wrap-eligibility and unwrap UI gates. Uses
  // real images (already an allowed slide type) — no schema change needed.
  test('Wrap two page images into a slider (object_list child), then unwrap back', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');
    const iframe = helper.getIframe();

    // Multi-select two page-level images (valid slider slide type). Images select on click
    // (no text-editing mode), so no escapeFromEditing — an Escape would deselect the image.
    await helper.clickBlockInIframe('block-2-uuid');
    await helper.waitForIframeBlockHandle('block-2-uuid');
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await iframe
      .locator('[data-block-uid="block-5-linked-image"]')
      .click({ modifiers: [modifier] });
    await helper.waitForMultiSelectOutlines(2);

    // Wrap → slider. It's offered because its object_list `slides` region accepts image.
    await page.locator('.quanta-toolbar .volto-hydra-menu-trigger').click();
    const wrapButton = page.locator('[data-testid="wrap-selected"]');
    await expect(wrapButton).toBeVisible({ timeout: 3000 });
    await wrapButton.click();
    await helper.selectBlockType('slider');

    // The wrap re-renders asynchronously; block-2 was already a page block, so poll until it
    // actually has a PARENT block — that parent is the new slider it now lives inside.
    const parentOfB2 = () =>
      iframe
        .locator('[data-block-uid="block-2-uuid"]')
        .evaluate(
          (el) =>
            el.parentElement
              ?.closest('[data-block-uid]')
              ?.getAttribute('data-block-uid') || null,
        );
    await expect.poll(parentOfB2, { timeout: 5000 }).not.toBeNull();
    const sliderUid = await parentOfB2();
    // BOTH wrapped images are now slides of that same slider (object_list children), nested
    // under its data-block-uid. Asserted structurally (not via a frontend-specific carousel
    // class) so it holds on the mock AND the real Nuxt renderer.
    await expect(
      iframe.locator(
        `[data-block-uid="${sliderUid}"] [data-block-uid="block-5-linked-image"]`,
      ),
    ).toBeAttached({ timeout: 5000 });

    // The wrap auto-selected the new slider, so its quanta toolbar is already up. Open the
    // menu → unwrap; the slides return to the page.
    const unwrapMenu = page.locator('.quanta-toolbar .volto-hydra-menu-trigger');
    await expect(unwrapMenu).toBeVisible({ timeout: 5000 });
    // Dispatch the click via JS (same technique as selectBlockType): the Nuxt slider is
    // async-setup and re-renders on its `:key`, so the admin toolbar that tracks its rect can
    // jitter enough that Playwright's actionability click never settles.
    await unwrapMenu.evaluate((el) => (el as HTMLElement).click());
    const unwrapButton = page.locator('[data-testid="unwrap-container"]');
    await expect(unwrapButton).toBeVisible({ timeout: 3000 });
    await unwrapButton.evaluate((el) => (el as HTMLElement).click());

    // Slider gone; the image is back at page level.
    await expect(
      iframe.locator(`[data-block-uid="${sliderUid}"]`),
    ).toHaveCount(0, { timeout: 5000 });
    await expect(
      iframe.locator('[data-block-uid="block-2-uuid"]'),
    ).toBeAttached();
    const parentAfter = await iframe
      .locator('[data-block-uid="block-2-uuid"]')
      .evaluate((el) =>
        el.parentElement
          ?.closest('[data-block-uid]')
          ?.getAttribute('data-block-uid'),
      );
    expect(parentAfter).not.toBe(sliderUid);
  });
});
