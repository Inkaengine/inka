/**
 * End-to-end for the per-region slate style allow-list (#295).
 *
 * Fixture: /restricted-styles-page. Its `items` region declares
 * `disallowedStyles: ['blockquote', 'b']` and the frontend passes
 * `styleAliases: { b: 'strong' }` via voltoConfig — so this page is restricted
 * while every other admin-mock fixture stays unrestricted, which is also what
 * makes the last test a real guard: the feature has to stay opt-in.
 *
 * The keyboard surfaces (markdown shortcut, format hotkey) are covered
 * deterministically in tests-playwright/unit/slateStyleGating.spec.ts — they
 * turn on a bridge predicate, not on admin rendering.
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

/** Titles offered by the block-format dropdown for the given block. */
async function formatOptions(page, helper: AdminUIHelper, blockId: string) {
  await helper.clickBlockInIframe(blockId);
  const trigger = page.locator('.quanta-toolbar .format-dropdown-trigger');
  await expect(trigger).toBeVisible();
  await trigger.click();
  const menu = page.locator('.format-dropdown-menu');
  await expect(menu).toBeVisible();
  return await menu
    .locator('.format-dropdown-item')
    .evaluateAll((items) => items.map((i) => i.getAttribute('title')));
}

test.describe('slate style allow-list', () => {
  // The restricted-styles fixture's rules, its style menu and its column
  // override are declared by the MOCK test frontend only — a page-path switch in
  // its index.html. On admin-nuxt / admin-nextjs / admin-f7 the same content is
  // served by a frontend that declares none of it, so every assertion here is
  // about a configuration that isn't present. Same idiom as dnd-convert's
  // mock-only conversion blocks.
  test.beforeEach(({}, testInfo) => {
    test.skip(
      testInfo.project.name !== 'admin-mock',
      'the restricted-styles configuration is declared by the mock frontend',
    );
  });
  test('the format dropdown drops a disallowed style and keeps the rest', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/restricted-styles-page');
    await helper.waitForIframeReady();

    const titles = await formatOptions(page, helper, 'target');
    expect(titles.some((t) => t?.toLowerCase().includes('quote'))).toBe(false);
    // The dropdown still works — this is a filter, not an empty menu.
    expect(titles).toContain('Title');
  });

  test('an inline style is filtered out of the toolbar too', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/restricted-styles-page');
    await helper.waitForIframeReady();

    await helper.clickBlockInIframe('target');
    const toolbar = page.locator('.quanta-toolbar');
    // Bold survives; strikethrough (`del`) is denied. volto-slate models both as
    // inline ELEMENTS, so one allow-list covers block and inline formats alike.
    await expect(toolbar.locator('[data-toolbar-button="bold"]')).toHaveCount(1);
    await expect(toolbar.locator('[data-toolbar-button="strikethrough"]')).toHaveCount(0);
  });

  test('an ALLOWED format still applies on a restricted page', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/restricted-styles-page');
    await helper.waitForIframeReady();

    const iframe = helper.getIframe();
    const block = iframe.locator('[data-block-uid="target"]');
    await expect(block.locator('h2')).toHaveCount(0);

    await helper.clickBlockInIframe('target');
    const editableField = await helper.getEditorLocator('target');
    await editableField.click();

    const toolbar = page.locator('.quanta-toolbar');
    await toolbar.locator('.format-dropdown-trigger').click();
    const dropdownMenu = page.locator('.format-dropdown-menu');
    await expect(dropdownMenu).toBeVisible({ timeout: 5000 });
    await dropdownMenu.getByRole('button', { name: 'Title', exact: true }).click();

    // Filtering the menu must not break applying what's left in it.
    await expect(block.locator('h2')).toBeVisible({ timeout: 5000 });
    expect(await block.locator('h2').textContent()).toContain('paste here');
  });

  test('a format transform driven straight at the admin is refused', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/restricted-styles-page');
    await helper.waitForIframeReady();

    const iframe = helper.getIframe();
    await helper.clickBlockInIframe('target');
    const editableField = await helper.getEditorLocator('target');
    await editableField.click();

    // The toolbar button is gone and the hotkey is swallowed, so nothing a user
    // can do reaches this branch — which is the point of a backstop. Drive the
    // transform the way a NEW surface added later would, and it still has to be
    // refused at the place the format is actually written.
    await iframe.locator('body').evaluate((_el, blockId) => {
      (window as any).bridge.sendTransformRequest(blockId, 'format', { format: 'del' });
    }, 'target');

    const block = iframe.locator('[data-block-uid="target"]');
    // This frontend renders `del` as a line-through span.
    await expect(block.locator('span[style*="line-through"]')).toHaveCount(0);
    await expect(block).toContainText('paste here');
  });

  test('an unrestricted page still offers everything (the feature is opt-in)', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');
    await helper.waitForIframeReady();

    const titles = await formatOptions(page, helper, 'block-1-uuid');
    expect(titles.some((t) => t?.toLowerCase().includes('quote'))).toBe(true);
  });

  test('a stored node the region disallows is normalized when the page loads', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/restricted-styles-page');
    await helper.waitForIframeReady();

    // The fixture stores `b`; the alias map renames it to `strong`, which this
    // frontend renders as a font-weight span.
    const legacy = helper.getIframe().locator('[data-block-uid="legacy"]');
    await expect(legacy.locator('span[style*="font-weight: bold"]')).toHaveText('bold');
    await expect(legacy).toContainText('was bold');
  });

  test('pasting a disallowed element lands as a paragraph, text intact', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/restricted-styles-page');
    await helper.waitForIframeReady();

    const editor = await helper.enterEditMode('target');
    await helper.selectAllTextInEditor(editor);

    await editor.evaluate((el: HTMLElement) => {
      const dt = new DataTransfer();
      dt.setData('text/html', '<blockquote>quoted</blockquote><p>after</p>');
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });

    const iframe = helper.getIframe();
    await expect(iframe.locator('[data-block-uid]')).toContainText(['quoted']);
    // Nothing was dropped, and nothing arrived as a blockquote.
    await expect(iframe.locator('blockquote')).toHaveCount(0);
    await expect(iframe.locator('body')).toContainText('after');
  });
});

/**
 * The style menu — how a design system's OWN styles reach an author.
 *
 * Volto ships the menu and both toolbars list it, but hydra's canvas toolbar
 * intercepts mousedown on its buttons to flush the iframe's text buffer before
 * a format applies. A dropdown is not a format button, so "it is in the list"
 * is not evidence that picking a style works. This checks the whole path:
 * the menu opens, a style applies, and the frontend renders the class.
 */
test.describe('design-system style menu', () => {
  // The restricted-styles fixture's rules, its style menu and its column
  // override are declared by the MOCK test frontend only — a page-path switch in
  // its index.html. On admin-nuxt / admin-nextjs / admin-f7 the same content is
  // served by a frontend that declares none of it, so every assertion here is
  // about a configuration that isn't present. Same idiom as dnd-convert's
  // mock-only conversion blocks.
  test.beforeEach(({}, testInfo) => {
    test.skip(
      testInfo.project.name !== 'admin-mock',
      'the restricted-styles configuration is declared by the mock frontend',
    );
  });
  test('a block style applies and reaches the rendered element', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/restricted-styles-page');
    await helper.waitForIframeReady();

    const iframe = helper.getIframe();
    const block = iframe.locator('[data-block-uid="target"]');
    await expect(block.locator('.lead')).toHaveCount(0);

    await helper.clickBlockInIframe('target');
    const editor = await helper.getEditorLocator('target');
    await editor.click();

    const trigger = page.locator('.quanta-toolbar #style-menu');
    await expect(trigger, 'the style menu is in toolbarButtons — it should render').toBeVisible();
    await trigger.click();

    const lead = page.locator('.block-style-lead');
    await expect(lead).toBeVisible();
    await lead.click();

    // The class the design system styles on, on the element the author edited.
    await expect(iframe.locator('[data-block-uid="target"] .lead, [data-block-uid="target"].lead'))
      .toHaveCount(1, { timeout: 5000 });
  });
});

/**
 * Design-system styles in the SIDEBAR, where the design system's CSS does not
 * exist.
 *
 * volto-slate applies the classes there (render.jsx puts `styleName` on the
 * element and each `style-*` mark on the leaf), but Volto never loads the site's
 * stylesheet, so they resolve to nothing: the author picks a style and sees no
 * change at all. hydra labels them from what the style menu declares.
 *
 * Asserting the generated CSS *string* proves nothing — the rules can be perfect
 * and still apply to no element, which is exactly the bug an earlier version of
 * this had (the shared appearance hung on an attribute nothing sets). So this
 * reads the COMPUTED pseudo-element content off the real sidebar editor.
 */
test.describe('style markers in the sidebar', () => {
  // The restricted-styles fixture's rules, its style menu and its column
  // override are declared by the MOCK test frontend only — a page-path switch in
  // its index.html. On admin-nuxt / admin-nextjs / admin-f7 the same content is
  // served by a frontend that declares none of it, so every assertion here is
  // about a configuration that isn't present. Same idiom as dnd-convert's
  // mock-only conversion blocks.
  test.beforeEach(({}, testInfo) => {
    test.skip(
      testInfo.project.name !== 'admin-mock',
      'the restricted-styles configuration is declared by the mock frontend',
    );
  });
  test('a styled run is marked at both ends, and names itself when clicked', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/restricted-styles-page');
    await helper.waitForIframeReady();

    await helper.clickBlockInIframe('styled');
    const sidebarEditor = helper.getSidebarSlateEditor('value');
    await expect(sidebarEditor).toBeVisible({ timeout: 10000 });

    const read = (cls: string, pseudo: string) =>
      sidebarEditor.evaluate(
        (root: HTMLElement, [c, p]: string[]) => {
          const el = root.querySelector(`.${c}`);
          return el ? getComputedStyle(el, p).content : '(no element)';
        },
        [cls, pseudo],
      );

    // WAIT ON THE RIGHT THING. The stylesheet is installed when the frontend's
    // voltoConfig is merged at INIT, which can land after the sidebar editor is
    // visible — so reading a computed marker straight away races it, and the
    // NEGATIVE assertions below would pass for the wrong reason if it lost.
    // Wait until a marker is actually applied; everything else is then readable
    // in one go, with nothing left in flight.
    await expect
      .poll(() => read('lead', '::before'), { timeout: 10000 })
      .toContain('\u00AB');

    const marks = await sidebarEditor.evaluate((root: HTMLElement) => {
      const at = (c: string, p: string) => {
        const el = root.querySelector(`.${c}`);
        return el ? getComputedStyle(el, p).content : '(no element)';
      };
      return {
        leadOpen: at('lead', '::before'),
        leadClose: at('lead', '::after'),
        capOpen: at('dropcap', '::before'),
        capClose: at('dropcap', '::after'),
      };
    });

    // A block style and an inline mark claim different things — a paragraph
    // versus a run inside one — so they are marked differently: doubles for the
    // wider scope, singles for the narrower.
    expect(marks.leadOpen, 'block style opens with «').toContain('\u00AB');
    expect(marks.leadClose, 'block style closes with »').toContain('\u00BB');
    expect(marks.capOpen, 'inline mark opens with ‹').toContain('\u2039');
    expect(marks.capClose, 'inline mark closes with ›').toContain('\u203A');
    // …and neither names itself until it is clicked. Meaningful now: the
    // stylesheet is known applied, so an absent name is a real absence.
    expect(marks.leadClose).not.toContain('Lead');
    expect(marks.capClose).not.toContain('Drop cap');

    // Clicking into the run is when you want to know which style it is.
    await sidebarEditor.locator('.dropcap').click();
    await expect
      .poll(() => read('dropcap', '::after'), { timeout: 5000 })
      .toContain('Drop cap');

    // Only one at a time — clicking elsewhere closes it again.
    await sidebarEditor.locator('.lead').click({ position: { x: 200, y: 5 } });
    await expect
      .poll(() => read('dropcap', '::after'), { timeout: 5000 })
      .not.toContain('Drop cap');
  });
});

test.describe('style menu in the sidebar toolbar', () => {
  // The restricted-styles fixture's rules, its style menu and its column
  // override are declared by the MOCK test frontend only — a page-path switch in
  // its index.html. On admin-nuxt / admin-nextjs / admin-f7 the same content is
  // served by a frontend that declares none of it, so every assertion here is
  // about a configuration that isn't present. Same idiom as dnd-convert's
  // mock-only conversion blocks.
  test.beforeEach(({}, testInfo) => {
    test.skip(
      testInfo.project.name !== 'admin-mock',
      'the restricted-styles configuration is declared by the mock frontend',
    );
  });
  test('a style can be applied from the sidebar, and shows there', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/restricted-styles-page');
    await helper.waitForIframeReady();

    await helper.clickBlockInIframe('target');
    await helper.waitForSidebarOpen();

    const sidebarEditor = helper.getSidebarSlateEditor('value');
    await expect(sidebarEditor).toBeVisible({ timeout: 10000 });
    // Nothing is styled yet — otherwise the assertion at the end proves nothing.
    await expect(sidebarEditor.locator('.lead')).toHaveCount(0);

    await sidebarEditor.click();
    await sidebarEditor.press('ControlOrMeta+a');

    const toolbar = await helper.waitForSidebarSlateToolbar();
    const trigger = page.locator('.slate-inline-toolbar:not(.quanta-toolbar) #style-menu');
    await expect(
      trigger,
      'styleMenu is in expandedToolbarButtons — the sidebar toolbar should offer it',
    ).toBeVisible({ timeout: 5000 });
    await trigger.click();

    const lead = page.locator('.style-dropdown-menu .block-style-lead');
    await expect(lead).toBeVisible({ timeout: 5000 });
    await lead.click();

    // Applied to the value, and visible where the author is working — the label
    // is what stands in for the design system's CSS, which Volto never loads.
    const styled = sidebarEditor.locator('.lead');
    await expect(styled).toHaveCount(1, { timeout: 5000 });
    // Marked, so the author can see a style took — the marker stands in for the
    // design system's CSS, which Volto never loads. The NAME is on click, and is
    // covered by the markers test above.
    await expect
      .poll(
        () => styled.evaluate((el) => getComputedStyle(el, '::before').content),
        { timeout: 5000 },
      )
      .toContain('\u00AB');
    expect(toolbar).toBeTruthy();
  });
});

/**
 * Inheritance, through a real nested container.
 *
 * The fold is unit-tested, but "deny accumulates, allow replaces" is the rule an
 * author actually meets, and it had never been driven through the editor. The
 * page denies `blockquote`; the COLUMN's own region re-lists it in
 * `allowedStyles`. A nested region must not be able to re-allow what an ancestor
 * banned — and its allow half must still work, or the test proves only that
 * everything is off.
 */
test.describe('region rules inherit into nested containers', () => {
  // The restricted-styles fixture's rules, its style menu and its column
  // override are declared by the MOCK test frontend only — a page-path switch in
  // its index.html. On admin-nuxt / admin-nextjs / admin-f7 the same content is
  // served by a frontend that declares none of it, so every assertion here is
  // about a configuration that isn't present. Same idiom as dnd-convert's
  // mock-only conversion blocks.
  test.beforeEach(({}, testInfo) => {
    test.skip(
      testInfo.project.name !== 'admin-mock',
      'the restricted-styles configuration is declared by the mock frontend',
    );
  });
  test('a nested region cannot re-allow what the page denied', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/restricted-styles-page');
    await helper.waitForIframeReady();

    const titles = await formatOptions(page, helper, 'deep');
    // The allow half took effect for this subtree…
    expect(titles, 'the column allows h2').toContain('Title');
    // …but the page-level deny survived two levels of nesting, even though the
    // column's own allowedStyles names blockquote.
    expect(
      titles.some((t) => t?.toLowerCase().includes('quote')),
      'blockquote was denied by the page and must stay denied inside the column',
    ).toBe(false);
  });
});

/**
 * Leaf MARKS. Nothing in the default toolbar produces one — the inline formats
 * are elements — so `allowedMarks`/`disallowedMarks` had no end-to-end cover at
 * all, only the normalizer's unit tests. Stored content can still carry them
 * (an import, a plugin), which is exactly when normalize-on-load matters.
 */
test.describe('disallowed leaf marks', () => {
  // The restricted-styles fixture's rules, its style menu and its column
  // override are declared by the MOCK test frontend only — a page-path switch in
  // its index.html. On admin-nuxt / admin-nextjs / admin-f7 the same content is
  // served by a frontend that declares none of it, so every assertion here is
  // about a configuration that isn't present. Same idiom as dnd-convert's
  // mock-only conversion blocks.
  test.beforeEach(({}, testInfo) => {
    test.skip(
      testInfo.project.name !== 'admin-mock',
      'the restricted-styles configuration is declared by the mock frontend',
    );
  });
  test('are stripped on load, keeping their text', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/restricted-styles-page');
    await helper.waitForIframeReady();
    await helper.waitForBridgeConnected();

    // Ask the bridge for the block as the editor now holds it — the mark is a
    // data concern, and this frontend has no rendering for it to observe.
    const frame = page.frames().find((f) => f !== page.mainFrame())!;
    const leaves = await frame.evaluate(() => {
      const data = (window as any).__hydraBridge?.getBlockData('marked');
      const out: any[] = [];
      const walk = (n: any) => {
        if (Array.isArray(n)) return n.forEach(walk);
        if (!n || typeof n !== 'object') return;
        if (typeof n.text === 'string') out.push({ ...n });
        (n.children || []).forEach(walk);
      };
      walk(data?.value);
      return out;
    });

    const texts = leaves.map((l: any) => l.text).join('');
    expect(texts, 'no text may be lost').toContain('kept');
    for (const leaf of leaves) {
      expect(Object.keys(leaf), 'the denied mark is gone').not.toContain('highlight');
    }
    // The allowed one is untouched — otherwise this passes by stripping everything.
    expect(leaves.some((l: any) => l.underline === true), 'an allowed mark survives').toBe(true);
  });
});

/**
 * The renderer's half of the contract.
 *
 * A frontend has to emit BOTH storage shapes or half a style menu silently does
 * nothing — `styleName` on the element, and the `style-<cssClass>` leaf marks
 * inline styles use. hydra's example frontend demonstrates it, and that was only
 * ever exercised through the sidebar tests, which read the ADMIN's rendering,
 * not the frontend's.
 */
test.describe('a frontend rendering design-system styles', () => {
  // The restricted-styles fixture's rules, its style menu and its column
  // override are declared by the MOCK test frontend only — a page-path switch in
  // its index.html. On admin-nuxt / admin-nextjs / admin-f7 the same content is
  // served by a frontend that declares none of it, so every assertion here is
  // about a configuration that isn't present. Same idiom as dnd-convert's
  // mock-only conversion blocks.
  test.beforeEach(({}, testInfo) => {
    test.skip(
      testInfo.project.name !== 'admin-mock',
      'the restricted-styles configuration is declared by the mock frontend',
    );
  });
  test('emits the class for both storage shapes', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/restricted-styles-page');
    await helper.waitForIframeReady();

    const block = helper.getIframe().locator('[data-block-uid="styled"]');
    // Block style: styleName on the element the block renders as — which may be
    // the block's own root, so ask the DOM rather than assuming a descendant.
    expect(
      await block.evaluate(
        (el: HTMLElement) => el.classList.contains('lead') || !!el.querySelector('.lead'),
      ),
      'the block style class is emitted',
    ).toBe(true);
    // Inline style: a leaf mark needs an element to hang the class on, so the
    // renderer has to wrap it — a bare text leaf has nowhere to put it.
    await expect(block.locator('.dropcap')).toHaveCount(1);
    await expect(block.locator('.dropcap')).toHaveText('D');
    // And the text either side is untouched.
    await expect(block).toContainText('Design-system styles');
  });
});
