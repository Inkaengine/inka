import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

/**
 * Selecting a block that only exists once a question has been asked.
 *
 * `data-block-selector` reveals a block by CLICKING something — a tab button, a
 * carousel dot, a +1/-1 step. That covers every block whose element is in the
 * DOM but out of sight, and it covers a panel that is not rendered until its tab
 * is chosen. What it cannot reach is a block that needs INPUT before it exists
 * at all: a search's quick answer, a filtered listing, anything downstream of a
 * query. There is nothing to click that produces a question.
 *
 * So the frontend says what to type, next to the thing to click:
 *
 *     <input  data-block-selector="quick-answer-block"
 *             data-block-selector-input="what is inka">
 *     <button data-block-selector="quick-answer-block">Search</button>
 *
 * The uid is the join — the same token match the bridge already uses to find a
 * handle — so several handles can share one form and each still knows its own
 * inputs. An element declaring a value is a field to fill; one that does not is
 * the thing to activate.
 */
test.describe('Query reveal', () => {
  test('a block that needs a question is revealed by asking it', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/query-reveal-page');

    const iframe = helper.getIframe();

    // The form is there; the answer is not — no query has been asked.
    await expect(iframe.locator('.search-form')).toBeVisible({ timeout: 15000 });
    await expect(iframe.locator('[data-block-uid="quick-answer-block"]')).toHaveCount(0);

    await page.evaluate((uid) => {
      (document.querySelector('iframe') as HTMLIFrameElement).contentWindow!.postMessage(
        { type: 'SELECT_BLOCK', uid }, '*');
    }, 'quick-answer-block');

    // Asking the declared question is what brings it into being.
    await expect(iframe.locator('[data-block-uid="quick-answer-block"]'))
      .toBeVisible({ timeout: 20000 });
    await expect(iframe.locator('[data-block-uid="quick-answer-block"]'))
      .toContainText('Inka is a page builder');
  });

  test('the declared value reaches the input, not just the DOM property', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/query-reveal-page');

    const iframe = helper.getIframe();
    await expect(iframe.locator('.search-form')).toBeVisible({ timeout: 15000 });

    await page.evaluate((uid) => {
      (document.querySelector('iframe') as HTMLIFrameElement).contentWindow!.postMessage(
        { type: 'SELECT_BLOCK', uid }, '*');
    }, 'quick-answer-block');

    // Assigning .value silently fails to reach a framework-bound input; the
    // query landing in the URL proves the form actually submitted the value.
    await expect
      .poll(async () => iframe.locator('input[name="SearchableText"]').inputValue(), { timeout: 20000 })
      .toBe('what is inka');
  });
});
