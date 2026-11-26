/**
 * Copy-from-target: the per-field toggle between "owned by the link" and "the
 * author's".
 *
 * The `button` block declares fieldMappings['@target']: { Title: 'title' }; its
 * href carries the target snapshot. A field is pulled only when the block SAYS
 * a link owns it, in `_pullFrom` ({ linkField: [field, ...] }) — absence means
 * the author's, whoever wrote it (inka#595).
 *
 * Fixtures: btn-linked (`_pullFrom: {href: ['title']}` → title tracks the
 * target's 'Target Title'); btn-custom (no record → keeps 'My own label').
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

const linkedToggle = '.copy-from-target-linked';
const titleInput = '#sidebar-properties .field-wrapper-title input';

test.describe('Copy-from-target — linked/custom toggle', () => {
  test('a linked field pulls the target value on select, toggle checked', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/copy-target-page');

    await helper.clickBlockInIframe('btn-linked');
    await helper.waitForSidebarOpen();

    // Linked → pulled from the target ('Stale label' → 'Target Title').
    await expect
      .poll(async () => helper.getSidebarFieldValue('title'), { timeout: 5000 })
      .toBe('Target Title');
    await expect(page.locator(linkedToggle)).toHaveAttribute('aria-pressed', 'true');
  });

  test('on load, every linked field is pulled from its snapshot WITHOUT selecting', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/copy-target-page');

    // The decided behaviour: all blocks update when the page opens for editing.
    // btn-linked stores title 'Stale label' but its href snapshot carries the
    // target's 'Target Title' — on open it must fill from the snapshot with NO
    // click (the widget pull only runs on select; this is the on-load pass).
    const iframe = helper.getIframe();
    await expect(iframe.locator('[data-block-uid="btn-linked"]')).toContainText('Target Title', {
      timeout: 8000,
    });
    // btn-custom names no source → NOT pulled, keeps its own label.
    await expect(iframe.locator('[data-block-uid="btn-custom"]')).toContainText('My own label');

    // hero-onload has a FULL saved snapshot (the shape a real pick stores: title,
    // description, image_scales) with stale/empty fields. On open, EVERY mapped
    // field fills from that snapshot — heading, subheading AND the image — with no
    // click. This is what the single-field button above can't prove.
    const heroOnload = iframe.locator('[data-block-uid="hero-onload"]');
    await expect(heroOnload).toContainText('Another Page', { timeout: 8000 }); // heading (was 'Stale heading')
    await expect(heroOnload).toContainText('Another test page for linking'); // subheading (was empty)
    await expect(heroOnload.locator('img').first()).toHaveAttribute('src', /another-page/, {
      timeout: 8000,
    }); // image (from image_scales in the snapshot)
  });

  test('a custom field keeps its own value, toggle unchecked', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/copy-target-page');

    await helper.clickBlockInIframe('btn-custom');
    await helper.waitForSidebarOpen();

    // Custom → NOT pulled; keeps the editor's value.
    expect(await helper.getSidebarFieldValue('title')).toBe('My own label');
    await expect(page.locator(linkedToggle)).toHaveAttribute('aria-pressed', 'false');
  });

  test('editing a linked field flips it to custom (toggle unchecks)', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/copy-target-page');

    await helper.clickBlockInIframe('btn-linked');
    await helper.waitForSidebarOpen();
    await expect
      .poll(async () => helper.getSidebarFieldValue('title'), { timeout: 5000 })
      .toBe('Target Title');
    await expect(page.locator(linkedToggle)).toHaveAttribute('aria-pressed', 'true');

    // Type into the (linked) field → it becomes custom.
    await page.locator(titleInput).fill('Hand typed');
    await expect(page.locator(linkedToggle)).toHaveAttribute('aria-pressed', 'false');
    await expect
      .poll(async () => helper.getSidebarFieldValue('title'), { timeout: 5000 })
      .toBe('Hand typed');
  });

  test('typing inline turns off sync (flips the field to custom)', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/copy-target-page');

    // The hero's `heading` is a copy-from-target LINKED text field, inline-editable
    // on the canvas. Typing into it must turn off sync (flip to custom) — detected
    // by value-compare, since the inline message doesn't say which field changed.
    const headingToggle =
      '#sidebar-properties .field-wrapper-heading + .copy-from-target-toggle';
    await helper.clickBlockInIframe('hero-linked');
    await helper.waitForSidebarOpen();
    await expect(page.locator(headingToggle)).toHaveAttribute('aria-pressed', 'true');

    const editor = await helper.enterEditMode('hero-linked', 'heading');
    await helper.selectAllTextInEditor(editor);
    await editor.pressSequentially('Typed inline', { delay: 10 });

    // Confirm the edit landed (value drifted) — that is what turns it custom.
    await expect
      .poll(async () => helper.getSidebarFieldValue('heading'), { timeout: 5000 })
      .toBe('Typed inline');
    await expect(page.locator(headingToggle)).toHaveAttribute('aria-pressed', 'false');
  });

  test('inline-editing an IMAGE field flips it to custom (image/link edit path)', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/copy-target-page');

    // The hero's `image` is a copy-from-target LINKED destination (its buttonLink
    // is an internal target) and is edited inline via the toolbar image overlay —
    // the same `onFieldLinkChange` path that image AND link fields use. Editing it
    // must flip it to custom, exactly like a sidebar edit; otherwise the next pull
    // would clobber the chosen image. The toggle renders after the field wrapper.
    const imageToggle =
      '#sidebar-properties .field-wrapper-image + .copy-from-target-toggle';
    await helper.clickBlockInIframe('hero-linked');
    await helper.waitForSidebarOpen();
    await expect(page.locator(imageToggle)).toHaveAttribute('aria-pressed', 'true');

    // Set the image via a typed URL in the overlay (no object browser).
    const iframe = helper.getIframe();
    await iframe.locator('[data-block-uid="hero-linked"] [data-edit-media="image"]').click();
    const imageButton = helper.getQuantaToolbarFormatButton('image');
    await expect(imageButton).toBeVisible({ timeout: 5000 });
    await imageButton.click();
    const overlay = page.locator('.empty-image-overlay');
    await expect(overlay).toBeVisible({ timeout: 5000 });
    await overlay.locator('input[name="link"]').fill('https://picsum.photos/400/300');
    await overlay.locator('button[aria-label="Submit"]').click();

    await expect(page.locator(imageToggle)).toHaveAttribute('aria-pressed', 'false');
  });

  test('picking a page in the object browser fills the linked title', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/copy-target-page');

    // btn-pick starts empty (no href, no title). Pick a page via the REAL object
    // browser — the only way a link gets a snapshot in the app — and the title
    // must fill from the picked page. This is the core flow the feature exists for.
    const iframe = helper.getIframe();
    const btn = iframe.locator('[data-block-uid="btn-pick"] [data-edit-link="href"]');
    await btn.click();
    await helper.waitForSidebarOpen();

    const linkButton = page.locator('.quanta-toolbar button[title*="Edit link"]');
    await expect(linkButton).toBeVisible({ timeout: 5000 });
    await linkButton.click();
    await expect(page.locator('.field-link-editor .link-form-container')).toBeVisible({ timeout: 5000 });

    const browse = await helper.getLinkEditorBrowseButton();
    await browse.click();
    const ob = await helper.waitForObjectBrowser();
    // Selecting applies via onSelectItem (carrying the item's metadata) — no submit.
    await helper.objectBrowserSelectItem(ob, /Another Page/);

    // The href now points at /another-page → the linked title fills from its title.
    await expect
      .poll(async () => helper.getSidebarFieldValue('title'), { timeout: 8000 })
      .toBe('Another Page');
  });

  test('typing a relative URL into the link editor fills the linked title', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/copy-target-page');

    // No pick — TYPE an internal relative path. There's no item metadata, so the
    // value must resolve via a live @search of the @id and still fill the title.
    const iframe = helper.getIframe();
    await iframe.locator('[data-block-uid="btn-pick"] [data-edit-link="href"]').click();
    await helper.waitForSidebarOpen();
    await page.locator('.quanta-toolbar button[title*="Edit link"]').click();
    const form = page.locator('.field-link-editor .link-form-container');
    await expect(form).toBeVisible({ timeout: 5000 });
    await form.locator('input[name="link"]').fill('/_test_data/another-page');
    await form.locator('button[aria-label="Submit"]').click();

    await expect
      .poll(async () => helper.getSidebarFieldValue('title'), { timeout: 8000 })
      .toBe('Another Page');
  });

  test('a copy-from-target block INSIDE a container pulls its linked field', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/copy-target-page');

    // nested-btn lives inside section-cft; copy-from-target must work in containers,
    // not just at the page level — its title pulls from its own href snapshot.
    await helper.clickBlockInIframe('nested-btn');
    await helper.waitForSidebarOpen();
    await expect
      .poll(async () => helper.getSidebarFieldValue('title'), { timeout: 5000 })
      .toBe('Target Title');
    await expect(page.locator(linkedToggle)).toHaveAttribute('aria-pressed', 'true');
  });

  test('picking a page on a @default block (hero) fills EVERY mapped field from one URL change', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/copy-target-page');

    // hero-pick starts empty; the hero is default-on via @default mapping
    // title→heading, description→subheading, image→image. Picking a page for the
    // buttonLink (ONE URL change) must fill ALL of them together — this is the
    // regression guard for the multi-field pull race where per-field pulls
    // clobbered each other and only one field (subheading) survived.
    const iframe = helper.getIframe();
    await iframe.locator('[data-block-uid="hero-pick"] [data-edit-link="buttonLink"]').click();
    await helper.waitForSidebarOpen();
    await page.locator('.quanta-toolbar button[title*="Edit link"]').click();
    await expect(page.locator('.field-link-editor .link-form-container')).toBeVisible({ timeout: 5000 });
    const browse = await helper.getLinkEditorBrowseButton();
    await browse.click();
    const ob = await helper.waitForObjectBrowser();
    await helper.objectBrowserSelectItem(ob, /Another Page/);

    // title → heading (from the pick's snapshot metadata, synchronously)
    await expect
      .poll(async () => helper.getSidebarFieldValue('heading'), { timeout: 8000 })
      .toBe('Another Page');
    // description → subheading (the field that WON the race before — must still fill)
    await expect
      .poll(async () => helper.getSidebarFieldValue('subheading'), { timeout: 8000 })
      .toBe('Another test page for linking');
    // image → image: the target carries image_scales, resolved via the live
    // @search, so the hero's rendered image points at the target's own image.
    await expect(
      iframe.locator('[data-block-uid="hero-pick"] [data-edit-media="image"]'),
    ).toHaveAttribute('src', /another-page/, { timeout: 8000 });
  });

  test('TYPING a relative URL on a @default block fills EVERY mapped field (no async race)', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/copy-target-page');

    // No pick — TYPE the URL, so NO snapshot metadata rides along. Every mapped
    // field (heading, subheading, image) must still fill, resolved via the live
    // @search of the typed @id. The multi-field pull must be atomic here too —
    // per-field async pulls would race and clobber all but one field.
    const iframe = helper.getIframe();
    await iframe.locator('[data-block-uid="hero-pick"] [data-edit-link="buttonLink"]').click();
    await helper.waitForSidebarOpen();
    await page.locator('.quanta-toolbar button[title*="Edit link"]').click();
    const form = page.locator('.field-link-editor .link-form-container');
    await expect(form).toBeVisible({ timeout: 5000 });
    await form.locator('input[name="link"]').fill('/_test_data/another-page');
    await form.locator('button[aria-label="Submit"]').click();

    await expect
      .poll(async () => helper.getSidebarFieldValue('heading'), { timeout: 8000 })
      .toBe('Another Page');
    await expect
      .poll(async () => helper.getSidebarFieldValue('subheading'), { timeout: 8000 })
      .toBe('Another test page for linking');
    await expect(
      iframe.locator('[data-block-uid="hero-pick"] [data-edit-media="image"]'),
    ).toHaveAttribute('src', /another-page/, { timeout: 8000 });
  });

  test('changing the URL in the SIDEBAR object browser re-pulls the linked field', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/copy-target-page');

    // btn-linked → /news/big → title 'Target Title'. Change its href in the
    // SIDEBAR object browser to a different target → the linked title must
    // re-pull to the NEW target's title.
    await helper.clickBlockInIframe('btn-linked');
    await helper.waitForSidebarOpen();
    await expect
      .poll(async () => helper.getSidebarFieldValue('title'), { timeout: 5000 })
      .toBe('Target Title');

    const linkField = page.locator('#sidebar-properties .field-wrapper-href');
    const browseButton = linkField.locator('button[aria-label="Open object browser"]');
    await expect(browseButton).toBeVisible({ timeout: 5000 });
    await browseButton.click();
    let ob;
    try {
      ob = await helper.waitForObjectBrowser(3000);
    } catch {
      await browseButton.click();
      ob = await helper.waitForObjectBrowser();
    }
    await helper.objectBrowserNavigateToFolder(ob, /Test Data/);
    await helper.objectBrowserSelectItem(ob, /Another Page/);

    await expect
      .poll(async () => helper.getSidebarFieldValue('title'), { timeout: 8000 })
      .toBe('Another Page');
  });

  test('an external link offers no toggle and cannot pull (plain editable field)', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/copy-target-page');

    await helper.clickBlockInIframe('btn-external');
    await helper.waitForSidebarOpen();

    // External URL → no catalog target to pull from → no toggle, value untouched.
    await expect(page.locator('.copy-from-target-toggle')).toHaveCount(0);
    expect(await helper.getSidebarFieldValue('title')).toBe('External label');

    // Still a normal editable field.
    await page.locator(titleInput).fill('Edited external');
    await expect
      .poll(async () => helper.getSidebarFieldValue('title'), { timeout: 5000 })
      .toBe('Edited external');
  });

  test('unticking a linked field keeps the current value as custom', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/copy-target-page');

    await helper.clickBlockInIframe('btn-linked');
    await helper.waitForSidebarOpen();
    await expect
      .poll(async () => helper.getSidebarFieldValue('title'), { timeout: 5000 })
      .toBe('Target Title');

    // Untick → custom; value is retained, no longer pulled.
    await page.locator(linkedToggle).click();
    await expect(page.locator(linkedToggle)).toHaveAttribute('aria-pressed', 'false');
    expect(await helper.getSidebarFieldValue('title')).toBe('Target Title');
  });

  test('re-linking (re-tick) wipes the custom value and pulls the target again', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/copy-target-page');

    await helper.clickBlockInIframe('btn-linked');
    await helper.waitForSidebarOpen();
    await expect
      .poll(async () => helper.getSidebarFieldValue('title'), { timeout: 5000 })
      .toBe('Target Title');

    // Edit → custom (keeps the typed value).
    await page.locator(titleInput).fill('Hand typed');
    await expect(page.locator(linkedToggle)).toHaveAttribute('aria-pressed', 'false');
    await expect
      .poll(async () => helper.getSidebarFieldValue('title'), { timeout: 5000 })
      .toBe('Hand typed');

    // Re-tick → re-links AND re-pulls the target, discarding the custom value.
    await page.locator(linkedToggle).click();
    await expect(page.locator(linkedToggle)).toHaveAttribute('aria-pressed', 'true');
    await expect
      .poll(async () => helper.getSidebarFieldValue('title'), { timeout: 5000 })
      .toBe('Target Title');
  });
});
