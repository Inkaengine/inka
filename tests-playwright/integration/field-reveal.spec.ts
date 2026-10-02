import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

/**
 * Revealing the place a FIELD is edited, rather than the place a block is.
 *
 * A tab is the smallest block whose fields live in two different places, and
 * only one of them is ever hidden: its `label` sits on the button in the tab
 * bar, always on screen, while its `code` sits in a panel that is hidden unless
 * that tab is active. So "is the block visible?" is the wrong question — the
 * button is visible whatever the panel is doing — and the answer depends on
 * WHICH field the author reached for.
 *
 * That is what `data-block-selector="uid#fieldName"` says. The tab button now
 * carries two tokens: the bare uid (reveal the tab, any field — what
 * tab-reveal.spec.ts covers) and `uid#code` (reveal where the code is edited).
 * The label needs none: it is on the button already.
 *
 * The reveal is driven by the sidebar. Focusing a field there sends
 * `FOCUS_FIELD { blockId, fieldName, moveCaret: false }`, and the bridge opens
 * that field's place only when it is hidden AND something advertises it — so
 * focusing `label` must open nothing at all, which is the assertion that makes
 * the other one mean something.
 */
test.describe('Field reveal', () => {
  /** Put the cursor in a sidebar field, the way an author reaching for it does. */
  async function focusSidebarField(page, field: string) {
    const control = page
      .locator(
        `#sidebar-properties .field-wrapper-${field} input, ` +
          `#sidebar-properties .field-wrapper-${field} textarea, ` +
          `#sidebar-properties .field-wrapper-${field} [contenteditable="true"]`,
      )
      .first();
    await control.waitFor({ state: 'visible', timeout: 15000 });
    // Clicked, not `.focus()`ed: it is what an author does, and what raises the
    // focusin the admin listens for.
    await control.click();
  }

  const selectBlock = (page, uid: string) =>
    page.evaluate((id) => {
      (document.querySelector('iframe') as HTMLIFrameElement).contentWindow!.postMessage(
        { type: 'SELECT_BLOCK', uid: id }, '*');
    }, uid);

  test('focusing a hidden field in the sidebar opens the place it is edited', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/code-example-test-page');

    const iframe = helper.getIframe();
    // tab-js is the active tab; tab-py's panel is hidden.
    const pyCode = iframe
      .locator('[data-block-uid="tab-py"]')
      .locator('[data-edit-text="code"]')
      .first();
    await expect(pyCode).toBeAttached({ timeout: 15000 });
    await expect(pyCode, 'the code starts out of sight').toBeHidden();

    await selectBlock(page, 'tab-py');
    await expect(page.locator('#sidebar-properties')).toContainText('Code', {
      timeout: 15000,
    });

    await focusSidebarField(page, 'code');

    await expect(
      pyCode,
      'the panel holding THAT field opened',
    ).toBeVisible({ timeout: 10000 });
  });

  test('focusing a field that is already on screen opens nothing', async ({
    page,
  }) => {
    // The no-op that makes this safe to send on every sidebar focus — and the
    // reason the handle names a field rather than the block. A tab's label is on
    // the button, in plain sight; reaching for it must not go opening panels.
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/code-example-test-page');

    const iframe = helper.getIframe();
    const pyCode = iframe
      .locator('[data-block-uid="tab-py"]')
      .locator('[data-edit-text="code"]')
      .first();
    await expect(pyCode).toBeAttached({ timeout: 15000 });
    await expect(pyCode).toBeHidden();

    // Select the tab — which reveals it, as selecting a block should (see
    // tab-reveal.spec.ts) — then switch the canvas back to another tab. The tab
    // is still the SELECTED block, and its code is hidden again: the state where
    // "did the reveal fire?" is answerable.
    await selectBlock(page, 'tab-py');
    await expect(pyCode).toBeVisible({ timeout: 10000 });
    await iframe.locator('[data-block-selector~="tab-js"]').first().click();
    await expect(pyCode, 'the code is out of sight again').toBeHidden({
      timeout: 10000,
    });
    await expect(page.locator('#sidebar-properties')).toContainText('Label', {
      timeout: 15000,
    });

    await focusSidebarField(page, 'label');

    // Give the message the same room the positive case gets, then assert the
    // panel is still shut: a reveal that fired late would show up here.
    await page.waitForTimeout(1500);
    await expect(
      pyCode,
      'the label is already visible, so there was nothing to reveal',
    ).toBeHidden();
  });
});
