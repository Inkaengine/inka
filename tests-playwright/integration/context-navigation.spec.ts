/**
 * contextNavigation block tests.
 *
 * Structural checks ride on the /context-navigation-test-page fixture:
 *
 *  - A hand-built nav (3 navItems) verifies the rendering contract:
 *    <nav aria-label> > <ul> > <li><a class="nav-item">. The link whose
 *    href matches the current URL gets aria-current="page" + .current.
 *    Indent levels (.level-N) are derived from URL path depth — there
 *    is no manual `level` field on navItem.
 *
 *  - An auto-populated nav (listing child, variation=nav, path=/_test_data,
 *    depth=1) verifies that the depth field is honored — only direct
 *    children come back, no grand-children — and that listing items
 *    render via the same navItem template.
 *
 *  - The context-navigation-layout template, inserted via standard
 *    template-instance markers (templateId + templateInstanceId +
 *    slotId) on the pages under /context-navigation-forced-folder/.
 *    Exercises the template-merge path with a container block whose
 *    layout field is `items`, not `blocks_layout` — picked up by
 *    findBlocksLayoutField rather than a hardcoded field name.
 */
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

test.describe('contextNavigation block', () => {
  test('hand-built nav renders aria-label / aria-current / indent levels', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/context-navigation-test-page');

    const iframe = helper.getIframe();

    const nav = iframe.locator('[data-block-uid="nav-1"]');
    await expect(nav).toBeVisible({ timeout: 10_000 });

    // a11y contract: <nav aria-label="Section navigation">
    await expect(nav).toHaveAttribute('aria-label', 'Section navigation');

    // List semantics: <ul role="list"> > three <li>
    const list = nav.locator('ul.context-navigation-list');
    await expect(list).toBeVisible();
    await expect(list.locator('> li')).toHaveCount(3);

    // The self-pointing link should be the active one — aria-current
    // and the .current class both come from the renderer's path match.
    const selfLink = nav.locator('a[data-block-uid="item-self"]');
    await expect(selfLink).toHaveAttribute('aria-current', 'page');
    await expect(selfLink).toHaveClass(/\bcurrent\b/);

    // Non-matching links don't get aria-current.
    const otherLink = nav.locator('a[data-block-uid="item-test-page"]');
    await expect(otherLink).not.toHaveAttribute('aria-current', 'page');

    // Indent levels via .level-N — derived from URL path depth:
    //   /_test_data/context-navigation-test-page → 2 segs (shallowest)
    //   /_test_data/test-page                    → 2 segs
    //   /_test_data/test-page/sub                → 3 segs → level-2
    const child = nav.locator('a[data-block-uid="item-test-page-child"]');
    await expect(child).toHaveClass(/\blevel-2\b/);
    await expect(selfLink).toHaveClass(/\blevel-1\b/);
  });

  test('summary renders as section header on desktop; both summary + list visible', async ({ page }) => {
    // The cnav <summary> doubles as the visible section header (the
    // editable block.ariaLabel text). On desktop it's styled as a
    // small-caps section label (Stripe/MDN/Primer pattern) with the
    // disclosure chevron hidden; on mobile it's the disclosure tap
    // target (pill background + chevron). Both look different but the
    // element is the same — keeps the [data-edit-text] for ariaLabel
    // discoverable to the bridge in either viewport.
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/context-navigation-test-page');

    const iframe = helper.getIframe();
    const nav = iframe.locator('[data-block-uid="nav-1"]');
    await expect(nav).toBeVisible({ timeout: 10_000 });

    const summary = nav.locator('summary.context-navigation-summary');
    await expect(summary).toBeVisible();

    // Desktop styling: small-caps muted label, NOT a pill. The native
    // disclosure marker (::-webkit-details-marker / list-style) is
    // hidden so it doesn't look like a clickable disclosure.
    const summaryStyle = await summary.evaluate((el) => {
      const s = window.getComputedStyle(el);
      return { textTransform: s.textTransform, listStyle: s.listStyle };
    });
    expect(summaryStyle.textTransform, 'desktop header uppercases').toBe('uppercase');

    // List is also visible (details is open at desktop via matchMedia).
    const list = nav.locator('ul.context-navigation-list');
    await expect(list).toBeVisible();
  });

  test('context-navigation-layout template-merge: inserted-template fixture renders the fixed cnav block + body slot', async ({ page }) => {
    // page-a/data.json opts into the context-navigation-layout template
    // via the standard inserted-template pattern (templateId +
    // templateInstanceId + slotId on the body block) — same shape as
    // inserted-template-test-page. No path-based force-rule.
    //
    // Why the fixture exists: the template's tpl-context-nav block uses
    // `items: { items: [...] }` (not `blocks_layout`) for its layout
    // field. The merge code can't hardcode the field name — it has to
    // detect it by shape via findBlocksLayoutField. If that detection
    // regresses, the cnav's listing child won't expand and this test's
    // sibling-link assertions below will fail loudly.
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/context-navigation-forced-folder/page-a');

    const iframe = helper.getIframe();
    const forcedNav = iframe.locator('nav[aria-label="In this section"]');
    await expect(forcedNav).toBeVisible({ timeout: 10_000 });

    // The listing inside resolves `relativePath: ..` against the current
    // page, so depth=1 returns the siblings page-a and page-b.
    const links = forcedNav.locator('a.nav-item');
    await expect(links.first()).toBeVisible({ timeout: 10_000 });

    const hrefs = await links.evaluateAll((els) => els.map((el) => el.getAttribute('href')));
    expect(hrefs).toContain('/_test_data/context-navigation-forced-folder/page-a');
    expect(hrefs).toContain('/_test_data/context-navigation-forced-folder/page-b');

    // The current page link gets aria-current="page" via the renderer's
    // path match — the URL-based active-state logic must work whether
    // the contextNavigation came from the page or the template.
    const currentLink = forcedNav.locator('a[aria-current="page"]');
    await expect(currentLink).toHaveAttribute('href', '/_test_data/context-navigation-forced-folder/page-a');

    // The page's own body content is still rendered after the forced nav.
    await expect(iframe.getByText('Body of page A.')).toBeVisible();
  });

  test('expandCurrentOnly hides descendants of unrelated siblings', async ({ page }) => {
    // Fixture tree under context-navigation-forced-folder (depth 4 listing):
    //   page-a
    //   page-a/deep-1
    //   page-b
    //   page-b/under-b   ← descendant of an unrelated sibling
    //
    // When viewing page-a, the smart-expansion filter (expandCurrentOnly
    // default true on the forced contextNavigation) should hide
    // /page-b/under-b — it sits under page-b, which isn't on the
    // ancestor chain of the current page. page-b itself (sibling of
    // current) stays.
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/context-navigation-forced-folder/page-a');

    const iframe = helper.getIframe();
    const forcedNav = iframe.locator('nav[aria-label="In this section"]');
    await expect(forcedNav.locator('a.nav-item').first()).toBeVisible({ timeout: 10_000 });

    const hrefs = await forcedNav.locator('a.nav-item').evaluateAll((els) =>
      els.map((el) => el.getAttribute('href')),
    );
    expect(hrefs).toContain('/_test_data/context-navigation-forced-folder/page-a');
    expect(hrefs).toContain('/_test_data/context-navigation-forced-folder/page-b');
    expect(hrefs).toContain('/_test_data/context-navigation-forced-folder/page-a/deep-1');
    // Filtered out: descendant of unrelated sibling page-b.
    expect(hrefs).not.toContain('/_test_data/context-navigation-forced-folder/page-b/under-b');
  });

  test('children of an exclude_from_nav folder are dropped (not shown as orphan roots)', async ({ page }) => {
    // Fixture under context-navigation-forced-folder/page-a:
    //   hidden-child            ← exclude_from_nav=true (folder)
    //   hidden-child/orphan-grandchild   ← NOT excluded (leaf)
    //
    // The cnav listing's exclude_from_nav=isFalse criterion drops
    // hidden-child but its child orphan-grandchild is still returned.
    // Naive hierarchical sort would put orphan-grandchild at the top of
    // cnav as a root (its parent isn't in the result). Author intent:
    // marking a folder as "hide from nav" should hide its whole subtree.
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/context-navigation-forced-folder/page-a');

    const iframe = helper.getIframe();
    const forcedNav = iframe.locator('nav[aria-label="In this section"]');
    await expect(forcedNav.locator('a.nav-item').first()).toBeVisible({ timeout: 10_000 });

    const hrefs = await forcedNav.locator('a.nav-item').evaluateAll((els) =>
      els.map((el) => el.getAttribute('href')),
    );
    expect(hrefs).not.toContain('/_test_data/context-navigation-forced-folder/page-a/hidden-child');
    expect(hrefs, 'orphan-grandchild must not appear: ancestor is exclude_from_nav').not.toContain(
      '/_test_data/context-navigation-forced-folder/page-a/hidden-child/orphan-grandchild',
    );
  });

  test('includeTop prepends the section root as the first nav item', async ({ page }) => {
    // nav-5 (on context-navigation-test-page) sets includeTop:true. The
    // listing fetches /_test_data/context-navigation-forced-folder/* —
    // the renderer derives the section root from the shallowest items'
    // parent (/_test_data/context-navigation-forced-folder) and
    // prepends it as the first <a>.
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/context-navigation-test-page');

    const iframe = helper.getIframe();
    const nav = iframe.locator('[data-block-uid="nav-5"]');
    await expect(nav).toBeVisible({ timeout: 10_000 });

    const links = nav.locator('a.nav-item');
    await expect(links.first()).toBeVisible({ timeout: 10_000 });
    const firstHref = await links.first().getAttribute('href');
    expect(firstHref).toBe('/_test_data/context-navigation-forced-folder');
  });

test('listing-derived level + hierarchical sort: depth=2 listing renders mixed levels in parent-then-children order', async ({ page }) => {
    // nav-4 fetches /context-navigation-forced-folder with depth=2 →
    //   page-a, page-b (depth 3 = 3 path segs)     → minDepth → level-1
    //   page-a/deep-1   (depth 4)                   → level-2
    //
    // The fixture's __metadata__.json sets page-b at position 0 and
    // page-a at position 1 — so a flat sort by getObjPositionInParent
    // alone (without the hierarchical post-sort in ploneFetchItems)
    // would slot deep-1 (position 0 inside page-a) between page-b (0)
    // and page-a (1), giving [page-b, deep-1, page-a]. The post-sort
    // restores hierarchical order: [page-b, page-a, deep-1] —
    // parent-then-its-subtree-then-next-parent.
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/context-navigation-test-page');

    const iframe = helper.getIframe();
    const nav = iframe.locator('[data-block-uid="nav-4"]');
    await expect(nav).toBeVisible({ timeout: 10_000 });

    const linkA = nav.locator('a[href="/_test_data/context-navigation-forced-folder/page-a"]');
    const linkB = nav.locator('a[href="/_test_data/context-navigation-forced-folder/page-b"]');
    const linkDeep = nav.locator('a[href="/_test_data/context-navigation-forced-folder/page-a/deep-1"]');

    await expect(linkA).toBeVisible({ timeout: 10_000 });
    await expect(linkA).toHaveClass(/\blevel-1\b/);
    await expect(linkB).toHaveClass(/\blevel-1\b/);
    await expect(linkDeep).toHaveClass(/\blevel-2\b/);

    // Hierarchical order: page-b (pos 0), then page-a (pos 1) and its
    // subtree (deep-1). deep-1 must appear AFTER page-a, never sandwiched
    // between page-b and page-a — that's the failure mode without the
    // post-sort.
    const hrefs = await nav.locator('a.nav-item').evaluateAll((els) =>
      els.map((el) => el.getAttribute('href')),
    );
    const pageBIdx = hrefs.indexOf('/_test_data/context-navigation-forced-folder/page-b');
    const pageAIdx = hrefs.indexOf('/_test_data/context-navigation-forced-folder/page-a');
    const deepIdx = hrefs.indexOf('/_test_data/context-navigation-forced-folder/page-a/deep-1');
    expect(pageBIdx, 'page-b present').toBeGreaterThanOrEqual(0);
    expect(pageAIdx, 'page-a present').toBeGreaterThanOrEqual(0);
    expect(deepIdx, 'deep-1 present').toBeGreaterThanOrEqual(0);
    expect(pageBIdx, 'page-b before page-a (position-0 first)').toBeLessThan(pageAIdx);
    expect(pageAIdx, 'page-a before its child deep-1 (hierarchical)').toBeLessThan(deepIdx);
  });

  test('bridge expose: selecting the hidden listing block opens its containing disclosure', async ({ page }) => {
    // Companion to the navItem version below. The cnav <summary>'s
    // data-block-selector word-list includes every direct child block
    // uid — including listing children whose rendered output is the
    // synthesised nav items (NOT a wrapper DOM element for the listing
    // itself). So the listing block has no own DOM, yet the admin can
    // still "select" it via SELECT_BLOCK, and the bridge needs to find
    // the right <summary> to open via the word-list match.
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/context-navigation-test-page');

    const iframe = helper.getIframe();
    // nav-2 has a single listing child with uid 'snav-listing' (per
    // the fixture). Confirm the cnav details is mounted, then narrow
    // viewport so matchMedia closes it.
    const cnav = iframe.locator('[data-block-uid="nav-2"]');
    await expect(cnav).toBeAttached({ timeout: 10_000 });
    await page.setViewportSize({ width: 375, height: 800 });
    const details = cnav.locator('details');
    await expect.poll(
      async () => details.evaluate((d: HTMLDetailsElement) => d.open),
      { timeout: 5000 },
    ).toBe(false);

    // Sanity: the summary's data-block-selector lists snav-listing.
    const selectorAttr = await cnav.locator('summary').getAttribute('data-block-selector');
    expect(selectorAttr, 'summary exposes listing uid').toContain('snav-listing');

    // Drive selection of the listing block — it has no visible DOM
    // element of its own; the bridge looks for any element with that
    // uid in its data-block-selector word-list (the <summary>) and
    // opens the enclosing <details>.
    await page.evaluate(() => {
      const iframeEl = document.querySelector('iframe');
      iframeEl.contentWindow.postMessage({ type: 'SELECT_BLOCK', uid: 'snav-listing' }, '*');
    });

    await expect.poll(
      async () => details.evaluate((d: HTMLDetailsElement) => d.open),
      { timeout: 5000 },
    ).toBe(true);
  });

  test('bridge expose: at mobile viewport, selecting hidden navItem opens the disclosure', async ({ page }) => {
    // Companion to the carousel test in container-blocks.spec.ts:
    //   'clicking hidden slide in sidebar ChildBlocksWidget selects it'
    // — but for the contextNavigation's <details>/<summary> disclosure.
    // Exercises the bridge's word-list `data-block-selector~=` match +
    // the SUMMARY special-case that flips `details.open = true`.
    //
    // Load the admin at its default desktop viewport so the layout
    // renders normally; the cnav's `<details>` opens at desktop width
    // via matchMedia. THEN we narrow the viewport below the 768px
    // breakpoint — the iframe's matchMedia('change') listener fires
    // and closes the disclosure, matching what a user crossing the
    // breakpoint via devtools / resize would see. The bridge expose
    // path then runs against a genuinely closed disclosure.
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/context-navigation-test-page');

    const iframe = helper.getIframe();
    const cnav = iframe.locator('[data-block-uid="nav-1"]');
    await expect(cnav).toBeAttached({ timeout: 10_000 });

    // Now shrink to mobile — the iframe's matchMedia listener flips
    // `details.open = false` because the (min-width: 768px) media query
    // no longer matches.
    await page.setViewportSize({ width: 375, height: 800 });

    const details = cnav.locator('details');
    await expect(details).toBeAttached();
    await expect.poll(
      async () => details.evaluate((d: HTMLDetailsElement) => d.open),
      { timeout: 5000, message: 'matchMedia should close <details> at mobile viewport' },
    ).toBe(false);

    const childLink = cnav.locator('a.nav-item').first();
    await expect(childLink).toBeAttached();
    const childUid = await childLink.getAttribute('data-block-uid');
    expect(childUid).toBeTruthy();
    await expect(childLink).toBeHidden();

    // Drive selection of the hidden navItem the same way the admin would —
    // postMessage SELECT_BLOCK to the iframe. The bridge's selectBlock
    // handler will see the target is not visible, find the <summary>
    // whose `data-block-selector` word-list contains childUid, and
    // flip `details.open = true`.
    await page.evaluate((uid) => {
      const iframeEl = document.querySelector('iframe');
      iframeEl.contentWindow.postMessage({ type: 'SELECT_BLOCK', uid }, '*');
    }, childUid);

    // Bridge expose: <details> is now open and the navItem visible.
    await expect.poll(
      async () => details.evaluate((d: HTMLDetailsElement) => d.open),
      { timeout: 5000 },
    ).toBe(true);
    await expect(childLink).toBeVisible();
  });

  test('inline edit: clicking the summary heading (a data-block-selector element) starts text editing', async ({ page }) => {
    // The <summary> is BOTH the reveal trigger (data-block-selector, so
    // selecting a hidden child opens the disclosure) and the block's editable
    // heading ([data-edit-text="ariaLabel"] inside it). The renderer promises
    // authors can inline-edit it: "clicking the span fires <details>'s native
    // toggle as a side-effect, but the summary stays visible whether open or
    // closed, so editing continues without losing the cursor."
    //
    // That is the shape of every component whose reveal trigger doubles as its
    // heading — accordion panel titles, tab labels — and it must survive the
    // reveal: click, then the caret is in the heading.
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/context-navigation-test-page');

    const iframe = helper.getIframe();
    const nav = iframe.locator('[data-block-uid="nav-1"]');
    await expect(nav).toBeVisible({ timeout: 10_000 });

    // Sanity: this really is the both-attributes case the test is about.
    // Without it a fixture change could quietly turn this into a plain
    // inline-editing test that passes for the wrong reason.
    const summary = nav.locator('summary.context-navigation-summary');
    await expect(summary).toHaveAttribute('data-block-selector', /nav-1/);
    const heading = summary.locator('[data-edit-text="ariaLabel"]');
    await expect(heading).toBeVisible();

    // Start from BLOCK mode. A plain click recomputes the mode from "does this
    // block own text" — but the data-block-selector branch returns before that,
    // so it only ever worked when text mode leaked in from a previous
    // selection. Escape from the auto-selected first block is the shortest way
    // to the state an author reaches by pressing Escape, using the ⬆ button, or
    // selecting a container (a block with no text of its own) first.
    await helper.escapeFromEditing();

    // Click between "Section" and "navigation" — NOT at either end, so a caret
    // that defaulted to the start or the end of the field is distinguishable
    // from one placed at the click point.
    const caretAt = 'Section '.length;
    const clickPoint = await helper.getClickPositionForCharacter(heading, caretAt);
    expect(clickPoint, 'measured a click point inside the heading text').not.toBeNull();
    await heading.click({ position: clickPoint! });

    // The bridge writes contenteditable explicitly as "true"/"false" — a
    // missing attribute and contenteditable="" both read as "" from
    // Playwright, so only "true" proves the bridge promoted the field.
    await expect(heading).toHaveAttribute('contenteditable', 'true', { timeout: 5000 });

    // The admin has to agree that we're in TEXT mode, which it reads purely
    // from focusedFieldName (subtle outline vs the block-mode border). Without
    // this the bridge can look right locally while the admin still shows a
    // block-mode toolbar — and any block with more than one editable field
    // would put the caret in the first one rather than the one clicked.
    await expect(page.locator('.volto-hydra-block-outline[data-outline-style="subtle"]')).toBeVisible({
      timeout: 5000,
    });

    // Editable is not enough: the caret has to be IN it, or the author's first
    // keystroke goes to the body and gets buffered instead of typed.
    await expect
      .poll(
        async () =>
          heading.evaluate((el) => el === document.activeElement || el.contains(document.activeElement)),
        { timeout: 5000, message: 'caret should be inside the heading after clicking it' },
      )
      .toBe(true);

    // And typing lands on the canvas AT THE CLICK POINT. The reveal path has to
    // carry the click coordinates through too, or the author clicks mid-word and
    // types at the start of the field.
    await page.keyboard.type('X');
    await expect(heading).toHaveText('Section Xnavigation', { timeout: 5000 });
  });

  test('listing child with depth=1 returns direct children only', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/context-navigation-test-page');

    const iframe = helper.getIframe();
    const topNav = iframe.locator('[data-block-uid="nav-2"]');
    await expect(topNav).toBeVisible({ timeout: 10_000 });

    // Listing fetches direct children of /_test_data — the fixture
    // has many siblings. Depth limits the result set; we don't assert
    // an exact count because the fixture grows over time, only that:
    //   1. at least one link is present (depth filter didn't kill the result),
    //   2. no link's href contains a deeper path under /_test_data
    //      (depth=1 must reject /a/b style nested grand-children).
    const links = topNav.locator('a.nav-item');
    await expect(links.first()).toBeVisible({ timeout: 10_000 });
    const count = await links.count();
    expect(count).toBeGreaterThan(0);

    const hrefs = await links.evaluateAll((els) => els.map((el) => el.getAttribute('href')));
    for (const href of hrefs) {
      if (!href) continue;
      // direct children of /_test_data have exactly 2 segments
      const segs = href.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
      expect(segs.length, `link ${href} should be at depth 1 under /_test_data`).toBeLessThanOrEqual(2);
    }
  });
});
