import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';
import { PORTS, URLS } from '../ports';

// Point the admin iframe at the Nuxt frontend: its accordion collapses panels
// and renders nested blocks, which is what this case needs — the mock renders
// every panel open, so nothing would be hidden to reveal.
//
// The cookie is keyed by the Volto SSR PORT (`iframe_url_<port>`), so the
// checked-in storage state only works on the default 3001. Set it for whatever
// port this run uses, or the admin silently falls back to the mock frontend and
// the test passes against the wrong renderer.
test.beforeEach(async ({ context }) => {
  await context.addCookies([
    {
      name: `iframe_url_${PORTS.voltoSsr}`,
      value: URLS.nuxt,
      domain: 'localhost',
      path: '/',
    },
  ]);
});

/**
 * Revealing a block nested BELOW the container that publishes the handle.
 *
 * A container advertises what it can reveal with `data-block-selector`, and the
 * accordion lists its panel's uid plus that panel's DIRECT children. A block one
 * level deeper — here a slate inside a grid inside the panel — appears in no
 * such list, so nothing in the DOM claims to be able to show it.
 *
 * The +1/-1 fallback cannot cover this either: it needs the target element
 * already rendered, and a closed panel's contents are hidden.
 *
 * The bridge resolves it by walking up blockPathMap from the target to the
 * nearest ancestor that DID publish a handle, and clicking that.
 */
test.describe('Reveal a block nested under the handle', () => {
  test('selecting a grid block inside a closed accordion panel opens the panel', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/accordion-nested-page');

    const iframe = helper.getIframe();

    // The second panel is closed (the accordion opens only the first).
    const nested = iframe.locator('[data-block-uid="grid-inner-slate"]').first();
    await expect(nested).toBeAttached({ timeout: 15000 });
    await expect(nested).toBeHidden();

    // Nothing advertises this uid: the panel handle lists the panel and the
    // grid, not the grid's children. Assert that, so the test keeps proving the
    // walk rather than quietly passing if the frontend starts enumerating.
    const advertised = await iframe
      .locator('[data-block-selector]')
      .evaluateAll((els, uid) => els.some((el) => (el.getAttribute('data-block-selector') || '').split(/\s+/).includes(uid)), 'grid-inner-slate');
    expect(advertised, 'no handle should advertise the nested uid').toBe(false);

    // Select it the way the admin does.
    await page.evaluate((uid) => {
      const el = document.querySelector('iframe') as HTMLIFrameElement;
      el.contentWindow!.postMessage({ type: 'SELECT_BLOCK', uid }, '*');
    }, 'grid-inner-slate');

    await expect(nested).toBeVisible({ timeout: 5000 });
  });

  test('selecting a block two closed containers deep opens both', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/accordion-nested-page');

    const iframe = helper.getIframe();

    // deep-slate sits in a closed panel of an accordion that is itself inside
    // a closed panel — opening one layer is not enough to bring it into view.
    const deep = iframe.locator('[data-block-uid="deep-slate"]').first();
    await expect(deep).toBeAttached({ timeout: 15000 });
    await expect(deep).toBeHidden();

    await page.evaluate((uid) => {
      const el = document.querySelector('iframe') as HTMLIFrameElement;
      el.contentWindow!.postMessage({ type: 'SELECT_BLOCK', uid }, '*');
    }, 'deep-slate');

    await expect(deep).toBeVisible({ timeout: 8000 });
  });
});
