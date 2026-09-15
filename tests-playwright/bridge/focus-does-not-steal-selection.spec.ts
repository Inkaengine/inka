/**
 * A frontend-initiated focus must not steal the author's selection.
 *
 * The document focus listener follows focus to a different block so that Tab
 * moves the caret between blocks. It checks the mode, the navigation flags and
 * the mouse button — but never whether the newly focused element is somewhere a
 * caret can actually go.
 *
 * So any focus a FRONTEND moves lands as a selection change. That is how adding
 * a PDF block into a doc page's Example tab ended up with the TAB selected: the
 * add flow selected the new block, the tab's own JS moved focus to the tab
 * element as its panel changed, and the listener re-selected the tab. The author
 * adds a block and the sidebar shows them the container's settings instead of
 * the block they just added — with no way to configure it.
 *
 *   selectBlock: 01b153f6-…                 ← the add selects the new block
 *   selectBlock: pdf-doc::cd-tab-example    ← at HTMLDocument.<anonymous>, stolen
 *
 * Following focus onto a non-editable element is never a caret move, and the
 * comment in that listener already argues the same thing for block mode:
 * a focus event nobody typed is the frontend's, not the author's.
 */
import { test, expect } from './fixtures';

const selectedUid = (helper: any) =>
  helper
    .getIframe()
    .locator('body')
    .evaluate(
      (node: HTMLElement) =>
        (node.ownerDocument.defaultView as any).__hydraBridge?.selectedBlockUid,
    );

test.describe('focus moved by the frontend', () => {
  test('does not re-select another block over the author’s', async ({ helper, page }) => {
    // Select a text block by clicking it: this is text mode, where the listener
    // is meant to follow the caret.
    await helper.clickBlockInIframe('mock-block-1');
    expect(await selectedUid(helper)).toBe('mock-block-1');

    // A different block's element takes focus WITHOUT anyone typing or clicking
    // — a container re-rendering, a tab strip moving focus to its active tab, a
    // carousel restoring focus after a slide change.
    await helper
      .getIframe()
      .locator('body')
      .evaluate((node: HTMLElement) => {
        const other = node.ownerDocument.querySelector(
          '[data-block-uid="mock-hero-block"]',
        ) as HTMLElement;
        other.setAttribute('tabindex', '-1'); // as a container that takes focus would
        other.focus();
      });

    // The author's selection stands: nothing they did moved it.
    //
    // Asserting something did NOT happen has no positive signal to wait for, so
    // wait a frame for the focus to have been delivered and processed.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    await helper.getIframe().locator('body').evaluate(
      () => new Promise((r) => requestAnimationFrame(() => r(null))),
    );

    expect(await selectedUid(helper)).toBe('mock-block-1');
  });

  // The other half — focus landing on an editable field in another block SHOULD
  // move the selection (Tab between blocks) — is already pinned by
  // bridge/navigation-keys.spec.ts and bridge/block-navigation.spec.ts, which
  // drive it through hydra's own navigation rather than synthesising focus.
  // Duplicating it here would test the fixture, not the rule.
});
