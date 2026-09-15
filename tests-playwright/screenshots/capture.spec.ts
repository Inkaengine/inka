/**
 * Editor UI screenshot capture for the Editor Guide.
 *
 * Run with: pnpm exec playwright test --project=screenshots
 *
 * Each test below opens the showcase fixture page, drives the editor into a
 * specific state, and saves an image into docs/images/. The
 * Editor Guide markdown pages reference those images by filename.
 *
 * Not part of normal test runs — gated to its own project (see
 * playwright.config.ts). CSS-driven re-renders are accepted; rerun the
 * --project=screenshots when the editor chrome changes.
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(SCRIPT_DIR, '..', '..', 'docs', 'images');
const SHOWCASE_PATH = '/showcase-page';

// Make sure the output directory exists once at import time.
fs.mkdirSync(OUT_DIR, { recursive: true });

/**
 * Save a viewport-sized screenshot under docs/images/<name>.png.
 */
async function snap(page: import('@playwright/test').Page, name: string) {
  const file = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`[screenshot] ${name} -> ${path.relative(process.cwd(), file)}`);
}

/**
 * Tight shot of the sidebar template section — the "Template: …" bar plus its
 * settings — so the doc image frames exactly the lock/unlock + Template Settings,
 * not the whole viewport (page fields sit above it in a long sidebar).
 */
async function snapTemplateSection(
  page: import('@playwright/test').Page,
  name: string,
  height = 260,
) {
  const bar = page
    .locator('.sidebar-section-header')
    .filter({ has: page.locator('.edit-template-toggle') });
  // Align the bar to the TOP of the sidebar so the Template Settings below it are in
  // frame (scrollIntoViewIfNeeded can park it at the bottom edge with nothing below).
  await bar.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  const box = (await bar.boundingBox())!;
  const file = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({
    path: file,
    clip: { x: box.x, y: Math.max(0, box.y - 4), width: box.width, height },
  });
  console.log(`[screenshot] ${name} -> ${path.relative(process.cwd(), file)}`);
}

test.describe('Editor Guide screenshots', () => {
  test('block-selected — slate block in text mode with Quanta toolbar', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit(SHOWCASE_PATH);

    // Click the intro paragraph — text mode, Quanta toolbar appears.
    await helper.clickBlockInIframe('intro');
    await helper.waitForBlockSelectedInAdmin('intro');

    await snap(page, 'block-selected');
  });

  test('block-mode — Escape from text mode, full border', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit(SHOWCASE_PATH);

    await helper.clickBlockInIframe('intro');
    await helper.waitForBlockSelectedInAdmin('intro');
    await helper.escapeFromEditing(); // text mode -> block mode

    await snap(page, 'block-mode');
  });

  test('multi-select — Shift+Click to select a range', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit(SHOWCASE_PATH);

    // Select first paragraph in block mode, then Shift+Click the second.
    await helper.clickBlockInIframe('after-columns');
    await helper.waitForBlockSelectedInAdmin('after-columns');
    await helper.escapeFromEditing();

    // Shift+Click in iframe to extend selection across to another-paragraph.
    const iframe = helper.page.frameLocator('iframe');
    const target = iframe.locator('[data-block-uid="another-paragraph"]');
    await target.click({ modifiers: ['Shift'] });

    // Allow the admin chrome to redraw the combined bounding box.
    await page.waitForTimeout(200);

    await snap(page, 'multi-select');
  });

  test('media-empty-placeholder — empty image block with upload prompt', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit(SHOWCASE_PATH);

    // Snap an image block before a file is picked — the state an author sees
    // the moment they insert one. NOT stored in the fixture: `url` is required,
    // and stored content with an empty required field contradicts its schema.
    // addBlockOnCanvas already leaves the newly inserted image block selected.
    // Don't click it again: an empty image renders a full-bleed upload-prompt
    // overlay over the block, and a second click races/​is intercepted by it.
    const uid = await helper.addBlockOnCanvas('empty-slate', 'image');
    await helper.waitForBlockSelectedInAdmin(uid);

    await snap(page, 'media-empty-placeholder');
  });

  test('slash-menu — type / in an empty slate to open the chooser', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit(SHOWCASE_PATH);

    const editor = await helper.enterEditMode('empty-slate');
    await editor.pressSequentially('/', { delay: 10 });

    const slashMenu = page.locator('.power-user-menu');
    await expect(slashMenu).toBeVisible({ timeout: 5000 });
    // Wait for menu items to populate so the screenshot isn't a half-rendered list.
    await expect(slashMenu.locator('.ui.menu .item').first()).toBeVisible({ timeout: 3000 });

    await snap(page, 'slash-menu');
  });

  test('wrap-chooser — multi-select then Wrap in container opens a chooser', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit(SHOWCASE_PATH);

    // Multi-select two adjacent paragraphs (block mode).
    await helper.clickBlockInIframe('after-columns');
    await helper.waitForBlockSelectedInAdmin('after-columns');
    await helper.escapeFromEditing();

    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    const iframe = helper.getIframe();
    await iframe.locator('[data-block-uid="another-paragraph"]').click({ modifiers: [modifier] });
    await helper.waitForMultiSelectOutlines(2);

    // Open the Quanta toolbar's overflow menu and click "Wrap in container...".
    const menuButton = page.locator('.quanta-toolbar .volto-hydra-menu-trigger');
    await expect(menuButton).toBeVisible({ timeout: 3000 });
    await menuButton.click();
    const wrapButton = page.locator('[data-testid="wrap-selected"]');
    await expect(wrapButton).toBeVisible({ timeout: 3000 });
    await wrapButton.click();

    // BlockChooser appears with the compatible container types.
    const chooser = page.locator('.blocks-chooser').first();
    await expect(chooser).toBeVisible({ timeout: 5000 });
    // Allow the chooser to finish its open animation before snap.
    await page.waitForTimeout(150);

    await snap(page, 'wrap-chooser');
  });

  test('link-picker — click the link toolbar button to open the picker', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit(SHOWCASE_PATH);

    // Enter edit mode on the intro paragraph (has a link inside).
    const editor = await helper.enterEditMode('intro');
    // Click inside the link so the cursor is on it.
    await editor.locator('a').first().click();
    // Toolbar's link button opens the LinkEditor popup.
    await helper.clickFormatButton('link');
    await helper.waitForLinkEditorPopup();

    await snap(page, 'link-picker');
  });

  test('link-fragments — expand a page to pick a heading as the link target', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    // Shot on a page that HAS headings. Open the picker from the button block's
    // own link field (as the deep-link tests do) — selecting a heading's text and
    // linking it would rewrite the very heading we want to show as an anchor.
    await helper.navigateToEdit('/deep-link-page');
    const iframe = helper.getIframe();

    await iframe.locator('[data-block-uid="btn"] [data-edit-link="href"]').click();
    await page.locator('.quanta-toolbar button[title*="Edit link"]').click();
    const browse = await helper.getLinkEditorBrowseButton();
    await browse.click();
    const ob = await helper.waitForObjectBrowser();
    await helper.objectBrowserNavigateToFolder(ob, /Test Data/);
    // Navigate INTO the page (click its row — a leaf page has no child items to
    // wait for), then switch the level to list its fragments.
    const row = page
      .locator('.object-listing li')
      .filter({ has: page.getByText(/^Deep Link Page$/, { exact: true }) })
      .first();
    await row.waitFor({ state: 'visible', timeout: 10000 });
    await row.click();
    await page.locator('.ob-level-mode-fragments').click();
    await expect(page.locator('.ob-fragment-item').first()).toBeVisible({
      timeout: 5000,
    });

    await snap(page, 'link-fragments');
  });

  test('edge-drag-ghost — mid-drag, ghost boundary visible', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit(SHOWCASE_PATH);

    const iframe = helper.getIframe();

    // Select the columns container in block mode so its edge handles render.
    await iframe.locator('[data-block-uid="columns-1"]').first().evaluate((el) => {
      (window as any).bridge?.selectBlock(el);
    });
    await helper.waitForIframeBlockHandle('columns-1');

    const bottomHandle = iframe.locator('.volto-hydra-edge-handle[data-edge="bottom"]');
    await expect(bottomHandle).toBeVisible({ timeout: 5000 });

    // after-columns is the next sibling at page level; drag the bottom edge
    // halfway toward its midpoint so the ghost boundary line renders without
    // crossing it (release won't actually absorb the paragraph).
    const handleBox = await bottomHandle.boundingBox();
    const afterRect = await iframe.locator('[data-block-uid="after-columns"]').boundingBox();
    expect(handleBox).not.toBeNull();
    expect(afterRect).not.toBeNull();
    const startX = handleBox!.x + handleBox!.width / 2;
    const startY = handleBox!.y + handleBox!.height / 2;
    // Halfway between handle and after-columns top — well short of after-columns midpoint.
    const dragY = startY + (afterRect!.y - startY) * 0.4;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    for (let step = 1; step <= 6; step++) {
      await page.mouse.move(startX, startY + (dragY - startY) * (step / 6));
      await page.waitForTimeout(20);
    }
    // Hold mid-drag and snap before releasing.
    await page.waitForTimeout(100);
    await snap(page, 'edge-drag-ghost');
    await page.mouse.up();
  });

  test('template-locked — fixed/readOnly template block shows lock', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    // inserted-template-test-page has a snippet template applied with one
    // fixed+readOnly heading block (the lock case) plus an editable body slot.
    await helper.navigateToEdit('/inserted-template-test-page');

    // Select the fixed/readOnly template block. Use bridge.selectBlock
    // because clicking a readOnly block doesn't enter text mode.
    const iframe = helper.getIframe();
    await iframe.locator('[data-block-uid="snippet-inst-header"]').first().evaluate((el) => {
      (window as any).bridge?.selectBlock(el);
    });
    await helper.waitForIframeBlockHandle('snippet-inst-header');
    // Allow the readonly chrome / sidebar lock indicator to render.
    await page.waitForTimeout(300);

    await snap(page, 'template-locked');
  });

  test('template-edit-locked — template instance selected, lock on the bar (not editing)', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    // Select a fixed template block, then step up to the template instance — its
    // sidebar bar shows the 🔒 lock (not editing) and the Template Settings form
    // with Name/Location disabled.
    const { blockId: headerBlockId } = await helper.waitForBlockByContent('Template Header - From Template');
    await helper.clickBlockInIframe(headerBlockId);
    await helper.waitForSidebarOpen();
    await helper.escapeToParent();
    await expect(page.locator('.edit-template-toggle')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.edit-template-toggle')).toHaveAttribute('aria-pressed', 'false');

    await snapTemplateSection(page, 'template-edit-locked');
  });

  test('template-edit-editing — unlocked, editing the template (unlock icon, fields enabled)', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    const { blockId: headerBlockId } = await helper.waitForBlockByContent('Template Header - From Template');
    await helper.clickBlockInIframe(headerBlockId);
    await helper.waitForSidebarOpen();
    await helper.escapeToParent();

    // Unlock → template edit mode; the bar toggle flips to 🔓. Unlocking warns
    // first (editing a template changes it everywhere) — confirm the modal,
    // exactly as helper.unlockTemplate does, or the unlock never completes.
    // v2: unlocking a template does NOT lock the rest of the page — the blocks
    // outside it stay editable (see template-edit-mode.spec "blocks outside
    // template stay editable in edit mode"). aria-pressed=true is the signal
    // that edit mode is on.
    await page.locator('.edit-template-toggle').click();
    const unlockConfirm = page.locator('.template-unlock-modal .template-confirm');
    await expect(unlockConfirm).toBeVisible({ timeout: 5000 });
    await unlockConfirm.click();
    await expect(page.locator('.template-unlock-modal')).toHaveCount(0, { timeout: 5000 });
    await expect(page.locator('.edit-template-toggle')).toHaveAttribute('aria-pressed', 'true', { timeout: 5000 });

    // Re-select the instance so its (now enabled) Template Settings are shown.
    await helper.clickBlockInIframe(headerBlockId);
    await helper.waitForSidebarOpen();
    await helper.escapeToParent();

    await snapTemplateSection(page, 'template-edit-editing', 330);
  });

  test('template-toolbar-lock — a template block toolbar shows the lock (not editing)', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/template-test-page');

    // Select a fixed template block; its in-canvas Quanta toolbar shows the 🔒 lock —
    // the in-canvas entry point into template edit mode.
    const { blockId: headerBlockId } = await helper.waitForBlockByContent('Template Header - From Template');
    await helper.clickBlockInIframe(headerBlockId);
    await helper.waitForBlockSelectedInAdmin(headerBlockId);
    await expect(page.locator('.quanta-toolbar .lock-icon')).toBeVisible({ timeout: 5000 });

    // The toolbar box is as wide as the block (transparent passthrough) with the
    // buttons packed on the left — clip a tight strip around the button row.
    const box = (await page.locator('.quanta-toolbar').boundingBox())!;
    const file = path.join(OUT_DIR, 'template-toolbar-lock.png');
    await page.screenshot({
      path: file,
      clip: { x: box.x, y: box.y, width: Math.min(box.width, 200), height: box.height },
    });
    console.log(`[screenshot] template-toolbar-lock -> ${path.relative(process.cwd(), file)}`);
  });

  test('frontend-switcher — toolbar panel with viewport + frontends', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit(SHOWCASE_PATH);

    await page.locator('#toolbar-frontend-switcher').click();
    const panel = page.locator('.frontend-switcher-panel');
    await expect(panel).toBeVisible({ timeout: 3000 });
    await expect(panel.locator('.frontend-switcher-url-item').first()).toBeVisible({ timeout: 3000 });
    // Wait for the toolbar-content "show" transition to settle so the panel
    // sits cleanly on the toolbar, not faintly overlaid on the iframe.
    await page.waitForTimeout(500);

    // Force a solid background on the panel for the screenshot — Volto's
    // toolbar panels rely on the surrounding pusher-puller layout to look
    // opaque, but in headless capture they render translucent over the
    // iframe.
    await panel.evaluate((el) => {
      (el as HTMLElement).style.backgroundColor = 'white';
      (el as HTMLElement).style.boxShadow = '0 2px 12px rgba(0,0,0,0.15)';
    });

    const file = path.join(OUT_DIR, 'frontend-switcher.png');
    await panel.screenshot({ path: file });
    console.log(`[screenshot] frontend-switcher -> ${path.relative(process.cwd(), file)}`);
  });

  test('parent-chain — sidebar shows ancestor breadcrumb when nested block selected', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    // container-test-page has slate text inside column inside columns —
    // three levels of nesting so the parent chain has multiple `‹` rows.
    // Showcase's columns block renders its children as separate top-level
    // data-block-uid elements via the column renderer, but only when the
    // test frontend's column block actually renders them; container-test-page
    // is the canonical fixture used in container tests for this shape.
    await helper.navigateToEdit('/container-test-page');

    await helper.clickBlockInIframe('text-1a');
    await helper.waitForBlockSelectedInAdmin('text-1a');

    await snap(page, 'parent-chain');
  });

  test('children-list — sidebar shows container children with drag handles', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    // search-test-page has a search block with TWO container fields:
    // `facets` (object_list, "Facets" section) and `listing` (blocks_layout,
    // "Results Listing" section). Selecting search-block-1 surfaces both
    // sections in the children-list widget with drag handles + drill-in
    // arrows — illustrates the multi-slot case the doc text describes.
    await helper.navigateToEdit('/search-test-page');

    const iframe = helper.getIframe();
    await iframe.locator('[data-block-uid="search-block-1"]').first().evaluate((el) => {
      (window as any).bridge?.selectBlock(el);
    });
    await helper.waitForBlockSelectedInAdmin('search-block-1');
    await page.waitForTimeout(300);

    // Scroll the sidebar so the multi-slot ChildBlocksWidget — which
    // renders below the search block's form fields — is in view. The
    // screenshot's whole point is to show those two sections side by
    // side; the form fields above are incidental. Scroll the *last*
    // child-block-item into view so both the Facets section and the
    // Results Listing section land in the viewport.
    const lastChildItem = page
      .locator('.sidebar-container .container-field-section .child-block-item')
      .last();
    await lastChildItem.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);

    await snap(page, 'children-list');
  });

  test('container-convert — select a container, open Convert chooser', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    // container-test-page has grid-1, a gridBlock with teaser children that
    // can convert to other container types. The showcase columns block
    // doesn't have fieldMappings to other containers so the menu would be
    // empty there.
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();
    await iframe.locator('[data-block-uid="grid-1"]').first().evaluate((el) => {
      (window as any).bridge?.selectBlock(el);
    });
    await helper.waitForIframeBlockHandle('grid-1');

    // Open the toolbar menu, click "Convert to..." — chooser pops up listing
    // compatible target types.
    const menuButton = page.locator('.quanta-toolbar .volto-hydra-menu-trigger');
    await expect(menuButton).toBeVisible({ timeout: 3000 });
    await menuButton.click();
    const convertButton = page.locator('[data-testid="convert-block"]');
    await expect(convertButton).toBeVisible({ timeout: 3000 });
    await convertButton.click();

    const chooser = page.locator('.blocks-chooser').first();
    await expect(chooser).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(150);

    await snap(page, 'container-convert');
  });
});

