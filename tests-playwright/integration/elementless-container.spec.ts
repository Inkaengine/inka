/**
 * A container that draws no element of its own is where its children are.
 *
 * The test frontend draws an accordion of one panel as just that panel — a
 * <details>, no group element around it — the way a design system draws a
 * single collapsible section. The accordion block still holds the panel in
 * the data. Selected from its panel, it is outlined around the panel it is
 * drawn by; given a second panel, it draws its group element again.
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

test.describe('A container with no element of its own', () => {
  test('is selected through its child and outlined around it', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/accordion-single-page');
    const iframe = helper.getIframe();

    await expect(iframe.locator('details[data-block-uid="panel-only"]')).toBeVisible();
    await expect(iframe.locator('[data-block-uid="accordion-single"]')).toHaveCount(0);

    // A child, then up: to the panel, then to the accordion it is drawn by.
    // (Clicking the panel itself lands on its <summary>, which toggles it.)
    await helper.clickBlockInIframe('only-text');
    await helper.waitForBlockSelectedInAdmin('only-text');
    await helper.navigateToParentBlock('panel-only');
    await helper.waitForBlockSelectedInAdmin('panel-only');
    await helper.navigateToParentBlock('accordion-single');
    await helper.waitForBlockSelectedInAdmin('accordion-single');

    const selected = await helper.isBlockSelectedInIframe('accordion-single');
    expect(selected.ok, selected.reason).toBe(true);
    // The outline is the panel's box: the accordion is drawn by it.
    const panelBox = await helper.getBlockBoundingBoxInIframe('panel-only');
    const accordionBox = await helper.getBlockBoundingBoxInIframe('accordion-single');
    expect(accordionBox).toEqual(panelBox);
  });

  test('draws its own element again once it holds two children', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/accordion-single-page');
    const iframe = helper.getIframe();

    await helper.clickBlockInIframe('only-text');
    await helper.waitForBlockSelectedInAdmin('only-text');
    await helper.navigateToParentBlock('panel-only');
    await helper.waitForBlockSelectedInAdmin('panel-only');
    await helper.clickAddBlockButton();

    const group = iframe.locator('[data-block-uid="accordion-single"]');
    await expect(group, 'two panels are a group, drawn as one').toBeVisible();
    await expect(group.locator('details[data-block-uid]')).toHaveCount(2);
    await expect(group.locator('details[data-block-uid="panel-only"]')).toHaveCount(1);
  });
});
