/**
 * Tests for the Nuxt header: site name "Inka" and global search.
 *
 * The header search icon expands into an input field. Submitting a query
 * navigates to /search?SearchableText=<query> where a search block renders
 * results with left-side facets.
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

test.use({
  storageState: 'tests-playwright/.generated/storage-nuxt.json',
});

test.describe('Nuxt header', () => {

  test('header displays "Inka" site name', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const iframe = helper.getIframe();

    await helper.login();
    await helper.navigateToView('/test-page');

    const header = iframe.locator('header');
    await expect(header).toBeVisible({ timeout: 15000 });
    // Match the site-name span exactly — `text=Inka` is a substring
    // selector and would also match navigation links like "Inka
    // Documentation" added when docs got linked into the nav.
    await expect(header.getByText('Inka', { exact: true })).toBeVisible();
  });

  test('search icon expands into input field', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const iframe = helper.getIframe();

    await helper.login();
    await helper.navigateToView('/test-page');

    const header = iframe.locator('header');
    await expect(header).toBeVisible({ timeout: 15000 });

    // Search input should not be visible initially
    await expect(header.locator('input[placeholder="Search..."]')).not.toBeVisible();

    // Click the search icon
    const searchButton = header.locator('button[aria-label="Search"]');
    await expect(searchButton).toBeVisible();
    await searchButton.click();

    // Input should now be visible and focused
    const searchInput = header.locator('input[placeholder="Search..."]');
    await expect(searchInput).toBeVisible();
    await expect(searchInput).toBeFocused();

    // Pressing Escape should close the search input
    await searchInput.press('Escape');
    await expect(searchInput).not.toBeVisible();
    await expect(searchButton).toBeVisible();
  });

  test('header search navigates to search page with results', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const iframe = helper.getIframe();

    await helper.login();
    await helper.navigateToView('/test-page');

    const header = iframe.locator('header');
    await expect(header).toBeVisible({ timeout: 15000 });

    // Open search, type query, submit
    const searchButton = header.locator('button[aria-label="Search"]');
    await searchButton.click();
    const searchInput = header.locator('input[placeholder="Search..."]');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('test');
    await searchInput.press('Enter');

    // Wait for the search page to load in the iframe
    const searchBlock = iframe.locator('.search-block');
    await expect(searchBlock).toBeVisible({ timeout: 30000 });

    // The search input on the search page should have the query pre-filled
    const pageSearchInput = searchBlock.locator('input[name="SearchableText"]');
    await expect(pageSearchInput).toBeVisible();
    await expect(pageSearchInput).toHaveValue('test');

    // Left-side facets should be in an aside element
    const facetsSidebar = searchBlock.locator('aside.search-facets');
    await expect(facetsSidebar).toBeVisible();

    // Content Type facet should be present
    await expect(facetsSidebar.locator('text=Content Type')).toBeVisible();

    // Search results should be visible
    const results = searchBlock.locator('.search-results [data-block-uid]');
    await expect(results.first()).toBeVisible({ timeout: 30000 });
    const count = await results.count();
    expect(count).toBeGreaterThan(0);
  });

  test('header search from search page updates results', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const iframe = helper.getIframe();

    await helper.login();
    await helper.navigateToView('/test-page');

    const header = iframe.locator('header');
    await expect(header).toBeVisible({ timeout: 15000 });

    // First header search: navigate to search page
    const searchButton = header.locator('button[aria-label="Search"]');
    await searchButton.click();
    const headerInput = header.locator('input[placeholder="Search..."]');
    await headerInput.fill('page');
    await headerInput.press('Enter');

    const searchBlock = iframe.locator('.search-block');
    await expect(searchBlock).toBeVisible({ timeout: 30000 });

    // Wait for initial results
    const results = searchBlock.locator('.search-results [data-block-uid]');
    await expect(results.first()).toBeVisible({ timeout: 30000 });

    // Second header search while already on search page: use header search again
    const searchButton2 = header.locator('button[aria-label="Search"]');
    await searchButton2.click();
    const headerInput2 = header.locator('input[placeholder="Search..."]');
    await expect(headerInput2).toBeVisible();
    await headerInput2.fill('news');
    await headerInput2.press('Enter');

    // The search block input should now have the new query
    const pageSearchInput = searchBlock.locator('input[name="SearchableText"]');
    await expect(pageSearchInput).toHaveValue('news', { timeout: 15000 });

    // Results should still be visible with the new query
    await expect(results.first()).toBeVisible({ timeout: 30000 });
  });
});
