/**
 * The admin's chrome is Hydra's own: a preview iframe framed by Hydra's
 * toolbar and sidebar. Volto's site chrome must not render around it, and the
 * content area must sit flush because the iframe fills it.
 *
 * This used to be enforced by forking App.jsx (329 lines) and commenting the
 * tags out, which went stale and cost two upstream fixes — e8fac8543's
 * undefined-blockType guard and 61eb4d2f8's staticContext. It is now three
 * null-rendering leaf shadows plus one CSS rule, and this pins that they
 * actually do the job.
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

test.describe('Admin chrome', () => {
  test('suppresses Volto site chrome, keeps the route announcer, flush content area', async ({
    page,
  }) => {
    test.setTimeout(120000);
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Suppressed: the frontend renders the page's own header/footer inside
    // the iframe, so Volto's must not render around it.
    await expect(page.locator('#navigation, .header-wrapper')).toHaveCount(0);
    await expect(page.locator('.breadcrumbs')).toHaveCount(0);
    await expect(page.locator('#footer')).toHaveCount(0);

    // NOT suppressed: the old App.jsx shadow dropped RouteAnnouncer with the
    // chrome. It is an off-screen role="alert" carrying the page title for
    // screen readers — an a11y feature, not chrome.
    await expect(page.locator('#route-announcer')).toHaveCount(1);

    // Flush. Semantic UI ships `.ui.basic.segment { padding: 14px 0 }`, which
    // the old inline style beat for free and a bare `.content-area` does not.
    const padding = await page
      .locator('.content-area')
      .first()
      .evaluate((el) => getComputedStyle(el).padding);
    expect(padding).toBe('0px');
  });
});
