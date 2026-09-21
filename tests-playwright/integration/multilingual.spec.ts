import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';
import { URLS } from '../ports';

/**
 * Editing a multilingual site.
 *
 * The site's languages live in language root folders (/en, /de), each item
 * carrying its language and the translations linked to it — plone.app.multilingual's
 * model, which the mock reproduces. These tests are about what an editor can do
 * with it: see what a page is translated into, and make a translation that does
 * not exist yet.
 *
 * The fixture pair is /en/about ↔ /de/ueber-uns. /en/services has no
 * translation, so there is something to create.
 *
 * Every test asks for a multilingual site FIRST: the admin reads @site once at
 * boot, and the mock answers per session so the rest of the suite is unaffected.
 *
 * They also reach the views the way an editor does, from the toolbar. A deep
 * link to /manage-translations cannot work: on a server-rendered load Volto
 * fetches the content and the site's features CONCURRENTLY, so the content
 * request goes out before anything knows the site is multilingual and comes
 * back without the translations its view reads. That is Volto's own race, and
 * it bites the same way against a real Plone.
 */

/** Open the page's More menu and follow one of its entries. */
async function fromMoreMenu(page: import('@playwright/test').Page, entry: RegExp) {
  await page.locator('#toolbar-body .more').click();
  const link = page.getByRole('link', { name: entry });
  await expect(link, `the More menu offers ${entry}`).toBeVisible({ timeout: 10000 });
  await link.click();
}
test.describe('Multilingual editing', () => {
  test('a page shows what it is translated into', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.enableMultilingual();

    await page.goto(`${helper.adminUrl}/en/about`);
    await fromMoreMenu(page, /manage translations/i);

    const row = page.locator('#page-manage-translations tbody tr', {
      hasText: /deutsch|german/i,
    });
    await expect(row, 'the German translation is listed').toBeVisible({
      timeout: 15000,
    });
    await expect(row).toContainText('/de/ueber-uns');
  });

  test('a page with no translation offers to create one', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.enableMultilingual();

    await page.goto(`${helper.adminUrl}/en/services`);
    await fromMoreMenu(page, /manage translations/i);

    const row = page.locator('#page-manage-translations tbody tr', {
      hasText: /deutsch|german/i,
    });
    await expect(row).toBeVisible({ timeout: 15000 });
    // By destination, not by name: the control is an icon-only link with no
    // accessible name — Volto gives the unlink button an aria-label and this
    // one none, so a screen reader announces nothing to translate with.
    await expect(
      row.locator('a[href$="/create-translation"]'),
      'an untranslated language offers a way to translate it',
    ).toBeVisible();
  });

  test('an existing page can be linked as a translation, and unlinked again', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.enableMultilingual();

    // /de/dienstleistungen exists already and is nobody's translation: the
    // other way a pair comes about, when both pages were written separately.
    await page.goto(`${helper.adminUrl}/en/services`);
    await fromMoreMenu(page, /manage translations/i);
    const row = page.locator('#page-manage-translations tbody tr', {
      hasText: /deutsch|german/i,
    });
    await expect(row).toBeVisible({ timeout: 15000 });

    await row.getByRole('button', { name: /link/i }).click();
    const browser = await helper.waitForObjectBrowser();
    await helper.objectBrowserNavigateToFolder(browser, /Deutsch/);
    await page
      .locator('.object-listing li')
      .filter({ hasText: /Dienstleistungen/ })
      .first()
      .click();

    // Linked, both ways — the point of a translation group.
    const token = helper.authToken;
    const translations = async (path: string) =>
      (
        await page.request.get(`${URLS.mockApi}${path}/@translations`, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        })
      ).json();
    await expect
      .poll(async () => (await translations('/en/services')).items.map((i: any) => i.language), {
        timeout: 20000,
      })
      .toEqual(['de']);
    expect((await translations('/de/dienstleistungen')).items[0].language).toBe('en');

    // And unlinked again, from the same table — re-entered through the
    // toolbar, because a fresh load of this view races Volto's own site
    // features (see the note at the top of this file).
    await page.goto(`${helper.adminUrl}/en/services`);
    await fromMoreMenu(page, /manage translations/i);
    const linkedRow = page.locator('#page-manage-translations tbody tr', {
      hasText: /deutsch|german/i,
    });
    await expect(linkedRow).toContainText('/de/dienstleistungen', { timeout: 15000 });
    await linkedRow.getByRole('button', { name: /unlink/i }).click();
    await expect
      .poll(async () => (await translations('/en/services')).items.length, {
        timeout: 20000,
      })
      .toBe(0);
  });

  test('a language-independent field is inherited, not asked for again', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.enableMultilingual();

    await page.goto(`${helper.adminUrl}/en/services`);
    await fromMoreMenu(page, /manage translations/i);
    await page
      .locator('#page-manage-translations tbody tr', { hasText: /deutsch/i })
      .locator('a[href$="/create-translation"]')
      .click();
    await expect(page).toHaveURL(/\/de\/add\?type=/, { timeout: 15000 });

    // Tags are the same in every language, so the schema says so and the form
    // inherits them: the translator SEES the canonical's tags, and has nothing
    // to type — read-only here means the value is rendered, not an input that
    // is merely faded (which is all Volto's `pointer-events: none` does).
    await page
      .locator('#page-add .formtabs .item', { hasText: 'Categorization' })
      .click();
    const tags = page.locator('#page-add .field-wrapper-subjects');
    await expect(
      tags,
      'the field is marked as one the translation inherits',
    ).toHaveClass(/language-independent-field/, { timeout: 15000 });
    await expect(tags, "the canonical's tags, carried over").toContainText(
      'design',
    );
    await expect(tags).toContainText('build');
    await expect(
      tags.locator('input, textarea, [contenteditable="true"]'),
      'nothing to type into: there is one home for this value',
    ).toHaveCount(0);

    await page
      .locator('#page-add .formtabs .item', { hasText: 'Default' })
      .click();
    await page.locator('#page-add #field-title').fill('Dienstleistungen');
    await page.locator('#toolbar-save').click();
    await expect(page).toHaveURL(/\/de\/dienstleistungen\/edit/, { timeout: 20000 });

    // And the value came across without anyone typing it.
    const german = await (
      await page.request.get(`${URLS.mockApi}/de/dienstleistungen`, {
        headers: {
          Authorization: `Bearer ${helper.authToken}`,
          Accept: 'application/json',
        },
      })
    ).json();
    expect(german.subjects?.sort()).toEqual(['build', 'design']);
  });

  test('translating a page creates it linked, and lands in the editor', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.enableMultilingual();

    await page.goto(`${helper.adminUrl}/en/services`);
    await fromMoreMenu(page, /manage translations/i);
    const row = page.locator('#page-manage-translations tbody tr', {
      hasText: /deutsch|german/i,
    });
    await expect(row).toBeVisible({ timeout: 15000 });
    await row.locator('a[href$="/create-translation"]').click();
    // The add form under the German language root. Inka has no specialist
    // create view — you create, then you edit, as for every other type.
    await expect(page).toHaveURL(/\/de\/add\?type=/, { timeout: 15000 });

    await page.locator('#page-add #field-title').fill('Dienstleistungen');
    await page.locator('#toolbar-save').click();

    // Saved where German belongs, and straight into the editor.
    await expect(page).toHaveURL(/\/de\/dienstleistungen\/edit/, { timeout: 20000 });

    const token = helper.authToken;
    const read = async (path: string) =>
      (await page.request.get(`${URLS.mockApi}${path}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      })).json();

    // Linked, which is the point of translating rather than adding.
    const linked = await read('/en/services/@translations');
    expect(linked.items.map((i: { language: string }) => i.language)).toEqual(['de']);
    expect(linked.items[0]['@id']).toContain('/de/dienstleistungen');

    // The blocks came with it under ids of their own — including the ones
    // NESTED in a container. A uid naming a block on both pages would leave
    // selection, inline editing and the bridge unable to say which page is
    // meant. `@canonical` is the link back to the original.
    const english = await read('/en/services');
    const german = await read('/de/dienstleistungen');
    const nested = (doc: any) => {
      const grid: any = Object.values(doc.blocks).find(
        (b: any) => b['@type'] === 'gridBlock',
      );
      return { grid, childIds: grid.blocks_layout.items as string[] };
    };
    const sourceGrid = nested(english);
    const copy = nested(german);
    expect(copy.grid['@canonical']).toBe(
      Object.keys(english.blocks).find(
        (id) => english.blocks[id]['@type'] === 'gridBlock',
      ),
    );
    expect(copy.childIds).toHaveLength(2);
    for (const childId of copy.childIds) {
      expect(sourceGrid.childIds, 'a nested block gets an id of its own').not.toContain(
        childId,
      );
      expect(sourceGrid.childIds).toContain(copy.grid.blocks[childId]['@canonical']);
    }
  });

  test('a saved translation renders, and leaves the original alone', async ({
    page,
  }) => {
    // The test above proves the copy is CORRECT in the API. It never looks at
    // the page, so a copy that saved cleanly and rendered as nothing — a block
    // whose uid the frontend can't resolve, a container whose children were
    // copied into the wrong field — would pass it. A translation nobody can
    // read is not a translation.
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.enableMultilingual();

    await page.goto(`${helper.adminUrl}/en/services`);
    await fromMoreMenu(page, /manage translations/i);
    await page
      .locator('#page-manage-translations tbody tr', { hasText: /deutsch/i })
      .locator('a[href$="/create-translation"]')
      .click();
    await expect(page).toHaveURL(/\/de\/add\?type=/, { timeout: 15000 });
    await page.locator('#page-add #field-title').fill('Dienstleistungen');
    await page.locator('#toolbar-save').click();
    await expect(page).toHaveURL(/\/de\/dienstleistungen\/edit/, { timeout: 20000 });

    // Viewed, not edited: the saved page as a reader gets it. Asserted on the
    // rendered text rather than any one frontend's markup, since every frontend
    // runs this spec.
    await page.goto(`${helper.adminUrl}/de/dienstleistungen`);
    await helper.waitForIframeReady();
    // Which page is on screen, stated — the block text below is copied, so it
    // reads the same on the English original and would pass there too.
    await expect(page.locator('#previewIframe')).toHaveAttribute(
      'src',
      /\/de\/dienstleistungen/,
    );
    const iframe = helper.getIframe();
    await expect(iframe.locator('body'), 'the title that was typed').toContainText(
      'Dienstleistungen',
      { timeout: 15000 },
    );
    // The copied blocks, including the two NESTED in the grid — the ones whose
    // ids were rewritten on the way over, and so the ones a broken copy loses.
    // Still in English: a fresh translation is work to do, not work done.
    await expect(iframe.locator('body'), 'a top-level block came across').toContainText(
      'What we do, in English.',
    );
    await expect(iframe.locator('body'), 'the grid came across').toContainText(
      'What we do',
    );
    for (const nested of ['We design in English.', 'We build in English.']) {
      await expect(iframe.locator('body'), 'a nested block came across').toContainText(
        nested,
      );
    }

    // And the page it was translated FROM is untouched — same blocks, same
    // title. Copying by reference would have shown up here.
    const english = await (
      await page.request.get(`${URLS.mockApi}/en/services`, {
        headers: {
          Authorization: `Bearer ${helper.authToken}`,
          Accept: 'application/json',
        },
      })
    ).json();
    expect(english.title).toBe('Services');
    expect(english.language?.token ?? english.language).toBe('en');
  });

  test('editing a page can show it in another language, side by side', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.enableMultilingual();

    // /en/about is translated into German already.
    await page.goto(`${helper.adminUrl}/en/about/edit`);

    const compare = page.locator('.compare-languages');
    await expect(compare, 'the editor offers the languages this page has').toBeVisible({
      timeout: 20000,
    });
    await compare.getByRole('button', { name: 'de' }).click();

    // The other language is read-only beside the page being edited, drawn by
    // the frontend like everything else in Inka.
    await expect(
      page.frameLocator('#translationSourceIframe').locator('body'),
      'the German page is there to translate from',
    ).toContainText('Wir bauen Dinge auf Deutsch.', { timeout: 20000 });
    // Both panes are editing frames. What makes the compared one read-only is
    // its CONTENT — every block in it is marked read-only — so the bridge
    // collects no editable field and there is nothing to type into.
    await expect(page.locator('#previewIframe')).toHaveAttribute('src', /_edit=true/);
    await expect(
      page.frameLocator('#translationSourceIframe').locator('[contenteditable="true"]'),
      'nothing in the compared page may be typed into',
    ).toHaveCount(0);
  });

  test('selecting the other language shows its fields, read only', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.enableMultilingual();

    await page.goto(`${helper.adminUrl}/en/about/edit`);
    const compare = page.locator('.compare-languages');
    await expect(compare).toBeVisible({ timeout: 20000 });
    await compare.getByRole('button', { name: 'de' }).click();

    // One sidebar, two panes — the same bargain Volto strikes with its two
    // forms: whichever you select is the one the sidebar belongs to.
    const fields = page.locator('.compare-language-fields');
    await expect(fields, 'the sidebar starts on the page being edited').toHaveCount(0);

    // Clicking a block in the other language selects it there — the pane is an
    // editing frame whose blocks are all read-only — and the sidebar shows
    // that block, read-only.
    const german = page.frameLocator('#translationSourceIframe');
    // Wait for the pane's bridge to have finished its handshake before
    // clicking: node ids are stamped when the admin's data arrives, and until
    // they are there a click selects nothing.
    await expect(german.locator('[data-node-id]').first()).toBeAttached({
      timeout: 20000,
    });
    await german
      .locator('[data-block-uid]')
      .filter({ hasText: 'Über uns' })
      .last()
      .click();
    await expect(fields, "the sidebar follows the pane that was clicked").toBeVisible({
      timeout: 15000,
    });

    // Working in the page being edited takes the sidebar back.
    await helper.getIframe().locator('[data-block-uid]').first().click();
    await expect(fields).toHaveCount(0);
  });

  test('a block in the other language can be inspected, but not changed', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.enableMultilingual();

    await page.goto(`${helper.adminUrl}/en/about/edit`);
    const compare = page.locator('.compare-languages');
    await expect(compare).toBeVisible({ timeout: 20000 });
    await compare.getByRole('button', { name: 'de' }).click();

    const german = page.frameLocator('#translationSourceIframe');
    const block = german.locator('[data-block-uid]').filter({ hasText: 'Über uns' }).last();
    await expect(block).toBeVisible({ timeout: 20000 });
    // Wait for the pane's bridge to have finished its handshake before
    // clicking: node ids are stamped when the admin's data arrives, and until
    // they are there a click selects nothing.
    await expect(german.locator('[data-node-id]').first()).toBeAttached({
      timeout: 20000,
    });
    await block.click();

    // The sidebar shows what was picked, by its type — a block, not the page.
    const fields = page.locator('.compare-language-fields');
    await expect(fields).toBeVisible({ timeout: 15000 });
    await expect(fields).toContainText(/\(de\)/);

    // Inspectable, not editable: the bridge collects no editable field for a
    // read-only block, so nothing in that pane can be typed into.
    await expect(german.locator('[contenteditable="true"]')).toHaveCount(0);
  });

  test('selecting a block shows the same block in the other language', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.enableMultilingual();

    // A translation made here, so its blocks are copies that record where they
    // came from — the pairing Volto writes and never reads.
    await page.goto(`${helper.adminUrl}/en/services`);
    await fromMoreMenu(page, /manage translations/i);
    await page
      .locator('#page-manage-translations tbody tr', { hasText: /deutsch/i })
      .locator('a[href$="/create-translation"]')
      .click();
    await page.locator('#page-add #field-title').fill('Dienstleistungen');
    await page.locator('#toolbar-save').click();
    await expect(page).toHaveURL(/\/de\/dienstleistungen\/edit/, { timeout: 20000 });
    await helper.waitForIframeReady();

    const compare = page.locator('.compare-languages');
    await expect(compare).toBeVisible({ timeout: 20000 });
    await compare.getByRole('button', { name: 'en' }).click();

    // Pick the block by id, not by what it looks like: each frontend renders
    // this page its own way, and the test is about the pairing.
    const token = helper.authToken;
    const german = await (
      await page.request.get(`${URLS.mockApi}/de/dienstleistungen`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      })
    ).json();
    const grid: any = Object.values(german.blocks).find(
      (b: any) => b['@type'] === 'gridBlock',
    );
    const [teaserUid] = grid.blocks_layout.items as string[];
    const canonicalOfSelected = grid.blocks[teaserUid]['@canonical'];
    expect(canonicalOfSelected, 'the copy records where it came from').toBeTruthy();

    const teaser = helper.getIframe().locator(`[data-block-uid="${teaserUid}"]`).first();
    await expect(teaser).toBeVisible({ timeout: 20000 });
    // Rendered is not ready: node ids are stamped when the admin's data
    // arrives, and a click before that selects nothing — the compare pane then
    // sits on whatever was selected when the page loaded, which is the title.
    // The heavier the frontend, the more often the click lands first.
    await expect(
      helper.getIframe().locator('[data-node-id]').first(),
    ).toBeAttached({ timeout: 20000 });
    await teaser.click();

    // The other pane shows the block this one was copied from. Polled, and
    // generously: selection settles a beat after the click, and a frontend in
    // dev can take its time.
    const pane = page.locator('.source-preview-pane');
    await expect
      .poll(async () => pane.getAttribute('data-showing-block'), { timeout: 30000 })
      .toBe(canonicalOfSelected);
  });

  test('a block with no counterpart in the other language says so', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.enableMultilingual();

    // /en/about and /de/ueber-uns were LINKED, not copied from one another, so
    // no block of either records where it came from — there is no pairing to
    // follow. The same happens to a block added after a copy, or one whose
    // original has since been deleted.
    await page.goto(`${helper.adminUrl}/en/about/edit`);
    const compare = page.locator('.compare-languages');
    await expect(compare).toBeVisible({ timeout: 20000 });
    await compare.getByRole('button', { name: 'de' }).click();

    await helper
      .getIframe()
      .locator('[data-block-uid]')
      .filter({ hasText: 'We build things in English.' })
      .last()
      .click();

    await expect(
      page.locator('.compare-no-counterpart'),
      'the editor is told, rather than left with a pane that looks broken',
    ).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.source-preview-pane')).toHaveAttribute(
      'data-showing-block',
      '',
    );
  });

  test('a container says when the blocks inside it are still untranslated', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.enableMultilingual();

    // Make the translation first: its blocks are copies of the English ones,
    // which nobody has translated yet.
    await page.goto(`${helper.adminUrl}/en/services`);
    await fromMoreMenu(page, /manage translations/i);
    await page
      .locator('#page-manage-translations tbody tr', { hasText: /deutsch/i })
      .locator('a[href$="/create-translation"]')
      .click();
    await page.locator('#page-add #field-title').fill('Dienstleistungen');
    await page.locator('#toolbar-save').click();
    await expect(page).toHaveURL(/\/de\/dienstleistungen\/edit/, { timeout: 20000 });

    // Read it beside the English original — which is what makes
    // "untranslated" answerable at all.
    const compare = page.locator('.compare-languages');
    await expect(compare).toBeVisible({ timeout: 20000 });
    await compare.getByRole('button', { name: 'en' }).click();

    // Select a block INSIDE the grid: that is how an editor gets a blind for
    // the container, and the blind is what hides the copies.
    const teaser = helper
      .getIframe()
      .locator('[data-block-uid]')
      .filter({ hasText: 'We design in English.' })
      .last();
    await expect(teaser).toBeVisible({ timeout: 20000 });
    await teaser.click();

    const marker = page
      .locator('.parent-block-section')
      .filter({ hasText: 'GridBlock' })
      .locator('.nested-status[data-nested-status="untranslated"]');
    await expect(
      marker.first(),
      "the container's blind marks that blocks inside still read as the original",
    ).toBeVisible({ timeout: 10000 });
    // Both teasers, counted — the marker is a roll-up, not a flag.
    await expect(marker.first()).toHaveAttribute('data-nested-count', '2');
  });

  test('a language shows its own menu, not the whole site in two languages', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.enableMultilingual();

    await page.goto(`${helper.adminUrl}/en/about`);
    await helper.waitForIframeReady();
    // Every frontend builds its menu its own way, so this asks the navigation
    // landmarks rather than one frontend's markup.
    const menus = async () =>
      (
        await helper
          .getIframe()
          .locator('nav')
          .evaluateAll((navs) => navs.map((n) => n.textContent || ''))
      ).join(' ');

    // The English tree, and only it: a language root folder is the navigation
    // root for everything inside it, which is what keeps one site's two
    // languages out of each other's menus.
    await expect.poll(menus, { timeout: 15000 }).toContain('Services');
    expect(
      await menus(),
      'the German pages belong to the German menu',
    ).not.toContain('Dienstleistungen');
  });

  test('the frontend offers the page in its other language, and following it moves the admin', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.enableMultilingual();

    await page.goto(`${helper.adminUrl}/en/about`);
    // Wait for the preview to have rendered before reading anything out of it:
    // a frontend still compiling (Nuxt in dev) is not a missing switcher.
    await helper.waitForIframeReady();
    const iframe = helper.getIframe();

    const switcher = iframe.locator('#language-switcher');
    await expect(switcher, 'the page offers its languages').toBeVisible();
    await expect(
      switcher.locator('[aria-current="true"]'),
      'the language being read is marked as current',
    ).toHaveText(/english/i);

    const german = switcher.getByRole('link', { name: /deutsch/i });
    await expect(german).toHaveAttribute('href', '/de/ueber-uns');
    await german.click();

    // Following it is ordinary navigation inside the preview, which the bridge
    // reports — so the admin ends up on the German page, not just the iframe.
    await expect(page).toHaveURL(/\/de\/ueber-uns/, { timeout: 15000 });
    // The German page is what the preview now shows — asserted on the rendered
    // text rather than any one frontend's markup, since every frontend runs
    // this spec.
    await expect(iframe.locator('body')).toContainText('Über uns', { timeout: 15000 });
  });

  test('a language with no translation offers its language root instead', async ({
    page,
  }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.enableMultilingual();

    await page.goto(`${helper.adminUrl}/en/services`);
    await helper.waitForIframeReady();
    const switcher = helper.getIframe().locator('#language-switcher');
    await expect(switcher).toBeVisible();
    // Nothing to read in German yet, so the offer is the German site itself —
    // what Volto's own language selector falls back to.
    await expect(switcher.getByRole('link', { name: /deutsch/i })).toHaveAttribute(
      'href',
      '/de',
    );
  });

  test('translating the copy saves, and the original keeps its own words', async ({
    page,
  }) => {
    // Creating a translation is half the job: the copy arrives in the language
    // it came from, and the point is to type over it. Nothing so far edits a
    // translation at all, so a copy that saved and rendered but could not be
    // EDITED — blocks whose uids the bridge cannot address, a save that wrote
    // back over the original — would pass every test above.
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.enableMultilingual();

    await page.goto(`${helper.adminUrl}/en/services`);
    await fromMoreMenu(page, /manage translations/i);
    await page
      .locator('#page-manage-translations tbody tr', { hasText: /deutsch/i })
      .locator('a[href$="/create-translation"]')
      .click();
    await expect(page).toHaveURL(/\/de\/add\?type=/, { timeout: 15000 });
    await page.locator('#page-add #field-title').fill('Dienstleistungen');
    await page.locator('#toolbar-save').click();
    await expect(page).toHaveURL(/\/de\/dienstleistungen\/edit/, { timeout: 20000 });

    const read = async (path: string) =>
      (
        await page.request.get(`${URLS.mockApi}${path}`, {
          headers: {
            Authorization: `Bearer ${helper.authToken}`,
            Accept: 'application/json',
          },
        })
      ).json();

    // The copied paragraph, by the text it still carries from the original.
    const german = await read('/de/dienstleistungen');
    const slateId = Object.keys(german.blocks).find(
      (id) =>
        german.blocks[id]['@type'] === 'slate' &&
        JSON.stringify(german.blocks[id].value ?? '').includes(
          'What we do, in English.',
        ),
    );
    expect(slateId, 'the copied paragraph is there to translate').toBeTruthy();

    await helper.waitForIframeReady();
    await helper.editBlockTextInIframe(slateId!, 'Was wir machen, auf Deutsch.');
    await page.locator('#toolbar-save').click();
    await expect(page).toHaveURL(/\/de\/dienstleistungen$/, { timeout: 20000 });

    // What was typed is what was saved.
    await expect
      .poll(
        async () =>
          JSON.stringify((await read('/de/dienstleistungen')).blocks[slateId!].value),
        { timeout: 15000 },
      )
      .toContain('Was wir machen, auf Deutsch.');

    // And it reads that way on the page, not just in the API.
    await helper.waitForIframeReady();
    await expect(helper.getIframe().locator('body')).toContainText(
      'Was wir machen, auf Deutsch.',
      { timeout: 15000 },
    );

    // The English page is untouched — the copy has ids of its own, so typing
    // into it cannot reach back. This is what `@canonical` being a REFERENCE
    // rather than a shared uid buys.
    const english = await read('/en/services');
    expect(JSON.stringify(english.blocks)).toContain('What we do, in English.');
    expect(JSON.stringify(english.blocks)).not.toContain('Was wir machen');
  });

  test('a folder can be translated too, and lands on its view', async ({ page }) => {
    // A site is not only pages. plone.app.multilingual translates whatever the
    // type is, through the same create — `translation_of` and `language` — and
    // everything above this test happens to be a Document. A folder has no
    // blocks to copy and no visual editor to land in, which is exactly why it
    // is worth walking: the paths that assume both are the ones that break.
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.enableMultilingual();

    await page.goto(`${helper.adminUrl}/en/team`);
    await fromMoreMenu(page, /manage translations/i);
    const row = page.locator('#page-manage-translations tbody tr', {
      hasText: /deutsch|german/i,
    });
    await expect(row, 'a folder offers its languages like anything else').toBeVisible({
      timeout: 15000,
    });
    await row.locator('a[href$="/create-translation"]').click();
    await expect(page).toHaveURL(/\/de\/add\?type=Folder/, { timeout: 15000 });

    await page.locator('#page-add #field-title').fill('Mannschaft');
    await page.locator('#toolbar-save').click();

    // A type with no blocks has no canvas to edit, so it lands on its view —
    // not /edit, which for a folder is Volto's flat form and not what the
    // bridge drives.
    await expect(page).toHaveURL(/\/de\/mannschaft$/, { timeout: 20000 });

    const read = async (path: string) =>
      (
        await page.request.get(`${URLS.mockApi}${path}`, {
          headers: {
            Authorization: `Bearer ${helper.authToken}`,
            Accept: 'application/json',
          },
        })
      ).json();

    // Linked and in German — the two things a create does for a translation,
    // which the API did for Documents only until this test asked.
    const group = await read('/en/team/@translations');
    expect(group.items.map((i: { language: string }) => i.language)).toEqual(['de']);
    expect(group.items[0]['@id']).toContain('/de/mannschaft');

    const german = await read('/de/mannschaft');
    expect(german['@type']).toBe('Folder');
    expect(german.language?.token ?? german.language).toBe('de');
  });

  test('an image can be translated, and gets a file of its own', async ({ page }) => {
    // A folder has nothing to upload; an image is the other shape of
    // non-Document — a type whose whole point is a binary, where translating
    // means a DIFFERENT file (German screenshot, German poster), not a copy of
    // the same one.
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.enableMultilingual();

    await page.goto(`${helper.adminUrl}/en/logo.jpg`);
    await fromMoreMenu(page, /manage translations/i);
    const row = page.locator('#page-manage-translations tbody tr', {
      hasText: /deutsch|german/i,
    });
    await expect(row, 'an image offers its languages like a page').toBeVisible({
      timeout: 15000,
    });
    await row.locator('a[href$="/create-translation"]').click();
    await expect(page).toHaveURL(/\/de\/add\?type=Image/, { timeout: 15000 });

    await page.locator('#page-add #field-title').fill('Logo (Deutsch)');
    // A 1x1 PNG: the German image is its own file, not the English one.
    await page.locator('#page-add input[type="file"]').setInputFiles({
      name: 'logo-de.png',
      mimeType: 'image/png',
      buffer: Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
        0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00,
        0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xff, 0xff, 0x3f,
        0x00, 0x05, 0xfe, 0x02, 0xfe, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
        0x44, 0xae, 0x42, 0x60, 0x82,
      ]),
    });
    await page.locator('#toolbar-save').click();

    // An image has no blocks, so like a folder it lands on its view — not the
    // add form it came from, and not /edit.
    await expect(page).not.toHaveURL(/\/add\b/, { timeout: 20000 });
    await expect(page).toHaveURL(/\/de\/[^/?#]+$/);

    const group = await (
      await page.request.get(`${URLS.mockApi}/en/logo.jpg/@translations`, {
        headers: {
          Authorization: `Bearer ${helper.authToken}`,
          Accept: 'application/json',
        },
      })
    ).json();
    expect(group.items.map((i: { language: string }) => i.language)).toEqual(['de']);
    expect(group.items[0]['@id'], 'the German image is a separate item').toContain(
      '/de/',
    );
  });

  test('a container says when the ORIGINAL has changed since it was translated', async ({
    page,
  }) => {
    // The other half of the same question. `untranslated` finds a copy nobody
    // has touched, and goes quiet the moment German is typed — after that,
    // nothing said the English had moved on, and a translator had to re-read
    // the page to find out. The copy records a fingerprint of what it was made
    // from, so the two can be compared without a diff.
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.enableMultilingual();

    await page.goto(`${helper.adminUrl}/en/services`);
    await fromMoreMenu(page, /manage translations/i);
    await page
      .locator('#page-manage-translations tbody tr', { hasText: /deutsch/i })
      .locator('a[href$="/create-translation"]')
      .click();
    await page.locator('#page-add #field-title').fill('Dienstleistungen');
    await page.locator('#toolbar-save').click();
    await expect(page).toHaveURL(/\/de\/dienstleistungen\/edit/, { timeout: 20000 });

    const auth = {
      Authorization: `Bearer ${helper.authToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };

    // Translate the two copied teasers, so neither is "untranslated" any more
    // and only the fingerprint can answer.
    const german = await (
      await page.request.get(`${URLS.mockApi}/de/dienstleistungen`, { headers: auth })
    ).json();
    const germanGrid: any = Object.values(german.blocks).find(
      (b: any) => b['@type'] === 'gridBlock',
    );
    const germanTeasers = germanGrid.blocks_layout.items as string[];
    for (const [i, uid] of germanTeasers.entries()) {
      germanGrid.blocks[uid].title = `Deutscher Titel ${i + 1}`;
      germanGrid.blocks[uid].description = `Deutsche Beschreibung ${i + 1}`;
    }
    await page.request.patch(`${URLS.mockApi}/de/dienstleistungen`, {
      headers: auth,
      data: { blocks: german.blocks },
    });

    // Now the ENGLISH changes: someone rewrites one teaser.
    const english = await (
      await page.request.get(`${URLS.mockApi}/en/services`, { headers: auth })
    ).json();
    const englishGrid: any = Object.values(english.blocks).find(
      (b: any) => b['@type'] === 'gridBlock',
    );
    const [firstEnglishTeaser] = englishGrid.blocks_layout.items as string[];
    englishGrid.blocks[firstEnglishTeaser].description =
      'We design in English, but differently now.';
    await page.request.patch(`${URLS.mockApi}/en/services`, {
      headers: auth,
      data: { blocks: english.blocks },
    });

    // Re-open the translation beside its original.
    await page.goto(`${helper.adminUrl}/de/dienstleistungen/edit`);
    const compare = page.locator('.compare-languages');
    await expect(compare).toBeVisible({ timeout: 20000 });
    await compare.getByRole('button', { name: 'en' }).click();

    await helper.waitForIframeReady();
    const teaser = helper
      .getIframe()
      .locator('[data-block-uid]')
      .filter({ hasText: 'Deutscher Titel' })
      .last();
    await expect(teaser).toBeVisible({ timeout: 20000 });
    await teaser.click();

    const marker = page
      .locator('.parent-block-section')
      .filter({ hasText: 'GridBlock' })
      .locator('.nested-status[data-nested-status="stale"]');
    await expect(
      marker.first(),
      "the container's blind marks that a block's original has changed",
    ).toBeVisible({ timeout: 10000 });
    // ONE of the two teasers was rewritten in English; the other is current.
    await expect(marker.first()).toHaveAttribute('data-nested-count', '1');
  });

  test('a shared field is inherited on a translation, and owned by the default language', async ({
    page,
  }) => {
    // The add form shows a language-independent field as inherited. It is the
    // same value afterwards — one value for the whole translation group — so
    // the edit form has to say the same thing, or the editor gets a second
    // place to type it that quietly disagrees with the first.
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.enableMultilingual();

    await page.goto(`${helper.adminUrl}/de/ueber-uns/edit`);
    await helper.openSidebarTab('Page');
    const germanTags = page.locator('#sidebar-metadata .field-wrapper-subjects');
    await expect(germanTags, 'the translation inherits the tags').toHaveClass(
      /language-independent-field/,
      { timeout: 20000 },
    );
    await expect(germanTags).toContainText('design');
    await expect(
      germanTags.locator('input, textarea'),
      'nothing to type into on a translation',
    ).toHaveCount(0);

    // The page in the site's default language is where that value lives, so
    // there it is an ordinary field.
    await page.goto(`${helper.adminUrl}/en/about/edit`);
    await helper.openSidebarTab('Page');
    const englishTags = page.locator('#sidebar-metadata .field-wrapper-subjects');
    await expect(
      englishTags.locator('input').first(),
      'the default language owns it, and can change it',
    ).toBeVisible({ timeout: 20000 });
    await expect(englishTags).not.toHaveClass(/readonly-field/);
  });
});
