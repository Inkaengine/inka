/**
 * Tests for block sync and type selection.
 *
 * Tests the Phase 2 features:
 * - Type selection: choosing block types for container items (via inheritSchemaFrom)
 * - FieldMappingWidget: mapping source fields to target block fields
 * - Block sync: inheriting non-mapped fields from referenced type
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

test.describe('Block Sync - Listing Block Item Type', () => {
  test('listing block shows variation selector in sidebar', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Click on listing block (block-9-listing)
    await helper.clickBlockInIframe('block-9-listing');
    await helper.waitForSidebarOpen();

    // Open Block tab
    await helper.openSidebarTab('Block');

    // Verify variation field exists
    const hasItemTypeField = await helper.hasSidebarField('variation');
    expect(hasItemTypeField).toBe(true);
  });

  test('changing variation from teaser to image updates frontend rendering', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-9-listing';
    const iframe = helper.getIframe();

    // Initially (BEFORE clicking) should have teaser items - verify data has variation="teaser"
    // Expanded items have data-block-uid="block-9-listing" AND class="teaser-block" on same element
    const teaserItems = iframe.locator(`[data-block-uid="${blockId}"].teaser-block`);
    await expect(teaserItems.first()).toBeVisible({ timeout: 10000 });

    // Verify it's NOT showing summary layout (which has image on the side with flexbox)
    // Teaser layout has image on top (no flex display)
    const summaryItems = iframe.locator(`[data-block-uid="${blockId}"].summary-item-block`);
    await expect(summaryItems).toHaveCount(0);

    // Now click on listing block (scrolls to it)
    await helper.clickBlockInIframe(blockId);
    await helper.waitForSidebarOpen();
    await helper.openSidebarTab('Block');

    // Verify teaser blocks render with correct field-mapped data
    // Field mapping for teaser: @id->href, title->title, description->description, image->preview_image
    const firstTeaser = teaserItems.first();

    // Check teaser has a title (from title field mapping)
    // Test frontend uses h3, Nuxt uses h5
    const teaserTitle = firstTeaser.locator(':is(h3, h4, h5, h6)').first();
    await expect(teaserTitle).toBeVisible();
    const titleText = await teaserTitle.textContent();
    expect(titleText).toBeTruthy();

    // Check teaser has a link with href (from @id field mapping)
    // Test frontend uses absolute URLs, Nuxt uses relative
    const teaserLink = firstTeaser.locator('a').first();
    const teaserHref = await teaserLink.getAttribute('href');
    expect(teaserHref).toBeTruthy();
    expect(teaserHref.length).toBeGreaterThan(1);

    // Find the variation field's React Select
    const variationField = page.locator('#sidebar-properties .field-wrapper-variation');
    await expect(variationField).toBeVisible();

    // Verify current value is "Teaser"
    await expect(variationField.locator('.react-select__single-value')).toContainText('Teaser');

    // Click on the React Select control to open dropdown
    const selectControl = variationField.locator('.react-select__control');
    await selectControl.click();

    // Wait for dropdown menu to appear
    const menu = page.locator('.react-select__menu');
    await menu.waitFor({ state: 'visible', timeout: 3000 });

    // Click on "Image" option
    const imageOption = menu.locator('.react-select__option', { hasText: 'Image' });
    await imageOption.click();

    // Wait for schema to update - "Image Defaults" fieldset appears when variation changes
    const imageDefaultsFieldset = page.locator('#blockform-fieldset-inherited_fields');
    await expect(imageDefaultsFieldset).toBeVisible({ timeout: 5000 });

    // The variation change is confirmed by the teasers going away — assert
    // that directly rather than waiting for the count to stop moving.
    await expect(teaserItems).toHaveCount(0, { timeout: 5000 });

    // Then wait for image blocks to appear
    // Image blocks: element with data-block-uid contains <img data-edit-media="url">
    const imageItems = iframe.locator(`[data-block-uid="${blockId}"] img[data-edit-media="url"]`);
    await expect(imageItems.first()).toBeVisible({ timeout: 5000 });

    // Verify no image editing overlay appears (listing items are readonly)
    // The image-upload-widget-toolbar is the inline editing UI that shouldn't appear on readonly blocks
    const imageOverlay = page.locator('.image-upload-widget-toolbar, .hydra-image-picker-inline');
    await expect(imageOverlay).toHaveCount(0);

    // Verify at least one image actually loaded (non-empty src and naturalWidth > 0)
    await expect(async () => {
      const count = await imageItems.count();
      for (let i = 0; i < count; i++) {
        const info = await imageItems.nth(i).evaluate(
          (el: HTMLImageElement) => ({ src: el.src, naturalWidth: el.naturalWidth })
        );
        if (info.src && info.naturalWidth > 0) return; // found a loaded image
      }
      throw new Error('No listing image has loaded successfully');
    }).toPass({ timeout: 10000 });

    // Check that at least one image is wrapped in a link with href (from @id field mapping)
    // Some listing items may not have images/links (placeholder items)
    const imageLink = iframe.locator(`[data-block-uid="${blockId}"] a`).first();
    if (await imageLink.count() > 0) {
      const linkHref = await imageLink.getAttribute('href');
      expect(linkHref).toBeTruthy();
      expect(linkHref.length).toBeGreaterThan(1);
    }

    // Verify toolbar doesn't show link/media buttons for readonly listing items
    // Click on one of the rendered image items to select it
    await imageItems.first().click();

    // The Quanta toolbar should be visible (selection box around block)
    const quantaToolbar = page.locator('.quanta-toolbar');
    await expect(quantaToolbar).toBeVisible();

    // But the link and image buttons should NOT be visible (listing items are readonly)
    // These buttons appear when focusedLinkableField or focusedMediaField are set
    const linkButton = quantaToolbar.locator('button[title*="link"]');
    const imageButton = quantaToolbar.locator('button[title*="image"]');
    await expect(linkButton).not.toBeVisible();
    await expect(imageButton).not.toBeVisible();
  });

  test('listing block shows fieldMapping widget with target type fields', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Click on listing block
    await helper.clickBlockInIframe('block-9-listing');
    await helper.waitForSidebarOpen();
    await helper.openSidebarTab('Block');

    // Verify fieldMapping field exists
    const hasFieldMappingField = await helper.hasSidebarField('fieldMapping');
    expect(hasFieldMappingField).toBe(true);

    // The field mapping widget should show source fields in the first column
    const fieldMappingWidget = page.locator('#sidebar-properties .field-wrapper-fieldMapping');
    const mappingTable = fieldMappingWidget.locator('.field-mapping-table');
    await expect(mappingTable).toBeVisible();

    // Check source field labels exist in the Source column (first td of each row)
    await expect(mappingTable.locator('td:first-child', { hasText: 'Title' })).toBeVisible();
    await expect(mappingTable.locator('td:first-child', { hasText: 'Description' })).toBeVisible();

    // Open the URL row's target dropdown to verify target type fields are available
    const urlRowDropdown = mappingTable.locator('tr', { hasText: 'URL' }).locator('.react-select__control');
    await urlRowDropdown.click();

    // Wait for dropdown menu to appear
    const menu = page.locator('.react-select__menu');
    await menu.waitFor({ state: 'visible', timeout: 3000 });

    // Verify all teaser block fields are available as options
    // Teaser has: href (Target), title (Title), head_title (Head title),
    // description (Description), preview_image (Image override)
    // React Select options are divs with class react-select__option
    const options = menu.locator('.react-select__option');
    // Should have at least 6 options: (none), Target, Title, Head title, Description, Image override
    await expect(options).toHaveCount(9); // All teaser properties + (none)

    // Verify specific teaser fields are present
    await expect(menu.locator('.react-select__option:has-text("(none)")')).toBeVisible();
    await expect(menu.locator('.react-select__option:has-text("Target")')).toBeVisible();
    await expect(menu.locator('.react-select__option:has-text("Description")')).toBeVisible();
    await expect(menu.locator('.react-select__option:has-text("Image override")')).toBeVisible();

    // Close dropdown by clicking elsewhere (not Escape, which deselects the block)
    await mappingTable.locator('th', { hasText: 'Source' }).click();
    await menu.waitFor({ state: 'hidden', timeout: 1000 });

    // Now change variation to "image" and verify dropdown options change
    const variationField = page.locator('#sidebar-properties .field-wrapper-variation');
    const variationSelect = variationField.locator('.react-select__control');
    await variationSelect.click();

    // Wait for variation dropdown menu
    const variationMenu = page.locator('.react-select__menu');
    await variationMenu.waitFor({ state: 'visible', timeout: 3000 });

    // Select "Image" option
    await variationMenu.locator('.react-select__option', { hasText: 'Image' }).click();

    // Wait for variation menu to close (confirms selection was made)
    await variationMenu.waitFor({ state: 'hidden', timeout: 3000 });

    // Wait for schema to update - fieldset title changes to "Image Defaults"
    const imageDefaultsFieldset = page.locator('#blockform-fieldset-inherited_fields');
    await expect(imageDefaultsFieldset).toBeVisible({ timeout: 5000 });

    // Verify smart defaults are recalculated for image block
    // The "Lead Image" row should now show a mapped value (smart defaults for image type)
    const imageRow = mappingTable.locator('tr').filter({ has: page.locator('td:first-child', { hasText: 'Lead Image' }) });
    const imageRowSelect = imageRow.locator('.react-select__single-value');
    // Image block's url field should be mapped (it's an image type field)
    await expect(imageRowSelect).toContainText('Image URL');

    // Scroll to show the fieldMapping table after variation change
    const sidebarWrapper = page.locator('.sidebar-content-wrapper');
    await sidebarWrapper.evaluate((el) => el.scrollTo(0, el.scrollHeight));

    // Re-query the URL row dropdown (use first-child filter to avoid matching "Image URL" text)
    const urlRowAfterChange = mappingTable.locator('tr').filter({ has: page.locator('td:first-child', { hasText: 'URL' }) });
    const urlRowDropdownAfterChange = urlRowAfterChange.locator('.react-select__control');
    await urlRowDropdownAfterChange.scrollIntoViewIfNeeded();
    await urlRowDropdownAfterChange.click();
    await menu.waitFor({ state: 'visible', timeout: 3000 });

    // Image block should have different fields than teaser
    // Verify "Target" (teaser-specific) is NOT present
    await expect(menu.locator('.react-select__option:has-text("Target")')).not.toBeVisible();

    // Verify image block has "Image URL" field (url with widget: 'image')
    await expect(menu.locator('.react-select__option:has-text("Image URL")')).toBeVisible();

    // Close dropdown by clicking elsewhere
    await mappingTable.locator('th', { hasText: 'Source' }).click();
    await menu.waitFor({ state: 'hidden', timeout: 1000 });
  });

  test('fieldMapping shows smart defaults based on field types', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Click on listing block
    await helper.clickBlockInIframe('block-9-listing');
    await helper.waitForSidebarOpen();
    await helper.openSidebarTab('Block');

    // The field mapping widget should show smart defaults by field type:
    // - @id (URL) → href target (link field - "Target")
    // - title source → title target (first string field - "Title")
    // - description source → description target (textarea field)
    // - image source → preview_image target (image field)
    const fieldMappingTable = page.locator('#sidebar-properties .field-mapping-table');
    await expect(fieldMappingTable).toBeVisible();

    // Check that URL row has a default mapping to "Target" (href/link field)
    const urlRow = fieldMappingTable.locator('tr').filter({ has: page.locator('td:first-child', { hasText: 'URL' }) });
    await expect(urlRow.locator('.react-select__single-value')).toContainText('Target');

    // Check that Title row has a default mapping to "Title" (first string field)
    const titleRow = fieldMappingTable.locator('tr').filter({ has: page.locator('td:first-child', { hasText: 'Title' }) });
    await expect(titleRow.locator('.react-select__single-value')).toContainText('Title');

    // Check that Description row has a default mapping to "Description"
    const descriptionRow = fieldMappingTable.locator('tr').filter({ has: page.locator('td:first-child', { hasText: 'Description' }) });
    await expect(descriptionRow.locator('.react-select__single-value')).toContainText('Description');

    // Check that Lead Image row has a default mapping to "Image override" (preview_image)
    const imageRow = fieldMappingTable.locator('tr').filter({ has: page.locator('td:first-child', { hasText: 'Lead Image' }) });
    await expect(imageRow.locator('.react-select__single-value')).toContainText('Image override');
  });

  test('Teaser Defaults fieldset hides fields that are in fieldMapping', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Click on listing block
    await helper.clickBlockInIframe('block-9-listing');
    await helper.waitForSidebarOpen();
    await helper.openSidebarTab('Block');

    // Scroll to the "Teaser Defaults" fieldset (it's expanded by default)
    const teaserDefaultsContent = page.locator('#blockform-fieldset-inherited_fields');
    await teaserDefaultsContent.scrollIntoViewIfNeeded();
    await expect(teaserDefaultsContent).toBeVisible();

    // The fieldset should NOT contain fields that are mapped:
    // - title is mapped (title -> title)
    // - description is mapped (description -> description)
    // - href/Target is mapped (@id -> href)
    // - preview_image/Image override is mapped (image -> preview_image)

    // But it SHOULD contain fields that are NOT mapped, like:
    // - overwrite (checkbox to enable custom content)
    // - head_title
    // - openLinkInNewTab

    // Mapped fields should NOT appear in Teaser Defaults
    // (they get their values from query results via fieldMapping)
    await expect(teaserDefaultsContent.locator('.field-wrapper-itemDefaults_title')).not.toBeVisible();
    await expect(teaserDefaultsContent.locator('.field-wrapper-itemDefaults_description')).not.toBeVisible();
    await expect(teaserDefaultsContent.locator('.field-wrapper-itemDefaults_href')).not.toBeVisible();
    await expect(teaserDefaultsContent.locator('.field-wrapper-itemDefaults_preview_image')).not.toBeVisible();

    // Non-mapped AND non-editable fields SHOULD appear in parent defaults
    // editableFields stay on child: ['href', 'title', 'description', 'preview_image', 'overwrite']
    // So head_title and openLinkInNewTab go to parent defaults
    await expect(teaserDefaultsContent.locator('.field-wrapper-itemDefaults_head_title')).toBeVisible();
    await expect(teaserDefaultsContent.locator('.field-wrapper-itemDefaults_openLinkInNewTab')).toBeVisible();
  });

  test('listing inside grid has valid titles on initial render', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const iframe = helper.getIframe();

    // Wait for the grid block to be visible
    const gridBlock = iframe.locator('[data-block-uid="block-8-grid"]');
    await expect(gridBlock).toBeVisible({ timeout: 10000 });

    // The grid contains a listing (listing-in-grid) which should be expanded to teaser items
    // Each expanded teaser has data-block-uid="listing-in-grid" (the listing's ID)
    const nestedListingItems = iframe.locator('[data-block-uid="listing-in-grid"]');

    // Wait for items to appear (expansion should happen during render)
    await expect(nestedListingItems.first()).toBeVisible({ timeout: 10000 });

    // Should have multiple items from the listing query
    const itemCount = await nestedListingItems.count();
    expect(itemCount).toBeGreaterThan(0);

    // Check that each item has a valid title (not empty)
    // These are teaser blocks with h3 or h5 titles
    for (let i = 0; i < Math.min(itemCount, 3); i++) {
      const item = nestedListingItems.nth(i);
      const title = item.locator('h3, h5');

      // Title should be visible and have text
      await expect(title).toBeVisible();
      const titleText = await title.textContent();
      expect(titleText).toBeTruthy();
      expect(titleText?.trim().length).toBeGreaterThan(0);
    }

    // Verify these items are readonly (no editable fields should be present)
    // The listing block ID should be in the readonly registry
    // Clicking on an item should NOT show media/link buttons in toolbar
    await nestedListingItems.first().click();

    // Toolbar should appear but without link/image buttons
    const toolbar = page.locator('.quanta-toolbar');
    await expect(toolbar).toBeVisible({ timeout: 5000 });

    // Link and image buttons should NOT be visible (listing items are readonly)
    const linkButton = toolbar.locator('button[title*="link"]');
    const imageButton = toolbar.locator('button[title*="image"]');
    await expect(linkButton).not.toBeVisible();
    await expect(imageButton).not.toBeVisible();
  });
});

test.describe('Block Sync - Search Block with Listing Container', () => {
  test('can select search block, facet, and listing block', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/search-test-page');

    // Click on the search block headline (waits for block, clicks specific element)
    await helper.clickBlockInIframe('search-block-1', {
      selector: 'h2[data-edit-text="headline"]',
    });

    // Verify the search block is selected (toolbar visible)
    const toolbar = page.locator('.quanta-toolbar');
    await expect(toolbar).toBeVisible({ timeout: 5000 });

    // Click on a facet title (waits for block - async expandListingBlocks must complete)
    await helper.clickBlockInIframe('facet-type', {
      selector: '[data-edit-text="title"]',
    });

    // Toolbar should be visible for the facet
    await expect(toolbar).toBeVisible({ timeout: 5000 });

    // Verify sidebar shows facet settings (title field)
    await helper.waitForSidebarOpen();
    await helper.openSidebarTab('Block');

    // Facet should have title field in sidebar
    const titleField = page.locator('#sidebar-properties .field-wrapper-title');
    await expect(titleField).toBeVisible({ timeout: 5000 });

    // Click on the listing child block inside search
    await helper.clickBlockInIframe('results-listing');

    // Toolbar should still be visible for the listing block
    await expect(toolbar).toBeVisible({ timeout: 5000 });
  });

  test('can change search listing item type to summary', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/search-test-page');

    const iframe = helper.getIframe();

    // Click on the listing block inside search
    await helper.clickBlockInIframe('results-listing');
    await helper.waitForSidebarOpen();
    await helper.openSidebarTab('Block');

    // Find the variation field's React Select
    const variationField = page.locator('#sidebar-properties .field-wrapper-variation');
    await expect(variationField).toBeVisible({ timeout: 5000 });

    // Click on the React Select control to open dropdown
    const selectControl = variationField.locator('.react-select__control');
    await selectControl.click();

    // Wait for dropdown menu to appear
    const menu = page.locator('.react-select__menu');
    await expect(menu).toBeVisible({ timeout: 5000 });

    // Verify Summary option exists and click it
    const summaryOption = menu.locator('.react-select__option', { hasText: 'Summary' });
    await expect(summaryOption).toBeVisible();
    await summaryOption.click();

    // Verify the value changed
    await expect(variationField.locator('.react-select__single-value')).toContainText('Summary');
  });

  test('search block listing container has no add buttons when at maxLength', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/search-test-page');

    // Click on the listing block (waits for async expandListingBlocks to complete)
    await helper.clickBlockInIframe('results-listing');

    // Toolbar should be visible
    const toolbar = page.locator('.quanta-toolbar');
    await expect(toolbar).toBeVisible({ timeout: 5000 });

    // Since maxLength=1 and there's already 1 listing block,
    // there should be no add block buttons (data-block-add markers should be hidden)
    // Check that no "+" buttons are visible in the listing container area
    const plusButtons = page.locator('.volto-hydra-add-button');
    await expect(plusButtons).toHaveCount(0);
  });

  test('search block filters results when user submits search form', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    // Use view mode - search is a frontend feature, not an editing feature
    await helper.navigateToView('/search-test-page');

    const iframe = helper.getIframe();

    // Wait for search block and initial results to be visible
    const searchBlock = iframe.locator('[data-block-uid="search-block-1"]');
    await expect(searchBlock).toBeVisible({ timeout: 10000 });

    // Get initial results count (listing items inside search results)
    const searchResults = searchBlock.locator('.search-results [data-block-uid]');
    await expect(searchResults.first()).toBeVisible({ timeout: 10000 });
    const initialCount = await searchResults.count();
    expect(initialCount).toBeGreaterThan(0);

    // Find the search input and enter a search term
    const searchInput = searchBlock.locator('input[name="SearchableText"]');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('accordion');

    // Submit the search form - this navigates iframe to ?SearchableText=accordion
    const searchButton = searchBlock.locator('button.search-submit-button');
    await searchButton.click();

    // Wait for iframe to reload by waiting for the search input to have the value
    // (indicates the page reloaded and read the URL param)
    const searchInputAfter = iframe.locator('[data-block-uid="search-block-1"] input[name="SearchableText"]');
    await expect(searchInputAfter).toHaveValue('accordion', { timeout: 10000 });

    const filteredResults = iframe.locator('[data-block-uid="search-block-1"] .search-results [data-block-uid]');

    // Wait for the RESULT of the re-fetch, and wait for the WHOLE result in one
    // step: filtered means fewer rows than before AND still some rows, since
    // accordion-test-page matches. Polling only for "fewer" accepts the empty
    // render the re-fetch passes through on its way to the filtered set — 0 is
    // less than 6 — and the next line then failed on a state the poll had just
    // approved. (`first()` being visible is no good either: the OLD rows
    // satisfy it, which is how this once read a stale 6-of-6.)
    await expect
      .poll(
        async () => {
          const count = await filteredResults.count();
          return count > 0 && count < initialCount ? 'filtered' : `count=${count}`;
        },
        {
          timeout: 10000,
          message:
            `search for "accordion" never settled on a filtered set (started at ${initialCount})`,
        },
      )
      .toBe('filtered');
  });

  test('search block filters results when user clicks facet checkbox', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();

    // Navigate to search page in VIEW mode (search is frontend-driven)
    await helper.navigateToView('/search-test-page');

    const iframe = helper.getIframe();

    // Wait for the search block to be visible
    const searchBlock = iframe.locator('[data-block-uid="search-block-1"]');
    await expect(searchBlock).toBeVisible({ timeout: 10000 });

    // Wait for initial results to load (all Documents)
    // Use data-block-uid selector which works across mock and Nuxt frontends
    const initialResults = iframe.locator('[data-block-uid="results-listing"]');
    await expect(initialResults.first()).toBeVisible({ timeout: 10000 });
    const initialCount = await initialResults.count();
    expect(initialCount).toBeGreaterThan(0);

    // Find the portal_type facet checkbox for "Image" (base query returns Documents, adding Image filter should return 0)
    const imageCheckbox = iframe.locator('.facet-checkbox[data-field="portal_type"][value="Image"]');
    await expect(imageCheckbox).toBeVisible({ timeout: 5000 });

    // Click the checkbox to filter by Image
    await imageCheckbox.click();

    // Wait for page to reload with facet filter
    // The checkbox should now be checked after reload
    const imageCheckboxAfter = iframe.locator('.facet-checkbox[data-field="portal_type"][value="Image"]');
    await expect(imageCheckboxAfter).toBeChecked({ timeout: 10000 });

    // Should have 0 results (base query filters to Documents, facet adds Image filter = no matches)
    // Use polling assertion — the old DOM may still be present briefly after navigation
    const filteredResults = iframe.locator('[data-block-uid="results-listing"]');
    await expect(filteredResults).toHaveCount(0, { timeout: 10000 });
  });

  test('can add a facet using add button', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/search-test-page');

    const iframe = helper.getIframe();

    // Count initial facets (wait for async expandListingBlocks to complete)
    const initialFacets = iframe.locator('.facet-item[data-block-uid]');
    // Wait for expandListingBlocks to finish, without asserting how many facets
    // the fixture happens to carry — that number is incidental here.
    await expect(initialFacets.first()).toBeVisible({ timeout: 10000 });
    const initialFacetCount = await initialFacets.count();

    // Wait for iframe to finish re-rendering after initial load —
    // expanding facets triggers multiple FORM_DATA updates to iframe.
    await helper.getStableBlockCount();

    // Select the facet entirely via sidebar to avoid clicking interactive
    // checkboxes in the iframe. Press Escape to get to page level, then
    // drill down: Search block → Content Type facet.
    await helper.waitForSidebarOpen();
    await helper.escapeToParent();

    const pageChildBlocks = page.locator('#sidebar-order .child-blocks-widget');
    await expect(pageChildBlocks).toBeVisible({ timeout: 5000 });
    const searchItem = pageChildBlocks.locator('.child-block-item', { hasText: 'Search' });
    await expect(searchItem).toBeVisible({ timeout: 5000 });
    await searchItem.click();

    // Now click the Content Type facet in the search block's child list
    const facetItem = page.locator('.child-block-item', { hasText: 'Content Type' });
    await expect(facetItem).toBeVisible({ timeout: 5000 });
    await facetItem.click();

    // Wait for facet to be selected and toolbar to appear
    await helper.waitForIframeBlockHandle('facet-type', 5000);
    const toolbar = page.locator('.quanta-toolbar');
    await expect(toolbar).toBeVisible({ timeout: 5000 });

    // Click the add button (should appear below the facet since data-block-add="bottom")
    const addButton = page.locator('.volto-hydra-add-button');
    await expect(addButton).toBeVisible({ timeout: 5000 });
    await addButton.scrollIntoViewIfNeeded();
    await addButton.click();

    // Block chooser opens (multiple facet types + slate/image are allowed)
    await helper.selectBlockType('checkboxFacet');

    // Wait for the new facet to be added (count goes from 3 to 4)
    const allFacets = iframe.locator('.facet-item[data-block-uid]');
    await expect(allFacets).toHaveCount(initialFacetCount + 1, { timeout: 10000 });

    // Find the new facet ID (not one of the known initial facets)
    const knownIds = ['facet-type', 'facet-state', 'facet-subject'];
    let newFacetId: string | null = null;
    for (let i = 0; i < 4; i++) {
      const uid = await allFacets.nth(i).getAttribute('data-block-uid');
      if (uid && !knownIds.includes(uid)) {
        newFacetId = uid;
        break;
      }
    }
    expect(newFacetId).not.toBeNull();

    // Wait for the new facet to be selected (should happen automatically after add)
    const newFacet = iframe.locator(`[data-block-uid="${newFacetId}"]`);
    await helper.waitForIframeBlockHandle(newFacetId!, 10000);

    // Wait for iframe blocks to stabilize — adding a facet triggers re-renders
    // that cause sidebar re-mounts, detaching react-select DOM nodes mid-click
    await helper.getStableBlockCount();
    await helper.waitForSidebarOpen();

    // Wait for sidebar to show the NEW facet (not the old "Content Type" facet)
    // The old facet has Label="Content Type"; new empty facet does not
    await expect(page.locator('#sidebar-properties')).not.toContainText('Content Type', { timeout: 5000 });

    // Find and select the field (review_state)
    const fieldWrapper = page.locator('#sidebar-properties .field-wrapper-field');
    await expect(fieldWrapper).toBeVisible({ timeout: 5000 });
    const fieldSelect = fieldWrapper.locator('.react-select__control');

    // Sidebar re-renders after adding a facet can close the dropdown between
    // opening it and clicking the option. Retry the whole sequence.
    const fieldMenu = page.locator('.react-select__menu');
    const reviewStateOption = fieldMenu.locator('.react-select__option', {
      hasText: /Review state|review_state/i,
    });
    await expect(async () => {
      await fieldSelect.click({ timeout: 1000 });
      await reviewStateOption.click({ timeout: 2000 });
    }).toPass({ timeout: 10000 });

    // Wait for field dropdown to close and sidebar to fully settle after data change.
    // Selecting a field triggers onChangeBlock → Redux → sidebar re-render cascade.
    // Wait for the selected value to appear in the control, confirming re-render is done.
    await fieldMenu.waitFor({ state: 'hidden', timeout: 3000 });
    await expect(fieldWrapper.locator('.react-select__single-value')).toContainText(
      /Review state|review_state/i,
      { timeout: 5000 },
    );

    // Selecting a field triggers onChangeBlock → Redux → FORM_DATA → iframe
    // re-render → BLOCK_SELECTED cascade. Wait for blocks to stabilize before
    // interacting with the toolbar, otherwise it can unmount mid-click.
    await helper.getStableBlockCount();

    // Convert the checkboxFacet to selectFacet via toolbar "Convert to" chooser
    // (fieldMappings on facet types enables this action)
    await expect(toolbar).toBeVisible({ timeout: 5000 });
    await helper.openConvertChooser();
    await helper.selectBlockType('selectFacet');

    // Verify the facet now renders as a dropdown (select element)
    // This waits for frontend to re-render with the new facet settings
    const facetDropdown = newFacet.locator('select.facet-select');
    await expect(facetDropdown).toBeVisible({ timeout: 5000 });

    // Verify the dropdown has the correct options for review_state
    const options = facetDropdown.locator('option');
    await expect(options).toHaveCount(4, { timeout: 5000 }); // Select..., Private, Pending, Published

    // Check specific option values
    await expect(options.nth(0)).toHaveText('Select...');
    await expect(options.nth(1)).toHaveText('Private');
    await expect(options.nth(2)).toHaveText('Pending');
    await expect(options.nth(3)).toHaveText('Published');

    // Verify the dropdown has the correct data-field attribute
    const dataField = await facetDropdown.getAttribute('data-field');
    expect(dataField).toBe('review_state');
  });
});

test.describe('Frontend-Driven Schema Enhancers', () => {
  test('gridBlock with schemaEnhancer recipe shows inherited defaults fieldset', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const iframe = helper.getIframe();

    // Click on a teaser inside gridBlock (this is inside the grid container)
    const gridCell = iframe.locator('[data-block-uid="manual-teaser"]');
    await expect(gridCell).toBeVisible({ timeout: 10000 });
    await gridCell.click();

    await helper.waitForSidebarOpen();
    await helper.openSidebarTab('Block');

    // Scroll to top of sidebar to see parent's settings
    const sidebarWrapper = page.locator('.sidebar-content-wrapper');
    await sidebarWrapper.evaluate((el) => el.scrollTo(0, 0));

    // Find the Grid section in sidebar (parent block settings)
    // Look for section with "Grid" nav title
    const gridSection = page.locator('.parent-block-section').filter({
      has: page.locator('.parent-nav', { hasText: /Grid/ }),
    }).first();
    await expect(gridSection).toBeVisible({ timeout: 5000 });

    // Type widget should start empty (no default) - verify placeholder is shown
    const variationSelect = gridSection.locator('.react-select__control').first();
    await expect(variationSelect).toBeVisible({ timeout: 5000 });
    await expect(variationSelect.locator('.react-select__placeholder')).toBeVisible();

    // No defaults fieldset should be visible yet (no type selected)
    await expect(gridSection.locator('text=Teaser Defaults')).not.toBeVisible();
    await expect(gridSection.locator('text=Image Defaults')).not.toBeVisible();

    // Select Teaser from the dropdown
    await variationSelect.click();
    const menu = page.locator('.react-select__menu');
    await menu.waitFor({ state: 'visible', timeout: 3000 });
    await menu.locator('.react-select__option', { hasText: 'Teaser' }).click();
    await menu.waitFor({ state: 'hidden', timeout: 3000 });

    // Verify inherited fields are present in Grid section (from teaser schema)
    // These fields are NOT in teaser's editableFields, so they get inherited to parent
    // head_title -> "Kicker" (renamed from "Head title" in Volto 19),
    // openLinkInNewTab -> "Open in a new tab", align -> "Alignment"
    //
    // The schemaEnhancer pipeline runs asynchronously after the Item Type
    // selection — wait for the resulting fieldset header to mount before
    // checking individual field labels, rather than racing the render.
    await gridSection.getByText('Teaser Defaults').waitFor({ state: 'visible' });

    // Use getByText (modern Playwright) instead of the legacy `text=` selector.
    // getByText matches the accessible-name-style text including labels for
    // form controls; the legacy text= selector kept missing the Kicker label
    // even though the page snapshot showed it rendered.
    const headTitleField = gridSection.getByText('Kicker', { exact: true });
    await expect(headTitleField).toBeVisible();

    const alignmentField = gridSection.getByText('Alignment', { exact: true });
    await expect(alignmentField).toBeVisible();

    // Verify "Customize teaser content" (overwrite) is NOT in Grid section
    // It's in editableFields so it stays on the child teaser
    await expect(gridSection.locator('text=Customize teaser content')).not.toBeVisible();
  });

  test('child teaser inside grid hides parent-owned fields', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const iframe = helper.getIframe();

    // Click on a child teaser inside gridBlock
    const manualTeaser = iframe.locator('[data-block-uid="manual-teaser"]');
    await expect(manualTeaser).toBeVisible();
    await manualTeaser.click();

    await helper.waitForSidebarOpen();
    await helper.openSidebarTab('Block');

    // PHASE 1: No type selected - children are independent, all fields visible
    // Grid has no default for variation, so childBlockConfig should NOT apply

    // All teaser fields should be visible (no hiding)
    expect(await helper.hasSidebarField('href')).toBe(true);
    expect(await helper.hasSidebarField('overwrite')).toBe(true);
    // align might be in a styling fieldset - check it exists somewhere
    const alignVisibleInitially = await helper.hasSidebarField('align');

    // Grid section should NOT show "Teaser Defaults" since no type selected
    const gridSection = page.locator('.parent-block-section').filter({
      has: page.locator('.parent-nav', { hasText: /Grid/ }),
    });
    await expect(gridSection.getByText('Teaser Defaults')).not.toBeVisible();

    // PHASE 2: Select a type - children become controlled, fields hidden
    // Find the variation dropdown and select "teaser"
    const variationSelect = gridSection.locator('.react-select__control').first();
    await expect(variationSelect).toBeVisible({ timeout: 5000 });
    await variationSelect.click();
    const menu = page.locator('.react-select__menu');
    await menu.locator('text=Teaser').click();
    await menu.waitFor({ state: 'hidden', timeout: 3000 });

    // Wait for schema to update after type selection
    await expect(gridSection.getByText('Teaser Defaults')).toBeVisible({ timeout: 5000 });

    // Now parent-owned fields should be hidden on the child teaser
    // editableFields for teaser are: href, title, description, preview_image, overwrite
    expect(await helper.hasSidebarField('href')).toBe(true);
    expect(await helper.hasSidebarField('overwrite')).toBe(true);

    // If align was visible before, it should now be hidden (moved to parent)
    if (alignVisibleInitially) {
      expect(await helper.hasSidebarField('align')).toBe(false);
    }

    // Verify alignment IS visible in Grid's parent section (inherited fields)
    expect(await helper.hasSidebarField('align-0-itemDefaults_styles', 'Grid')).toBe(true);
  });

  test('nested listing inside grid hides parent-owned fields when type selected', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const iframe = helper.getIframe();

    // Click on the listing block inside the grid (first match - the container)
    const listingInGrid = iframe.locator('[data-block-uid="listing-in-grid"]').first();
    await expect(listingInGrid).toBeVisible();
    await listingInGrid.click();

    await helper.waitForSidebarOpen();
    await helper.openSidebarTab('Block');

    // Find Grid section and select "teaser" as the item type
    const gridSection = page.locator('.parent-block-section').filter({
      has: page.locator('.parent-nav', { hasText: /Grid/ }),
    });
    await expect(gridSection).toBeVisible({ timeout: 5000 });

    // Select "teaser" in Grid's variation dropdown
    const variationSelect = gridSection.locator('.react-select__control').first();
    await expect(variationSelect).toBeVisible({ timeout: 5000 });
    await variationSelect.click();
    const menu = page.locator('.react-select__menu');
    await menu.locator('text=Teaser').click();
    await menu.waitFor({ state: 'hidden', timeout: 3000 });

    // Wait for Teaser Defaults to appear in Grid section
    await expect(gridSection.getByText('Teaser Defaults')).toBeVisible({ timeout: 5000 });

    // Now the listing block should hide parent-owned fields
    // The listing's "variation" field should NOT be visible (it's controlled by Grid)
    expect(await helper.hasSidebarField('variation')).toBe(false);

    // Parent-owned fields like openLinkInNewTab should NOT be visible
    expect(await helper.hasSidebarField('openLinkInNewTab')).toBe(false);

    // But the listing should still show its own fields like headline
    expect(await helper.hasSidebarField('headline')).toBe(true);
  });

  test('child block sidebar hides non-editable fields inside synced container', async ({ page }) => {
    // Regression: when a block with `childBlockConfig.editableFields` lives
    // inside a synced parent container (itemTypeField + variation set), its
    // non-editable fields must be hidden from the CHILD sidebar and surface
    // only on the PARENT's defaults area.
    //
    // Bug: Volto's applySchemaEnhancer invokes block enhancers without
    // passing blockId/blockPathMap. `hideParentOwnedFields` guarded
    // hydraContext fallback on those args being passed, so from Volto's
    // sidebar path the filter never ran. Fields stayed on the child.
    //
    // This test uses block-preset-grid/preset-teaser where variation is
    // pre-set in content (so we avoid flaky dropdown UI) and the teaser has
    // overwrite:true (so Volto's schema puts head_title in the default
    // fieldset). `head_title` is NOT in the fixture teaser's editableFields,
    // so if filtering works it should be hidden; if broken, it shows.
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const iframe = helper.getIframe();

    const teaser = iframe.locator('[data-block-uid="preset-teaser"]').first();
    await expect(teaser).toBeVisible();
    await teaser.click();
    await helper.waitForSidebarOpen();
    await helper.openSidebarTab('Block');

    // head_title is in schema.properties + in default fieldset (overwrite:true)
    // but NOT in editableFields → should be hidden from child sidebar.
    expect(
      await helper.hasSidebarField('head_title'),
      'non-editable field leaked onto child sidebar — hideParentOwnedFields filter did not run',
    ).toBe(false);

    // Sanity: editable fields stay on the child.
    expect(await helper.hasSidebarField('title')).toBe(true);
    expect(await helper.hasSidebarField('description')).toBe(true);
  });

  test('nested listing fieldMapping updates when parent type changes', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const iframe = helper.getIframe();

    // Click on the listing block inside the grid
    const listingInGrid = iframe.locator('[data-block-uid="listing-in-grid"]').first();
    await expect(listingInGrid).toBeVisible();
    await listingInGrid.click();

    await helper.waitForSidebarOpen();
    await helper.openSidebarTab('Block');

    // Find Grid section and select "teaser" as the item type
    const gridSection = page.locator('.parent-block-section').filter({
      has: page.locator('.parent-nav', { hasText: /Grid/ }),
    });
    await expect(gridSection).toBeVisible({ timeout: 5000 });

    // Select "teaser" in Grid's variation dropdown
    const variationSelect = gridSection.locator('.react-select__control').first();
    await expect(variationSelect).toBeVisible({ timeout: 5000 });
    await variationSelect.click();
    const menu = page.locator('.react-select__menu');
    await menu.locator('text=Teaser').click();
    await menu.waitFor({ state: 'hidden', timeout: 3000 });

    // Wait for Teaser Defaults to appear in Grid section
    await expect(gridSection.getByText('Teaser Defaults')).toBeVisible({ timeout: 5000 });

    // Scroll sidebar to show Field Mapping section
    const sidebarWrapper = page.locator('.sidebar-content-wrapper');
    await sidebarWrapper.evaluate((el) => el.scrollTo(0, el.scrollHeight));

    // Verify fieldMapping widget shows teaser target fields
    const fieldMappingWidget = page.locator('#sidebar-properties .field-wrapper-fieldMapping');
    const fieldMappingTable = fieldMappingWidget.locator('.field-mapping-table');
    await expect(fieldMappingTable).toBeVisible({ timeout: 5000 });

    // The fieldMapping should show teaser's target fields in the dropdowns
    // Check that "Target" (teaser's href field) is available as an option
    const urlRow = fieldMappingTable.locator('tr').filter({ has: page.locator('td:first-child', { hasText: 'URL' }) });
    await expect(urlRow.locator('.react-select__single-value')).toContainText('Target');

    // Now change Grid's variation to "image" and verify fieldMapping updates
    // First scroll back up to access the Grid section
    await sidebarWrapper.evaluate((el) => el.scrollTo(0, 0));
    await variationSelect.click();
    const menu2 = page.locator('.react-select__menu');
    await menu2.locator('text=Image').click();
    await menu2.waitFor({ state: 'hidden', timeout: 3000 });

    // Wait for Image Defaults to appear in Grid section
    await expect(gridSection.getByText('Image Defaults')).toBeVisible({ timeout: 5000 });

    // Scroll down again to check fieldMapping
    await sidebarWrapper.evaluate((el) => el.scrollTo(0, el.scrollHeight));

    // The fieldMapping should now show image's target fields (Image URL, Alt text)
    // Wait for the fieldMapping to update with image fields
    await expect(fieldMappingTable).toBeVisible({ timeout: 5000 });
    // The Lead Image row should map to "Image URL" (image's url field for src)
    const imageRow = fieldMappingTable.locator('tr').filter({ has: page.locator('td:first-child', { hasText: 'Lead Image' }) });
    await expect(imageRow.locator('.react-select__single-value')).toContainText('Image URL', { timeout: 5000 });
  });

  test('changing variation transforms child block types', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const iframe = helper.getIframe();

    // Click on a child teaser inside gridBlock (manual-teaser is a teaser)
    const manualTeaser = iframe.locator('[data-block-uid="manual-teaser"]');
    await expect(manualTeaser).toBeVisible({ timeout: 10000 });
    await manualTeaser.click();

    await helper.waitForSidebarOpen();
    await helper.openSidebarTab('Block');

    // Scroll to top of sidebar to see parent's settings
    const sidebarWrapper = page.locator('.sidebar-content-wrapper');
    await sidebarWrapper.evaluate((el) => el.scrollTo(0, 0));

    // Verify initial state - child is Teaser type (check breadcrumb)
    const childBreadcrumb = page.locator('.parent-block-section .parent-nav').last();
    await expect(childBreadcrumb).toContainText('Teaser', { timeout: 5000 });

    // Find the Grid section in sidebar
    const gridSection = page.locator('.parent-block-section').filter({
      has: page.locator('.parent-nav', { hasText: /Grid/ }),
    }).first();
    await expect(gridSection).toBeVisible({ timeout: 5000 });

    // Find the variation dropdown (type selector) and change to Image
    // The field renders as a react-select dropdown with computed choices
    const variationSelect = gridSection.locator('.react-select__control').first();
    await expect(variationSelect).toBeVisible({ timeout: 5000 });
    await variationSelect.click();
    const menu = page.locator('.react-select__menu');
    await menu.waitFor({ state: 'visible', timeout: 3000 });
    await menu.locator('.react-select__option', { hasText: 'Image' }).click();
    await menu.waitFor({ state: 'hidden', timeout: 3000 });

    // Verify defaults fieldset changed to Image
    const imageDefaultsFieldset = gridSection.locator('text=Image Defaults');
    await expect(imageDefaultsFieldset).toBeVisible({ timeout: 5000 });

    // Verify child block type changed - breadcrumb should now say Image
    await expect(childBreadcrumb).toContainText('Image', { timeout: 5000 });

    // Verify the grid has 6 items total (1 transformed teaser + 5 listing items)
    // If the listing's @type was wrongly changed to image, we'd only see 2 items
    // (the listing would be an image block, not expanding to 5 items)
    // Use polling — iframe re-renders asynchronously after variation change
    const gridItems = iframe.locator('[data-block-uid="block-8-grid"] [data-block-uid]');
    await expect.poll(async () => await gridItems.count(), { timeout: 10000 }).toBeGreaterThanOrEqual(6);

    // Click on the listing block to verify it's still a listing (not transformed to image)
    const listingBlock = iframe.locator('[data-block-uid="listing-in-grid"]').first();
    await listingBlock.click();

    // Verify listing-in-grid was selected
    await helper.waitForIframeBlockHandle('listing-in-grid');

    // Verify the listing block sidebar still shows listing settings
    // The listing's @type should still be "listing", only its variation changed to "image"
    // Look for the Listing section in parent blocks
    const listingSection = page.locator('.parent-block-section').filter({
      has: page.locator('.parent-nav', { hasText: /Listing/ }),
    }).first();
    await expect(listingSection).toBeVisible();

    // Verify that the Listing does NOT show "Image Defaults" - since the parent (Grid)
    // controls the type, only the Grid should show the defaults fieldset
    // The Listing's variation field should be hidden and it should not duplicate defaults
    const listingForm = listingSection.locator('form');
    await expect(listingForm.locator('text=Image Defaults')).not.toBeVisible();

    // Verify the Grid section still shows "Image Defaults" (parent owns the defaults)
    await expect(gridSection.locator('text=Image Defaults')).toBeVisible();
  });

  test('unselecting grid variation clears type constraint', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const iframe = helper.getIframe();

    // Click on a child teaser inside gridBlock
    const manualTeaser = iframe.locator('[data-block-uid="manual-teaser"]');
    await expect(manualTeaser).toBeVisible({ timeout: 10000 });
    await manualTeaser.click();

    await helper.waitForSidebarOpen();
    await helper.openSidebarTab('Block');

    // Scroll to top of sidebar
    const sidebarWrapper = page.locator('.sidebar-content-wrapper');
    await sidebarWrapper.evaluate((el) => el.scrollTo(0, 0));

    // Find the Grid section in sidebar
    const gridSection = page.locator('.parent-block-section').filter({
      has: page.locator('.parent-nav', { hasText: /Grid/ }),
    }).first();
    await expect(gridSection).toBeVisible({ timeout: 5000 });

    // First set a variation to 'Teaser'
    const variationSelect = gridSection.locator('.react-select__control').first();
    await expect(variationSelect).toBeVisible({ timeout: 5000 });
    await variationSelect.click();
    let menu = page.locator('.react-select__menu');
    await menu.waitFor({ state: 'visible', timeout: 3000 });
    await menu.locator('.react-select__option', { hasText: 'Teaser' }).click();
    await menu.waitFor({ state: 'hidden', timeout: 3000 });

    // Verify Teaser Defaults fieldset appeared
    await expect(gridSection.locator('text=Teaser Defaults')).toBeVisible({ timeout: 5000 });

    // Now clear the selection by clicking the clear button (x)
    const clearButton = variationSelect.locator('.react-select__clear-indicator');
    await expect(clearButton).toBeVisible({ timeout: 3000 });
    await clearButton.click();

    // Verify the defaults fieldset is gone (no type selected)
    await expect(gridSection.locator('text=Teaser Defaults')).not.toBeVisible({ timeout: 5000 });
    await expect(gridSection.locator('text=Image Defaults')).not.toBeVisible();

    // Verify the placeholder is shown again (no value selected)
    await expect(variationSelect.locator('.react-select__placeholder')).toBeVisible({ timeout: 3000 });
  });

  test('adding different block type inside grid with variation syncs to item type', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const iframe = helper.getIframe();

    // Click on a child block inside gridBlock
    const manualTeaser = iframe.locator('[data-block-uid="manual-teaser"]');
    await expect(manualTeaser).toBeVisible({ timeout: 10000 });
    await manualTeaser.click();

    await helper.waitForSidebarOpen();
    await helper.openSidebarTab('Block');

    // Scroll to top of sidebar to see parent's settings
    const sidebarWrapper = page.locator('.sidebar-content-wrapper');
    await sidebarWrapper.evaluate((el) => el.scrollTo(0, 0));

    // Find the Grid section in sidebar
    const gridSection = page.locator('.parent-block-section').filter({
      has: page.locator('.parent-nav', { hasText: /Grid/ }),
    }).first();
    await expect(gridSection).toBeVisible({ timeout: 5000 });

    // Set the variation to 'Teaser'
    const variationSelect = gridSection.locator('.react-select__control').first();
    await expect(variationSelect).toBeVisible({ timeout: 5000 });
    await variationSelect.click();
    let menu = page.locator('.react-select__menu');
    await menu.waitFor({ state: 'visible', timeout: 3000 });
    await menu.locator('.react-select__option', { hasText: 'Teaser' }).click();
    await menu.waitFor({ state: 'hidden', timeout: 3000 });

    // Click the add button in the iframe (appears near selected block)
    await helper.clickAddBlockButton();

    // When variation is set, only that type is allowed in the block chooser
    // Since there's only 1 allowed type (Teaser), the system auto-adds it without showing chooser
    // This is the "nicer for user" approach: no need to choose when there's only 1 option

    // Wait a bit for the block to be added and selected
    await page.waitForTimeout(500);

    // The new block should be a Teaser (auto-added since it's the only choice)
    await helper.waitForSidebarOpen();
    const childBreadcrumb = page.locator('.parent-block-section .parent-nav').last();
    await expect(childBreadcrumb).toContainText('Teaser', { timeout: 5000 });
  });
});

/**
 * fieldRules reaching the sidebar, on blocks people ship.
 *
 * Volto expresses conditional field visibility as a schema FUNCTION of the
 * data, which cannot reach a frontend — the block config crosses postMessage,
 * and functions do not survive the trip. `fieldRules` is the declarative form
 * that does, so the admin and the frontend resolve the same schema.
 *
 * What is checked here is that pipeline: rule → resolved schema → what the
 * author is actually offered. The rule grammar itself is checked where it is
 * cheap and exhaustive — operators in blockSync.test.js (is/isNot/isSet/
 * gt/gte/lt/lte/oneOf/contains), item positions in
 * blockPath.item-fieldrules.test.js (`../@index`), page fields in
 * blockPath.page-field-rule.test.js (`../description`).
 *
 * Both blocks below carry rules for their own reasons, not for this test: a
 * teaser that borrows its wording from the page it links to has nothing to ask
 * for until "Overwrite" is ticked, and a full-width image has no size to
 * choose because its width IS the page.
 */
test.describe('fieldRules - Conditional Field Visibility', () => {
  /** A field's row in the block sidebar, by field name. */
  const field = (page, name: string) =>
    page.locator(`#sidebar-properties .field-wrapper-${name}`);

  async function selectBlock(page, helper: AdminUIHelper, uid: string) {
    const block = helper.getIframe().locator(`[data-block-uid="${uid}"]`);
    await expect(block).toBeVisible({ timeout: 10000 });
    await block.click();
    await helper.waitForSidebarOpen();
    await helper.openSidebarTab('Block');
  }

  test('a teaser borrowing its wording is not asked for wording', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/field-rules-page');
    await selectBlock(page, helper, 'fr-teaser');

    // `overwrite` is off, so the teaser shows the linked page's own title and
    // description — and the four fields that would override them are gone.
    await expect(field(page, 'overwrite')).toBeVisible({ timeout: 5000 });
    await expect(field(page, 'title')).toBeHidden();
    await expect(field(page, 'description')).toBeHidden();
    await expect(field(page, 'head_title')).toBeHidden();
    await expect(field(page, 'preview_image')).toBeHidden();
  });

  test('ticking Overwrite brings the wording fields back', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/field-rules-page');
    await selectBlock(page, helper, 'fr-teaser');

    await field(page, 'overwrite').locator('input[type="checkbox"]').check({ force: true });

    // The rule is re-resolved against the new value, so the sidebar grows the
    // fields the author now needs — no reload, no re-select.
    await expect(field(page, 'title')).toBeVisible({ timeout: 5000 });
    await expect(field(page, 'description')).toBeVisible();
    await expect(field(page, 'preview_image')).toBeVisible();
  });

  test('a full-width image is offered no size to choose', async ({ page }) => {
    // The image rule is a LIST — `[{ when: { url: isSet, align: isNot full } }, false]`
    // — so this covers both halves of the shape at once: the condition that
    // holds for an ordinary image, and the bare `false` that hides the field
    // when none of the entries match.
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/field-rules-page');

    await selectBlock(page, helper, 'fr-image');
    await expect(field(page, 'alt')).toBeVisible({ timeout: 5000 });
    await expect(field(page, 'size'), 'a centred image has a size to choose').toBeVisible();

    await selectBlock(page, helper, 'fr-image-full');
    await expect(field(page, 'alt'), 'the sidebar is showing the other image').toBeVisible({
      timeout: 5000,
    });
    await expect(field(page, 'size'), 'full width IS the size').toBeHidden();
  });
});

test.describe('Block Type Conversion via fieldMappings', () => {
  test('teaser block dropdown shows Convert to Image option', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const iframe = helper.getIframe();

    const teaserBlock = iframe.locator('[data-block-uid="manual-teaser"]');
    await expect(teaserBlock).toBeVisible({ timeout: 10000 });
    await teaserBlock.click();

    await helper.openConvertChooser();
    const types = await helper.getBlockChooserTypes();
    expect(types, 'Image should be available as a Convert target for teaser').toContain('image');
    await helper.cancelBlockChooser();
  });

  test('converting teaser to image maps fields correctly', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const iframe = helper.getIframe();

    const teaserBlock = iframe.locator('[data-block-uid="manual-teaser"]');
    await expect(teaserBlock).toBeVisible({ timeout: 10000 });
    await teaserBlock.click();

    await helper.waitForSidebarOpen();
    await helper.openSidebarTab('Block');

    const breadcrumb = page.locator('.parent-block-section .parent-nav').last();
    await expect(breadcrumb).toContainText('Teaser', { timeout: 5000 });

    await helper.openConvertChooser();
    await helper.selectBlockType('image');

    // Wait for conversion to complete - breadcrumb should change to Image
    await expect(breadcrumb).toContainText('Image', { timeout: 5000 });
  });

  test('image block dropdown shows Convert to Teaser option', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const iframe = helper.getIframe();

    // Click on a teaser, convert to image, then verify Convert to Teaser option appears
    const teaserBlock = iframe.locator('[data-block-uid="manual-teaser"]');
    await expect(teaserBlock).toBeVisible({ timeout: 10000 });
    await teaserBlock.click();

    // Convert to Image first
    await helper.openConvertChooser();
    await helper.selectBlockType('image');

    const breadcrumb = page.locator('.parent-block-section .parent-nav').last();
    await expect(breadcrumb).toContainText('Image', { timeout: 5000 });

    // Now open the chooser again and verify Teaser is offered
    await helper.openConvertChooser();
    const types = await helper.getBlockChooserTypes();
    expect(types, 'Teaser should be available as a Convert target for image').toContain('teaser');
    await helper.cancelBlockChooser();
  });

  test('roundtrip conversion preserves mapped fields', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const iframe = helper.getIframe();

    const teaserBlock = iframe.locator('[data-block-uid="manual-teaser"]');
    await expect(teaserBlock).toBeVisible({ timeout: 10000 });
    await teaserBlock.click();

    await helper.waitForSidebarOpen();
    await helper.openSidebarTab('Block');

    const breadcrumb = page.locator('.parent-block-section .parent-nav').last();
    await expect(breadcrumb).toContainText('Teaser', { timeout: 5000 });

    const hrefField = page.locator('#sidebar-properties .field-wrapper-href');
    await expect(hrefField).toBeVisible({ timeout: 5000 });

    // Teaser → Image
    await helper.openConvertChooser();
    await helper.selectBlockType('image');
    await expect(breadcrumb).toContainText('Image', { timeout: 5000 });

    // Image → Teaser (roundtrip)
    await helper.openConvertChooser();
    await helper.selectBlockType('teaser');
    await expect(breadcrumb).toContainText('Teaser', { timeout: 5000 });

    // The href field should still be present (preserved through roundtrip:
    // teaser.href -> image.href -> teaser.href)
    await expect(hrefField).toBeVisible({ timeout: 5000 });
  });

  test('hero to image and back preserves fields through transitive conversion', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const iframe = helper.getIframe();

    // Wait for the Hero block to be visible in iframe before clicking
    const heroBlock = iframe.locator('[data-block-uid="block-4-hero"]');
    await expect(heroBlock).toBeVisible({ timeout: 10000 });

    // Click on the Hero block (block-4-hero has heading, image, buttonLink, buttonText)
    await helper.clickBlockInIframe('block-4-hero');

    await helper.waitForSidebarOpen();
    await helper.openSidebarTab('Block');

    const breadcrumb = page.locator('.parent-block-section .parent-nav').last();
    await expect(breadcrumb).toContainText('Hero', { timeout: 5000 });

    // Verify Hero has heading, image, buttonLink, and buttonText fields
    const headingField = page.locator('#sidebar-properties .field-wrapper-heading');
    await expect(headingField).toBeVisible({ timeout: 5000 });
    const imageField = page.locator('#sidebar-properties .field-wrapper-image');
    await expect(imageField).toBeVisible({ timeout: 5000 });
    const buttonLinkField = page.locator('#sidebar-properties .field-wrapper-buttonLink');
    await expect(buttonLinkField).toBeVisible({ timeout: 5000 });
    const buttonTextField = page.locator('#sidebar-properties .field-wrapper-buttonText');
    await expect(buttonTextField).toBeVisible({ timeout: 5000 });

    // Record initial buttonText value (should persist through conversions since it's not mapped)
    const buttonTextInput = buttonTextField.locator('input, textarea');
    const originalButtonText = await buttonTextInput.inputValue();
    expect(originalButtonText).toBe('Click Me');

    // Convert Hero → Image (transitive via teaser)
    await helper.openConvertChooser();
    await helper.selectBlockType('image');
    await expect(breadcrumb).toContainText('Image', { timeout: 5000 });

    // Verify iframe renders as image block with a working image
    const imageBlockImg = iframe.locator('[data-block-uid="block-4-hero"] img');
    await expect(imageBlockImg).toBeVisible({ timeout: 5000 });
    const imageSrc = await imageBlockImg.getAttribute('src');
    expect(imageSrc).toContain('Hero Image'); // The SVG data URL contains "Hero Image"
    const imageNaturalWidth = await imageBlockImg.evaluate(el => (el as HTMLImageElement).naturalWidth);
    expect(imageNaturalWidth).toBeGreaterThan(0);

    // Verify Image has alt field with the converted heading value
    const altField = page.locator('#sidebar-properties .field-wrapper-alt');
    await expect(altField).toBeVisible({ timeout: 5000 });
    // Check the alt text field has the converted heading value "Welcome Hero"
    const altInput = altField.locator('input, textarea');
    await expect(altInput).toHaveValue('Welcome Hero', { timeout: 5000 });

    // Convert Image → Hero (transitive via teaser)
    await helper.openConvertChooser();
    await helper.selectBlockType('hero');
    await expect(breadcrumb).toContainText('Hero', { timeout: 5000 });

    // Verify hero image is preserved and renders through roundtrip
    const heroImg = iframe.locator('[data-block-uid="block-4-hero"] img');
    await expect(heroImg).toBeVisible({ timeout: 5000 });
    const heroImgSrc = await heroImg.getAttribute('src');
    expect(heroImgSrc).toContain('Hero Image');
    const heroNaturalWidth = await heroImg.evaluate(el => (el as HTMLImageElement).naturalWidth);
    expect(heroNaturalWidth).toBeGreaterThan(0);

    // Verify Hero fields are back with the original values
    await expect(headingField).toBeVisible({ timeout: 5000 });
    // Check heading field has the roundtrip value
    const headingInput = headingField.locator('input, textarea');
    await expect(headingInput).toHaveValue('Welcome Hero', { timeout: 5000 });

    // Verify buttonText was preserved (it's not in any fieldMappings, so should persist)
    await expect(buttonTextField).toBeVisible({ timeout: 5000 });
    await expect(buttonTextInput).toHaveValue('Click Me', { timeout: 5000 });
  });

  test('hero to teaser and back preserves image rendering', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const iframe = helper.getIframe();
    const heroBlock = iframe.locator('[data-block-uid="block-4-hero"]');
    await expect(heroBlock).toBeVisible({ timeout: 10000 });
    await helper.clickBlockInIframe('block-4-hero');

    await helper.waitForSidebarOpen();
    await helper.openSidebarTab('Block');

    const breadcrumb = page.locator('.parent-block-section .parent-nav').last();
    await expect(breadcrumb).toContainText('Hero', { timeout: 5000 });

    // Convert Hero → Teaser
    await helper.openConvertChooser();
    await helper.selectBlockType('teaser');
    await expect(breadcrumb).toContainText('Teaser', { timeout: 5000 });

    // Verify the teaser image renders (hero's image should map to preview_image)
    const teaserImg = iframe.locator('[data-block-uid="block-4-hero"] img');
    await expect(teaserImg).toBeVisible({ timeout: 5000 });
    const teaserNaturalWidth = await teaserImg.evaluate(el => (el as HTMLImageElement).naturalWidth);
    expect(teaserNaturalWidth, 'Teaser image should render (naturalWidth > 0)').toBeGreaterThan(0);

    // Convert Teaser → Hero
    await helper.openConvertChooser();
    await helper.selectBlockType('hero');
    await expect(breadcrumb).toContainText('Hero', { timeout: 5000 });

    // Verify hero image renders after roundtrip
    const heroImg = iframe.locator('[data-block-uid="block-4-hero"] img');
    await expect(heroImg).toBeVisible({ timeout: 5000 });
    const heroNaturalWidth = await heroImg.evaluate(el => (el as HTMLImageElement).naturalWidth);
    expect(heroNaturalWidth, 'Hero image should render after roundtrip (naturalWidth > 0)').toBeGreaterThan(0);
  });

  test('image to teaser conversion does not show empty media picker when image exists', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const iframe = helper.getIframe();

    // Click on an image block (block-2-uuid has url and alt)
    await helper.clickBlockInIframe('block-2-uuid');
    await helper.waitForSidebarOpen();
    await helper.openSidebarTab('Block');

    const breadcrumb = page.locator('.parent-block-section .parent-nav').last();
    await expect(breadcrumb).toContainText('Image', { timeout: 5000 });

    // Convert Image → Teaser
    await helper.openConvertChooser();
    await helper.selectBlockType('teaser');
    await expect(breadcrumb).toContainText('Teaser', { timeout: 5000 });

    // The empty-image-overlay should NOT appear — preview_image has a value from the conversion
    await page.waitForTimeout(1000); // Allow UI to settle
    const emptyImageOverlay = page.locator('.empty-image-overlay');
    await expect(emptyImageOverlay).not.toBeVisible({ timeout: 3000 });
  });

  // NOTE: hero→summary roundtrip test removed — Summary is restricted at page level,
  // so it doesn't appear in the Convert to menu. Would need a container that allows
  // both hero and summary to test this. Slate↔text coercion is still exercised by
  // hero→image→hero roundtrip test above.

  test('convert-to only shows types from same fieldMappings family, not unrelated @default types', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const iframe = helper.getIframe();

    // Click on a PAGE-LEVEL teaser block (not one inside a grid, which has its own allowedBlocks)
    const teaserBlock = iframe.locator('[data-block-uid="block-7-filled-teaser"]');
    await expect(teaserBlock).toBeVisible({ timeout: 10000 });
    await teaserBlock.click();

    await helper.openConvertChooser();
    const types = await helper.getBlockChooserTypes();

    // At page level, only content-item types allowed by the page should appear
    expect(types, 'Expected "image" in Convert chooser').toContain('image');
    expect(types, 'Expected "hero" in Convert chooser').toContain('hero');

    // Types that should NOT appear:
    // - Restricted content-item types not in page allowedBlocks (e.g., slide is only valid inside slider)
    // - Different fieldMapping families (facets, form fields)
    const forbiddenTypes = [
      'slide',
      'checkboxFacet', 'selectFacet', 'dateRangeFacet', 'toggleFacet',
      'singleChoice', 'multipleChoice', 'date', 'email',
    ];
    for (const forbidden of forbiddenTypes) {
      expect(types, `"${forbidden}" should NOT appear in teaser's Convert chooser`).not.toContain(forbidden);
    }

    await helper.cancelBlockChooser();
  });

  test('convert-to menu respects container allowedBlocks', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();

    // Click on a teaser inside the grid (grid allowedBlocks: ['teaser', 'image'])
    const gridTeaser = iframe.locator('[data-block-uid="grid-cell-1"]');
    await expect(gridTeaser).toBeVisible({ timeout: 10000 });
    await gridTeaser.click();

    await helper.openConvertChooser();
    const types = await helper.getBlockChooserTypes();

    // Grid allows only ['teaser', 'image'] — Convert should only show 'image'
    // (teaser is the current type, so it's excluded).
    expect(types).toContain('image');

    // Types reachable via fieldMappings but NOT in grid's allowedBlocks
    expect(types, 'hero not allowed by grid container').not.toContain('hero');
    expect(types, 'summary not allowed by grid container').not.toContain('summary');

    await helper.cancelBlockChooser();
  });
});

/**
 * fieldRules — a rule that REFUSES a value.
 *
 * The other rules on this page show and hide fields. This one raises an error,
 * and the point of the test is that nothing about the consequence is ours: the
 * message goes on the field DEFINITION, and Volto's own machinery does the
 * rest. `Form.onSubmit` validates every block against its enhanced schema, so
 * the rule is evaluated on the way to the server and the save is refused.
 *
 * The rssFeed fixture refuses "fewer than no items". No other fixture asks for
 * that — the listings page uses the default 6 — so the rule is inert
 * everywhere except the page written for it here.
 */
test.describe('fieldRules - a rule that refuses a value', () => {
  test('a page holding a refused value does not save', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/refused-value-page');

    // The page is up and being edited before anything is asked of it.
    await expect(
      helper.getIframe().locator('[data-block-uid="intro-1"]'),
    ).toBeVisible({ timeout: 15000 });

    // Not helper.saveContent(): that waits for the redirect a SUCCESSFUL save
    // makes, and the whole point here is that there isn't one.
    await page.locator('#toolbar-save, button:has-text("Save")').first().click();

    // Refused: the editor says which field, and the page is still being edited.
    // The shadow reports a block error as a toast naming the field, which is
    // how an author learns about a block they may not be looking at.
    await expect(
      page.getByRole('alert').filter({ hasText: 'Max items' }).first(),
    ).toBeVisible({ timeout: 10000 });
    await expect(page).toHaveURL(/\/edit(\?|$)/);

    // And the field itself says so, in the sidebar, where it gets fixed. The
    // refused save selects the offending block and opens its Block tab, so the
    // form on screen is the one holding the bad value.
    await expect(
      page.locator('#sidebar-properties').getByText('Max items cannot be negative.'),
    ).toBeVisible({ timeout: 10000 });
  });
  /**
   * The same machinery, with Volto's OWN validators rather than a hydra rule.
   *
   * Every standard validator is covered as a unit in validateBlocks.test.js;
   * these prove the wiring an author actually meets: a bad value NESTED inside
   * a container — which core's validation, walking `blocks_layout.items`, would
   * never open — and a string over its schema's maxLength.
   *
   * `required` is covered as a unit, not here: block sanity forbids a fixture
   * holding a required-but-empty field ("the editor won't let a block save
   * without it, so this content can't be authored"), which is the rule this
   * change now enforces. Testing it in the browser needs the state made at
   * RUNTIME — an author emptying the field and pressing save — not stored.
   */
  test('a warned value is said, not refused — the page still saves', async ({
    page,
  }) => {
    // The difference between the two actions, in the only terms that matter to
    // an author: an error stops the save, a warning does not. Advice about
    // artwork that is merely unwise must not hold a page hostage.
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/warned-value-page');
    await expect(
      helper.getIframe().locator('[data-block-uid="intro-1"]'),
    ).toBeVisible({ timeout: 15000 });

    await page.locator('#toolbar-save, button:has-text("Save")').first().click();

    // Saved: the editor leaves edit mode, which a refused save never does.
    await expect(page).not.toHaveURL(/\/edit(\?|$)/, { timeout: 15000 });
  });

  test('a string longer than its schema allows does not save', async ({ page }) => {
    // maxLength — a standard Volto validator, on a plain string field of a
    // fixture block. Every slide in the fixtures has a short kicker, so the
    // constraint is inert until this page writes a long one.
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/too-long-string-page');
    await expect(
      helper.getIframe().locator('[data-block-uid="intro-1"]'),
    ).toBeVisible({ timeout: 15000 });

    await page.locator('#toolbar-save, button:has-text("Save")').first().click();

    await expect(page.getByRole('alert').first()).toBeVisible({ timeout: 10000 });
    await expect(page).toHaveURL(/\/edit(\?|$)/);
  });

  test('a bad value inside a container does not save', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/nested-bad-url-page');
    await expect(
      helper.getIframe().locator('[data-block-uid="intro-1"]'),
    ).toBeVisible({ timeout: 15000 });

    await page.locator('#toolbar-save, button:has-text("Save")').first().click();

    await expect(page.getByRole('alert').first()).toBeVisible({ timeout: 10000 });
    await expect(page).toHaveURL(/\/edit(\?|$)/);
  });
});

