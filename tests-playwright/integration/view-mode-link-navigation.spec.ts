import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

/**
 * Following a link in VIEW mode must land on the page, not on not-found.
 *
 * Reported from production: an author opened a page in the admin, clicked an
 * internal link to go and edit that page, and got the frontend's 404 — on a
 * page that exists. Everything checkable from outside came back clean: the
 * link's uid resolves, the target is published, and the API, the SSG page, its
 * payload and the frontend's own SSR all return 200 with the right title.
 *
 * It only fails inside the iframe, after a CLIENT-SIDE route change, and no
 * HTTP request fails while it happens — so the router moves and nothing
 * supplies content for the new route. In view mode the admin itself does not
 * navigate on a click, so the bridge pushes nothing; the hypothesis this test
 * exists to settle is that the frontend does not fetch either.
 *
 * Edit mode is NOT this: links are inert there by design, which is why the
 * first attempt to reproduce this found nothing.
 */
test.describe('View mode link navigation', () => {
  test('following an internal link does not land on not-found', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const failed: string[] = [];
    const afterClick: string[] = [];
    let clicked = false;
    page.on('response', (r) => {
      if (clicked) afterClick.push(`${r.status()} ${r.url()}`);
      if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
    });

    await helper.login();
    await helper.navigateToView('/test-page');

    const iframe = helper.getIframe();
    const link = iframe.locator('a[href$="/target-page"]').first();
    await expect(link, 'the fixture link the test navigates by').toBeVisible({ timeout: 15000 });

    clicked = true;
    await link.click();

    // The target renders its own content. Asserting on that rather than on the
    // URL: the bug is that the route changes and the page does not follow.
    await expect(
      iframe.locator('text=/Page Not Found|not available or has been moved/i'),
      `landed on not-found after following the link.\n` +
        `requests after the click:\n  ${afterClick.join('\n  ') || '(none — nothing was fetched for the new route)'}\n` +
        `failed requests:\n  ${failed.join('\n  ') || '(none)'}`,
    ).toHaveCount(0, { timeout: 10000 });
  });
});
