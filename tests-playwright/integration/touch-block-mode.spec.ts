/**
 * Touch-pointer block-mode behavior — regression coverage for the
 * "long-press still selects the word in block mode" bug.
 *
 * Playwright synthetic TouchEvents don't reproduce iOS's OS-level
 * long-press = word-select gesture (that's handled by the browser
 * outside the JS event loop). What we CAN test is the *mechanism*
 * the bridge uses to suppress it: a `data-hydra-edit-mode` body
 * attribute that gates a `user-select: none` rule on data-edit-text
 * fields, scoped to `@media (pointer: coarse)`. If the attribute is
 * "block" and pointer is coarse, the computed `user-select` is
 * `none` — which on a real device means the OS won't word-select on
 * long-press. If the test catches a regression where (a) the
 * attribute isn't set, (b) it isn't tied to editMode, or (c) the CSS
 * rule isn't scoped to coarse pointers, the iOS bug returns.
 */
import { test, expect } from '@playwright/test';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

// iPhone-12-shaped emulation. NOT a full spread of devices['iPhone 12']
// because that includes defaultBrowserType which forces a new worker
// (forbidden inside test.describe). What matters for this test is
// hasTouch + isMobile — together they make Chromium report
// `pointer: coarse` to matchMedia, which is the gate for the bridge's
// user-select:none rule.
test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 3,
});

test.describe('touch-mode word-select suppression', () => {

  test('after tapping a block on touch device, body[data-hydra-edit-mode] becomes "block" and editable fields get user-select:none', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const iframe = helper.getIframe();

    // We're on an iPhone-shaped device profile (viewport + hasTouch +
    // isMobile). The bridge's touch-aware tap logic uses matchMedia
    // (pointer: coarse) — confirm it fires here. The CSS suppression
    // rule itself is no longer gated by the media query (see the long
    // comment in injectCSS) so it covers Chrome devtools mobile-
    // emulation, which doesn't always report pointer:coarse.
    const coarse = await iframe.locator('html').evaluate(
      () => window.matchMedia('(pointer: coarse)').matches,
    );
    expect(coarse, 'iPhone 12 device profile must report pointer: coarse').toBe(true);

    // Tap a block that is NOT the auto-restored selection. Volto often
    // re-selects the previously-active block on render, which would
    // make my "1st tap" actually a re-tap and flip straight to text.
    // block-3-uuid is a separate slate block that isn't auto-selected
    // on a fresh navigation to /test-page.
    const block3 = iframe.locator('[data-block-uid="block-3-uuid"]').first();
    // The editable field may be a DESCENDANT (mock frontend) OR the block element
    // itself (nuxt renders `data-block-uid` + `data-edit-text` on the same <div>, as
    // getOwnEditableFields notes). Match both so this isn't mock-only — a descendant-
    // only selector times out on nuxt, where block-3's field is on the block element.
    const block3Field = iframe
      .locator(
        '[data-block-uid="block-3-uuid"] [data-edit-text], [data-block-uid="block-3-uuid"][data-edit-text]',
      )
      .first();
    await page.waitForTimeout(500); // let any auto-restoration settle

    // Single tap on a different block → block mode (touch-first behavior).
    await block3.click();
    await page.waitForTimeout(500);

    const bodyMode1 = await iframe.locator('body').getAttribute('data-hydra-edit-mode');
    expect(bodyMode1, '1st tap on a touch device should enter block mode').toBe('block');

    // The CSS rule disables text selection on data-edit-text fields when
    // in block mode on coarse-pointer. Compute style on the editable
    // child of the slate block and assert it's "none".
    const userSelect = await block3Field.evaluate(
      (el) => window.getComputedStyle(el).userSelect,
    );
    expect(
      userSelect.toLowerCase(),
      'block-mode editable fields must have user-select:none — this is what stops iOS long-press = word-select',
    ).toBe('none');

    // Second tap on the SAME block → text mode. Body attribute flips.
    await block3.click();
    await page.waitForTimeout(500);
    const bodyMode2 = await iframe.locator('body').getAttribute('data-hydra-edit-mode');
    expect(bodyMode2, '2nd tap on same block should enter text mode').toBe('text');

    // In text mode the CSS rule no longer matches → user-select goes
    // back to its frontend-defined default (usually "auto" or "text").
    const userSelectAfter = await block3Field.evaluate(
      (el) => window.getComputedStyle(el).userSelect,
    );
    expect(
      userSelectAfter.toLowerCase(),
      'text mode must NOT suppress text selection — user wants word-select to work here',
    ).not.toBe('none');
  });

  // Regression: on a touch device, moving a selected block with the mobile
  // chevron (▲/▼) must NOT drop the block out of block mode. The user taps a
  // block (→ block mode, chevrons appear), taps ▼ to reorder, and expects to
  // stay on that block in block mode so they can keep nudging it. The bug:
  // after the move the body flips out of data-hydra-edit-mode="block".
  test('chevron move keeps the block in block mode (does not change mode)', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const iframe = helper.getIframe();

    // Tap a block that isn't the auto-restored selection → first tap on a
    // touch device lands in BLOCK mode (chevrons appear).
    const block3 = iframe.locator('[data-block-uid="block-3-uuid"]').first();
    await block3.click();

    await expect
      .poll(() => iframe.locator('body').getAttribute('data-hydra-edit-mode'))
      .toBe('block');

    const chevronDown = page.locator('.quanta-toolbar .chevron-down');
    await expect(chevronDown).toBeVisible();

    const before = await helper.getBlockOrder();
    const idx = before.indexOf('block-3-uuid');
    await chevronDown.click();

    // Wait for the move to actually land (block-3 shifts one slot down).
    await expect(async () => {
      const after = await helper.getBlockOrder();
      expect(after[idx + 1]).toBe('block-3-uuid');
    }).toPass({ timeout: 5000 });

    // The block must still be selected (chevron toolbar still up) AND still in
    // block mode. It must not silently flip to text mode.
    await expect(page.locator('.quanta-toolbar .chevron-down')).toBeVisible();
    await expect
      .poll(() => iframe.locator('body').getAttribute('data-hydra-edit-mode'))
      .toBe('block');
  });

  // Root cause of "moving a block in a grid flips block→text": after the move a
  // Volto-style frontend (volto-light-theme) re-renders and REFOCUSES its own
  // contenteditable slate field. hydra's document 'focus' listener treats any
  // field focus inside the selected block as "user is editing text" and sets
  // focusedFieldName — which the admin reads as text mode (format buttons appear),
  // even though editMode is still 'block'. A focus the FRONTEND initiated must not
  // drag the editor into text mode while in block mode. (Simple client frontends
  // like the mock/nuxt examples don't refocus on re-render, so the field focus is
  // simulated here — that's the frontend's contribution, not a user gesture.)
  test('a frontend refocusing a field while in BLOCK mode must not flip to text mode', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const iframe = helper.getIframe();
    // Read hydra's own state (the source of truth) rather than the admin toolbar,
    // which lags behind by a postMessage round-trip. focusedFieldName is the
    // text-mode signal the admin reads to surface the format toolbar.
    const bridgeState = () =>
      iframe.locator('body').evaluate(() => {
        const b = (window as { __hydraBridge?: { focusedFieldName?: string | null; editMode?: string } }).__hydraBridge;
        return { field: b?.focusedFieldName ?? null, mode: b?.editMode ?? null };
      });
    const block = iframe.locator('[data-block-uid="block-3-uuid"]').first();

    // Establish CLEAN block mode: tap to text, then Escape back to block. Escape
    // (stepUp) clears focusedFieldName and makes the field non-editable — the
    // exact state a user is in before reordering a block.
    await block.click();
    await block.click();
    await expect.poll(bridgeState).toEqual({ field: 'value', mode: 'text' });
    await page.keyboard.press('Escape');
    await expect.poll(bridgeState).toEqual({ field: null, mode: 'block' });

    // Simulate the frontend refocusing its contenteditable slate field on
    // re-render (what Volto does after a move). The editable field may be a
    // descendant (mock) OR the block element itself (nuxt).
    const field = iframe
      .locator(
        '[data-block-uid="block-3-uuid"] [data-edit-text], [data-block-uid="block-3-uuid"][data-edit-text]',
      )
      .first();
    await field.evaluate((el) => {
      el.setAttribute('contenteditable', 'true');
      (el as HTMLElement).focus();
    });

    // In BLOCK mode a FRONTEND-initiated focus is not the user asking to edit
    // text, so hydra must NOT record a focusedFieldName (which would flip the
    // admin into text mode / surface the format toolbar). editMode stays 'block'.
    await expect.poll(bridgeState).toEqual({ field: null, mode: 'block' });
  });

  // "Worse version": moving a CONTAINER (e.g. a grid) in block mode. After the
  // move the Volto frontend re-renders and autofocuses the container's FIRST
  // CHILD field — a DIFFERENT block than the selected grid. hydra's focus
  // listener then runs selectBlock(child), hijacking the selection off the grid
  // onto the child (and leaving the grid's expand handles behind → confused
  // mode). A focus the frontend initiated must not change which block is
  // selected while in block mode.
  test('a frontend focusing a DIFFERENT block while in BLOCK mode must not move the selection', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const iframe = helper.getIframe();
    const bridgeState = () =>
      iframe.locator('body').evaluate(() => {
        const b = (window as { __hydraBridge?: { selectedBlockUid?: string | null; editMode?: string } }).__hydraBridge;
        return { sel: b?.selectedBlockUid ?? null, mode: b?.editMode ?? null };
      });

    // Clean block mode on block-3 (tap→text, Escape→block).
    const block = iframe.locator('[data-block-uid="block-3-uuid"]').first();
    await block.click();
    await block.click();
    await expect
      .poll(() => iframe.locator('body').getAttribute('data-hydra-edit-mode'))
      .toBe('text');
    await page.keyboard.press('Escape');
    await expect.poll(bridgeState).toEqual({ sel: 'block-3-uuid', mode: 'block' });

    // Simulate the frontend autofocusing a DIFFERENT block's field on re-render
    // (what Volto does to the grid's first child after moving the grid).
    const otherField = iframe
      .locator(
        '[data-block-uid="block-1-uuid"] [data-edit-text], [data-block-uid="block-1-uuid"][data-edit-text]',
      )
      .first();
    await otherField.evaluate((el) => {
      el.setAttribute('contenteditable', 'true');
      (el as HTMLElement).focus();
    });

    // Selection must STAY on block-3 in block mode — the frontend's focus on
    // block-1 must not hijack it.
    await expect.poll(bridgeState).toEqual({ sel: 'block-3-uuid', mode: 'block' });
  });

  // End-to-end (real user actions, not a simulated event): a slate block inside a
  // grid. The invariant under test is "focusedFieldName is non-null ONLY in text
  // mode" — the admin surfaces the slate format toolbar off focusedFieldName, so
  // if a select or a move leaves it set in block mode, the user sees block handles
  // AND the text toolbar at once ("block mode to slate"). Assert both hydra's own
  // focusedFieldName (deterministic) and the admin's Bold button (user-facing).
  const gridSlateState = (iframe: import('@playwright/test').FrameLocator) =>
    iframe.locator('body').evaluate(() => {
      const b = (window as { __hydraBridge?: { focusedFieldName?: string | null; editMode?: string } }).__hydraBridge;
      return { field: b?.focusedFieldName ?? null, mode: b?.editMode ?? null };
    });

  test('selecting a slate inside a grid lands in block mode with no text toolbar', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/grid-slates-test-page');

    const iframe = helper.getIframe();
    const slate = iframe.locator('[data-block-uid="gs-slate-1"]').first();
    await slate.scrollIntoViewIfNeeded();
    await slate.click();

    // First tap on a touch device = block mode, and block mode has no focused
    // text field, so no format toolbar.
    await expect.poll(() => gridSlateState(iframe)).toEqual({ field: null, mode: 'block' });
    await expect(helper.getQuantaToolbarFormatButton('Bold')).toHaveCount(0);
  });

  test('moving a slate inside a grid keeps block mode with no text toolbar', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/grid-slates-test-page');

    const iframe = helper.getIframe();
    const slate = iframe.locator('[data-block-uid="gs-slate-1"]').first();
    await slate.scrollIntoViewIfNeeded();
    await slate.click();
    await expect.poll(() => gridSlateState(iframe)).toEqual({ field: null, mode: 'block' });

    // Move it down within the grid.
    const chevronDown = page.locator('.quanta-toolbar .chevron-down');
    await expect(chevronDown).toBeVisible();
    await chevronDown.click();

    // The move re-renders the slate; the frontend may refocus its field, but the
    // block must stay in block mode with no text toolbar throughout.
    await expect(async () => {
      expect(await gridSlateState(iframe)).toEqual({ field: null, mode: 'block' });
      expect(await helper.getQuantaToolbarFormatButton('Bold').count()).toBe(0);
    }).toPass({ timeout: 3000 });
  });

  test('on a phone, a newly added text block takes what is typed into it', async ({ page }) => {
    // Typing into a text block just added on a phone used to produce nothing:
    // the characters were eaten. Add a block the way a phone user does (tap a
    // block, tap +, pick text), tap into the new paragraph, and type.
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');
    const iframe = helper.getIframe();

    await iframe.locator('[data-block-uid="block-3-uuid"]').first().tap();
    await helper.waitForIframeBlockHandle('block-3-uuid');
    const before = await helper.getBlockOrder();
    await helper.clickAddBlockButton();
    await helper.selectBlockType('slate');

    let newBlockUid = '';
    await expect(async () => {
      const order = await helper.getBlockOrder();
      const added = order.filter((uid) => !before.includes(uid));
      expect(added).toHaveLength(1);
      newBlockUid = added[0];
    }).toPass({ timeout: 10000 });

    const field = iframe
      .locator(
        `[data-block-uid="${newBlockUid}"] [data-edit-text], [data-block-uid="${newBlockUid}"][data-edit-text]`,
      )
      .first();
    await field.tap();
    await expect(field).toHaveAttribute('contenteditable', 'true', { timeout: 5000 });
    await expect(field).toBeFocused({ timeout: 5000 });

    await page.keyboard.type('Typed on a phone', { delay: 20 });
    await expect(field).toHaveText('Typed on a phone', { timeout: 5000 });
  });
});
