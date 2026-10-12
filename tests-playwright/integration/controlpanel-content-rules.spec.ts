import { test, expect, type Page } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

/**
 * Content rules, end to end through the admin: add a rule in the control
 * panel, give it a condition and an action, and assign it to a folder.
 *
 * tests-playwright/api/content-rules.spec.ts pins the endpoints; this pins the
 * three screens a site manager uses on top of them. Each test signs in for its
 * own session, so the rules it adds are its own.
 */
const FOLDER = '/_test_data';
const RULE = 'Tell reviewers';

async function addRule(page: Page, helper: AdminUIHelper) {
  await page.goto(`${helper.adminUrl}/controlpanel/rules/add`);
  const form = page.locator('#page-rule-add');
  await form
    .locator('.field')
    .filter({ hasText: 'Please set a descriptive title' })
    .locator('input')
    .fill(RULE);
  const event = form.locator('.field').filter({ hasText: 'Triggering event' });
  await event.locator('.react-select__control').click();
  await page.locator('.react-select__option', { hasText: 'Workflow state changed' }).click();
  await expect(event).toContainText('Workflow state changed');
  // The form starts with the rule switched off.
  await form.getByText('Enabled', { exact: true }).click();
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/controlpanel\/rules$/, { timeout: 15000 });
  return page.locator('#page-rules tr', { hasText: RULE });
}

test.describe('Content rules', () => {
  test('a rule added in the control panel is listed, not yet assigned', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    const row = await addRule(page, helper);
    await expect(row).toHaveCount(1, { timeout: 15000 });
    await expect(row).toContainText('Workflow state changed');
    await expect(row).toContainText('not assigned');
  });

  test('a rule is given a condition and an action', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    const row = await addRule(page, helper);
    await row.getByRole('button', { name: 'Configure' }).click();
    await expect(page).toHaveURL(/\/controlpanel\/rules\/[^/]+\/configure$/);
    const configure = page.locator('#page-rule-configure');
    await expect(configure).toContainText(RULE);

    // Condition: only when the item is now pending review.
    const conditions = configure.locator('.column', { hasText: 'If all of the following conditions are met' });
    await conditions.locator('.ui.dropdown').click();
    await conditions.getByRole('option', { name: 'Workflow state', exact: true }).click();
    await conditions.getByRole('button', { name: 'Add' }).click();
    const modal = page.locator('.ui.modal');
    await expect(modal).toBeVisible();
    await modal.locator('.react-select__control').click();
    await page.locator('.react-select__option', { hasText: 'Pending review' }).click();
    await modal.getByRole('button', { name: 'Save' }).click();
    await expect(modal).toBeHidden();
    // Plone sends the summary's message id with its placeholders.
    await expect(configure).toContainText('Workflow states are: ${states}', { timeout: 10000 });

    // Action: email the reviewers.
    const actions = configure.locator('.column', { hasText: 'Perform the following actions' });
    await actions.locator('.ui.dropdown').click();
    await actions.getByRole('option', { name: 'Send email', exact: true }).click();
    await actions.getByRole('button', { name: 'Add' }).click();
    await expect(modal).toBeVisible();
    await modal.locator('#field-subject').fill('Please review');
    await modal.locator('#field-recipients').fill('reviewers@example.com');
    await modal.locator('#field-message').fill('Something is waiting for your review.');
    await modal.getByRole('button', { name: 'Save' }).click();
    await expect(modal).toBeHidden();
    await expect(configure).toContainText('Email report to ${recipients}', {
      timeout: 10000,
    });
  });

  test('a rule assigned to a folder is active there', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await addRule(page, helper);

    await page.goto(`${helper.adminUrl}${FOLDER}/rules`);
    const rules = page.locator('#rules');
    await rules.locator('.ui.selection.dropdown').click();
    await rules.locator('.ui.selection.dropdown .item', { hasText: RULE }).click();
    await rules.getByRole('button', { name: 'Add' }).click();

    const assigned = rules.locator('tbody tr', { hasText: RULE });
    await expect(assigned).toHaveCount(1, { timeout: 10000 });
    await expect(assigned).toContainText('Workflow state changed');
  });
});
