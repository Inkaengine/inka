/**
 * Form block tests: rendering, validation, submission, and adding new fields.
 *
 * Tests the form block at /form-test-page which has:
 * - Full Name (text, required)
 * - Email Address (from, required)
 * - Subject (select, required, options: General Inquiry/Bug Report/Feature Request)
 * - Message (textarea, optional)
 * - Priority (single_choice, optional, options: Low/Medium/High)
 * - I agree to the terms (checkbox, required)
 *
 * Validation and submission tests run after saving (view mode) so the hydra bridge
 * doesn't intercept form button clicks.
 *
 * The page carries a SECOND form block (`form-block-2`), so every locator here
 * is scoped to `form-block-1`. Page-wide `locator('form')` / `input[name=…]`
 * matched both and died on strict mode the moment that fixture arrived.
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

// Nuxt-specific: uses Nuxt iframe which has full form block implementation
test.use({
  storageState: 'tests-playwright/.generated/storage-nuxt.json',
});

test.describe('Form Block', () => {

  test('renders form fields and validates required fields on submit', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const iframe = helper.getIframe();

    await helper.login();
    await helper.navigateToEdit('/form-test-page');
    await helper.waitForIframeReady();

    // Wait for the form to render in edit mode
    const formBlock = iframe.locator('[data-block-uid="form-block-1"] form');
    await expect(formBlock).toBeVisible({ timeout: 10000 });

    // Save to switch to view mode — form interactions work without bridge interference
    await helper.saveContent();

    // Re-locate the SAME block in view mode (the template binds
    // data-block-uid outside edit mode too, so the scope survives the save).
    const block = iframe.locator('[data-block-uid="form-block-1"]');
    await expect(block.locator('form')).toBeVisible({ timeout: 10000 });

    // Verify fields rendered
    await expect(block.locator('input[name="field-name"]')).toBeVisible();
    await expect(block.locator('input[name="field-email"]')).toBeVisible();
    await expect(block.locator('select[name="field-subject"]')).toBeVisible();
    await expect(block.locator('textarea[name="field-message"]')).toBeVisible();
    await expect(block.locator('input[type="checkbox"][name="field-agree"]')).toBeVisible();

    // Verify required indicators (*)
    const nameLabel = block.locator('.form-field:has(input[name="field-name"]) label');
    await expect(nameLabel).toContainText('*');

    // Submit empty form — should show validation errors on required fields
    const submitButton = block.locator('.form-submit');
    await submitButton.click();

    // Errors should appear for all required fields
    const nameError = block.locator('.form-field:has(input[name="field-name"]) .form-error');
    await expect(nameError).toBeVisible({ timeout: 5000 });
    await expect(nameError).toContainText('required');

    const emailError = block.locator('.form-field:has(input[name="field-email"]) .form-error');
    await expect(emailError).toBeVisible();

    const subjectError = block.locator('.form-field:has(select[name="field-subject"]) .form-error');
    await expect(subjectError).toBeVisible();

    const agreeError = block.locator('.form-field:has(input[name="field-agree"]) .form-error');
    await expect(agreeError).toBeVisible();

    // No success message
    await expect(block.locator('.form-success')).toHaveCount(0);

    // Fill required fields and submit
    await block.locator('input[name="field-name"]').fill('Test User');
    await block.locator('input[name="field-email"]').fill('test@example.com');
    await block.locator('select[name="field-subject"]').selectOption('Bug Report');
    await block.locator('input[name="field-agree"]').check();
    await submitButton.click();

    // Should show success message
    await expect(block.locator('.form-success')).toBeVisible({ timeout: 5000 });
  });

  test('validates email format on from field', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const iframe = helper.getIframe();

    await helper.login();
    await helper.navigateToEdit('/form-test-page');
    await helper.waitForIframeReady();

    const formBlock = iframe.locator('[data-block-uid="form-block-1"] form');
    await expect(formBlock).toBeVisible({ timeout: 10000 });

    // Save to switch to view mode
    await helper.saveContent();
    const block = iframe.locator('[data-block-uid="form-block-1"]');
    await expect(block.locator('form')).toBeVisible({ timeout: 10000 });

    // Fill all required fields but use invalid email
    await block.locator('input[name="field-name"]').fill('Test User');
    await block.locator('input[name="field-email"]').fill('not-an-email');
    await block.locator('select[name="field-subject"]').selectOption('General Inquiry');
    await block.locator('input[name="field-agree"]').check();

    await block.locator('.form-submit').click();

    // Email error should appear
    const emailError = block.locator('.form-field:has(input[name="field-email"]) .form-error');
    await expect(emailError).toBeVisible({ timeout: 5000 });
    await expect(emailError).toContainText('valid email');

    // Fix the email and resubmit
    await block.locator('input[name="field-email"]').fill('test@example.com');
    await block.locator('.form-submit').click();

    await expect(block.locator('.form-success')).toBeVisible({ timeout: 5000 });
  });

  test('can add a new field to the form via block chooser', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const iframe = helper.getIframe();

    await helper.login();
    await helper.navigateToEdit('/form-test-page');
    await helper.waitForIframeReady();

    // Wait for form fields to render (this form's — the page has two)
    const formFields = iframe.locator(
      '[data-block-uid="form-block-1"] .form-field[data-block-uid]',
    );
    await expect(formFields.first()).toBeVisible({ timeout: 10000 });
    // How many fields the fixture ships is incidental — this test is about the
    // chooser adding ONE. Hardcoding the count made the page un-extendable:
    // giving the form's unused field types a content example broke it.
    const initialCount = await formFields.count();
    expect(initialCount).toBeGreaterThan(0);

    await helper.getStableBlockCount();

    // Select the form block via sidebar — press Escape to get to page level
    await helper.waitForSidebarOpen();
    await helper.escapeToParent();

    // Drill down to the form block in the sidebar
    const pageChildBlocks = page.locator('#sidebar-order .child-blocks-widget');
    await expect(pageChildBlocks).toBeVisible({ timeout: 5000 });
    // By its TITLE, not by 'Form': hasText is a case-insensitive substring, so
    // the second block ("A second form on the same page") matched too.
    const formItem = pageChildBlocks.locator('.child-block-item', {
      hasText: 'Contact Form',
    });
    await expect(formItem).toBeVisible({ timeout: 5000 });
    await formItem.click();

    // Click the first field (Full Name) to select it
    const nameItem = page.locator('.child-block-item', { hasText: 'Full Name' });
    await expect(nameItem).toBeVisible({ timeout: 5000 });
    await nameItem.click();

    // Wait for the field to be selected
    await helper.waitForIframeBlockHandle('field-name', 5000);
    const toolbar = page.locator('.quanta-toolbar');
    await expect(toolbar).toBeVisible({ timeout: 5000 });

    // Click the add button
    const addButton = page.locator('.volto-hydra-add-button');
    await expect(addButton).toBeVisible({ timeout: 5000 });
    await addButton.click();

    // Block chooser opens with form field types
    const blockChooser = page.locator('.blocks-chooser');
    await expect(blockChooser).toBeVisible({ timeout: 5000 });

    // Select the Date field type. Expand "Common" only when the button is NOT
    // already on offer: the section header is a TOGGLE, so clicking it while
    // the section is open collapses it — Playwright then watched the button it
    // had just resolved slide out of view and retried the click for 45s.
    const dateButton = blockChooser.getByRole('button', { name: /Date/i });
    if (!(await dateButton.isVisible().catch(() => false))) {
      await blockChooser.locator('text=Common').first().click();
    }
    await dateButton.click();
    await blockChooser.waitFor({ state: 'hidden', timeout: 5000 });

    // Wait for the new field to appear (count goes from 6 to 7)
    await expect(formFields).toHaveCount(initialCount + 1, { timeout: 10000 });
  });
});
