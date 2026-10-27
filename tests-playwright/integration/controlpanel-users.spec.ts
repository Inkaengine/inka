import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

/**
 * The Users control panel: list the site's users, and add one.
 *
 * The panel draws nothing until the usergroup and security settings, the roles,
 * the groups, the users and the user schema have all loaded; tests-playwright/
 * api/users-and-groups.spec.ts pins each of those. This pins that the screen an
 * administrator actually uses works on top of them: the users are rows, and a
 * user added through "Add user" becomes one.
 */
test.describe('Users control panel', () => {
  test('lists the site users with their roles', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await page.goto(`${helper.adminUrl}/controlpanel/users`);

    const rows = page.locator('.users-control-panel tbody tr');
    await expect(rows.filter({ hasText: 'Admin User' })).toHaveCount(1, { timeout: 30000 });
    await expect(rows.filter({ hasText: 'Ed Editor' })).toHaveCount(1);
    // A column per assignable role, so the panel can tick what each user holds.
    await expect(page.locator('.users-control-panel thead')).toContainText('Site Administrator');
  });

  test('a user added through the form is listed', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await page.goto(`${helper.adminUrl}/controlpanel/users`);
    const rows = page.locator('.users-control-panel tbody tr');
    await expect(rows.filter({ hasText: 'Admin User' })).toHaveCount(1, { timeout: 30000 });

    await page.locator('#toolbar-add').click();
    const modal = page.locator('.ui.modal');
    await expect(modal).toBeVisible();
    await modal.locator('#field-fullname').fill('Jo Smith');
    await modal.locator('#field-email').fill('jo@example.com');
    await modal.locator('#field-username').fill('jsmith');
    await modal.locator('#field-password').fill('a-long-password');
    await modal.getByRole('button', { name: 'Save' }).click();

    await expect(modal).toBeHidden({ timeout: 10000 });
    await expect(rows.filter({ hasText: 'Jo Smith' })).toHaveCount(1, { timeout: 10000 });
  });
});
