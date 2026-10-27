/**
 * A remembered frontend that is now only a publish URL opens its edit URL.
 *
 * The iframe_url cookie remembers the frontend an editor last had open, for a
 * week. A frontend can later gain an editing build at its own address, with
 * its old address kept as its publish URL (`Name|EditURL|PublishURL`). Its
 * returning editors still remember the old address: a site they cannot edit
 * through. The admin opens that frontend's edit URL instead, and remembers that
 * from then on.
 *
 * Both addresses serve the test frontend, as different origins, so the old one
 * would load too: the test tells them apart by the iframe's address.
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';
import { PORTS, URLS } from '../ports';

const EDIT = `http://localhost:${PORTS.testFrontend}`;
const PUBLISH = `http://127.0.0.1:${PORTS.testFrontend}`;

test.describe('a remembered publish URL', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().addCookies([
      {
        name: `saved_urls_${PORTS.voltoSsr}`,
        value: `Site|${EDIT}|${PUBLISH}`,
        url: URLS.voltoSsr,
      },
      {
        // What the editor last had open, before the frontend got its own
        // editing address.
        name: `iframe_url_${PORTS.voltoSsr}`,
        value: PUBLISH,
        url: URLS.voltoSsr,
      },
    ]);
  });

  test("opens that frontend's edit URL, and remembers it", async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const iframe = page.locator('#previewIframe');
    await expect(iframe).toHaveAttribute('src', new RegExp(`^${EDIT}/`));
    await expect(
      helper.getIframe().locator('[data-block-uid]').first(),
    ).toBeVisible();

    const remembered = (await page.context().cookies(URLS.voltoSsr)).find(
      (c) => c.name === `iframe_url_${PORTS.voltoSsr}`,
    );
    // js-cookie writes it URL-encoded.
    expect(decodeURIComponent(remembered?.value ?? '')).toBe(EDIT);
  });
});
