import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

/**
 * Deep-link fragments: the frontend marks anchor elements with a real `id` +
 * `data-linkable-id="Name"`. Hydra harvests them per-block into
 * `_linkableAnchors` (persisted with the registered `blocks` field), and the
 * object browser offers them as `path#fragment` deep-link targets.
 */
test.describe('deep-link fragments', () => {
  test('frontend renders id + data-linkable-id on anchor headings', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/deep-link-page');
    const iframe = helper.getIframe();

    // The renderer emits a real id (the #fragment) + data-linkable-id (label).
    await expect(
      iframe.locator('#intro[data-linkable-id="Intro"]'),
    ).toBeVisible();
    await expect(
      iframe.locator('#details[data-linkable-id="Details"]'),
    ).toBeVisible();
  });

  test('anchors persist per-block and are offered as deep-link targets', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();

    // 1. Open for edit → hydra harvests the anchors into the admin formData.
    await helper.navigateToEdit('/deep-link-page');

    // 2. Save → PATCH persists blocks (with _linkableAnchors) to the session.
    await helper.saveContent();

    // 3. Re-enter edit. formData now loads from the persisted session content,
    //    so the object browser's getContent will see the anchors.
    await helper.navigateToEdit('/deep-link-page');
    const iframe = helper.getIframe();

    // 4. Open the button's link editor → object browser.
    await iframe.locator('[data-block-uid="btn"] [data-edit-link="href"]').click();
    await page.locator('.quanta-toolbar button[title*="Edit link"]').click();
    const browse = await helper.getLinkEditorBrowseButton();
    await browse.click();
    const ob = await helper.waitForObjectBrowser();

    // 5. OB opens at root (/) showing folders; deep-link-page lives under Test
    //    Data. Navigate in, then into the page itself and switch the level to
    //    its fragments.
    await helper.objectBrowserNavigateToFolder(ob, /Test Data/);
    await navigateIntoItem(page, /^Deep Link Page$/);
    const anchorItems = await showLevelFragments(page);

    // 6. Fragments listed in DOCUMENT order (s1 before s2): Intro, then Details.
    await expect(anchorItems).toHaveText(['Intro', 'Details']);

    // 7. Pick "Details" → the link becomes path#details.
    await anchorItems.filter({ hasText: 'Details' }).click();

    // 8. Re-open the link editor; the stored URL carries the #details fragment.
    await iframe.locator('[data-block-uid="btn"] [data-edit-link="href"]').click();
    await page.locator('.quanta-toolbar button[title*="Edit link"]').click();
    await expect(page.locator('input[name="link"]')).toHaveValue(/#details$/);
  });

  test('add a heading on one page, save, and link to it from another page', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();

    // Page A: add a heading block via the ## markdown shortcut, then a render
    // (block re-select) so the frontend recomputes its slug id and the harvest
    // captures it. Save → the anchor persists.
    await helper.navigateToEdit('/deep-link-page');
    await addHeadingBlock(helper, page, 's1', '## Chapter One');
    await helper.saveContent();

    // Page B: link its button to page A's "Chapter One" anchor.
    await helper.navigateToEdit('/deep-link-page-b');
    const iframeB = helper.getIframe();
    const fragments = await openPageAnchors(
      helper,
      page,
      iframeB,
      'btnb',
      /^Deep Link Page$/,
    );
    await expect(fragments.filter({ hasText: 'Chapter One' })).toBeVisible();
    await fragments.filter({ hasText: 'Chapter One' }).click();

    await iframeB.locator('[data-block-uid="btnb"] [data-edit-link="href"]').click();
    await page.locator('.quanta-toolbar button[title*="Edit link"]').click();
    await expect(page.locator('input[name="link"]')).toHaveValue(/#chapter-one$/);
  });

  test('add a heading on the current page and link to it live (no save)', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();

    // Add a heading on the page being edited — do NOT save.
    await helper.navigateToEdit('/deep-link-page');
    const iframe = helper.getIframe();
    await addHeadingBlock(helper, page, 's1', '## Section Two');

    // Link the same page's button to the just-added, UNSAVED heading. The object
    // browser reads live anchors from the current edit form (state.form.global).
    const fragments = await openPageAnchors(
      helper,
      page,
      iframe,
      'btn',
      /^Deep Link Page$/,
    );
    await expect(fragments.filter({ hasText: 'Section Two' })).toBeVisible();
    await fragments.filter({ hasText: 'Section Two' }).click();

    await iframe.locator('[data-block-uid="btn"] [data-edit-link="href"]').click();
    await page.locator('.quanta-toolbar button[title*="Edit link"]').click();
    await expect(page.locator('input[name="link"]')).toHaveValue(/#section-two$/);
  });

  // Read-only for TEMPLATE content is hydra's call, from the merged block.readOnly
  // — NOT something the frontend must mark. On a template page the fixed READ-ONLY
  // header carries an auto-anchor, but its content belongs to the template, so hydra
  // must skip it in the harvest. An EDITABLE slot heading's anchor must still be
  // harvested. This runs on admin-mock AND admin-nuxt: the real Nuxt example never
  // marks template read-only, so before hydra owned this the read-only anchor leaked
  // there. template-test-page uses test-layout (read-only header "Template Header -
  // From Template" + editable "default" slot).
  test('hydra skips read-only template anchors from data (not the renderer), keeps editable ones', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/template-test-page');
    await helper.waitForIframeReady();

    // Record every anchor NAME hydra harvests. Anchors ride whichever message
    // carries them: INLINE_EDIT_DATA for inline edits (a re-slugged heading title),
    // LINKABLE_ANCHORS for structural settles (reorder/delete). Both carry `anchors`.
    await page.evaluate(() => {
      (window as any).__harvestedNames = [];
      window.addEventListener(
        'message',
        (e: MessageEvent) => {
          if (
            e.data?.type !== 'LINKABLE_ANCHORS' &&
            e.data?.type !== 'INLINE_EDIT_DATA'
          )
            return;
          const map = e.data.anchors || {};
          for (const list of Object.values<any>(map))
            for (const a of list)
              (window as any).__harvestedNames.push(a.name);
        },
        true,
      );
    });

    // Add a heading in the editable "default" slot so the harvest has an editable
    // anchor to find (proves the harvest ran, not merely that it was empty). Use
    // addHeadingBlock — converting an existing block in place by select-all and
    // retyping doesn't reliably produce a tagged heading on every frontend.
    const { blockId } = await helper.waitForBlockByContent(
      'User content - different from template default',
    );
    await addHeadingBlock(helper, page, blockId, '## Editable Anchor Heading');

    // The editable slot heading's anchor IS harvested (debounced flush → harvest)…
    await expect
      .poll(() => page.evaluate(() => (window as any).__harvestedNames), {
        timeout: 10000,
      })
      .toContain('Editable Anchor Heading');

    // …but the READ-ONLY template header's anchor is NEVER harvested — hydra knows
    // it's read-only from block.readOnly, regardless of any render-side marking.
    const names = await page.evaluate(
      () => (window as any).__harvestedNames,
    );
    expect(names).not.toContain('Template Header - From Template');
  });

  // A heading's anchor auto-derives from its typed title. EDITING that title must
  // re-harvest so the picker offers the NEW slug and drops the stale one — the
  // hot path for the whole feature, and the one that fires the LINKABLE_ANCHORS
  // merge on every keystroke.
  test('editing a heading title re-slugs its offered anchor', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/deep-link-page');
    const iframe = helper.getIframe();

    // Add a heading "Alpha" (anchor auto-slugs to alpha / "Alpha").
    const uid = await addHeadingBlock(helper, page, 's1', '## Alpha');

    // Update the title: Alpha -> "Alpha Bravo" (the slug MUST follow).
    await helper.clickBlockInIframe(uid);
    const editor = await helper.getEditorLocator(uid);
    await expect(editor).toHaveAttribute('contenteditable', 'true', {
      timeout: 5000,
    });
    await editor.click();
    await page.keyboard.press('End');
    await editor.pressSequentially(' Bravo', { delay: 25 });
    await expect(iframe.locator(`[data-block-uid="${uid}"]`)).toContainText(
      'Alpha Bravo',
      { timeout: 10000 },
    );
    // Re-select a neighbour so the harvest flushes the final slug.
    await helper.clickBlockInIframe('s1');

    // The picker offers the UPDATED anchor; the stale "Alpha" is gone.
    const fragments = await openPageAnchors(
      helper,
      page,
      iframe,
      'btn',
      /^Deep Link Page$/,
    );
    await expect(fragments.filter({ hasText: 'Alpha Bravo' })).toBeVisible();
    await expect(fragments.filter({ hasText: /^Alpha$/ })).toHaveCount(0);
  });

});

// Add a slate block after `afterBlockId`, type `markdown` (e.g. '## Chapter One'),
// then re-select the anchor block to force a render so the frontend recomputes
// the heading's slug id and the bridge harvests it.
async function addHeadingBlock(helper, page, afterBlockId, markdown) {
  const before = await helper.getBlockOrder();
  await helper.clickBlockInIframe(afterBlockId);
  await helper.clickAddBlockButton();
  await helper.selectBlockType('slate');
  await helper.waitForBlockCountToBe(before.length + 1);
  const after = await helper.getBlockOrder();
  const newUid = after.find((id) => !before.includes(id));
  expect(newUid).toBeTruthy();
  await helper.clickBlockInIframe(newUid);
  const editor = await helper.getEditorLocator(newUid);
  await expect(editor).toHaveAttribute('contenteditable', 'true', {
    timeout: 5000,
  });
  await editor.pressSequentially(markdown, { delay: 20 });
  // Re-select another block to trigger a re-render (and thus a harvest).
  await helper.clickBlockInIframe(afterBlockId);
  return newUid;
}

// Navigate INTO a content item by clicking its row. Unlike the folder helper,
// this doesn't wait for child items — a leaf page's listing is empty, which is
// exactly the level whose fragments we want.
async function navigateIntoItem(page, titleRe) {
  const row = page
    .locator('.object-listing li')
    .filter({ has: page.getByText(titleRe, { exact: true }) })
    .first();
  await row.waitFor({ state: 'visible', timeout: 10000 });
  await row.click();
}

// Switch the level being browsed to its fragments and return the items locator.
// The fragment picker is a nested list (the heading hierarchy is structural), so
// target the label span — it carries the click handler and its text is just the
// anchor name, without a parent <li> absorbing its nested children's text.
async function showLevelFragments(page) {
  await page.locator('.ob-level-mode-fragments').click();
  return page.locator('.ob-fragment-label');
}

// Open the object browser for a button's link field, navigate to Test Data and
// then INTO the page whose title matches `titleRe`, and switch that level to
// list its fragments. Returns the fragment items locator.
async function openPageAnchors(helper, page, iframe, buttonUid, titleRe) {
  await iframe.locator(`[data-block-uid="${buttonUid}"] [data-edit-link="href"]`).click();
  await page.locator('.quanta-toolbar button[title*="Edit link"]').click();
  const browse = await helper.getLinkEditorBrowseButton();
  await browse.click();
  const ob = await helper.waitForObjectBrowser();
  await helper.objectBrowserNavigateToFolder(ob, /Test Data/);
  await navigateIntoItem(page, titleRe);
  return showLevelFragments(page);
}
