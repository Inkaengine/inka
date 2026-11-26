import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

/**
 * The More menu's entries that @actions gates.
 *
 * A Plug registers its children ONCE, on mount — usePlug's effect takes the
 * `dependencies` prop as its whole dependency list, and that defaults to [].
 * With SSR a server render fills the store before the menu mounts, so core
 * never had to think about it. In bridge mode there is no server render: the
 * menu mounts while the content GET carrying @actions is still in flight, so
 * every entry written as `{someAction && <li/>}` registered as `false` and no
 * later render replaced it. Rules and URL Management were simply absent, for
 * every user.
 *
 * controlpanel-content-rules.spec.ts covers Rules through the screen it opens.
 * This is URL Management, which nothing else reaches, and it is deliberately
 * about the MENU: the failure is a missing entry, not a broken destination.
 */
const FOLDER = '/_test_data';

test.describe('Toolbar More menu', () => {
  test('offers the entries @actions gates, which arrive after it mounts', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await page.goto(`${helper.adminUrl}${FOLDER}`);
    await page
      .locator('#toolbar button[aria-label="More"], #toolbar .more')
      .first()
      .click();
    const menu = page.locator('.menu-more');
    await expect(menu).toBeVisible();

    // object_buttons.redirection — the entry with no other coverage.
    await expect(menu.locator('a[href$="/aliases"]')).toHaveCount(1);
    // object.contentrules, on a folder, which is what can hold rules.
    await expect(menu.locator('a[href$="/rules"]')).toHaveCount(1);
  });
});
