/**
 * Integration tests for template edit mode.
 *
 * Template edit mode allows editing the template structure:
 * - Fixed/readonly blocks inside template become editable
 * - Blocks outside template become locked
 * - Fixed blocks can be moved (drag enabled)
 * - DnD out of template removes block from template
 * - DnD into template adds block to template
 * - Save validates template structure (no split slot groups)
 *
 * Note: Fixed template blocks get random UUIDs from template merge, so we find them by content.
 * User content blocks keep their original IDs from the page fixture.
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';
import { URLS } from '../ports';

// Content strings to find fixed template blocks (they have random UUIDs after merge)
const TEMPLATE_HEADER_CONTENT = 'Template Header - From Template';
const TEMPLATE_FOOTER_CONTENT = 'Template Footer - From Template';

// User content blocks keep their IDs from the page fixture
const USER_CONTENT_1 = 'user-content-1';
const USER_CONTENT_2 = 'user-content-2';
const STANDALONE_BLOCK_1 = 'standalone-block-1';
const STANDALONE_BLOCK_2 = 'standalone-block-2';


test.describe('Template Creation', () => {
  test('"Make Template" option appears in toolbar menu for regular blocks', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Click a regular block (not part of a template)
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForBlockSelectedInAdmin('block-1-uuid');

    // Open toolbar menu
    await helper.openQuantaToolbarMenu('block-1-uuid');
    const menuOptions = await helper.getQuantaToolbarMenuOptions('block-1-uuid');
    const optionLabels = menuOptions.map(o => o.toLowerCase());

    // Should have "Make Template" option
    expect(optionLabels.some(o => o.includes('make') && o.includes('template'))).toBe(true);
  });

  test('"Make Template" does NOT appear for blocks already in a template', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    // Click template header block (merged from template, has random UUID)
    // Content is "Template Header - From Template" after merge replaces stale content
    const headerBlockId = await helper.clickBlockByContent('Template Header - From Template');
    await helper.waitForBlockSelectedInAdmin(headerBlockId);

    // Open toolbar menu
    await helper.openQuantaToolbarMenu(headerBlockId);
    const menuOptions = await helper.getQuantaToolbarMenuOptions(headerBlockId);
    const optionLabels = menuOptions.map(o => o.toLowerCase());

    // Should NOT have "Make Template" option for blocks already in a template
    expect(optionLabels.some(o => o.includes('make') && o.includes('template'))).toBe(false);
  });

  test('clicking "Make Template" wraps block in template instance and shows settings', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Click a regular block
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForBlockSelectedInAdmin('block-1-uuid');

    // Open toolbar menu and click "Make Template"
    await helper.openQuantaToolbarMenu('block-1-uuid');
    const makeTemplateOption = page.locator('.volto-hydra-dropdown-menu .volto-hydra-dropdown-item')
      .filter({ hasText: /make.*template/i });
    await makeTemplateOption.click();

    // Wait for sidebar to update
    await helper.waitForSidebarOpen();

    // Block should now be inside a template instance
    // Sidebar should show hierarchy: Page > Template Instance > Block
    const stickyHeaders = page.locator('.sidebar-section-header.sticky-header');
    await expect(stickyHeaders).toHaveCount(3, { timeout: 5000 }); // Page > Template > Block
    await expect(stickyHeaders.nth(1)).toContainText(/Template:/i);

    // Should have a name/title field for the template visible in sidebar
    const nameField = page.locator('.field-wrapper-title, .field').filter({ hasText: /Template Name/i });
    await expect(nameField).toBeVisible({ timeout: 5000 });

    // Should also have save location field
    const locationField = page.locator('.field-wrapper-folder, .field').filter({ hasText: /Save Location/i });
    await expect(locationField).toBeVisible({ timeout: 5000 });
  });

  // Failing on purpose (TDD): when the user makes a block into a template
  // and saves the page, the new template document needs to be POSTed to
  // the API as a brand-new Document. Currently onMakeTemplate only stores
  // the template object in templateCacheRef and saveTemplatesRef does an
  // api.patch — which 404s on a real Plone backend because the document
  // doesn't exist yet. Plone (not the client) is what populates created /
  // modified / effective / UID timestamps, so a missing POST is also why
  // hand-crafted template fixtures end up with null timestamps.
  //
  // Expected behaviour: on save after make-template, a POST hits the
  // template's parent folder with @type:'Document' and the block payload.
  // The folder path comes from the sidebar's 'folder' field, NOT from a
  // hard-coded '/templates/' prefix in the bridge (so consumers can host
  // templates anywhere in the content tree).
  test('saving a page after Make Template POSTs a new template document', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Capture every POST that goes to the API while we save. Filter for
    // content-creation requests (body has @type) so we don't catch login,
    // search, etc.
    const contentPosts: Array<{ url: string; body: any }> = [];
    page.on('request', (req) => {
      if (req.method() !== 'POST') return;
      if (!req.url().startsWith(URLS.mockApi)) return;
      let body: any = null;
      try { body = req.postDataJSON(); } catch { /* not JSON */ }
      if (!body || !body['@type']) return;
      contentPosts.push({ url: req.url(), body });
    });

    // Make-template on a regular block.
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForBlockSelectedInAdmin('block-1-uuid');
    await helper.openQuantaToolbarMenu('block-1-uuid');
    const makeTemplateOption = page.locator('.volto-hydra-dropdown-menu .volto-hydra-dropdown-item')
      .filter({ hasText: /make.*template/i });
    await makeTemplateOption.click();
    await helper.waitForSidebarOpen();

    // Save. saveContent waits for redirect out of /edit so any POSTs
    // dispatched as part of the save will have been observed by then.
    await helper.saveContent();

    // EXPECTED: at least one POST whose body @type is Document — that's
    // the new template being created. Path is the parent folder; client
    // doesn't set timestamps (Plone fills those server-side).
    const templatePosts = contentPosts.filter((r) => r.body['@type'] === 'Document');
    expect(templatePosts.length,
      'expected the save flow to POST a new template document for the just-created template',
    ).toBeGreaterThanOrEqual(1);
    const tplPost = templatePosts[0];
    expect(tplPost.body.blocks, 'POSTed template should carry the source block in its blocks dict').toBeTruthy();
    expect(tplPost.body.blocks_layout?.items?.length,
      'POSTed template should have blocks_layout.items',
    ).toBeGreaterThan(0);
    // Path must not be hard-coded to /templates/ — it should reflect the
    // sidebar 'folder' field's value (default folder is fine here, just
    // not a baked-in literal in the bridge).
    expect(tplPost.url, 'template POST URL must come from the sidebar folder, not a hard-coded /templates/ literal')
      .not.toMatch(/\/templates\/$/);
  });

  // TDD (task #21): the template's URL id/filename is editable via a "Short name"
  // field while editing. Setting it must (1) create the document at that id, (2)
  // rewrite the page's block references to the new id (so they don't dangle at the
  // placeholder), and (3) make the template load correctly when opened elsewhere.
  test('changing a new template’s short name sets its id, rewrites references, and loads on its own page', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Capture the template create POST + the page PATCH.
    const docPosts: Array<{ url: string; body: any }> = [];
    const pagePatches: any[] = [];
    page.on('request', (req) => {
      if (!req.url().startsWith(URLS.mockApi)) return;
      let body: any = null;
      try { body = req.postDataJSON(); } catch { /* not JSON */ }
      if (req.method() === 'POST' && body?.['@type'] === 'Document') docPosts.push({ url: req.url(), body });
      if (req.method() === 'PATCH' && /\/test-page$/.test(req.url().replace(/\/$/, '')) && body) pagePatches.push(body);
    });

    // Make a template from a regular block.
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForBlockSelectedInAdmin('block-1-uuid');
    await helper.openQuantaToolbarMenu('block-1-uuid');
    await page.locator('.volto-hydra-dropdown-menu .volto-hydra-dropdown-item')
      .filter({ hasText: /make.*template/i }).click();
    await helper.waitForSidebarOpen();

    // Make Template auto-selects the instance and enters edit mode, so the Short
    // name field is editable. Set a custom short name.
    await expect(page.locator('.edit-template-toggle')).toHaveAttribute('aria-pressed', 'true', { timeout: 5000 });
    // Scoped to the template instance's own sidebar section. The content type
    // declares `id`, titled "Short name" too, and the page pane renders it in
    // the same sidebar at the same time — an unscoped `.field` matched both and
    // strict mode refused the pair.
    const shortName = page
      .locator('.parent-block-settings .field')
      .filter({ hasText: 'Short name' })
      .locator('input');
    await expect(shortName).toBeEnabled({ timeout: 5000 });
    await shortName.fill('my-new-layout');

    // Save (creates the template + writes the page).
    await helper.saveContent();

    // (1) The template document is POSTed at the chosen id — not untitled-template-N.
    const tpl = docPosts.find((p) => p.body.id === 'my-new-layout');
    expect(
      tpl,
      `expected a template POST with id "my-new-layout"; saw ${JSON.stringify(docPosts.map((p) => p.body.id))}`,
    ).toBeTruthy();

    // (2) The page save rewrote the block's templateId to the new id (no dangling
    // placeholder reference).
    const patchWithRef = pagePatches.find((p) => JSON.stringify(p.blocks || {}).includes('my-new-layout'));
    expect(
      patchWithRef,
      'page save must rewrite the block templateId to /…/my-new-layout, not leave the untitled placeholder',
    ).toBeTruthy();
    expect(
      JSON.stringify(patchWithRef.blocks),
      'no dangling untitled-template placeholder should remain in the saved page blocks',
    ).not.toMatch(/untitled-template-\d+/);

    // (3) The created template LOADS and RENDERS at its new id — open its own page
    // and the block renders in the iframe. (Proves the doc was created at the right id
    // AND is servable/renderable — the page referencing it, per (2), resolves to real
    // content.)
    expect(tpl!.body.blocks, 'the created template must carry the source block').toBeTruthy();
    await helper.navigateToEdit('/templates/my-new-layout');
    const { locator } = await helper.waitForBlockByContent('This is a test paragraph');
    await expect(locator).toBeVisible({ timeout: 10000 });
  });

  // Failing on purpose (TDD): a template document is just a Document at
  // /templates/<name> whose blocks happen to have templateId/slotId set.
  // It should be openable + editable in the admin like any other page.
  // The save flow's existing `id !== currentPath` filter already covers
  // "don't recursively save the template's own page as a template", but
  // the LOAD path (View.jsx ~2751 + ~2936) calls getUniqueTemplateIds
  // without the same filter — after dropping the instanceId-equality
  // heuristic, that means navigating to a template page tries to fetch
  // and re-merge the template into itself, which breaks rendering /
  // selection of its own blocks.
  //
  // Expected behaviour: open /templates/test-layout in the editor → its
  // blocks render visibly, clicking one selects it (admin chrome appears).
  // Same as opening any non-template Document.
  test('a template page loads + edits like a normal page', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/templates/test-layout');

    const iframe = helper.getIframe();

    // Block from the test-layout fixture. Identified by content (template
    // fixtures' own UUIDs are stable in this fixture but the test cares
    // about the rendered state, not the id, so use plaintext to find it).
    const { blockId: headerBlockId, locator: headerBlock } =
      await helper.waitForBlockByContent('Template Header - From Template');
    await expect(headerBlock).toBeVisible();

    // Click + verify admin reflects the selection (toolbar + outline
    // mounted over the block — i.e. the page is interactive, not stuck
    // mid-load or stuck in a template-expansion loop).
    await helper.clickBlockInIframe(headerBlockId);
    await helper.waitForBlockSelectedInAdmin(headerBlockId);
  });

  // The test above passes for the WRONG reason: test-layout happens to be one of
  // the `items` region's allowedLayouts, so re-merging it into its own document
  // re-inserts the same content and nothing looks broken.
  //
  // A template forced into a DIFFERENT region has no such luck. footer-layout is
  // forced into `footer` (page schema, test-frontend), while its own blocks live
  // in `items` on its definition page — so the merge, seeing a templateId that is
  // not among that region's allowedLayouts, removes those blocks and re-inserts
  // nothing. The definition page then shows an empty shell: the one document
  // where a site footer is authored offers nothing to author.
  //
  // A page should never be re-merged against its own template. The save path
  // already knows this (getUniqueTemplateIds(...).filter(id => id !== currentPath));
  // the load path did not.
  test('a template page forced into another region keeps its own blocks', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/templates/footer-layout');

    const { blockId: brandingId, locator: branding } = await helper.waitForBlockByContent(
      'Footer Branding - Forced Layout',
    );
    await expect(branding).toBeVisible();

    // Present is not enough — the point of opening the definition is to edit it.
    await helper.clickBlockInIframe(brandingId);
    await helper.waitForBlockSelectedInAdmin(brandingId);
  });

  // Editing the definition still goes through the SAME unlock gesture as editing
  // it from a page — the lock is what says "this changes everywhere", and that is
  // true on the definition page too. All that is needed for the toggle to appear
  // is a templateInstanceId on the definition's own blocks (see the
  // templates/editable-fixed-layout fixture, whose blocks carry a definition-side
  // instance id); without one, isBlockInEditedTemplate has nothing to match and
  // the block is locked with no way to unlock it.
  test('a template definition page unlocks + edits like any template', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/templates/footer-layout');

    const { blockId: brandingId, locator: branding } = await helper.waitForBlockByContent(
      'Footer Branding - Forced Layout',
    );

    await helper.unlockTemplate(brandingId);

    // Click into the block after unlocking, as the page-side template tests do:
    // the bridge restores contenteditable when a block is SELECTED for text
    // editing, and skips the restore while the editor is still in block mode.
    await helper.clickBlockInIframe(brandingId);
    const editor = helper.getSlateField(branding);
    await expect(editor).toHaveAttribute('contenteditable', 'true', { timeout: 5000 });
  });

  test.skip('template edit mode is automatically activated when creating template', async ({ page }) => {
    // Skipped: auto-activation feature not yet implemented
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Click a regular block and make it a template
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForBlockSelectedInAdmin('block-1-uuid');
    await helper.openQuantaToolbarMenu('block-1-uuid');
    const makeTemplateOption = page.locator('.volto-hydra-dropdown-menu .volto-hydra-dropdown-item')
      .filter({ hasText: /make.*template/i });
    await makeTemplateOption.click();

    // Template edit mode should be active (indicated by toggle in sidebar)
    await helper.waitForSidebarOpen();
    const editModeToggle = page.locator('.edit-template-toggle');
    await expect(editModeToggle).toHaveAttribute('aria-pressed', 'true', { timeout: 5000 });
  });

  test('can toggle template edit mode from sidebar', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    // Find template block IDs (fixed blocks have random UUIDs, user content keeps original IDs)
    const { blockId: headerBlockId } = await helper.waitForBlockByContent(TEMPLATE_HEADER_CONTENT);
    const { blockId: footerBlockId } = await helper.waitForBlockByContent(TEMPLATE_FOOTER_CONTENT);
    const templateBlockIds = [headerBlockId, USER_CONTENT_1, USER_CONTENT_2, footerBlockId];

    // Unlock via the sidebar toggle (warns, then enters edit mode).
    await helper.unlockTemplate(headerBlockId);

    // Edit mode is active — the template's fixed block is now editable.
    await helper.waitForBlockEditable(headerBlockId);
  });

  test('can toggle template edit mode from sidebar ON MOBILE (collapsed sheet)', async ({ page }) => {
    // On a phone viewport the settings sidebar is a collapsed off-screen sheet, so
    // the template edit toggle isn't on screen. unlockTemplate/lockTemplate must open
    // the sheet (bottom-toolbar Settings icon), drive the toggle, then dismiss it so
    // the canvas is usable — all viewport-aware in the helper, so the SAME calls work
    // as on desktop. Regression guard for the mobile-admin footer demo.
    await page.setViewportSize({ width: 375, height: 812 });
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    const { blockId: headerBlockId } = await helper.waitForBlockByContent(TEMPLATE_HEADER_CONTENT);

    // Sidebar starts collapsed on mobile — unlock must open it itself.
    await expect(page.locator('.sidebar-container.collapsed')).toBeAttached({ timeout: 5000 });
    await helper.unlockTemplate(headerBlockId);
    await helper.waitForBlockEditable(headerBlockId);

    // Make a template change so re-locking PROMPTS the decision modal — an UNCHANGED
    // template locks silently (see "locking an unchanged template does not prompt").
    // Delete the fixed footer (a structural template edit); the event path is
    // viewport-independent, so it's the same signal on mobile as on desktop.
    const { blockId: footerBlockId } = await helper.waitForBlockByContent(TEMPLATE_FOOTER_CONTENT);
    await page.evaluate((id) => {
      document.dispatchEvent(new CustomEvent('hydra-delete-blocks', { detail: { blockIds: [id] } }));
    }, footerBlockId);

    // unlock dismissed the sheet, so the canvas is reachable again.
    await expect(page.locator('.sidebar-container.collapsed')).toBeAttached({ timeout: 5000 });

    // And it locks back cleanly (drives the lock decision modal from the sheet).
    await helper.lockTemplate(headerBlockId, 'commit');
    await helper.waitForBlockReadonly(headerBlockId);
  });
});

test.describe('Template Edit Mode - Save', () => {
  // v2: templates commit when you LOCK them (Change on all pages), not with the
  // page. Locking a CHANGED template writes the template document.
  test('locking a template (Change on all pages) saves the template document', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    // Capture every content-shaped write (PATCH updates a template, POST creates
    // one); body carries blocks_layout for a template/page write.
    const writes: Array<{ method: string; url: string }> = [];
    page.on('request', (req) => {
      const m = req.method();
      if (m !== 'PATCH' && m !== 'POST') return;
      if (!req.url().startsWith(URLS.mockApi)) return;
      let body: any = null;
      try { body = req.postDataJSON(); } catch { /* not JSON */ }
      if (!body || !body.blocks_layout) return;
      writes.push({ method: m, url: req.url() });
    });

    // Unlock the template, make a change (delete the footer block), then lock with
    // "Change on all pages" — the changed template is written.
    const { blockId: headerBlockId } = await helper.waitForBlockByContent(TEMPLATE_HEADER_CONTENT);
    const { blockId: footerBlockId } = await helper.waitForBlockByContent(TEMPLATE_FOOTER_CONTENT);
    await helper.unlockTemplate(headerBlockId);
    await helper.clickBlockInIframe(footerBlockId);
    await helper.waitForBlockSelectedInAdmin(footerBlockId);
    await page.evaluate((id) => {
      document.dispatchEvent(new CustomEvent('hydra-delete-blocks', { detail: { blockIds: [id] } }));
    }, footerBlockId);
    await helper.lockTemplate(headerBlockId, 'commit');

    // A write whose URL is NOT the page itself = the template document being saved.
    const pageEnds = (u: string) => u.replace(/\/$/, '').endsWith('/template-test-page');
    await expect
      .poll(() => writes.filter((w) => !pageEnds(w.url)).length, {
        message: `expected the template document to be saved on lock; observed: ${JSON.stringify(writes)}`,
        timeout: 5000,
      })
      .toBeGreaterThanOrEqual(1);
  });

  // TDD: templateCacheRef (View.jsx:995) is a useRef that's never reset — it
  // leaks across page navigations, so a template cached while editing is reused
  // verbatim instead of re-fetched. Entering template edit mode must invalidate
  // that cache (re-fetch the template) so edits + the save operate on the current
  // backend copy, and other pages sharing the template load the fresh copy.
  test('entering template edit mode re-fetches the template (invalidates the cache)', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    // Wait for the initial load (template fetched + cached) to settle.
    const { blockId: headerBlockId } = await helper.waitForBlockByContent(TEMPLATE_HEADER_CONTENT);

    // From here, count GETs that fetch the shared template document.
    const templateGets: string[] = [];
    page.on('request', (req) => {
      if (req.method() !== 'GET') return;
      const u = req.url();
      if (u.startsWith(URLS.mockApi) && /test-layout/.test(u)) templateGets.push(u);
    });

    // Unlock the template (enters edit mode).
    await helper.unlockTemplate(headerBlockId);

    // Entering edit mode must invalidate the cache and re-fetch the template.
    await expect
      .poll(() => templateGets.length, {
        message: 'entering template edit mode should invalidate the cache and re-fetch the template',
        timeout: 5000,
      })
      .toBeGreaterThanOrEqual(1);
  });

  // v2: unlocking re-fetches the template fresh (structure), then locking with
  // "Change on all pages" COMMITS what you edited — reverse-merging the page's
  // current content into that re-fetched template and PATCHing it. This guards the
  // whole unlock(re-fetch) → edit → lock(commit) round trip: the edit reaches the
  // saved template document.
  test('locking (Change on all pages) persists the edit made after the re-fetch', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const iframe = helper.getIframe();
    await helper.login();
    await helper.navigateToEdit('/template-test-page');
    const { blockId: headerBlockId, locator: headerLocator } = await helper.waitForBlockByContent(TEMPLATE_HEADER_CONTENT);

    // Capture the template's save body (the template PATCH, not the page PATCH).
    const templatePatchBodies: string[] = [];
    page.on('request', (req) => {
      if (req.method() !== 'PATCH' || !/test-layout/.test(req.url())) return;
      try { templatePatchBodies.push(JSON.stringify(req.postDataJSON())); } catch { /* not JSON */ }
    });

    // Unlock (re-fetches the template) and edit the header with a unique marker.
    const MARKER = 'COMMITTED-EDIT';
    await helper.unlockTemplate(headerBlockId);
    await helper.clickBlockInIframe(headerBlockId);
    const editor = helper.getSlateField(headerLocator);
    await expect(editor).toHaveAttribute('contenteditable', 'true', { timeout: 5000 });
    await editor.click();
    await expect(editor).toBeFocused({ timeout: 2000 });
    await page.keyboard.press('End');
    await page.keyboard.type(` ${MARKER}`);
    await expect(iframe.locator(`[data-block-uid="${headerBlockId}"]`)).toContainText(MARKER, { timeout: 5000 });

    // Lock with "Change on all pages" — the edit must reach the saved template.
    await helper.lockTemplate(headerBlockId, 'commit');
    await expect
      .poll(() => templatePatchBodies.join('\n'), {
        message: 'the commit must persist the edit into the template document',
        timeout: 5000,
      })
      .toContain(MARKER);
  });
});

test.describe('Template Edit Mode - Editability', () => {
  test('a fixed member can be REMOVED once the template is unlocked', async ({ page }) => {
    // `fixed` means "not yours to remove from THIS page" — the point of a
    // template's chrome. It is not meant to survive unlocking: an author who
    // has taken the template into edit mode is editing the template itself,
    // and a member they can retype but never delete is a dead end.
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    const iframe = helper.getIframe();
    const { blockId: footerBlockId } = await helper.waitForBlockByContent(TEMPLATE_FOOTER_CONTENT);
    const { blockId: headerBlockId } = await helper.waitForBlockByContent(TEMPLATE_HEADER_CONTENT);
    const dropdown = page.locator('.volto-hydra-dropdown-menu');

    // Select and open the menu directly rather than through the helpers: those
    // assert the toolbar's drag handle lines up with the block, which is a
    // race against their own scroll-into-view here and is beside the point.
    // (A fixed member IS selectable while locked — outline and toolbar appear
    // exactly as they do for any block.)
    const openMenuOn = async (blockId: string) => {
      await iframe.locator(`[data-block-uid="${blockId}"]`).click({ force: true });
      const toolbar = page.locator('.quanta-toolbar');
      await expect(toolbar).toBeVisible({ timeout: 10000 });
      await toolbar.locator('[title*="options" i]').first().click();
      await expect(dropdown).toBeVisible({ timeout: 5000 });
    };

    // LOCKED: its settings are SHOWN but disabled — an empty sidebar reads as
    // broken; greyed fields say the setting exists and is not editable here.
    await iframe.locator(`[data-block-uid="${footerBlockId}"]`).click({ force: true });
    const readOnlyFields = page.locator('#sidebar-properties [class*="field-wrapper-"]');
    if (await readOnlyFields.count()) {
      await expect(
        page.locator('#sidebar-properties input:not([disabled]), #sidebar-properties textarea:not([disabled])'),
        'a read-only block offers no ENABLED input',
      ).toHaveCount(0);
    }

    // LOCKED: the page may not remove the template's chrome.
    await openMenuOn(footerBlockId);
    await expect(
      dropdown.locator('.volto-hydra-dropdown-item:has-text("Remove")'),
      'a locked template\'s fixed member offers no Remove',
    ).toHaveCount(0);
    await page.keyboard.press('Escape');

    // UNLOCKED: the same member is the template author's to delete.
    await helper.unlockTemplate(headerBlockId);
    await helper.waitForBlockEditable(footerBlockId);

    await openMenuOn(footerBlockId);
    await expect(
      dropdown.locator('.volto-hydra-dropdown-item:has-text("Remove")'),
      'an unlocked template\'s fixed member can be removed',
    ).toBeVisible({ timeout: 5000 });
  });

  test('fixed readonly blocks inside template become editable in edit mode', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    const iframe = helper.getIframe();

    // Find template block by content (fixed blocks have random UUIDs after merge)
    const { blockId: headerBlockId, locator: headerBlock } = await helper.waitForBlockByContent(TEMPLATE_HEADER_CONTENT);
    const { blockId: footerBlockId } = await helper.waitForBlockByContent(TEMPLATE_FOOTER_CONTENT);
    const templateBlockIds = [headerBlockId, USER_CONTENT_1, USER_CONTENT_2, footerBlockId];

    // Initially, the fixed template block should NOT be editable
    const editor = helper.getSlateField(headerBlock);
    let isEditable = await editor.getAttribute('contenteditable');
    expect(isEditable).not.toBe('true');

    // Unlock the template for editing (v2: warns, then enters edit mode).
    await helper.unlockTemplate(headerBlockId);

    // Click the fixed block again
    await helper.clickBlockInIframe(headerBlockId);
    await helper.waitForBlockSelectedInAdmin(headerBlockId);

    // Now the fixed block should be editable
    isEditable = await editor.getAttribute('contenteditable');
    expect(isEditable).toBe('true');
  });

  test('fixed readonly blocks NESTED in a template container become editable in edit mode', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    // A grid cell is a fixed template block nested two levels deep
    // (grid -> cell), not a direct child of the instance — the flat unlock check
    // (templateInstanceId match) only covers direct children, so the cell stays
    // locked. Edit mode must walk the instance subtree and unlock it too.
    const { blockId: cellId, locator: cellBlock } = await helper.waitForBlockByContent('Template Grid Cell 1');

    // Initially the nested fixed block is NOT editable.
    const editor = helper.getSlateField(cellBlock);
    let isEditable = await editor.getAttribute('contenteditable');
    expect(isEditable).not.toBe('true');

    // Unlock the template for editing.
    const { blockId: headerBlockId } = await helper.waitForBlockByContent(TEMPLATE_HEADER_CONTENT);
    await helper.unlockTemplate(headerBlockId);

    // The nested grid cell must now be editable — it belongs to the instance.
    await helper.clickBlockInIframe(cellId);
    await helper.waitForBlockSelectedInAdmin(cellId);
    isEditable = await editor.getAttribute('contenteditable');
    expect(isEditable).toBe('true');
  });

  test('a nested template block can be deleted in edit mode', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const iframe = helper.getIframe();

    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    const cellLocator = iframe.locator('[data-block-uid]').filter({ hasText: 'Template Grid Cell 1' });
    const { blockId: cellId } = await helper.waitForBlockByContent('Template Grid Cell 1');

    // Unlock the template for editing.
    const { blockId: headerBlockId } = await helper.waitForBlockByContent(TEMPLATE_HEADER_CONTENT);
    await helper.unlockTemplate(headerBlockId);

    // Delete the nested cell. handleDelete filters out blocks isBlockReadonlyDeep
    // flags as readonly — this guards two fixes together: (1) the ancestry-aware
    // unlock (the flat templateInstanceId check treated the nested cell as
    // readonly), and (2) handleDelete depending on templateEditMode (a stale
    // listener closure otherwise saw edit mode as null and refused to mutate any
    // template block at all).
    await helper.clickBlockInIframe(cellId);
    await helper.waitForBlockSelectedInAdmin(cellId);
    await page.evaluate((id) => {
      document.dispatchEvent(new CustomEvent('hydra-delete-blocks', { detail: { blockIds: [id] } }));
    }, cellId);

    // The nested cell must be gone — it belongs to the edited instance.
    await expect(cellLocator).toHaveCount(0, { timeout: 5000 });
  });

  test('editing a template lets you add + remove children in a container (items region)', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    // Unlock the template for editing.
    const { blockId: headerBlockId } = await helper.waitForBlockByContent(TEMPLATE_HEADER_CONTENT);
    await helper.unlockTemplate(headerBlockId);

    // Select a grid cell, then escape up to the grid container.
    const { blockId: cellId } = await helper.waitForBlockByContent('Template Grid Cell 1');
    await helper.clickBlockInIframe(cellId);
    await helper.waitForBlockSelectedInAdmin(cellId);
    await helper.escapeToParent();

    // canAdd must resolve for the nested grid in edit mode — before recursive
    // stamping the cells had no instance id and the Add control never showed.
    // Assert against the iframe (render = source of truth, selection-independent).
    // The merged grid has ONE real cell (fixture's tpl-grid-cell-2 is a markerless
    // default the merge drops).
    const gridCells = helper.getIframe().locator('.grid-row > [data-block-uid]');
    await expect(gridCells).toHaveCount(1);

    // ADD a child to the nested container while editing the template.
    // (gridBlock allowedBlocks = ['teaser','image'].)
    await helper.addBlockViaSidebar('Blocks', 'Teaser');
    await expect(gridCells).toHaveCount(2);

    // REMOVE a child from the nested container while editing the template.
    await page.evaluate((id) => {
      document.dispatchEvent(new CustomEvent('hydra-delete-blocks', { detail: { blockIds: [id] } }));
    }, cellId);
    await expect(gridCells).toHaveCount(1);
  });

  test('blocks outside template stay editable in edit mode (v2: no page lock)', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    const iframe = helper.getIframe();

    // Find template block by content and wait for standalone block
    const { blockId: headerBlockId } = await helper.waitForBlockByContent(TEMPLATE_HEADER_CONTENT);
    await expect(iframe.locator(`[data-block-uid="${STANDALONE_BLOCK_1}"]`)).toBeVisible();

    // Initially, standalone block should be editable
    await helper.clickBlockInIframe(STANDALONE_BLOCK_1);
    await helper.waitForBlockSelectedInAdmin(STANDALONE_BLOCK_1);
    const standaloneEditor = helper.getSlateField(iframe.locator(`[data-block-uid="${STANDALONE_BLOCK_1}"]`));
    let isEditable = await standaloneEditor.getAttribute('contenteditable');
    expect(isEditable).toBe('true');

    // Unlock the template.
    await helper.unlockTemplate(headerBlockId);

    // v2: the standalone block OUTSIDE the template is STILL editable (unlocking a
    // template does not lock the rest of the page).
    await helper.clickBlockInIframe(STANDALONE_BLOCK_1);
    isEditable = await standaloneEditor.getAttribute('contenteditable');
    expect(isEditable).toBe('true');
  });

  test('locking re-locks the template’s fixed blocks; outside blocks stay editable throughout', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    const iframe = helper.getIframe();

    // Find template blocks by content
    const { blockId: headerBlockId, locator: headerLocator } = await helper.waitForBlockByContent(TEMPLATE_HEADER_CONTENT);

    // Unlock the template.
    await helper.unlockTemplate(headerBlockId);

    // Template's fixed block is editable; the outside block is editable too.
    await helper.clickBlockInIframe(headerBlockId);
    const templateEditor = helper.getSlateField(headerLocator);
    expect(await templateEditor.getAttribute('contenteditable')).toBe('true');
    const standaloneEditor = helper.getSlateField(iframe.locator(`[data-block-uid="${STANDALONE_BLOCK_1}"]`));
    await helper.clickBlockInIframe(STANDALONE_BLOCK_1);
    expect(await standaloneEditor.getAttribute('contenteditable')).toBe('true');

    // Lock the template. No edits were made, so it locks SILENTLY — no decision
    // modal (v2: don't prompt when the template hasn't changed).
    await helper.clickBlockInIframe(headerBlockId);
    await helper.waitForSidebarOpen();
    await helper.escapeToParent();
    await page.locator('.sidebar-section-header[data-is-current="true"] .edit-template-toggle').click();
    await expect(page.locator('.template-lock-modal')).toHaveCount(0);

    // Template block is locked again...
    await helper.clickBlockInIframe(headerBlockId);
    await helper.waitForBlockReadonly(headerBlockId);
    expect(await templateEditor.getAttribute('contenteditable')).not.toBe('true');

    // ...and the standalone block was (and still is) editable.
    await helper.clickBlockInIframe(STANDALONE_BLOCK_1);
    expect(await standaloneEditor.getAttribute('contenteditable')).toBe('true');
  });
});

test.describe('Template Edit Mode - Drag and Drop', () => {
  test('fixed blocks can be dragged in edit mode', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    // Find template blocks by content
    const { blockId: headerBlockId } = await helper.waitForBlockByContent(TEMPLATE_HEADER_CONTENT);
    const { blockId: footerBlockId } = await helper.waitForBlockByContent(TEMPLATE_FOOTER_CONTENT);
    const templateBlockIds = [headerBlockId, USER_CONTENT_1, USER_CONTENT_2, footerBlockId];

    // Unlock the template for editing.
    await helper.unlockTemplate(headerBlockId);

    // Select the fixed header block
    await helper.clickBlockInIframe(headerBlockId);
    await helper.waitForBlockSelectedInAdmin(headerBlockId);

    // In edit mode a fixed template block is movable — the drag handle shows — AND
    // the lock/unlock toggle sits right next to it (v2: consistent lock location).
    const toolbar = page.locator('.quanta-toolbar');
    const dragHandle = toolbar.locator('.drag-handle, [title*="drag"], [aria-label*="drag"]');
    await expect(dragHandle).toBeVisible();

    // The toggle is in the "unlocked/editing" state — clicking it LOCKS (saves).
    const toggle = toolbar.locator('.template-lock-toggle');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle).toHaveAttribute('aria-label', /lock template/i);
  });

  test('dragging block out of template removes template fields', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    const iframe = helper.getIframe();

    // Find template blocks by content
    const { blockId: headerBlockId } = await helper.waitForBlockByContent(TEMPLATE_HEADER_CONTENT);
    const { blockId: footerBlockId } = await helper.waitForBlockByContent(TEMPLATE_FOOTER_CONTENT);
    const templateBlockIds = [headerBlockId, USER_CONTENT_1, USER_CONTENT_2, footerBlockId];

    // Unlock the template for editing.
    await expect(iframe.locator(`[data-block-uid="${USER_CONTENT_1}"]`)).toBeVisible({ timeout: 15000 });
    await helper.unlockTemplate(headerBlockId);

    // Verify user-content-1 is inside template (shows slotId field in sidebar)
    await helper.clickBlockInIframe(USER_CONTENT_1);
    await helper.waitForSidebarOpen();
    const slotIdFieldBefore = page.locator('.field-wrapper-slotId input');
    await expect(slotIdFieldBefore).toBeVisible({ timeout: 5000 });
    await helper.expectTemplateSettingsCount(1);

    // Drag user-content-1 outside the template (after standalone-block-1)
    await helper.dragBlockAfter(USER_CONTENT_1, STANDALONE_BLOCK_1);

    // Verify block moved - it should now be after standalone-block-1 (position 1 in DOM)
    const allBlocks = await iframe.locator('main [data-block-uid], #content [data-block-uid]').all();
    const blockIds = await Promise.all(allBlocks.map(b => b.getAttribute('data-block-uid')));
    const movedIndex = blockIds.indexOf(USER_CONTENT_1);
    const standaloneIndex = blockIds.indexOf(STANDALONE_BLOCK_1);
    expect(movedIndex).toBe(standaloneIndex + 1);

    // v2: the block dragged OUT of the template is now a page block — editable, not
    // locked (unlocking a template doesn't lock the page).
    await helper.waitForBlockEditable(USER_CONTENT_1);

    // Lock the template again (commit).
    await helper.lockTemplate(headerBlockId, 'commit');

    // Select the moved block - it should be editable now (it left the template)
    await helper.clickBlockInIframe(USER_CONTENT_1);
    await helper.waitForSidebarOpen();

    // Block should be editable (not readonly)
    const editor = helper.getSlateField(iframe.locator(`[data-block-uid="${USER_CONTENT_1}"]`));
    const isEditable = await editor.getAttribute('contenteditable');
    expect(isEditable).toBe('true');

    // Placeholder field should NOT be visible (block is no longer in template)
    const slotIdFieldAfter = page.locator('.field-wrapper-slotId input');
    await expect(slotIdFieldAfter).not.toBeVisible();
  });

  test('dropping a slot block before the first fixed anchor exits the template (position-based, not drag direction)', async ({ page }) => {
    // template-test-page is anchored at BOTH ends (fixed header on top, fixed slider +
    // footer at the bottom), so its slots are fully enclosed — there is NO slot before the
    // header. Dropping user-content-1 before the header therefore lands it OUTSIDE the top
    // anchor, in the page region: it EXITS the template (loses its slotId, stays an
    // editable page block). This is the SAME position, and so the SAME outcome, as dragging
    // it AFTER the standalone page block (test 691) — membership is decided by POSITION, not
    // by which way you dragged. (Regression guard: a prior direction-based rule inherited the
    // fixed header's membership here, producing an in-template, slot-less, read-only block.)
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    const iframe = helper.getIframe();

    // Find template blocks by content
    const { blockId: headerBlockId } = await helper.waitForBlockByContent(TEMPLATE_HEADER_CONTENT);
    const { blockId: footerBlockId } = await helper.waitForBlockByContent(TEMPLATE_FOOTER_CONTENT);
    const templateBlockIds = [headerBlockId, USER_CONTENT_1, USER_CONTENT_2, footerBlockId];

    // Unlock the template for editing.
    await expect(iframe.locator(`[data-block-uid="${USER_CONTENT_1}"]`)).toBeVisible({ timeout: 15000 });
    await helper.unlockTemplate(headerBlockId);

    // Move user-content-1 BEFORE the first fixed block (header)
    // This puts a slot block at the template edge
    await helper.clickBlockInIframe(USER_CONTENT_1);
    await helper.waitForSidebarOpen();
    const slotIdFieldBefore = page.locator('.field-wrapper-slotId input');
    await expect(slotIdFieldBefore).toBeVisible({ timeout: 5000 });

    await helper.dragBlockBefore(USER_CONTENT_1, headerBlockId);

    // Verify block moved - it should now be before header
    const allBlocks = await iframe.locator('main [data-block-uid], #content [data-block-uid]').all();
    const blockIds = await Promise.all(allBlocks.map(b => b.getAttribute('data-block-uid')));
    const movedIndex = blockIds.indexOf(USER_CONTENT_1);
    const headerIndex = blockIds.indexOf(headerBlockId);
    expect(movedIndex).toBeLessThan(headerIndex);

    // The block EXITED the template (it's before the top anchor, in the page region):
    // no slotId field, but still a fully editable page block.
    await helper.clickBlockInIframe(USER_CONTENT_1);
    await helper.waitForSidebarOpen();

    // Placeholder field should NOT be visible (block is no longer in the template)
    const slotIdFieldAfter = page.locator('.field-wrapper-slotId input');
    await expect(slotIdFieldAfter).not.toBeVisible();

    // Block should be editable (a plain page block, not a read-only template block)
    const editor = helper.getSlateField(iframe.locator(`[data-block-uid="${USER_CONTENT_1}"]`));
    const isEditable = await editor.getAttribute('contenteditable');
    expect(isEditable).toBe('true');
  });

  test('dragging block into template adds template fields', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    const iframe = helper.getIframe();

    // Find template blocks by content
    const { blockId: headerBlockId } = await helper.waitForBlockByContent(TEMPLATE_HEADER_CONTENT);
    const { blockId: footerBlockId } = await helper.waitForBlockByContent(TEMPLATE_FOOTER_CONTENT);
    const templateBlockIds = [headerBlockId, USER_CONTENT_1, USER_CONTENT_2, footerBlockId];

    // Unlock the template for editing.
    await expect(iframe.locator(`[data-block-uid="${STANDALONE_BLOCK_1}"]`)).toBeVisible({ timeout: 15000 });
    await helper.unlockTemplate(headerBlockId);

    // Verify standalone-block-1 is NOT in template (no slotId field)
    // First exit template edit mode to check
    await helper.clickBlockInIframe(STANDALONE_BLOCK_1);
    await helper.waitForSidebarOpen();
    // Outside template blocks are locked in template edit mode, so no slotId field
    const slotIdFieldBefore = page.locator('.field-wrapper-slotId input');
    await expect(slotIdFieldBefore).not.toBeVisible();

    // Drag standalone-block-1 into the template (between slot blocks)
    await helper.dragBlockAfter(STANDALONE_BLOCK_1, USER_CONTENT_1);

    // Select the moved block
    await helper.clickBlockInIframe(STANDALONE_BLOCK_1);
    await helper.waitForSidebarOpen();

    // Block should now show slotId field (it's now in template)
    const slotIdFieldAfter = page.locator('.field-wrapper-slotId input');
    await expect(slotIdFieldAfter).toBeVisible({ timeout: 5000 });
    await helper.expectTemplateSettingsCount(1);

    // Block should be editable (since we're in template edit mode)
    const editor = helper.getSlateField(iframe.locator(`[data-block-uid="${STANDALONE_BLOCK_1}"]`));
    const isEditable = await editor.getAttribute('contenteditable');
    expect(isEditable).toBe('true');
  });

  test('block dragged into template inherits slotId from neighbors', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    const iframe = helper.getIframe();

    // Find template blocks by content
    const { blockId: headerBlockId } = await helper.waitForBlockByContent(TEMPLATE_HEADER_CONTENT);
    const { blockId: footerBlockId } = await helper.waitForBlockByContent(TEMPLATE_FOOTER_CONTENT);
    const templateBlockIds = [headerBlockId, USER_CONTENT_1, USER_CONTENT_2, footerBlockId];

    // Unlock the template for editing.
    await expect(iframe.locator(`[data-block-uid="${STANDALONE_BLOCK_1}"]`)).toBeVisible({ timeout: 15000 });
    await helper.unlockTemplate(headerBlockId);

    // First check what slotId value user-content-1 has (should be "primary")
    await helper.clickBlockInIframe(USER_CONTENT_1);
    await helper.waitForSidebarOpen();
    const neighborPlaceholder = page.locator('.field-wrapper-slotId input');
    const expectedPlaceholder = await neighborPlaceholder.inputValue();
    expect(expectedPlaceholder).toBe('primary');

    // Drag standalone block into template (between user-content-1 and user-content-2)
    await helper.dragBlockAfter(STANDALONE_BLOCK_1, USER_CONTENT_1);

    // Select the newly added block
    await helper.clickBlockInIframe(STANDALONE_BLOCK_1);
    await helper.waitForSidebarOpen();

    // Should show slotId field with inherited value from neighbors
    const slotIdInput = page.locator('.field-wrapper-slotId input');
    await expect(slotIdInput).toBeVisible({ timeout: 5000 });

    // The slotId should match the neighbors (all are "primary" in this region)
    const actualSlotId = await slotIdInput.inputValue();
    expect(actualSlotId).toBe(expectedPlaceholder);
  });
});

test.describe('Template Edit Mode - Validation', () => {
  test('non-contiguous slot groups prevent exit from edit mode', async ({ page }) => {
    // Rule: all blocks with the same slotId must be adjacent.
    //   Valid:   [header] [primary] [primary] [primary] [footer]
    //   Invalid: [header] [primary] [secondary] [primary] [footer]  <- "primary" split in two
    //
    // A block dragged out of a slot now EXITS the template (it can't be left as a stranded
    // "primary" separated by the footer), so the split is created the way editing still can —
    // re-slot the MIDDLE of three primary blocks. The validation must refuse the lock. (The
    // fixture starts with three CONTIGUOUS primary blocks, valid on load.)

    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/template-split-slot-page');

    const iframe = helper.getIframe();

    const { blockId: headerBlockId } = await helper.waitForBlockByContent(TEMPLATE_HEADER_CONTENT);
    await expect(iframe.locator('[data-block-uid="ss-content-2"]')).toBeVisible({ timeout: 15000 });
    await helper.unlockTemplate(headerBlockId);

    // Split the contiguous "primary" group by re-slotting the MIDDLE block to "secondary":
    // [primary] [secondary] [primary] — "primary" is no longer contiguous.
    await helper.clickBlockInIframe('ss-content-2');
    await helper.waitForSidebarOpen();
    await page.locator('.field-wrapper-slotId input').fill('secondary');

    // Try to LOCK (Change on all pages) — validation must block the commit and keep the
    // template unlocked so the structure can be fixed.
    await helper.clickBlockInIframe(headerBlockId);
    await helper.waitForSidebarOpen();
    await helper.escapeToParent();
    const editToggle = page.locator('.sidebar-section-header[data-is-current="true"] .edit-template-toggle');
    await editToggle.click();
    await page.locator('.template-lock-modal .template-commit').click();

    // Should show validation error about non-contiguous slots (prevents lock)
    const errorMessage = page.locator('.toast-error, .Toastify__toast--error').filter({ hasText: /slot|contiguous|adjacent|position/i });
    await expect(errorMessage).toBeVisible({ timeout: 5000 });

    // Still unlocked — the commit was refused.
    await expect(editToggle).toHaveAttribute('aria-pressed', 'true');
  });

  test('adjacent slot groups without fixed block prevent exit from edit mode', async ({ page }) => {
    // Rule: Different slot groups must be separated by a fixed block.
    // Having two different slot groups adjacent is invalid.
    //
    // Valid:   [header-fixed] [primary] [primary] [footer-fixed]
    // Invalid: [header-fixed] [primary] [secondary] [footer-fixed]  <- no fixed block between groups

    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    const iframe = helper.getIframe();

    // Find template blocks by content
    const { blockId: headerBlockId } = await helper.waitForBlockByContent(TEMPLATE_HEADER_CONTENT);
    const { blockId: footerBlockId } = await helper.waitForBlockByContent(TEMPLATE_FOOTER_CONTENT);
    const templateBlockIds = [headerBlockId, USER_CONTENT_1, USER_CONTENT_2, footerBlockId];

    // Unlock the template for editing.
    await expect(iframe.locator(`[data-block-uid="${USER_CONTENT_1}"]`)).toBeVisible({ timeout: 15000 });
    await helper.unlockTemplate(headerBlockId);

    // Select user-content-2 and change its slotId to create a different group
    await helper.clickBlockInIframe(USER_CONTENT_2);
    await helper.waitForSidebarOpen();

    // Change slotId in sidebar from "primary" to "secondary"
    const slotIdField = page.locator('.field-wrapper-slotId input');
    await slotIdField.fill('secondary');

    // Try to LOCK (Change on all pages) — validation must block the commit.
    await helper.clickBlockInIframe(headerBlockId);
    await helper.waitForSidebarOpen();
    await helper.escapeToParent();
    const editToggle = page.locator('.sidebar-section-header[data-is-current="true"] .edit-template-toggle');
    await editToggle.click();
    await page.locator('.template-lock-modal .template-commit').click();

    // Should show validation error about adjacent slot groups needing fixed block (prevents lock)
    const errorMessage = page.locator('.toast-error, .Toastify__toast--error').filter({ hasText: /slot|fixed|separated/i });
    await expect(errorMessage).toBeVisible({ timeout: 5000 });

    // Still unlocked — the commit was refused.
    await expect(editToggle).toHaveAttribute('aria-pressed', 'true');
  });

  test('while editing a template, dragging a block to a different slot region keeps its slotId', async ({ page }) => {
    // In template edit mode the slotId is EXPLICIT — you rename slots, you don't change them
    // by dragging. Dragging ts-p2 ("primary") into the "secondary" region (still inside the
    // template) must KEEP it "primary" — NOT silently re-slot it to "secondary". (The author
    // now has an invalid arrangement to fix, or save-time validation catches it.) This is the
    // template-edit half of the edit-mode-gated membership rule; the normal-mode half (content
    // takes the slot it lands in / exits) is covered by template-edit-mode:691 and :746.
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/template-two-slots-page');

    const iframe = helper.getIframe();

    const { blockId: headerBlockId } = await helper.waitForBlockByContent(TEMPLATE_HEADER_CONTENT);
    await expect(iframe.locator('[data-block-uid="ts-p2"]')).toBeVisible({ timeout: 15000 });
    await helper.unlockTemplate(headerBlockId);

    // Drag ts-p2 (primary) into the secondary region: after ts-s1 (secondary), still inside
    // the template (between it and the fixed footer).
    await helper.dragBlockAfter('ts-p2', 'ts-s1');

    // It moved into the secondary region but KEPT its authored slotId "primary".
    await helper.clickBlockInIframe('ts-p2');
    await helper.waitForSidebarOpen();
    await expect(page.locator('.field-wrapper-slotId input')).toHaveValue('primary');
  });

  test('saved template changes persist and appear on other pages using the template', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    const iframe = helper.getIframe();

    // Find template blocks by content
    const { blockId: headerBlockId, locator: headerLocator } = await helper.waitForBlockByContent(TEMPLATE_HEADER_CONTENT);
    const { blockId: footerBlockId } = await helper.waitForBlockByContent(TEMPLATE_FOOTER_CONTENT);
    const templateBlockIds = [headerBlockId, USER_CONTENT_1, USER_CONTENT_2, footerBlockId];

    // Unlock the template for editing.
    await helper.unlockTemplate(headerBlockId);

    // Make a valid change - edit template header content
    await helper.clickBlockInIframe(headerBlockId);
    const editor = helper.getSlateField(headerLocator);
    // Wait for contenteditable to be set (template edit mode makes fixed blocks editable)
    await expect(editor).toHaveAttribute('contenteditable', 'true', { timeout: 5000 });
    await editor.click();
    // Wait for element to be focused before typing
    await expect(editor).toBeFocused({ timeout: 2000 });
    await page.keyboard.press('End');
    await page.keyboard.type(' - edited');
    // Wait for text to appear - use fresh locator since text changed (stale locator won't match)
    const headerBlock = iframe.locator(`[data-block-uid="${headerBlockId}"]`);
    await expect(headerBlock).toContainText('edited', { timeout: 5000 });

    // Lock with "Change on all pages" — commits + SAVES the template document now
    // (v2: templates save on lock, not with the page).
    await helper.lockTemplate(headerBlockId, 'commit');

    // Save the page too (allowed now that nothing is unlocked) - wait for pencil
    // icon (view mode) indicating save completed
    await page.keyboard.press('Control+s');
    const pencilIcon = page.locator('.toolbar-actions .edit, [aria-label="Edit"]');
    await expect(pencilIcon).toBeVisible({ timeout: 10000 });

    // Should NOT show validation error
    const errorMessage = page.locator('.toast-error, .validation-error, [role="alert"]').filter({ hasText: /slot|split|contiguous/i });
    await expect(errorMessage).not.toBeVisible();

    // Wait for iframe to refresh with new content (block count stabilizes after Nuxt re-renders)
    await helper.getStableBlockCount();

    // Content should be preserved in view mode - find by content since text and ID both changed
    const editedHeader = iframe.locator('main [data-block-uid], #content [data-block-uid]').filter({ hasText: 'edited' }).first();
    await expect(editedHeader).toBeVisible({ timeout: 15000 });

    // Verify template was actually saved by loading another page using the same template
    // Navigate to view mode (not edit) to also test that view mode loads templates
    await helper.navigateToView('/template-test-page-2');
    // Find header by content on page 2 as well
    const { locator: page2Header } = await helper.waitForBlockByContent('edited');
    await expect(page2Header).toContainText('edited', { timeout: 15000 });
  });

  test('saved NESTED template changes (a block inside a container) persist to other pages', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    const iframe = helper.getIframe();

    // A grid cell is nested inside the grid container (and inside a nested
    // "Template blocks" instance level) — not a direct child of the instance.
    // The top-level save test above only edits the header; the reverse merge that
    // captures edits back into the template must also walk into containers, or a
    // nested edit is silently dropped on save.
    const { blockId: headerBlockId } = await helper.waitForBlockByContent(TEMPLATE_HEADER_CONTENT);
    const { blockId: cellId, locator: cellLocator } = await helper.waitForBlockByContent('Template Grid Cell 1');

    // Unlock the template for editing.
    await helper.unlockTemplate(headerBlockId);

    // Edit the NESTED grid cell with a unique marker
    await helper.clickBlockInIframe(cellId);
    const editor = helper.getSlateField(cellLocator);
    await expect(editor).toHaveAttribute('contenteditable', 'true', { timeout: 5000 });
    await editor.click();
    await expect(editor).toBeFocused({ timeout: 2000 });
    await page.keyboard.press('End');
    await page.keyboard.type(' NESTEDSAVE');
    const cellBlock = iframe.locator(`[data-block-uid="${cellId}"]`);
    await expect(cellBlock).toContainText('NESTEDSAVE', { timeout: 5000 });

    // Lock with "Change on all pages" — commits + saves the template document.
    await helper.lockTemplate(headerBlockId, 'commit');

    // Save the page too (allowed now that nothing is unlocked).
    await page.keyboard.press('Control+s');
    const pencilIcon = page.locator('.toolbar-actions .edit, [aria-label="Edit"]');
    await expect(pencilIcon).toBeVisible({ timeout: 10000 });
    await helper.getStableBlockCount();

    // The nested edit must persist to another page using the same template.
    await helper.navigateToView('/template-test-page-2');
    const { locator: page2Cell } = await helper.waitForBlockByContent('NESTEDSAVE');
    await expect(page2Cell).toContainText('NESTEDSAVE', { timeout: 15000 });
  });
});

test.describe('Template Edit Mode - Block Settings', () => {
  test('can change block slotId in edit mode', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    const iframe = helper.getIframe();

    // Find template blocks by content
    const { blockId: headerBlockId } = await helper.waitForBlockByContent(TEMPLATE_HEADER_CONTENT);
    const { blockId: footerBlockId } = await helper.waitForBlockByContent(TEMPLATE_FOOTER_CONTENT);
    const templateBlockIds = [headerBlockId, USER_CONTENT_1, USER_CONTENT_2, footerBlockId];

    // Unlock the template for editing.
    await expect(iframe.locator(`[data-block-uid="${USER_CONTENT_1}"]`)).toBeVisible({ timeout: 15000 });
    await helper.unlockTemplate(headerBlockId);

    // Select a slot block
    await helper.clickBlockInIframe(USER_CONTENT_1);
    await helper.waitForSidebarOpen();

    // slotId input should be visible and have initial value from block data.
    const slotIdInput = page.locator('.field-wrapper-slotId input');
    await expect(slotIdInput).toHaveValue('primary', { timeout: 5000 });
    await helper.expectTemplateSettingsCount(1);

    // CRITICAL — wait for the sidebar form to STOP re-rendering before
    // typing. Just-asserting toHaveValue('primary') above only catches
    // the first poll where the value matches; Volto's TextWidget can
    // still be receiving Redux dispatches from schema-inheritance
    // recompute / template state churn for several hundred ms after.
    // If we start typing during that window the input unmounts and our
    // keystrokes go nowhere (or land on the next mount with leftover
    // text). Gate on N consecutive same-value polls of 'primary' before
    // touching it. (Cheap on the fast path: passes after ~300ms.)
    {
      let prev = '', stable = 0;
      await expect.poll(async () => {
        const v = await slotIdInput.inputValue();
        if (v === prev && v === 'primary') stable++;
        else { stable = 0; prev = v; }
        return stable >= 3;
      }, { timeout: 5000, intervals: [100, 150, 200] }).toBe(true);
    }

    // pressSequentially (NOT fill) on purpose. Volto's TextWidget is a
    // React controlled input whose value flows from Redux. fill() sets
    // the DOM `.value` directly and fires ONE 'input' event — React's
    // onChange may not dispatch the Redux update in time, and the next
    // render reads the stale value and reverts the DOM. Typing one char
    // at a time fires real keydown/keyup/input per char, React handles
    // each deterministically.
    await slotIdInput.press('ControlOrMeta+a');
    await slotIdInput.press('Backspace');
    await slotIdInput.pressSequentially('new-slot-name', { delay: 20 });

    // Stable-for-N-consecutive-polls gate: value must equal
    // 'new-slot-name' for 3 polls in a row. If a late re-render of the
    // sidebar form (from an iframe FORM_DATA echo or schema-inheritance
    // recompute) reverts the value, the counter resets and we keep
    // waiting; if Redux can't settle on the typed value at all the poll
    // times out, surfacing the bug rather than masking it.
    //
    // Generous timeout (10s) because admin-nuxt is markedly slower than
    // admin-mock — extra FORM_DATA echoes from the Nuxt iframe extend the
    // re-render churn window before the form quiets down.
    const seen: string[] = [];
    let prev = '';
    let stable = 0;
    try {
      await expect.poll(async () => {
        const v = await slotIdInput.inputValue();
        if (seen[seen.length - 1] !== v) seen.push(v);
        if (v === prev && v === 'new-slot-name') stable++;
        else { stable = 0; prev = v; }
        return stable >= 3;
      }, { timeout: 10000, intervals: [100, 150, 200] }).toBe(true);
    } catch (e) {
      throw new Error(`slotId never settled at "new-slot-name". Distinct values seen during poll: ${JSON.stringify(seen)} — last value: "${prev}"`);
    }
  });

  test('can toggle block fixed mode in edit mode', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    const iframe = helper.getIframe();

    // Find template blocks by content
    const { blockId: headerBlockId } = await helper.waitForBlockByContent(TEMPLATE_HEADER_CONTENT);
    const { blockId: footerBlockId } = await helper.waitForBlockByContent(TEMPLATE_FOOTER_CONTENT);
    const templateBlockIds = [headerBlockId, USER_CONTENT_1, USER_CONTENT_2, footerBlockId];

    // Unlock the template for editing.
    await expect(iframe.locator(`[data-block-uid="${USER_CONTENT_1}"]`)).toBeVisible({ timeout: 15000 });
    await helper.unlockTemplate(headerBlockId);

    // Select a slot block (not fixed)
    await helper.clickBlockInIframe(USER_CONTENT_1);
    await helper.waitForSidebarOpen();

    // Scroll sidebar to make Template Settings visible
    const sidebar = page.locator('#sidebar-template-settings');
    await sidebar.scrollIntoViewIfNeeded();

    // The kind dropdown replaces the fixed/readOnly checkboxes. A user-content block that is
    // neither fixed nor readOnly starts as "Slot"; changing it to a fixed kind must take.
    const kindField = page.locator('#sidebar-template-settings .field-wrapper-kind');
    await expect(kindField).toBeVisible({ timeout: 5000 });
    await helper.expectTemplateSettingsCount(1);

    const kindValue = kindField.locator('.react-select__single-value');
    await expect(kindValue).toContainText('Slot');

    // Open the dropdown and pick a fixed kind; verify the selection took.
    await kindField.locator('.react-select__control').click();
    await page
      .locator('.react-select__menu .react-select__option', { hasText: 'Fixed, read-only' })
      .click();
    await expect(kindValue).toContainText('Fixed, read-only', { timeout: 5000 });
  });
});

test.describe('Template Edit Mode - Object List Items', () => {
  // Object_list items (e.g., slider slides) inside a fixed/readOnly template block
  // should inherit readOnly status — they can't be edited until template edit mode is on.
  //
  // Carousel slides: only the first slide is visible by default.
  // Use carousel next button (data-block-selector="+1") to navigate to subsequent slides.
  const SLIDER_BLOCK_ID = 'template-slider';
  // Forced-layout nested template blocks are instance-scoped (`${instanceId}::tpl-slide-1`)
  // so two instances don't collide; resolve the actual rendered id from this suffix.
  const SLIDE_1_SUFFIX = 'tpl-slide-1';
  const SLIDE_2_SUFFIX = 'tpl-slide-2';

  test('object_list items inside readOnly template block are locked', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const iframe = helper.getIframe();

    await helper.login();
    await helper.navigateToEdit('/template-test-page');
    await helper.getStableBlockCount();

    // Wait for slider container to be visible
    await expect(iframe.locator(`[data-block-uid="${SLIDER_BLOCK_ID}"]`)).toBeVisible({ timeout: 10000 });

    const SLIDE_1_ID = await helper.resolveBlockId(SLIDE_1_SUFFIX);
    const SLIDE_2_ID = await helper.resolveBlockId(SLIDE_2_SUFFIX);
    // Verify slides have hydra-locked class (readOnly from template)
    await helper.waitForBlockReadonly(SLIDE_1_ID);

    // Use carousel indicator to select slide 1 (slide itself may be hidden due to hydra-locked CSS)
    const slide1Indicator = iframe.locator(`[data-block-selector="${SLIDE_1_ID}"]`);
    await slide1Indicator.click();
    // hydra-locked breaks absolute positioning so toolbar position check fails — use sidebar instead
    await helper.waitForSidebarCurrentBlock('Slide');

    // Sidebar form should NOT have interactive inputs (readOnly slide)
    const sidebarInputs = page.locator('#sidebar-properties input:not([type="hidden"]), #sidebar-properties textarea, #sidebar-properties [contenteditable="true"]');
    await expect(sidebarInputs).toHaveCount(0, { timeout: 3000 });

    // Navigate to slide 2 via carousel next button and verify it's also locked
    const nextButton = iframe.locator('[data-block-selector="+1"]');
    await nextButton.click();
    await helper.waitForSidebarCurrentBlock('Slide');
    await helper.waitForBlockReadonly(SLIDE_2_ID);
  });

  test('readOnly parent block sidebar form should not be interactive', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const iframe = helper.getIframe();

    await helper.login();
    await helper.navigateToEdit('/template-test-page');
    await helper.getStableBlockCount();

    // Wait for slider container to be visible
    await expect(iframe.locator(`[data-block-uid="${SLIDER_BLOCK_ID}"]`)).toBeVisible({ timeout: 10000 });

    // Use carousel indicator to select slide 1
    const SLIDE_1_ID = await helper.resolveBlockId(SLIDE_1_SUFFIX);
    const slide1Indicator = iframe.locator(`[data-block-selector="${SLIDE_1_ID}"]`);
    await slide1Indicator.click();
    await helper.waitForSidebarCurrentBlock('Slide');

    // Navigate up to the parent slider block
    await helper.escapeToParent();
    await page.waitForTimeout(300);

    // The parent slider's sidebar form should NOT have interactive inputs
    // (the slider block is readOnly — its settings like autoplayEnabled should be disabled)
    const sidebarInputs = page.locator('#sidebar-properties input:not([type="hidden"]), #sidebar-properties textarea, #sidebar-properties [contenteditable="true"]');
    await expect(sidebarInputs).toHaveCount(0, { timeout: 3000 });
  });

  test('object_list items become editable in template edit mode', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const iframe = helper.getIframe();

    await helper.login();
    await helper.navigateToEdit('/template-test-page');
    await helper.getStableBlockCount();

    const { blockId: headerBlockId } = await helper.waitForBlockByContent(TEMPLATE_HEADER_CONTENT);
    const { blockId: footerBlockId } = await helper.waitForBlockByContent(TEMPLATE_FOOTER_CONTENT);
    const templateBlockIds = [headerBlockId, USER_CONTENT_1, USER_CONTENT_2, footerBlockId];

    const SLIDE_1_ID = await helper.resolveBlockId(SLIDE_1_SUFFIX);
    const SLIDE_2_ID = await helper.resolveBlockId(SLIDE_2_SUFFIX);
    // Initially locked
    await helper.waitForBlockReadonly(SLIDE_1_ID);

    // Unlock the template for editing.
    await helper.unlockTemplate(headerBlockId);

    // Now the first slide should be editable (no longer locked)
    await helper.waitForBlockEditable(SLIDE_1_ID);

    // Select slide 1 via carousel indicator — sidebar form should now have interactive inputs
    const slide1Indicator = iframe.locator(`[data-block-selector="${SLIDE_1_ID}"]`);
    await slide1Indicator.click();
    await helper.waitForSidebarCurrentBlock('Slide');
    const sidebarInputs = page.locator('#sidebar-properties input:not([type="hidden"]), #sidebar-properties textarea, #sidebar-properties [contenteditable="true"]');
    await expect(sidebarInputs.first()).toBeVisible({ timeout: 5000 });

    // Object_list items should NOT show their own TEMPLATE SETTINGS —
    // only the parent block's template settings should appear
    await helper.expectTemplateSettingsCount(1);

    // Navigate to slide 2 and verify it's also editable
    const nextButton = iframe.locator('[data-block-selector="+1"]');
    await nextButton.click();
    await helper.waitForSidebarCurrentBlock('Slide');
    await helper.waitForBlockEditable(SLIDE_2_ID);
  });

  test('new object_list item added in template edit mode inherits template settings', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const iframe = helper.getIframe();

    await helper.login();
    await helper.navigateToEdit('/template-test-page');
    await helper.getStableBlockCount();

    // Find template blocks and enter template edit mode
    const { blockId: headerBlockId } = await helper.waitForBlockByContent(TEMPLATE_HEADER_CONTENT);
    const { blockId: footerBlockId } = await helper.waitForBlockByContent(TEMPLATE_FOOTER_CONTENT);
    const templateBlockIds = [headerBlockId, USER_CONTENT_1, USER_CONTENT_2, footerBlockId];

    await helper.unlockTemplate(headerBlockId);

    // Select slide 1 via carousel indicator, then click the [+] to add a new slide
    const SLIDE_1_ID = await helper.resolveBlockId(SLIDE_1_SUFFIX);
    await helper.waitForBlockEditable(SLIDE_1_ID);
    const slide1Indicator = iframe.locator(`[data-block-selector="${SLIDE_1_ID}"]`);
    await slide1Indicator.click();
    await helper.waitForSidebarCurrentBlock('Slide');
    await helper.clickAddBlockButton();

    // Wait for the new slide to be selected
    await helper.waitForSidebarCurrentBlock('Slide');

    // The new slide should be editable (we're in template edit mode)
    const sidebarInputs = page.locator('#sidebar-properties input:not([type="hidden"]), #sidebar-properties textarea, #sidebar-properties [contenteditable="true"]');
    await expect(sidebarInputs.first()).toBeVisible({ timeout: 5000 });

    // The new slide should inherit template settings from its neighbor (fixed, readOnly),
    // so the kind dropdown shows "Fixed, read-only".
    await helper.expectTemplateSettingsCount(1);
    const kindValue = page.locator('#sidebar-template-settings .field-wrapper-kind .react-select__single-value');
    await expect(kindValue).toContainText('Fixed, read-only', { timeout: 5000 });

    // The iframe [+] add button should still be visible on the new slide
    const addButton = page.locator('.volto-hydra-add-button');
    await expect(addButton).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Template Edit Mode - UI Restrictions', () => {
  test('readonly blocks should not show format buttons in toolbar', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    // Find template header by content (has random UUID after merge)
    const headerBlockId = await helper.clickBlockByContent(TEMPLATE_HEADER_CONTENT);
    await helper.waitForBlockSelectedInAdmin(headerBlockId);

    // Format buttons (bold, italic, etc.) should NOT be visible
    const toolbar = page.locator('.quanta-toolbar');
    const formatButtons = toolbar.locator('[data-toolbar-button]');
    await expect(formatButtons).toHaveCount(0);
  });

  test('readonly blocks should not show media field overlay', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    // Find template header by content (has random UUID after merge)
    const headerBlockId = await helper.clickBlockByContent(TEMPLATE_HEADER_CONTENT);
    await helper.waitForBlockSelectedInAdmin(headerBlockId);

    // Media overlay (X button to clear image) should NOT be visible
    const mediaOverlay = page.locator('.empty-image-overlay, button[title="Clear image"]');
    await expect(mediaOverlay).toHaveCount(0);
  });

  test('readonly blocks should not show link/media buttons in toolbar', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    // Find template header by content (has random UUID after merge)
    const headerBlockId = await helper.clickBlockByContent(TEMPLATE_HEADER_CONTENT);
    await helper.waitForBlockSelectedInAdmin(headerBlockId);

    // Link and media field buttons should NOT be visible
    const toolbar = page.locator('.quanta-toolbar');
    const linkButton = toolbar.locator('button[title*="link" i]');
    const mediaButton = toolbar.locator('button[title*="image" i]');
    await expect(linkButton).toHaveCount(0);
    await expect(mediaButton).toHaveCount(0);
  });

  test('readonly block sidebar form should not be interactive', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    // Find and click readonly template header block
    const headerBlockId = await helper.clickBlockByContent(TEMPLATE_HEADER_CONTENT);
    await helper.waitForSidebarOpen();

    // Sidebar form should not have interactive inputs (readonly block)
    const sidebarInputs = page.locator('#sidebar-properties input:not([type="hidden"]), #sidebar-properties textarea, #sidebar-properties [contenteditable="true"]');
    await expect(sidebarInputs).toHaveCount(0, { timeout: 3000 });
  });

  test('readonly block sidebar form becomes interactive in template edit mode', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    const { blockId: headerBlockId } = await helper.waitForBlockByContent(TEMPLATE_HEADER_CONTENT);
    const { blockId: footerBlockId } = await helper.waitForBlockByContent(TEMPLATE_FOOTER_CONTENT);
    const templateBlockIds = [headerBlockId, USER_CONTENT_1, USER_CONTENT_2, footerBlockId];

    // Unlock the template for editing.
    await helper.unlockTemplate(headerBlockId);

    // Click header block again — now in template edit mode
    await helper.clickBlockInIframe(headerBlockId);
    await helper.waitForSidebarOpen();

    // Sidebar form should now have interactive inputs
    const sidebarInputs = page.locator('#sidebar-properties input:not([type="hidden"]), #sidebar-properties textarea, #sidebar-properties [contenteditable="true"]');
    await expect(sidebarInputs.first()).toBeVisible({ timeout: 5000 });
  });

  test('fixed blocks should not show Remove option in dropdown menu', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    // Find template header by content (has random UUID after merge)
    const headerBlockId = await helper.clickBlockByContent(TEMPLATE_HEADER_CONTENT);
    await helper.waitForBlockSelectedInAdmin(headerBlockId);
    await helper.waitForSidebarOpen();

    // Open the dropdown menu (scroll to it first as it may be below the fold)
    const menuButton = page.locator('.parent-block-section .menu-trigger').last();
    await menuButton.scrollIntoViewIfNeeded();
    await menuButton.click();
    // Wait for menu to appear
    const menu = page.locator('.volto-hydra-dropdown-menu');
    await expect(menu).toBeVisible({ timeout: 5000 });

    // Remove option should NOT be visible
    const removeOption = menu.locator('.volto-hydra-dropdown-item').filter({ hasText: /Remove/i });
    await expect(removeOption).toHaveCount(0);
  });

  test('fixed blocks should not show Make Template option in dropdown menu', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    // Find template header by content (has random UUID after merge)
    const headerBlockId = await helper.clickBlockByContent(TEMPLATE_HEADER_CONTENT);
    await helper.waitForBlockSelectedInAdmin(headerBlockId);
    await helper.waitForSidebarOpen();

    // Open the dropdown menu (scroll to it first as it may be below the fold)
    const menuButton = page.locator('.parent-block-section .menu-trigger').last();
    await menuButton.scrollIntoViewIfNeeded();
    await menuButton.click();
    // Wait for menu to appear
    const menu = page.locator('.volto-hydra-dropdown-menu');
    await expect(menu).toBeVisible({ timeout: 5000 });

    // Make Template option should NOT be visible for fixed blocks
    const makeTemplateOption = menu.locator('.volto-hydra-dropdown-item').filter({ hasText: /Make Template/i });
    await expect(makeTemplateOption).toHaveCount(0);
  });

  test('readonly blocks should not show Convert to option in dropdown menu', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    // Find template header by content (has random UUID after merge)
    const headerBlockId = await helper.clickBlockByContent(TEMPLATE_HEADER_CONTENT);
    await helper.waitForBlockSelectedInAdmin(headerBlockId);
    await helper.waitForSidebarOpen();

    // Open the dropdown menu (scroll to it first as it may be below the fold)
    const menuButton = page.locator('.parent-block-section .menu-trigger').last();
    await menuButton.scrollIntoViewIfNeeded();
    await menuButton.click();
    // Wait for menu to appear
    const menu = page.locator('.volto-hydra-dropdown-menu');
    await expect(menu).toBeVisible({ timeout: 5000 });

    // Convert to option should NOT be visible for readonly blocks
    const convertOption = menu.locator('.volto-hydra-dropdown-item').filter({ hasText: /Convert to/i });
    await expect(convertOption).toHaveCount(0);
  });

  test('blocks outside the template stay fully interactive while a template is unlocked (v2: no page lock)', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const iframe = helper.getIframe();

    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    // Find template blocks by content
    const { blockId: headerBlockId } = await helper.waitForBlockByContent(TEMPLATE_HEADER_CONTENT);

    // Unlock the template for editing.
    await helper.unlockTemplate(headerBlockId);

    // Select a block outside the template — v2: it stays a fully-editable, movable
    // page block (unlocking a template no longer locks the page).
    await helper.clickBlockInIframe(STANDALONE_BLOCK_1);
    await helper.waitForBlockSelectedInAdmin(STANDALONE_BLOCK_1);
    await helper.waitForBlockEditable(STANDALONE_BLOCK_1);

    // Editable content + no lock in its toolbar = a normal, interactive page block.
    const editor = helper.getSlateField(iframe.locator(`[data-block-uid="${STANDALONE_BLOCK_1}"]`));
    expect(await editor.getAttribute('contenteditable')).toBe('true');
    await expect(page.locator('.quanta-toolbar .lock-icon')).toHaveCount(0);
  });
});

test.describe('Template Edit Mode - Permissions', () => {
  test('Edit-template button is disabled when the user lacks Modify permission on the template', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    // Deny "Modify portal content" on the template document: force can_edit=false on every
    // test-layout template response. Isolated to this test — no fixture change, no effect
    // on other tests. Verifies the edit gate end to end (threading + key match + rendering).
    await page.route('**/*test-layout*', async (route) => {
      const res = await route.fetch();
      let body;
      try {
        body = await res.json();
      } catch {
        return route.fulfill({ response: res });
      }
      body.can_edit = false;
      return route.fulfill({ response: res, json: body });
    });

    await helper.login();
    await helper.navigateToEdit('/template-test-page');
    await helper.getStableBlockCount();

    // Enter the template instance (select a template block, then escape to its parent).
    const { blockId: headerBlockId } = await helper.waitForBlockByContent(TEMPLATE_HEADER_CONTENT);
    await helper.clickBlockInIframe(headerBlockId);
    await helper.waitForSidebarOpen();
    await helper.escapeToParent();

    // The lock toggle on the template bar is present but DISABLED (permission-gated),
    // with a tooltip. (It shows a lock icon; the "Edit template" label lives in the ⋯
    // dropdown, which is omitted entirely when the user lacks permission.)
    const editButton = page.locator('.edit-template-toggle');
    await expect(editButton).toBeVisible({ timeout: 10000 });
    await expect(editButton).toBeDisabled();
    // Tooltip + aria confirm can_edit=false reached the button (threading + key match).
    await expect(editButton).toHaveAttribute('title', /permission|Modify portal content/i);
    await expect(editButton).toHaveAttribute('aria-label', /unlock/i);
  });

  test('creating a template in a folder without Add permission is blocked at save', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    // Force the templates folder (the default save location) to report no Add permission,
    // so the save-time can_add check blocks the create. Fulfilling here works regardless of
    // whether the folder exists in the fixtures.
    await page.route(
      (u) => u.pathname.endsWith('/templates'),
      async (route) => {
        if (route.request().method() !== 'GET') return route.continue();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ '@id': 'templates', '@type': 'Folder', can_add: false }),
        });
      },
    );

    await helper.login();
    await helper.navigateToEdit('/test-page');

    // A new template create is a POST with @type Document — must NOT happen when denied.
    const templatePosts: Array<any> = [];
    page.on('request', (req) => {
      if (req.method() !== 'POST') return;
      let body: any = null;
      try {
        body = req.postDataJSON();
      } catch {
        /* not JSON */
      }
      if (body?.['@type'] === 'Document') templatePosts.push(body);
    });

    // Make a template on a regular block, then attempt to save.
    await helper.clickBlockInIframe('block-1-uuid');
    await helper.waitForBlockSelectedInAdmin('block-1-uuid');
    await helper.openQuantaToolbarMenu('block-1-uuid');
    await page
      .locator('.volto-hydra-dropdown-menu .volto-hydra-dropdown-item')
      .filter({ hasText: /make.*template/i })
      .click();
    await helper.waitForSidebarOpen();

    // The save's can_add check GETs the folder; can_add=false blocks the create.
    const folderCheck = page.waitForRequest(
      (r) => r.method() === 'GET' && new URL(r.url()).pathname.endsWith('/templates'),
      { timeout: 15000 },
    );
    await page.locator('#toolbar-save, button:has-text("Save")').first().click();
    await folderCheck;

    // Create is blocked: the page stays in edit mode (a successful save redirects away),
    // and no template document was POSTed.
    await expect(page).toHaveURL(/\/edit$/, { timeout: 5000 });
    expect(
      templatePosts.length,
      'template POST must be blocked when the target folder denies Add',
    ).toBe(0);
  });
});

test.describe('Template Edit Mode - Lock affordance + metadata gating', () => {
  // Sub-issue #1: the lock icon on a template block's Quanta toolbar is the
  // discoverable way into template edit mode — clicking it enters edit mode for
  // that block's template (no need to hunt for the sidebar toggle).
  test('clicking the lock icon on a template block enters template edit mode', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    // A fixed template block is position-locked in normal mode, so its toolbar
    // shows the lock icon.
    const { blockId: headerBlockId } = await helper.waitForBlockByContent(TEMPLATE_HEADER_CONTENT);
    await helper.clickBlockInIframe(headerBlockId);
    await helper.waitForBlockSelectedInAdmin(headerBlockId);

    const lockIcon = page.locator('.quanta-toolbar .lock-icon');
    await expect(lockIcon).toBeVisible({ timeout: 5000 });

    // Clicking the lock offers to unlock the template (v2: warns first); confirming
    // enters edit mode → the fixed block becomes editable.
    await lockIcon.click();
    await page.locator('.template-unlock-modal .template-confirm').click();
    await helper.waitForBlockEditable(headerBlockId);
  });

  // Sub-issue #2: you must be editing the template to change its name / save
  // location. When NOT in edit mode the metadata fields render READ-ONLY (static
  // text, no inputs); entering edit mode swaps them for editable widgets.
  test('template name and save location are read-only unless editing the template', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    // Select the template instance (escape up from a fixed block).
    const { blockId: headerBlockId } = await helper.waitForBlockByContent(TEMPLATE_HEADER_CONTENT);
    await helper.clickBlockInIframe(headerBlockId);
    await helper.waitForSidebarOpen();
    await helper.escapeToParent();

    // Template Settings form is shown (name + save location). Scope by label —
    // there is also a page-level "Title" field with the same #field-title id.
    const nameField = page.locator('.field').filter({ hasText: 'Template Name' });
    const folderField = page.locator('.field').filter({ hasText: 'Save Location' });
    await expect(nameField).toBeVisible({ timeout: 5000 });

    // Locked → read-only: no editable input / browse control, value shown as text.
    await expect(nameField.locator('input')).toHaveCount(0);
    await expect(nameField.locator('.readonly-field-value')).toBeVisible();
    await expect(folderField.locator('button.action')).toHaveCount(0);

    // Enter template edit mode via the sidebar toggle (v2: warns first).
    await page.locator('.sidebar-section-header[data-is-current="true"] .edit-template-toggle').click();
    await page.locator('.template-unlock-modal .template-confirm').click();
    await helper.waitForBlockEditable(headerBlockId);

    // Editing → editable widgets appear and are enabled.
    await expect(nameField.locator('input')).toBeVisible({ timeout: 5000 });
    await expect(nameField.locator('input')).toBeEnabled();
    await expect(folderField.locator('button.action')).toBeVisible();
  });

  // A template's read-only (fixed/readonly) sub-blocks show their fields as read-only
  // text in the sidebar while the template is LOCKED — never editable inputs — and
  // become editable once the template is unlocked (edit mode).
  test('template sub-blocks show read-only sidebar fields when locked, editable while editing', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    const { blockId: headerBlockId } = await helper.waitForBlockByContent(TEMPLATE_HEADER_CONTENT);
    const { blockId: footerBlockId } = await helper.waitForBlockByContent(TEMPLATE_FOOTER_CONTENT);
    const props = page.locator('#sidebar-properties');

    // LOCKED (template not being edited): each read-only sub-block's settings render
    // through ReadOnlyForm — static values, no editable controls — and crucially show
    // the block's VALUES (not an empty panel, the original bug for view-less blocks).
    for (const [id, content] of [
      [headerBlockId, TEMPLATE_HEADER_CONTENT],
      [footerBlockId, TEMPLATE_FOOTER_CONTENT],
    ] as const) {
      await helper.clickBlockInIframe(id);
      await helper.waitForBlockSelectedInAdmin(id);
      await helper.waitForSidebarOpen();
      await expect(props.locator('.readonly-form')).toBeVisible({ timeout: 5000 });
      await expect(props.locator('input, textarea, [contenteditable="true"]')).toHaveCount(0);
      // The block's own content is shown as a read-only value.
      await expect(props.locator('.readonly-field-value').filter({ hasText: content })).toBeVisible();
    }

    // UNLOCK the template (enter edit mode): the same sub-block is now editable in the
    // sidebar — an Edit form, not ReadOnlyForm.
    await helper.unlockTemplate(headerBlockId);
    await helper.clickBlockInIframe(headerBlockId);
    await helper.waitForBlockSelectedInAdmin(headerBlockId);
    await expect(props.locator('.readonly-form')).toHaveCount(0);
  });

  // The template instance's sidebar bar carries a 🔒/🔓 lock toggle (the
  // .edit-template-toggle) AND an "Edit template" item in its ⋯ dropdown — both
  // replace the old standalone Edit/Done button.
  test('the template bar dropdown has an Edit template item that toggles edit mode', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    // Select the template instance.
    const { blockId: headerBlockId } = await helper.waitForBlockByContent(TEMPLATE_HEADER_CONTENT);
    await helper.clickBlockInIframe(headerBlockId);
    await helper.waitForSidebarOpen();
    await helper.escapeToParent();

    // The lock toggle on the bar is locked (not editing).
    const lockToggle = page.locator('.edit-template-toggle');
    await expect(lockToggle).toBeVisible({ timeout: 5000 });
    await expect(lockToggle).toHaveAttribute('aria-pressed', 'false');
    await expect(lockToggle).toHaveAttribute('aria-label', /unlock/i);

    // Open the ⋯ dropdown on the current (instance) section header and click "Edit template".
    await page.locator('.sidebar-section-header[data-is-current="true"] .menu-trigger').click();
    const editItem = page.locator('.volto-hydra-dropdown-item.edit-template-item');
    await expect(editItem).toBeVisible({ timeout: 5000 });
    await expect(editItem).toContainText('Edit template');
    await editItem.click();

    // v2: the dropdown item also routes through the unlock warning; confirm it.
    await page.locator('.template-unlock-modal .template-confirm').click();

    // Edit mode is now active: the fixed block becomes editable; the bar toggle flips.
    await helper.waitForBlockEditable(headerBlockId);
    await expect(lockToggle).toHaveAttribute('aria-pressed', 'true');
    await expect(lockToggle).toHaveAttribute('aria-label', /lock template/i);

    // The dropdown item now reads "Save template".
    await page.locator('.sidebar-section-header[data-is-current="true"] .menu-trigger').click();
    await expect(editItem).toContainText('Save template');
  });
});

// ---------------------------------------------------------------------------
// Template Edit Mode v2 — see docs/what-editors-will-experience/
//   templates-and-layouts.md "Editing content inside a template".
// Contract change:
//  - Unlocking a template does NOT lock the rest of the page. The page stays
//    editable and MULTIPLE templates can be unlocked at once.
//  - Unlocking warns first (edits appear on every page using the template — on lock).
//  - Locking commits: "Change on all pages" (save template doc) / "Reset changes"
//    (revert only the template's own blocks, keep page edits) / "Cancel".
//  - Templates save on LOCK, not on page save; saving the page while a template is
//    unlocked is blocked with a "lock your templates first" prompt.
// ---------------------------------------------------------------------------
test.describe('Template Edit Mode v2 - multi-unlock, no page lock, lock-to-commit', () => {
  // Two-instance fixture: instance 1 = test-layout, instance 2 = header-footer-layout.
  const I1_HEADER = 'Template Header - From Template'; // fixed block, instance 1 (test-layout)
  const I2_HEADER = 'Layout Header';                   // fixed block, instance 2 (header-footer-layout)
  const I1_FOOTER = 'Template Footer - From Template';
  const PAGE_TOP = 'page-block-top';
  const PAGE_MID = 'page-block-mid';
  const PAGE_BOTTOM = 'page-block-bottom';
  const I1_CONTENT = 'i1-content'; // editable member of instance 1 (keeps its id)
  const I2_CONTENT = 'i2-content'; // editable member of instance 2 (keeps its id)

  // Reproduces the deployed-mobile bugs: (1) the lock toggle must be present on
  // the template bar, and (2) the unlock/lock modals must render ABOVE the mobile
  // settings popup (sidebar), not behind it — so their buttons are clickable.
  test('on mobile a template modal replaces the settings sidebar (one popup at a time)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    const { blockId: headerBlockId } = await helper.waitForBlockByContent(TEMPLATE_HEADER_CONTENT);
    // Select the template instance, then make sure the settings sidebar is OPEN
    // (on mobile it may be a collapsed off-screen popup — the lock toggle lives
    // inside it). Open it via the cog only when actually collapsed.
    await helper.clickBlockInIframe(headerBlockId);
    await helper.waitForSidebarOpen();
    await helper.escapeToParent();
    const sidebar = page.locator('.sidebar-container:not(.collapsed)');
    if ((await sidebar.count()) === 0) {
      await page.locator('[aria-label="Open settings"]').click();
    }
    await expect(sidebar).toBeVisible({ timeout: 5000 });

    // (1) The lock toggle is present + clickable on the template bar.
    const toggle = page.locator('.sidebar-section-header[data-is-current="true"] .edit-template-toggle');
    await expect(toggle).toBeVisible({ timeout: 5000 });
    await toggle.click();

    // (2) The template modal opens as the single popup that REPLACES the settings
    // sidebar (the whole point of the mobile fix): its confirm button is clickable
    // (hit-tested — a covered button would fail) AND the settings sidebar has stepped
    // aside while the modal is up. The lock decision modal uses the same overlay +
    // bottom-sheet mechanism, so verifying the unlock modal here covers both.
    const modal = page.locator('.template-unlock-modal');
    await expect(modal).toBeVisible({ timeout: 5000 });
    await expect(sidebar).toBeHidden();
    await modal.locator('.template-confirm').click({ timeout: 5000 });
    await expect(modal).toHaveCount(0);
    await helper.waitForBlockEditable(headerBlockId);
    // The sidebar comes back once the modal closes.
    await expect(sidebar).toBeVisible({ timeout: 5000 });
  });

  test('a template unlocks AND saves from the toolbar lock toggle — consistent spot, no sidebar', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    // Capture the template document write (proves the save happened).
    const templateWrites: string[] = [];
    page.on('request', (req) => {
      if (req.method() !== 'PATCH' && req.method() !== 'POST') return;
      if (!req.url().startsWith(URLS.mockApi)) return;
      let body: any = null;
      try { body = req.postDataJSON(); } catch { /* not JSON */ }
      if (!body?.blocks_layout) return;
      if (req.url().replace(/\/$/, '').endsWith('/template-test-page')) return;
      templateWrites.push(req.url());
    });

    const { blockId: headerBlockId } = await helper.waitForBlockByContent(TEMPLATE_HEADER_CONTENT);
    await helper.clickBlockInIframe(headerBlockId);
    await helper.waitForBlockSelectedInAdmin(headerBlockId);

    const toolbar = page.locator('.quanta-toolbar');
    const toggle = toolbar.locator('.template-lock-toggle');

    // Locked → the toggle shows the lock; clicking it UNLOCKS (via the warning modal).
    await expect(toggle).toBeVisible({ timeout: 5000 });
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await page.locator('.template-unlock-modal .template-confirm').click();
    await helper.waitForBlockEditable(headerBlockId);

    // Make a change (delete the footer) so locking prompts to save.
    const { blockId: footerBlockId } = await helper.waitForBlockByContent(TEMPLATE_FOOTER_CONTENT);
    await helper.clickBlockInIframe(footerBlockId);
    await helper.waitForBlockSelectedInAdmin(footerBlockId);
    await page.evaluate((id) => {
      document.dispatchEvent(new CustomEvent('hydra-delete-blocks', { detail: { blockIds: [id] } }));
    }, footerBlockId);

    // Editing → the toggle is in the SAME spot but now LOCKS; clicking → decision
    // modal → "Change on all pages" saves the template. The sidebar is never opened.
    await helper.clickBlockInIframe(headerBlockId);
    await helper.waitForBlockSelectedInAdmin(headerBlockId);
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await toggle.click();
    await page.locator('.template-lock-modal .template-commit').click();

    await expect
      .poll(() => templateWrites.length, { timeout: 5000 })
      .toBeGreaterThanOrEqual(1);
  });

  test('unlocking a template warns before entering edit mode; cancel is a no-op', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    // Select the instance and click the lock toggle.
    const { blockId: headerBlockId } = await helper.waitForBlockByContent(TEMPLATE_HEADER_CONTENT);
    await helper.clickBlockInIframe(headerBlockId);
    await helper.waitForSidebarOpen();
    await helper.escapeToParent();
    const toggle = page.locator('.sidebar-section-header[data-is-current="true"] .edit-template-toggle');
    await toggle.click();

    // A warning modal appears — it must mention that the change hits every page.
    const modal = page.locator('.template-unlock-modal');
    await expect(modal).toBeVisible({ timeout: 5000 });
    await expect(modal).toContainText(/every page|other pages|all pages/i);

    // Cancel: no edit mode — the fixed block stays read-only, toggle stays locked.
    await modal.locator('.template-cancel').click();
    await expect(modal).toHaveCount(0);
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await helper.waitForBlockReadonly(headerBlockId);

    // Confirm: now edit mode — the fixed block becomes editable.
    await toggle.click();
    await modal.locator('.template-confirm').click();
    await expect(modal).toHaveCount(0);
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await helper.waitForBlockEditable(headerBlockId);
  });

  test('unlocking a template leaves the rest of the page editable (no page lock)', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    const iframe = helper.getIframe();
    const { blockId: headerBlockId } = await helper.waitForBlockByContent(TEMPLATE_HEADER_CONTENT);

    await helper.unlockTemplate(headerBlockId);
    // The template's fixed block is now editable...
    await helper.waitForBlockEditable(headerBlockId);

    // ...and blocks OUTSIDE the template stay editable (this is the v2 change —
    // they used to lock/grey out).
    await helper.waitForBlockEditable(STANDALONE_BLOCK_1);
    await helper.clickBlockInIframe(STANDALONE_BLOCK_1);
    const standaloneEditor = helper.getSlateField(iframe.locator(`[data-block-uid="${STANDALONE_BLOCK_1}"]`));
    expect(await standaloneEditor.getAttribute('contenteditable')).toBe('true');
  });

  test('a locked template block is marked read-only but NOT visually dimmed', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    const iframe = helper.getIframe();
    const { blockId: headerBlockId } = await helper.waitForBlockByContent(TEMPLATE_HEADER_CONTENT);
    const block = iframe.locator(`[data-block-uid="${headerBlockId}"]`);

    // The fixed template block is read-only (the live marker is present)...
    await helper.waitForBlockReadonly(headerBlockId);
    // ...but it is NOT greyed/dimmed — the lock icon in the toolbar is the cue.
    await expect(block).not.toHaveCSS('filter', /grayscale/);
    await expect(block).not.toHaveCSS('opacity', /0\.[0-9]/);
  });

  test('two templates on one page can be unlocked and edited at the same time', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/two-template-page');

    const { blockId: i1Header } = await helper.waitForBlockByContent(I1_HEADER);
    const { blockId: i2Header } = await helper.waitForBlockByContent(I2_HEADER);

    // Both templates start locked (fixed blocks read-only), page blocks editable.
    await helper.waitForBlockReadonly(i1Header);
    await helper.waitForBlockReadonly(i2Header);
    await helper.waitForBlockEditable(PAGE_TOP);

    // Unlock instance 1 via its fixed chrome (the toolbar lock toggle lives on the
    // template's fixed blocks) → only its fixed block becomes editable; instance 2 stays locked.
    await helper.unlockTemplate(i1Header);
    await helper.waitForBlockEditable(i1Header);
    await helper.waitForBlockReadonly(i2Header);
    await helper.waitForBlockEditable(PAGE_MID); // page still editable

    // Unlock instance 2 as well (via its fixed chrome) → BOTH are now editable simultaneously.
    await helper.unlockTemplate(i2Header);
    await helper.waitForBlockEditable(i2Header);
    await helper.waitForBlockEditable(i1Header); // instance 1 stayed unlocked
  });

  test('locking a template opens a decision modal (Change on all pages / Reset / Cancel)', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    const { blockId: headerBlockId } = await helper.waitForBlockByContent(TEMPLATE_HEADER_CONTENT);
    const { blockId: footerBlockId } = await helper.waitForBlockByContent(TEMPLATE_FOOTER_CONTENT);
    await helper.unlockTemplate(headerBlockId);

    // Make a change so locking prompts (an unchanged template locks silently).
    await helper.clickBlockInIframe(footerBlockId);
    await helper.waitForBlockSelectedInAdmin(footerBlockId);
    await page.evaluate((id) => {
      document.dispatchEvent(new CustomEvent('hydra-delete-blocks', { detail: { blockIds: [id] } }));
    }, footerBlockId);

    // Click the (now unlocked) toggle → decision modal with the three choices.
    await helper.clickBlockInIframe(headerBlockId);
    await helper.waitForSidebarOpen();
    await helper.escapeToParent();
    const toggle = page.locator('.sidebar-section-header[data-is-current="true"] .edit-template-toggle');
    await toggle.click();
    const modal = page.locator('.template-lock-modal');
    await expect(modal).toBeVisible({ timeout: 5000 });
    await expect(modal.locator('.template-commit')).toContainText(/all pages/i);
    await expect(modal.locator('.template-reset')).toContainText(/reset/i);
    await expect(modal.locator('.template-cancel')).toBeVisible();

    // Cancel keeps it unlocked (still editable).
    await modal.locator('.template-cancel').click();
    await expect(modal).toHaveCount(0);
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await helper.waitForBlockEditable(headerBlockId);
  });

  test('locking an unchanged template does not prompt — no modal, no save', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    // No template write should happen for an unchanged lock.
    const templateWrites: string[] = [];
    page.on('request', (req) => {
      if (req.method() !== 'PATCH' && req.method() !== 'POST') return;
      if (!req.url().startsWith(URLS.mockApi)) return;
      let body: any = null;
      try { body = req.postDataJSON(); } catch { /* not JSON */ }
      if (!body?.blocks_layout) return;
      if (req.url().replace(/\/$/, '').endsWith('/template-test-page')) return;
      templateWrites.push(req.url());
    });

    const { blockId: headerBlockId } = await helper.waitForBlockByContent(TEMPLATE_HEADER_CONTENT);
    await helper.unlockTemplate(headerBlockId);
    await helper.waitForBlockEditable(headerBlockId);

    // Lock again WITHOUT editing → no decision modal (v2: don't prompt when the
    // template hasn't changed), it just re-locks, and nothing is written. Drive the
    // quanta toolbar toggle (the same surface unlock used), not the sidebar toggle.
    await helper.clickBlockInIframe(headerBlockId);
    const toggle = page.locator('.quanta-toolbar .template-lock-toggle');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await toggle.click();
    await expect(page.locator('.template-lock-modal')).toHaveCount(0);
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await helper.waitForBlockReadonly(headerBlockId);
    expect(templateWrites).toHaveLength(0);
  });

  test('Reset changes reverts the template blocks but keeps page-content edits', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/two-template-page');

    const iframe = helper.getIframe();
    const { blockId: i1Header } = await helper.waitForBlockByContent(I1_HEADER);
    const { blockId: i1Footer } = await helper.waitForBlockByContent(I1_FOOTER);
    const footerLoc = iframe.locator(`[data-block-uid]`).filter({ hasText: I1_FOOTER });

    // Unlock via the fixed chrome header (where the toolbar lock toggle lives — the
    // header renders as template chrome on every frontend, incl. the Nuxt example).
    await helper.unlockTemplate(i1Header);

    // Structural template edit: delete a fixed template block of instance 1.
    await helper.clickBlockInIframe(i1Footer);
    await helper.waitForBlockSelectedInAdmin(i1Footer);
    await page.evaluate((id) => {
      document.dispatchEvent(new CustomEvent('hydra-delete-blocks', { detail: { blockIds: [id] } }));
    }, i1Footer);
    await expect(footerLoc).toHaveCount(0, { timeout: 5000 });

    // Page-content edit (outside the template): delete a page block.
    await helper.clickBlockInIframe(PAGE_BOTTOM);
    await helper.waitForBlockSelectedInAdmin(PAGE_BOTTOM);
    await page.evaluate((id) => {
      document.dispatchEvent(new CustomEvent('hydra-delete-blocks', { detail: { blockIds: [id] } }));
    }, PAGE_BOTTOM);
    await expect(iframe.locator(`[data-block-uid="${PAGE_BOTTOM}"]`)).toHaveCount(0, { timeout: 5000 });

    // Lock → Reset changes.
    // Lock via the fixed chrome header too — once the template re-locks, the toggle
    // lives on fixed chrome, not on the editable member (matters on slower frontends).
    await helper.lockTemplate(i1Header, 'reset');

    // The template block comes back (template reverted to saved version)...
    await expect(iframe.locator(`[data-block-uid]`).filter({ hasText: I1_FOOTER })).toBeVisible({ timeout: 5000 });
    // ...but the page edit stays (page block is still gone).
    await expect(iframe.locator(`[data-block-uid="${PAGE_BOTTOM}"]`)).toHaveCount(0);
  });

  test('Change on all pages saves the template document at LOCK time', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/two-template-page');

    // Capture every template-document write (a PATCH/POST whose URL is NOT the page).
    const templateWrites: string[] = [];
    page.on('request', (req) => {
      const m = req.method();
      if (m !== 'PATCH' && m !== 'POST') return;
      if (!req.url().startsWith(URLS.mockApi)) return;
      let body: any = null;
      try { body = req.postDataJSON(); } catch { /* not JSON */ }
      if (!body || !body.blocks_layout) return;
      if (req.url().replace(/\/$/, '').endsWith('/two-template-page')) return; // page write
      templateWrites.push(`${m} ${req.url()}`);
    });

    const { blockId: i1Header } = await helper.waitForBlockByContent(I1_HEADER);
    const { blockId: i1Footer } = await helper.waitForBlockByContent(I1_FOOTER);
    await helper.unlockTemplate(i1Header);

    // Make a template edit.
    await helper.clickBlockInIframe(i1Footer);
    await helper.waitForBlockSelectedInAdmin(i1Footer);
    await page.evaluate((id) => {
      document.dispatchEvent(new CustomEvent('hydra-delete-blocks', { detail: { blockIds: [id] } }));
    }, i1Footer);

    // Locking with "Change on all pages" writes the template document now —
    // before (and independently of) any page save. Lock via the fixed chrome header.
    await helper.lockTemplate(i1Header, 'commit');
    await expect.poll(() => templateWrites.length, { timeout: 5000 }).toBeGreaterThanOrEqual(1);
  });

  test('saving the page while a template is unlocked is blocked with a lock-first prompt', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    // Watch for a page PATCH — it must NOT happen while a template is unlocked.
    let pagePatched = false;
    page.on('request', (req) => {
      if (req.method() !== 'PATCH') return;
      if (req.url().replace(/\/$/, '').endsWith('/template-test-page')) pagePatched = true;
    });

    const { blockId: headerBlockId } = await helper.waitForBlockByContent(TEMPLATE_HEADER_CONTENT);
    await helper.unlockTemplate(headerBlockId);

    // Try to save the page.
    await helper.saveContent().catch(() => { /* save is expected to be gated */ });

    // A gate modal tells the user to lock their template(s) first, and the page
    // is NOT saved.
    const gate = page.locator('.template-save-gate-modal');
    await expect(gate).toBeVisible({ timeout: 5000 });
    await expect(gate).toContainText(/lock/i);
    expect(pagePatched).toBe(false);
  });
});
