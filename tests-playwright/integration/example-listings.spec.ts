/**
 * Example listing-variant blocks: Related Items, Search Shortcuts, RSS Feed.
 * Each expands via expandListingBlocks + a custom fetcher (packages/helpers)
 * into standard item blocks — no bespoke renderer, so the expanded items render
 * directly (not wrapped in the source block's data-block-uid); assert at the
 * iframe level.
 *
 * Fixture (example-listings-page): relatedItems summaries (Related A/B),
 * subjects [news, plone]; a this-page search-shortcuts (news, plone) and a
 * site-wide one (Keywords = news/plone/events), and an RSS block → the mock stub.
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

test.describe('Example listing blocks', () => {
  test('Related Items renders the page relation field items', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/example-listings-page');
    const iframe = helper.getIframe();
    await expect(iframe.getByRole('heading', { name: 'Related A' })).toBeVisible();
    await expect(iframe.getByRole('heading', { name: 'Related B' })).toBeVisible();
  });

  test('Search Shortcuts link values to a faceted search (this-page + site-wide)', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/example-listings-page');
    const iframe = helper.getIframe();
    // ss-page (this page's subjects: news, plone) + ss-site (every keyword the
    // index knows: news, newsletter, newsroom, plone, events) = 7 facet links.
    await expect(iframe.locator('a[href^="/search?facet.Subject="]')).toHaveCount(7);
    // `events` exists only in the index vocabulary → proves site-wide mode.
    await expect(iframe.locator('a[href="/search?facet.Subject=events"]')).toHaveCount(1);
    // `news` comes from BOTH blocks → proves this-page mode also rendered.
    await expect(iframe.locator('a[href="/search?facet.Subject=news"]')).toHaveCount(2);
    await expect(iframe.locator('a[href="/search?facet.Subject=plone"]')).toHaveCount(2);
  });

  test('RSS Feed renders the feed entries', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/example-listings-page');
    const iframe = helper.getIframe();
    await expect(iframe.getByRole('heading', { name: 'Feed One' })).toBeVisible();
    await expect(iframe.getByRole('heading', { name: 'Feed Two' })).toBeVisible();
  });
});
