/**
 * Link creation and editing tests for inline editing in Volto Hydra admin UI.
 *
 * TODO - additional tests and bugs:
 * - Bug - I can clear a link in the sidebar (causes path exception currently)
 * - paste a link
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

/** The slate link elements in saved block data (not a listing's fieldMapping `type: 'link'`). */
function savedLinks(node: unknown): any[] {
  if (Array.isArray(node)) return node.flatMap(savedLinks);
  if (!node || typeof node !== 'object') return [];
  const n = node as Record<string, unknown>;
  const isSlateLink = n.type === 'link' && Array.isArray(n.children);
  return [...(isSlateLink ? [n] : []), ...Object.values(n).flatMap(savedLinks)];
}

test.describe('Inline Editing - Links', () => {
  test('can create a link', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';

    // Edit the text (this also clicks the block, waits for toolbar, and selects all before typing)
    await helper.editBlockTextInIframe(blockId, 'Click here');

    // Select all the text for link button test
    const editor = await helper.getEditorLocator(blockId);
    await helper.selectAllTextInEditor(editor);

    // Click the link button - should show LinkEditor popup
    await helper.clickFormatButton('link');

    // Wait for LinkEditor popup to appear and verify its position
    const { popup, boundingBox } = await helper.waitForLinkEditorPopup();

    // Verify the LinkEditor is positioned directly on top of the toolbar, covering it
    // This ensures it's always visible even when toolbar is clamped to top of iframe
    const toolbar = page.locator('.quanta-toolbar');
    const toolbarBox = await toolbar.boundingBox();
    expect(toolbarBox).not.toBeNull();

    // LinkEditor should cover the toolbar - same position (within small tolerance for borders/padding)
    const tolerance = 10;
    expect(Math.abs(boundingBox.x - toolbarBox!.x)).toBeLessThan(tolerance);
    expect(Math.abs(boundingBox.y - toolbarBox!.y)).toBeLessThan(tolerance);

    // Get the URL input field
    const linkUrlInput = await helper.getLinkEditorUrlInput();

    // Enter a URL (must be a valid, real URL)
    await linkUrlInput.fill('https://plone.org');

    // Press Enter to submit
    await linkUrlInput.press('Enter');

    // Wait for link to be created in the iframe by checking the HTML contains the link
    await expect(async () => {
      const blockHtml = await editor.innerHTML();
      expect(blockHtml).toContain('<a ');
      expect(blockHtml).toContain('https://plone.org');
      expect(blockHtml).toContain('Click here');
    }).toPass({ timeout: 5000 });

    // Verify the LinkEditor popup has disappeared (check for .add-link specifically, not the Quanta toolbar)
    const linkEditorPopup = page.locator('.add-link');
    await expect(linkEditorPopup).not.toBeVisible();

    // Click on another block
    await helper.clickBlockInIframe('block-2-uuid');
    await page.waitForTimeout(500);

    // Click back to the original block with the link
    await helper.clickBlockInIframe(blockId);
    await page.waitForTimeout(500);

    // Verify the link is still there
    const blockHtml = await editor.innerHTML();
    expect(blockHtml).toContain('<a ');
    expect(blockHtml).toContain('https://plone.org');
  });

  test('can clear a link', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';

    // Edit the text and create a link
    await helper.editBlockTextInIframe(blockId, 'Click here');
    const editor = await helper.getEditorLocator(blockId);
    await helper.selectAllTextInEditor(editor);

    // Create the link
    await helper.clickFormatButton('link');
    await helper.waitForLinkEditorPopup();
    const linkUrlInput = await helper.getLinkEditorUrlInput();
    await linkUrlInput.fill('https://plone.org');
    await linkUrlInput.press('Enter');

    // Wait for link to be created
    await expect(async () => {
      const blockHtml = await editor.innerHTML();
      expect(blockHtml).toContain('<a ');
      expect(blockHtml).toContain('https://plone.org');
    }).toPass({ timeout: 5000 });

    // Click inside the link to position cursor there
    const linkElement = editor.locator('a');
    await linkElement.click();

    // Wait for editor to be editable and have a selection
    await expect(editor).toHaveAttribute('contenteditable', 'true');
    await expect(async () => {
      const hasSelection = await editor.evaluate(() => {
        const selection = window.getSelection();
        return selection && selection.rangeCount > 0;
      });
      expect(hasSelection).toBe(true);
    }).toPass({ timeout: 5000 });

    // Click the link button to open LinkEditor (cursor should be inside the link)
    await helper.clickFormatButton('link');
    await helper.waitForLinkEditorPopup();

    // Click the Clear (X) button - this removes the link and closes the popup
    const clearButton = await helper.getLinkEditorClearButton();
    await clearButton.click();

    // Wait for the LinkEditor popup to close (Clear removes link and closes popup)
    await helper.waitForLinkEditorToClose();

    // Check there is no link in the HTML (text should remain but without <a> tag)
    await expect(async () => {
      const blockHtml = await editor.innerHTML();
      expect(blockHtml).not.toContain('<a ');
      expect(blockHtml).not.toContain('href=');
      expect(blockHtml).toContain('Click here'); // Text should still be there
    }).toPass({ timeout: 5000 });
  });

  test('can use browse button in link editor', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';

    // Edit the text
    await helper.editBlockTextInIframe(blockId, 'Click here');
    const editor = await helper.getEditorLocator(blockId);
    await helper.selectAllTextInEditor(editor);

    // Click the link button to open LinkEditor
    await helper.clickFormatButton('link');
    await helper.waitForLinkEditorPopup();

    // Get the URL input - it might have some content
    const linkUrlInput = await helper.getLinkEditorUrlInput();

    // Wait for the input to actually be focused (componentDidMount completed successfully)
    await expect(linkUrlInput).toBeFocused({ timeout: 2000 });

    // Check if input has content, and clear it if needed to show the browse button
    const inputValue = await linkUrlInput.inputValue();
    if (inputValue && inputValue.length > 0) {
      await linkUrlInput.clear();
      // Wait for input to be focused again after clearing
      await expect(linkUrlInput).toBeFocused({ timeout: 1000 });
    }

    // Now the Browse button should be visible (only shows when input is empty)
    const browseButton = await helper.getLinkEditorBrowseButton();
    await browseButton.click();

    // Wait for object browser to be ready. The OB opens at /_test_data/test-page
    // (no children), so the helper navigates to the parent folder /_test_data
    // where Another Page is visible as a sibling.
    const objectBrowser = await helper.waitForObjectBrowser();

    // Select "Another Page" from the list (OB auto-submits the link)
    await helper.objectBrowserSelectItem(objectBrowser, /Another Page/);

    // Click Submit if the LinkEditor is still open
    const submitButton = page.getByRole('button', { name: 'Submit' });
    if (await submitButton.isVisible({ timeout: 1000 }).catch(() => false)) {
      await submitButton.click();
    }

    // Wait for the link to be created in the editor
    await page.waitForTimeout(500);

    // Verify the link was created in the editor
    await expect(async () => {
      const blockHtml = await editor.innerHTML();
      expect(blockHtml).toContain('<a ');
      expect(blockHtml).toContain('/another-page');
      expect(blockHtml).toContain('Click here');
    }).toPass({ timeout: 5000 });
  });

  test('can edit link URL', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';

    // Create text and initial link
    await helper.editBlockTextInIframe(blockId, 'Click here');
    const editor = await helper.getEditorLocator(blockId);
    await helper.selectAllTextInEditor(editor);

    // Click link button and create link
    await helper.clickFormatButton('link');
    const linkUrlInput = await helper.getLinkEditorUrlInput();
    await linkUrlInput.fill('https://example.com');
    await linkUrlInput.press('Enter');

    // Wait for popup to close and editor to be focused again
    await expect(editor).toBeFocused({ timeout: 2000 });

    // Verify link was created
    const link = editor.locator('a');
    await expect(link).toBeVisible();
    expect(await link.getAttribute('href')).toBe('https://example.com');

    // Click inside the link to edit it
    await link.click();
    // Wait for selection to be within the link
    await expect(editor).toBeFocused({ timeout: 2000 });

    // Click link button again to open editor
    await helper.clickFormatButton('link');
    const { popup: editPopup } = await helper.waitForLinkEditorPopup();
    const editUrlInput = await helper.getLinkEditorUrlInput();

    // Verify current URL is shown
    expect(await editUrlInput.inputValue()).toContain('example.com');

    // Change URL (fill will replace the existing value)
    await editUrlInput.fill('https://newurl.com');

    // Verify Submit button is enabled and click it
    const submitButton = page.getByRole('button', { name: 'Submit' });
    await expect(submitButton).toBeEnabled();
    await submitButton.click();

    // Wait for popup to close
    await helper.waitForLinkEditorToClose();

    // Verify link was updated (poll to allow time for sync)
    await expect(async () => {
      expect(await link.getAttribute('href')).toBe('https://newurl.com');
      expect(await link.textContent()).toBe('Click here');
    }).toPass({ timeout: 5000 });
  });

  // Object browser search looks across the WHOLE site, not just the folder
  // being browsed: an author linking to another page rarely knows which folder
  // it lives in, and a page three levels away in another branch would
  // otherwise be unfindable.
  test('searching from the browse button finds a page in a different folder', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';
    await helper.editBlockTextInIframe(blockId, 'Find me a page');
    const editor = await helper.getEditorLocator(blockId);
    await helper.selectAllTextInEditor(editor);
    await helper.clickFormatButton('link');
    const linkUrlInput = await helper.getLinkEditorUrlInput();
    await expect(linkUrlInput).toBeFocused({ timeout: 2000 });
    if ((await linkUrlInput.inputValue()).length > 0) await linkUrlInput.clear();
    await (await helper.getLinkEditorBrowseButton()).click();

    const objectBrowser = await helper.waitForObjectBrowser();
    // The target is not in the folder the browser opens on (the page itself and
    // its siblings): it is in another branch, three levels down.
    const target = '/_test_data/context-navigation-forced-folder/page-b/under-b';
    await expect(page.locator('.object-listing li').first()).toBeVisible();
    await expect(page.locator('.object-listing li').filter({ hasText: 'Under B' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Search SVG' }).click();
    const searchInput = page.getByPlaceholder('Search content');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('Under');

    const hit = page.locator('.object-listing li').filter({ hasText: 'Under B' });
    await expect(hit).toHaveCount(1, { timeout: 10000 });

    // Choosing it links to that page.
    await helper.objectBrowserSelectItem(objectBrowser, /Under B/);
    const submitButton = page.getByRole('button', { name: 'Submit' });
    if (await submitButton.isVisible()) await submitButton.click();
    await expect(editor.locator('a')).toHaveAttribute('href', new RegExp(`${target}$`));
  });

  // The object browser's header buttons sit under the text toolbar in the React
  // tree; they must reach their own handlers (the toolbar used to swallow them).
  async function openBrowseFromLinkEditor(page, helper: AdminUIHelper) {
    await helper.login();
    await helper.navigateToEdit('/test-page');
    await helper.editBlockTextInIframe('block-1-uuid', 'Browse from here');
    const editor = await helper.getEditorLocator('block-1-uuid');
    await helper.selectAllTextInEditor(editor);
    await helper.clickFormatButton('link');
    const linkUrlInput = await helper.getLinkEditorUrlInput();
    await expect(linkUrlInput).toBeFocused({ timeout: 2000 });
    if ((await linkUrlInput.inputValue()).length > 0) await linkUrlInput.clear();
    await (await helper.getLinkEditorBrowseButton()).click();
    return helper.waitForObjectBrowser();
  }

  test("the browse button's Back goes up a folder", async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const objectBrowser = await openBrowseFromLinkEditor(page, helper);
    // It opens on the page being edited, inside /_test_data.
    const crumbs = objectBrowser.locator('.breadcrumbs');
    await expect(crumbs).toContainText('test-page');

    await page.getByRole('button', { name: 'Back' }).click();

    await expect(crumbs).not.toContainText('test-page');
    await expect(crumbs).toContainText('_test_data');
    await expect(
      page.locator('.object-listing li').filter({ hasText: 'Another Page' }).first(),
    ).toBeVisible();
  });

  test("the browse button's close button closes the browser", async ({ page }) => {
    const helper = new AdminUIHelper(page);
    const objectBrowser = await openBrowseFromLinkEditor(page, helper);
    await expect(objectBrowser).toBeVisible();

    await objectBrowser.locator('header button.clearSVG').click();

    await expect(page.locator('.object-browser')).toHaveCount(0);
  });

  test('LinkEditor closes when focusing back on editor', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';

    // Create text and select it
    await helper.editBlockTextInIframe(blockId, 'Click here');
    const editor = await helper.getEditorLocator(blockId);
    await helper.selectAllTextInEditor(editor);

    // Click link button to open LinkEditor
    await helper.clickFormatButton('link');
    await helper.waitForLinkEditorPopup();

    // Click back on the editor to close the LinkEditor
    // Uses clickInIframeWithBlur because Playwright doesn't trigger blur reliably
    await helper.clickInIframeWithBlur(editor);

    // LinkEditor should close
    await helper.waitForLinkEditorToClose();
  });

  test('cancelling LinkEditor does not block editor', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';

    // Create text and select it
    await helper.editBlockTextInIframe(blockId, 'Test text');
    const editor = await helper.getEditorLocator(blockId);
    await helper.selectAllTextInEditor(editor);

    // Click link button to open LinkEditor
    await helper.clickFormatButton('link');
    await helper.waitForLinkEditorPopup();

    // Press Escape to cancel the LinkEditor without making changes
    await page.keyboard.press('Escape');

    // Wait for LinkEditor to close
    await helper.waitForLinkEditorToClose();

    // Verify the editor is still contenteditable (not blocked)
    await expect(editor).toHaveAttribute('contenteditable', 'true', { timeout: 5000 });

    // Verify the text content is still there
    const textContent = await helper.getCleanTextContent(editor);
    expect(textContent).toBe('Test text');

    // Verify focus returns to editor automatically after cancelling LinkEditor
    // This is the key test - focus should be restored without user action
    // Wait for selection to be stable (not disrupted by re-renders) before typing
    await helper.waitForStableSelection(editor, { editorHasFocus: true, isCollapsed: false });

    // Type to verify editor accepts input - will replace selected text
    await editor.pressSequentially('replaced', { delay: 10 });

    // Verify typing worked (replaced selected text since all was selected)
    await expect(async () => {
      const newText = await helper.getCleanTextContent(editor);
      expect(newText).toBe('replaced');
    }).toPass({ timeout: 10000 });
  });

  test('clicking editor cancels LinkEditor and does not block editor', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';

    // Create text and select it
    await helper.editBlockTextInIframe(blockId, 'Test text');
    const iframe = helper.getIframe();
    const editor = await helper.getEditorLocator(blockId);
    await helper.selectAllTextInEditor(editor);

    // Click link button to open LinkEditor
    await helper.clickFormatButton('link');
    await helper.waitForLinkEditorPopup();

    // Click back on the block to cancel the LinkEditor
    // Note: We click on the block element, not [contenteditable="true"], because
    // the iframe may be blocked (contenteditable removed) while popup is open
    const block = iframe.locator(`[data-block-uid="${blockId}"]`);
    await block.click();

    // Wait for LinkEditor to close
    await helper.waitForLinkEditorToClose();

    // Verify the editor is still contenteditable (not blocked)
    await expect(editor).toHaveAttribute('contenteditable', 'true', { timeout: 5000 });

    // Verify the text content is still there
    const textContent = await helper.getCleanTextContent(editor);
    expect(textContent).toBe('Test text');
  });

  test('clicking editor after browse button cancels LinkEditor and does not block editor', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';

    // Create text and select it
    await helper.editBlockTextInIframe(blockId, 'Test text');
    const iframe = helper.getIframe();
    const editor = await helper.getEditorLocator(blockId);
    await helper.selectAllTextInEditor(editor);

    // Click link button to open LinkEditor
    await helper.clickFormatButton('link');
    await helper.waitForLinkEditorPopup();

    // Click the browse button - this opens the ObjectBrowser
    const browseButton = page.locator('.add-link button[title="Browse"], .add-link button:has(svg.icon)').first();
    await browseButton.click();

    // Wait for ObjectBrowser to open
    const objectBrowser = page.locator('aside[role="presentation"]').last();
    await objectBrowser.waitFor({ state: 'visible', timeout: 5000 });

    // Press Escape to close the ObjectBrowser (otherwise its overlay blocks iframe clicks)
    await page.keyboard.press('Escape');
    // Wait for ObjectBrowser animation to complete
    await expect(objectBrowser).not.toBeVisible({ timeout: 2000 });

    // Click back on the block to cancel the LinkEditor
    // Note: We click on the block element, not [contenteditable="true"], because
    // the iframe may be blocked (contenteditable removed) while popup is open
    const block = iframe.locator(`[data-block-uid="${blockId}"]`);
    await block.click();

    // Wait for LinkEditor to close
    await helper.waitForLinkEditorToClose();

    // Verify the editor is still contenteditable (not blocked)
    await expect(editor).toHaveAttribute('contenteditable', 'true', { timeout: 5000 });

    // Verify the text content is still there
    const textContent = await helper.getCleanTextContent(editor);
    expect(textContent).toBe('Test text');
  });

  test('link button shows active state when cursor is in link', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';

    // Create text with a link in the middle
    await helper.editBlockTextInIframe(blockId, 'Before link after');
    const editor = await helper.getEditorLocator(blockId);

    // Select "link" text (characters 7-11)
    await helper.selectTextRange(editor, 7, 11);

    // Create link
    await helper.clickFormatButton('link');
    const linkUrlInput = await helper.getLinkEditorUrlInput();
    await linkUrlInput.fill('https://example.com');
    await linkUrlInput.press('Enter');

    // Wait for popup to close
    await helper.waitForLinkEditorToClose();

    // Verify link was created: "Before <a>link</a> after"
    const link = editor.locator('a');
    await expect(link).toBeVisible();
    expect(await link.textContent()).toBe('link');

    // Click inside the link
    await helper.clickRelativeToFormat(editor, 'inside', 'a');

    // Verify link button is active
    await expect(async () => {
      expect(await helper.isActiveFormatButton('link')).toBe(true);
    }).toPass({ timeout: 5000 });

    // Click before the link
    await helper.clickRelativeToFormat(editor, 'before', 'a');

    // Verify link button is NOT active
    await expect(async () => {
      expect(await helper.isActiveFormatButton('link')).toBe(false);
    }).toPass({ timeout: 5000 });

    // Click after the link
    await helper.clickRelativeToFormat(editor, 'after', 'a');

    // Verify link button is still NOT active
    await expect(async () => {
      expect(await helper.isActiveFormatButton('link')).toBe(false);
    }).toPass({ timeout: 5000 });
  });

  test('prospective link: click link button without selection, then type', async ({ page }) => {
    const helper = new AdminUIHelper(page);

    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';

    // Type some text - cursor ends up at the end with no selection (collapsed)
    await helper.editBlockTextInIframe(blockId, 'Hello ');
    const editor = await helper.getEditorLocator(blockId);

    // Click the link button with no text selected (prospective link)
    await helper.clickFormatButton('link');

    // Enter URL and submit
    const linkUrlInput = await helper.getLinkEditorUrlInput();
    await linkUrlInput.fill('https://plone.org');
    await linkUrlInput.press('Enter');

    // Wait for LinkEditor to close
    await helper.waitForLinkEditorToClose();

    // Wait for editor to be focused again
    await helper.waitForEditorFocus(editor);

    // Type text - it should go inside the link
    await editor.pressSequentially('world', { delay: 10 });

    // Verify typed text is inside a link
    await expect(async () => {
      const blockHtml = await editor.innerHTML();
      expect(blockHtml).toContain('<a ');
      expect(blockHtml).toContain('https://plone.org');
      // The link should contain the typed text
      const linkText = await editor.locator('a').textContent();
      expect(linkText).toContain('world');
    }).toPass({ timeout: 5000 });
  });

  test('Enter at the end of a link starts a plain paragraph, and no empty link is saved', async ({ page }) => {
    // Pressing Enter with the caret at the end of a link must not carry the
    // link into the new paragraph. When it did, what was typed next extended a
    // copy of the link, and pages were saved with `<a href="…"></a>` beside the
    // real link — after which editing that text edited the wrong link.
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';
    await helper.editBlockTextInIframe(blockId, 'Click here');
    const editor = await helper.getEditorLocator(blockId);
    await helper.selectAllTextInEditor(editor);
    await helper.clickFormatButton('link');
    const linkUrlInput = await helper.getLinkEditorUrlInput();
    await linkUrlInput.fill('https://example.com');
    await linkUrlInput.press('Enter');
    await helper.waitForLinkEditorToClose();
    await helper.waitForEditorFocus(editor);
    await expect(editor.locator('a')).toHaveAttribute('href', 'https://example.com');

    // Caret to the end of the linked text, then split the paragraph.
    await editor.press('End');
    const before = await helper.getBlockOrder();
    await editor.press('Enter');

    let newBlockUid = '';
    await expect(async () => {
      const order = await helper.getBlockOrder();
      const next = order[order.indexOf(blockId) + 1];
      expect(next).toBeTruthy();
      expect(before).not.toContain(next);
      newBlockUid = next;
    }).toPass({ timeout: 10000 });

    const newEditor = await helper.getEditorLocator(newBlockUid);
    await helper.waitForEditorFocus(newEditor);
    await newEditor.pressSequentially('Next line', { delay: 10 });
    await helper.waitForEditorText(newEditor, /Next line/);

    // The new paragraph is plain text; the original link is untouched. (Block 1
    // is no longer the editable one, so find its link by the block, not the
    // contenteditable field.)
    await expect(newEditor.locator('a')).toHaveCount(0);
    const originalLink = helper.getIframe().locator(`[data-block-uid="${blockId}"] a`);
    await expect(originalLink).toHaveCount(1);
    await expect(originalLink).toHaveText('Click here');
    await expect(originalLink).toHaveAttribute('href', 'https://example.com');

    // What is saved agrees: the new block holds no link, and no link anywhere
    // on the page is empty.
    // The PATCH of THIS page — a frontend may save other documents (a site
    // footer template) in the same save.
    const patchRequest = page.waitForRequest(
      (req) => req.method() === 'PATCH' && new URL(req.url()).pathname.endsWith('/test-page'),
    );
    await helper.saveContent();
    const body = JSON.parse((await patchRequest).postData() || '{}');

    const linksIn = (node: unknown): any[] => {
      if (Array.isArray(node)) return node.flatMap(linksIn);
      if (!node || typeof node !== 'object') return [];
      const n = node as Record<string, unknown>;
      // A slate link element — not e.g. a listing's `fieldMapping` entry,
      // which also says `type: 'link'` but has no children.
      const isSlateLink = n.type === 'link' && Array.isArray(n.children);
      return [...(isSlateLink ? [n] : []), ...Object.values(n).flatMap(linksIn)];
    };
    const textOf = (node: any): string =>
      typeof node.text === 'string' ? node.text : (node.children ?? []).map(textOf).join('');

    // Blocks may be nested in containers (frontends differ), so find the new
    // one by its uid anywhere in what was saved, not at `blocks[uid]`.
    const blockByUid = (node: unknown, uid: string): unknown => {
      if (!node || typeof node !== 'object') return undefined;
      if (Array.isArray(node)) {
        for (const x of node) {
          const found = blockByUid(x, uid);
          if (found) return found;
        }
        return undefined;
      }
      const n = node as Record<string, unknown>;
      const blocks = n.blocks as Record<string, unknown> | undefined;
      if (blocks && typeof blocks === 'object' && uid in blocks) return blocks[uid];
      for (const v of Object.values(n)) {
        const found = blockByUid(v, uid);
        if (found) return found;
      }
      return undefined;
    };
    const savedNewBlock = blockByUid(body, newBlockUid);
    expect(savedNewBlock, 'the new block is saved').toBeTruthy();
    expect(linksIn(savedNewBlock), 'no link in the new paragraph').toEqual([]);
    const allLinks = linksIn(body.blocks);
    expect(allLinks.length, 'the original link is saved').toBeGreaterThan(0);
    for (const link of allLinks) {
      expect(textOf(link).replace(/[​﻿]/g, ''), 'a saved link has text').not.toBe('');
    }
  });

  test("a link picked from the browser keeps the item's details beside its url", async ({ page }) => {
    // A frontend draws a link from what it links to — a file's type and size
    // after a link to it — so the link keeps the picked item's catalog
    // metadata in data.item. data.url stays its only address (Plone turns it
    // into a resolveuid), and who made the item is left out.
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';
    await helper.editBlockTextInIframe(blockId, 'The annual report');
    const editor = await helper.getEditorLocator(blockId);
    await helper.selectAllTextInEditor(editor);
    await helper.clickFormatButton('link');
    await helper.waitForLinkEditorPopup();
    const linkUrlInput = await helper.getLinkEditorUrlInput();
    await expect(linkUrlInput).toBeFocused();
    await expect(linkUrlInput).toHaveValue('');

    await (await helper.getLinkEditorBrowseButton()).click();
    const objectBrowser = await helper.waitForObjectBrowser();
    await helper.objectBrowserSelectItem(objectBrowser, /Annual report/);
    // The pick fills in the address; submitting makes the link.
    await expect(linkUrlInput).toHaveValue(/\/annual-report$/);
    await page.getByRole('button', { name: 'Submit' }).click();
    await helper.waitForLinkEditorToClose();
    await expect(editor.locator('a')).toHaveAttribute('href', /\/annual-report$/);

    const patchRequest = page.waitForRequest(
      (req) => req.method() === 'PATCH' && new URL(req.url()).pathname.endsWith('/test-page'),
    );
    await helper.saveContent();
    const body = JSON.parse((await patchRequest).postData() || '{}');
    const links = savedLinks(body.blocks[blockId]);
    expect(links).toHaveLength(1);
    const data = links[0].data;
    expect(data.url).toMatch(/\/annual-report$/);
    expect(data.item).toMatchObject({
      title: 'Annual report',
      portal_type: 'File',
      mime_type: 'application/pdf',
      getObjSize: '19.5 KB',
    });
    expect(data.item).not.toHaveProperty('@id');
    expect(data.item).not.toHaveProperty('Creator');
    expect(data.item).not.toHaveProperty('listCreators');
  });

  test('a link typed into the link editor has no item details', async ({ page }) => {
    // Only a pick from the browser knows the item; a typed address keeps none
    // (a stale one from an earlier pick would describe the wrong thing).
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';
    await helper.editBlockTextInIframe(blockId, 'Example');
    const editor = await helper.getEditorLocator(blockId);
    await helper.selectAllTextInEditor(editor);
    await helper.clickFormatButton('link');
    const linkUrlInput = await helper.getLinkEditorUrlInput();
    await linkUrlInput.fill('https://example.com');
    await linkUrlInput.press('Enter');
    await helper.waitForLinkEditorToClose();
    await expect(editor.locator('a')).toHaveAttribute('href', 'https://example.com');

    const patchRequest = page.waitForRequest(
      (req) => req.method() === 'PATCH' && new URL(req.url()).pathname.endsWith('/test-page'),
    );
    await helper.saveContent();
    const body = JSON.parse((await patchRequest).postData() || '{}');
    const links = savedLinks(body.blocks[blockId]);
    expect(links).toHaveLength(1);
    expect(links[0].data).toEqual({ url: 'https://example.com' });
  });

  test('a relative link typed into the link editor is accepted', async ({ page }) => {
    // Typing a path relative to the current page (`./child`) used to leave the
    // link editor's Submit doing nothing — the link was silently refused.
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';
    await helper.editBlockTextInIframe(blockId, 'Relative');
    const editor = await helper.getEditorLocator(blockId);
    await helper.selectAllTextInEditor(editor);
    await helper.clickFormatButton('link');
    const linkUrlInput = await helper.getLinkEditorUrlInput();
    await linkUrlInput.fill('./another-page');
    await linkUrlInput.press('Enter');
    await helper.waitForLinkEditorToClose();

    const link = editor.locator('a');
    await expect(link).toHaveCount(1);
    await expect(link).toHaveText('Relative');
    // Resolved like a browser would on /_test_data/test-page: a sibling.
    await expect(link).toHaveAttribute('href', /\/_test_data\/another-page$/);
  });

});
