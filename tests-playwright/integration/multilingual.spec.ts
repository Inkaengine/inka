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
    await page
      .frameLocator('#translationSourceIframe')
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
});
