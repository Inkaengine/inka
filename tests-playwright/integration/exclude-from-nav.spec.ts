import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

/**
 * Keeping a page out of the menu.
 *
 * `exclude_from_nav` is served on content and honoured by @navigation — the mock
 * has done both for a long time. What nothing checked is whether an author can
 * SET it: the content type schema never declared the field, so the page settings
 * form had no control to render and the setting was unreachable from the editor.
 *
 * That gap is invisible from either side. The API works, the menu filters
 * correctly, and every test that set the flag did so by writing content
 * directly. The only thing that fails is the one thing an author would do.
 *
 * Asserted through the FORM, not the API, because "the field exists in the
 * schema" is not the claim — "an author can keep a page out of the menu" is.
 */
test.describe('exclude from navigation', () => {
  test('the page settings form offers it, and setting it holds', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    await page.getByRole('button', { name: /open settings/i }).click();
    // The toolbar button reveals the page metadata form, but the sidebar itself
    // can still be COLLAPSED — its fields are then in the DOM and not visible,
    // which reads exactly like a field the schema never declared.
    await helper.openSidebar();

    const exclude = page.locator('.field-wrapper-exclude_from_nav');
    await expect(
      exclude,
      'the page settings offer a control for keeping the page out of the menu',
    ).toHaveCount(1, { timeout: 10000 });

    // No clicking the fieldset open: the metadata accordion renders every
    // section `active` already. Clicking the "Settings" title CLOSES it — which
    // is what made this look like a field the schema never declared, twice.
    // Semantic UI hides the real <input> and renders a styled label over it, so
    // the input is never clickable — click what an author clicks. The input is
    // still what carries the state.
    const box = exclude.locator('input[type=checkbox]').first();
    await expect(box).not.toBeChecked();
    await exclude.scrollIntoViewIfNeeded();
    // The wrapper is Semantic UI's click target: the <input> is hidden and the
    // <label> sits under the styled box, so neither takes a click on its own.
    await exclude.locator('.ui.checkbox').first().click({ timeout: 10000 });
    await expect(box, 'the tick holds').toBeChecked();

    await helper.saveContent();

    // Saved, not merely ticked: reopen and read it back.
    await helper.navigateToEdit('/test-page');
    await page.getByRole('button', { name: /open settings/i }).click();
    await expect(
      page.locator('.field-wrapper-exclude_from_nav input[type=checkbox]').first(),
      'the page is still kept out of the menu after a save',
    ).toBeChecked({ timeout: 10000 });
  });
});
