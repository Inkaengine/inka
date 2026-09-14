/**
 * Admin layout across three breakpoints (desktop / tablet / mobile).
 *
 * Spec: docs/superpowers/specs/2026-06-08-mobile-tablet-admin-layout-design.md
 *
 * IMPORTANT — these tests assert USER-VISIBLE behavior, not raw
 * bounding-box coordinates of named elements. A pure coordinate
 * assertion can pass even when an element is faded, covered by a
 * sibling, or unable to receive clicks. Each test below either:
 *   - calls toBeVisible() / toBeHidden() on the actual affordance, OR
 *   - performs the user action (click) and asserts the resulting
 *     state change, OR
 *   - asserts a layout invariant (no overlap, opacity > 0) that
 *     reflects what the editor actually sees.
 *
 * Breakpoints aligned with Volto's own (Semantic UI largestMobileScreen
 * = 767px). Going narrower than that triggers Volto's stock toolbar
 * collapse which fights any tablet-style rule we'd add — so we adopt
 * Volto's boundary instead of redoing the cascade fight.
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { test, expect } from '../fixtures';
import { URLS } from '../ports';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

// When CAPTURE_MOBILE_SCREENSHOTS=1, the four "snapshot" tests at the
// bottom of this file each save a viewport screenshot into the editor
// guide's _images dir. These tests intentionally re-use the
// already-proven admin-mock setup so the bridge handshake (which is
// flaky with Nuxt in headless capture) is reliable.
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SHOTS_OUT_DIR = path.join(
  SCRIPT_DIR,
  '..',
  '..',
  'docs',
  'what-editors-will-experience',
  '_images',
);
const CAPTURE_SHOTS = process.env.CAPTURE_MOBILE_SCREENSHOTS === '1';

test.describe('Admin layout — desktop control (≥1024px)', () => {
  test("desktop: the add '+' moves up onto the block rather than off the canvas", async ({
    page,
  }) => {
    // The '+' sits 8px BELOW the selected block. Nothing about that is mobile-specific:
    // scroll any block so its bottom meets the canvas edge and the button is drawn past
    // it. On mobile that lands on the bottom toolbar; on desktop it is simply off-canvas
    // and unclickable. The horizontal overflow has always been clamped (isConstrained
    // pulls the button back inside the block); this is the vertical counterpart.
    await page.setViewportSize({ width: 1280, height: 400 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Use a block partway DOWN the page. scrollIntoView({block:'end'}) can't push a
    // top-of-page block's bottom to the viewport bottom — there's nothing above it to
    // scroll — which is why anchoring this to block-1 passed on admin-mock's short page
    // but timed out on nuxt. block-3 has content both sides, so we can put its bottom
    // exactly on the canvas edge.
    await helper.clickBlockInIframe('block-3-uuid');

    const iframe = helper.getIframe();
    const block = iframe.locator('[data-block-uid="block-3-uuid"]');
    const addBtn = page.locator('.volto-hydra-add-button');
    await expect(addBtn).toBeVisible({ timeout: 10000 });

    // Drive the scroll deterministically: put the block's bottom on the iframe's
    // viewport bottom (the canvas edge) — the exact condition that would push the '+'
    // past it. hydra repositions the chrome on scroll, so poll until it settles.
    await block.evaluate((el) => {
      const r = el.getBoundingClientRect();
      window.scrollBy(0, r.bottom - window.innerHeight);
    });

    await expect
      .poll(
        async () => {
          const add = await addBtn.boundingBox();
          const blk = await block.boundingBox();
          const canvas = await page.locator('#previewIframe').boundingBox();
          if (!add || !blk || !canvas) return 'missing';
          const canvasBottom = canvas.y + canvas.height;
          if (blk.y + blk.height < canvasBottom - 40) return 'block not at canvas edge yet';
          if (add.y + add.height > canvasBottom + 1) return `'+' spills past canvas`;
          if (add.y + add.height > blk.y + blk.height + 1) return `'+' below the block`;
          return 'clamped onto block';
        },
        { timeout: 10000 },
      )
      .toBe('clamped onto block');
  });

  test('main toolbar pinned left, sidebar pinned right, drag handle visible, chevrons hidden', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');
    await helper.clickBlockInIframe('block-1-uuid');

    const toolbar = page.locator('#toolbar-body');
    const sidebar = page.locator('.sidebar-container');

    const tb = await toolbar.boundingBox();
    const sb = await sidebar.boundingBox();
    expect(tb!.x).toBeLessThan(50);
    expect(sb!.x + sb!.width).toBeGreaterThan(1280 - 50);
    expect(tb!.x + tb!.width).toBeLessThan(sb!.x);

    await expect(page.locator('.quanta-toolbar .drag-handle')).toBeVisible();
    await expect(page.locator('.quanta-toolbar .chevron-up')).toBeHidden();
    await expect(page.locator('.quanta-toolbar .chevron-down')).toBeHidden();
  });

  test('collapsed sidebar trigger sliver remains visible + clickable on desktop (stock Volto)', async ({
    page,
  }) => {
    // Counterpart to the mobile "no sidebar sliver on the right edge"
    // test: on desktop, Volto's stock .trigger sliver MUST stay
    // visible+clickable so editors can expand a collapsed sidebar from
    // the right edge. The mobile fix is scoped to max-width: 767px and
    // must not bleed into desktop.
    await page.setViewportSize({ width: 1280, height: 800 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const trigger = page.locator('.sidebar-container .trigger');
    await expect(trigger).toBeVisible();

    // Click to collapse, then assert the trigger is STILL visible (the
    // sliver) and is positioned somewhere inside the viewport (i.e.
    // unlike on mobile it is NOT pushed offscreen by the mobile fix).
    await trigger.click();
    await expect(page.locator('.sidebar-container.collapsed')).toBeAttached({
      timeout: 5000,
    });
    // Wait for the 300ms sidebar-slide transition to settle so bbox is stable.
    await expect(async () => {
      const tb = await trigger.boundingBox();
      expect(tb).not.toBeNull();
      expect(tb!.x, 'trigger inside viewport (not pushed offscreen)').toBeLessThan(
        1280,
      );
      expect(tb!.x + tb!.width, 'trigger inside viewport').toBeGreaterThan(0);
    }).toPass({ timeout: 3000 });
    await expect(trigger).toBeVisible();

    // Clicking the sliver re-expands — the affordance is functional, not
    // just visible.
    await trigger.click();
    await expect(page.locator('.sidebar-container.collapsed')).toHaveCount(0, {
      timeout: 5000,
    });
  });
});

/**
 * Mobile in LANDSCAPE orientation (per the user's mockup).
 *
 * The main toolbar rotates from a bottom horizontal bar (portrait) to
 * a right-edge vertical strip (landscape). Same icons, same sequence
 * from primary-CTA toward meta — just rotated 90°. Primary CTA (Edit
 * in view mode) stays at the strong-reach position: rightmost in
 * portrait → topmost in landscape.
 *
 * Media-query rule used:
 *   @media (orientation: landscape) and (max-width: 1023px)
 * This catches phones rotated to landscape and small tablets in
 * landscape; large tablets / desktop keep their own layout.
 */
test.describe('Admin layout — mobile landscape', () => {
  test('view mode: toolbar pinned to RIGHT edge as a vertical strip', async ({
    page,
  }) => {
    // iPhone-class viewport rotated to landscape.
    await page.setViewportSize({ width: 812, height: 375 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToView('/test-page');

    const tb = await page.locator('#toolbar-body').boundingBox();
    expect(tb).not.toBeNull();
    // Vertical strip: taller than wide.
    expect(tb!.height, 'toolbar must be taller than wide').toBeGreaterThan(
      tb!.width,
    );
    // Pinned to the right edge of the viewport (right edge ≥ 800).
    expect(
      tb!.x + tb!.width,
      'toolbar right edge must hug the viewport right',
    ).toBeGreaterThan(800);
  });

  test('view mode: Edit at TOP, User at BOTTOM (primary at top in landscape)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 812, height: 375 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToView('/test-page');

    const labels = await page.evaluate(() => {
      const inner = document.querySelector('#toolbar-body .toolbar-body');
      if (!inner) return [];
      return [...inner.querySelectorAll('button, a')]
        .map((b) => {
          const r = b.getBoundingClientRect();
          return {
            label: b.getAttribute('aria-label') || b.textContent?.trim() || '?',
            y: r.y,
            visible: r.width > 0 && r.height > 0,
          };
        })
        .filter((b) => b.visible)
        .sort((a, b) => a.y - b.y)
        .map((b) => b.label);
    });

    expect(
      labels,
      `landscape toolbar must match the designed top→bottom order. Got: ${labels.join(' → ')}`,
    ).toEqual([
      'Edit',
      'Contents',
      'Add',
      'More',
      'Frontend & Viewport',
      'Personal tools',
    ]);
  });
});

/**
 * Tablet PORTRAIT regression tests — the iPad Mini (768×1024) layout
 * the user screenshotted.
 *
 * Two bugs that had to be caught:
 *   1. Iframe was squashed to 313px wide because the tablet rule
 *      subtracted both the toolbar (80px) AND a phantom sidebar (375px)
 *      from the viewport, leaving most of the screen empty.
 *   2. The More button (⋯) rendered empty because semantic-ui's
 *      `.mobile.hidden` rule was hiding BOTH icon children at this
 *      breakpoint.
 */
test.describe('Admin layout — tablet portrait (768×1024)', () => {
  test('iframe canvas fills viewport minus right-edge toolbar', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToView('/test-page');

    const ic = await page.locator('#iframeContainer').boundingBox();
    const tb = await page.locator('#toolbar-body').boundingBox();
    expect(ic).not.toBeNull();
    expect(tb).not.toBeNull();

    // Toolbar pinned to the right edge as a vertical strip (~80px).
    expect(tb!.x + tb!.width, 'toolbar hugs right edge').toBeGreaterThan(760);
    expect(tb!.width, 'toolbar is a narrow strip').toBeLessThan(120);

    // Iframe fills from the left edge to just before the toolbar.
    expect(ic!.x, 'iframe starts at left edge').toBeLessThan(5);
    expect(
      ic!.width,
      `iframe must be at least 600px wide; got ${ic!.width.toFixed(0)}`,
    ).toBeGreaterThan(600);
    expect(ic!.x + ic!.width, 'iframe ends where toolbar begins').toBeLessThanOrEqual(
      tb!.x + 1,
    );
  });

  test('More button (⋯) renders a visible icon (semantic-ui mobile-hidden fix)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToView('/test-page');

    const more = page.locator('#toolbar-body .more');
    await expect(more).toBeVisible({ timeout: 5000 });

    // The button itself is 44×44 (other rules), but the regression
    // we're catching is that the SVG icon INSIDE has display:none
    // because semantic-ui's `.mobile.hidden` rule kicks in. Assert
    // that at least one svg inside the button is rendered (not none).
    const visibleSvgs = await more.locator('svg').evaluateAll((svgs) =>
      svgs.filter((s) => window.getComputedStyle(s).display !== 'none').length,
    );
    expect(
      visibleSvgs,
      'More button must render at least one visible SVG icon',
    ).toBeGreaterThan(0);
  });
});

test.describe('Admin layout — tablet (768–1023px)', () => {
  test('canvas / sidebar / toolbar columns do not overlap each other', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 900, height: 1024 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const toolbar = page.locator('#toolbar-body');
    const sidebar = page.locator('.sidebar-container');
    const iframe = page.locator('#previewIframe');

    const tb = await toolbar.boundingBox();
    const sb = await sidebar.boundingBox();
    const ib = await iframe.boundingBox();

    // Toolbar pinned to the right edge
    expect(tb!.x + tb!.width).toBeGreaterThan(900 - 5);
    // Sidebar ends where the toolbar begins (no horizontal overlap)
    expect(sb!.x + sb!.width).toBeLessThanOrEqual(tb!.x + 1);
    // Iframe ends where the sidebar begins (no horizontal overlap with sidebar)
    expect(ib!.x + ib!.width).toBeLessThanOrEqual(sb!.x + 1);
  });
});

test.describe('Admin layout — mobile (≤767px)', () => {
  // Mobile range extended to match Volto's own largestMobileScreen=767
  // breakpoint. Anything narrower triggers Volto's own toolbar collapse
  // (toolbar moves to top horizontally) which our tablet rules can't
  // unwind cleanly, so we treat that whole zone as mobile.

  test('Quanta is visible and stays visible at top (no fade) on block tap', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');
    await helper.clickBlockInIframe('block-1-uuid');

    const quanta = page.locator('.quanta-toolbar');
    await expect(quanta).toBeVisible();
    const qb = await quanta.boundingBox();
    expect(qb!.y).toBeLessThan(20); // pinned to top

    // Wait past the 5s desktop fade-timer; mobile must keep Quanta visible.
    await page.waitForTimeout(6000);
    await expect(quanta).toBeVisible();
    await expect(quanta).toHaveCSS('opacity', '1');
  });

  test('main toolbar pinned to bottom; iframe canvas occupies the space between', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');
    await helper.clickBlockInIframe('block-1-uuid');

    const quanta = page.locator('.quanta-toolbar');
    const toolbar = page.locator('#toolbar-body');
    const iframe = page.locator('#previewIframe');

    await expect(quanta).toBeVisible();
    await expect(toolbar).toBeVisible();
    await expect(iframe).toBeVisible();

    const tb = await toolbar.boundingBox();
    const ib = await iframe.boundingBox();
    const qb = await quanta.boundingBox();

    expect(tb!.y + tb!.height).toBeGreaterThan(812 - 20);
    // iframe canvas doesn't overlap toolbar or Quanta
    expect(ib!.y).toBeGreaterThanOrEqual(qb!.height - 1);
    expect(ib!.y + ib!.height).toBeLessThanOrEqual(tb!.y + 1);
  });

  test('mobile (700px in Volto-collapse zone) still uses the mobile layout', async ({
    page,
  }) => {
    // Regression: at 700px (Volto's stock-mobile zone), without proper
    // breakpoint alignment the toolbar collapses to top horizontally and
    // the user sees nothing like the spec'd mobile layout. Asserts our
    // mobile rules win at 700px too.
    await page.setViewportSize({ width: 700, height: 812 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');
    await helper.clickBlockInIframe('block-1-uuid');

    const toolbar = page.locator('#toolbar-body');
    const tb = await toolbar.boundingBox();
    // Toolbar at bottom (mobile layout) — NOT at top (Volto's stock collapse)
    expect(tb!.y + tb!.height).toBeGreaterThan(812 - 20);
    expect(tb!.y).toBeGreaterThan(400);
  });

  test('sidebar is collapsed (off-screen) by default on mobile', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    // .sidebar-container.collapsed has right:-355px (stock rule).
    await expect(page.locator('.sidebar-container.collapsed')).toBeAttached({
      timeout: 5000,
    });
    // Iframe canvas is reachable (not covered by sidebar)
    await expect(page.locator('#previewIframe')).toBeVisible();
  });

  test('no sidebar sliver on the right edge when collapsed', async ({
    page,
  }) => {
    // Stock Volto leaves a 20px sliver of the sidebar visible at the
    // right edge of the viewport on narrow screens (sidebar.less:114-121)
    // as a "trigger" to expand it. With the Settings shortcut in the
    // bottom toolbar, that sliver is redundant cruft. Regression: ensure
    // nothing of the collapsed sidebar (including its .trigger button)
    // sits inside the viewport's right edge.
    await page.setViewportSize({ width: 375, height: 812 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    await expect(page.locator('.sidebar-container.collapsed')).toBeAttached({
      timeout: 5000,
    });

    const sb = await page.locator('.sidebar-container.collapsed').boundingBox();
    expect(sb!.x, 'sidebar must be fully offscreen on the right').toBeGreaterThanOrEqual(
      375,
    );

    // The .trigger button (which is the stock sliver) must not be
    // visible to the editor on mobile.
    await expect(
      page.locator('.sidebar-container.collapsed .trigger'),
    ).toBeHidden();
  });

  test('⋯ menu opens as a bottom sheet with back-arrow that dismisses it', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');
    await helper.clickBlockInIframe('block-1-uuid');

    await page.locator('.quanta-toolbar button:has-text("⋯")').click();
    const menu = page.locator('.volto-hydra-dropdown-menu');
    await expect(menu).toBeVisible();
    const mb = await menu.boundingBox();
    expect(mb!.y + mb!.height).toBeGreaterThan(812 - 20);

    const back = page.locator('.volto-hydra-dropdown-menu .mobile-sheet-close');
    await expect(back).toBeVisible();
    await back.click();
    await expect(menu).not.toBeVisible({ timeout: 3000 });
  });

  test('⋯ menu bottom sheet: back-arrow at bottom-left, every menu item visible above it', async ({
    page,
  }) => {
    // The dismiss affordance is the ← back-arrow at the BOTTOM-LEFT
    // of the sheet (per the user's portrait mockups for both Add and
    // ⋯ menus). This regression test also asserts a second invariant
    // the earlier shipping path missed: every menu item must be fully
    // visible inside the viewport AND not horizontally overlap the
    // back-arrow's hit box (the old 70vh + cramped layout used to hide
    // "Remove" behind the dismiss button).
    await page.setViewportSize({ width: 375, height: 812 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');
    await helper.clickBlockInIframe('block-1-uuid');

    await page.locator('.quanta-toolbar button:has-text("⋯")').click();
    const menu = page.locator('.volto-hydra-dropdown-menu');
    await expect(menu).toBeVisible();
    const mb = await menu.boundingBox();
    const back = page.locator('.volto-hydra-dropdown-menu .mobile-sheet-close');
    await expect(back).toBeVisible();
    const bb = await back.boundingBox();

    // Back arrow lives in the BOTTOM half of the sheet AND in the LEFT
    // half (= bottom-left corner).
    expect(
      bb!.y - mb!.y,
      'back arrow should sit in the bottom half of the sheet',
    ).toBeGreaterThan(mb!.height / 2);
    expect(
      bb!.x - mb!.x,
      'back arrow should sit in the left half of the sheet',
    ).toBeLessThan(mb!.width / 2);

    // Every menu item must be FULLY visible (top and bottom inside the
    // viewport) — proves nothing is clipped at the sheet's bottom edge
    // (the old 70vh max-height + cramped layout hid "Remove").
    const items = page.locator('.volto-hydra-dropdown-menu .volto-hydra-dropdown-item');
    const count = await items.count();
    expect(count, 'menu should render its items').toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const ib = await items.nth(i).boundingBox();
      expect(
        ib!.y + ib!.height,
        `menu item ${i} must be inside the viewport`,
      ).toBeLessThanOrEqual(812);
      // And not under the back arrow (its top edge stays below the back
      // button's bottom edge OR is not horizontally overlapping it).
      const itemOverlapsBack =
        ib!.y < bb!.y + bb!.height &&
        ib!.y + ib!.height > bb!.y &&
        ib!.x < bb!.x + bb!.width &&
        ib!.x + ib!.width > bb!.x;
      expect(
        itemOverlapsBack,
        `menu item ${i} must not overlap the back arrow`,
      ).toBe(false);
    }
  });

  test('opening sidebar via ⋯ → Settings makes it full-screen; close button actually dismisses', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');
    await helper.clickBlockInIframe('block-1-uuid');

    await page.locator('.quanta-toolbar button:has-text("⋯")').click();
    await page.locator('.volto-hydra-dropdown-menu :text("Settings")').click();

    const sidebar = page.locator('.sidebar-container');
    await expect(sidebar).toBeVisible();
    await expect(async () => {
      const sb = await sidebar.boundingBox();
      expect(sb!.x).toBeLessThan(5);
      expect(sb!.x + sb!.width).toBeGreaterThan(370);
      expect(sb!.y).toBeLessThan(5);
      expect(sb!.y + sb!.height).toBeGreaterThan(800);
    }).toPass({ timeout: 3000 });

    // Regression: stock Volto's .trigger button is part of every
    // sidebar (it's the right-edge sliver on desktop). On mobile the
    // sheet doesn't need it — we have the X close in the page-header.
    // Worse, .trigger:before is a 4px blue highlight bar at left:0 which
    // used to leak through as a stray vertical line on the full-screen
    // sheet (visible in mobile-sidebar-fullscreen.png before the fix).
    await expect(
      sidebar.locator('.trigger'),
      'stock .trigger must not be visible on the mobile sidebar sheet',
    ).toBeHidden();

    // Close button must be visible AND clickable AND non-overlapping the
    // page-header title text (regression: user reported it overlapped).
    const close = sidebar.locator('.sidebar-close-button');
    await expect(close).toBeVisible();
    const closeBox = await close.boundingBox();
    const title = sidebar.locator('.section-title');
    const titleBox = await title.boundingBox();
    const overlap =
      closeBox!.x < titleBox!.x + titleBox!.width &&
      closeBox!.x + closeBox!.width > titleBox!.x &&
      closeBox!.y < titleBox!.y + titleBox!.height &&
      closeBox!.y + closeBox!.height > titleBox!.y;
    expect(overlap, 'close button must not overlap the title').toBe(false);

    await close.click();
    await expect(page.locator('.sidebar-container.collapsed')).toBeAttached({
      timeout: 5000,
    });
  });

  test('chevron ▼ moves the selected block down within its parent', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const initialOrder = await helper.getBlockOrder();
    await helper.clickBlockInIframe(initialOrder[0]);

    await expect(page.locator('.quanta-toolbar .drag-handle')).toBeHidden();
    const chevronDown = page.locator('.quanta-toolbar .chevron-down');
    await expect(chevronDown).toBeVisible();
    await chevronDown.click();

    await expect(async () => {
      const after = await helper.getBlockOrder();
      expect(after[0]).toBe(initialOrder[1]);
      expect(after[1]).toBe(initialOrder[0]);
    }).toPass({ timeout: 5000 });
  });

  test('chevron ▲ into a grid from below lands at the grid END, not the middle', async ({
    page,
  }) => {
    // A block sitting just below a grid, moved up, enters the grid from below.
    // It must land as the LAST child (the grid's end), not before the last child
    // (the "lands in the middle" bug). Entering a container from below = far edge.
    await page.setViewportSize({ width: 375, height: 812 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/grid-slates-test-page');

    const iframe = helper.getIframe();
    const gridOrder = () =>
      iframe
        .locator('[data-block-uid="gs-grid"] [data-block-uid]')
        .evaluateAll((els) => els.map((e) => e.getAttribute('data-block-uid')));

    expect(await gridOrder()).toEqual(['gs-slate-1', 'gs-slate-2', 'gs-slate-3']);

    // gs-after is the page-level slate directly below the grid.
    await iframe.locator('[data-block-uid="gs-after"]').first().click();
    const chevronUp = page.locator('.quanta-toolbar .chevron-up');
    await expect(chevronUp).toBeVisible();
    await chevronUp.click();

    await expect
      .poll(gridOrder)
      .toEqual(['gs-slate-1', 'gs-slate-2', 'gs-slate-3', 'gs-after']);
  });

  test('chevron ▼ into a grid from above enters at the START, not skips past it', async ({
    page,
  }) => {
    // Mirror of the up case. A block just above a grid, moved down, enters the
    // grid from above and must land as the FIRST child — one visual step. The bug:
    // it jumps PAST the whole grid (lands after it) because the flattened walk hits
    // the grid container before its children.
    await page.setViewportSize({ width: 375, height: 812 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/grid-slates-test-page');

    const iframe = helper.getIframe();
    const gridOrder = () =>
      iframe
        .locator('[data-block-uid="gs-grid"] [data-block-uid]')
        .evaluateAll((els) => els.map((e) => e.getAttribute('data-block-uid')));

    expect(await gridOrder()).toEqual(['gs-slate-1', 'gs-slate-2', 'gs-slate-3']);

    // gs-title is the page-level slate directly above the grid.
    await iframe.locator('[data-block-uid="gs-title"]').first().click();
    const chevronDown = page.locator('.quanta-toolbar .chevron-down');
    await expect(chevronDown).toBeVisible();
    await chevronDown.click();

    await expect
      .poll(gridOrder)
      .toEqual(['gs-title', 'gs-slate-1', 'gs-slate-2', 'gs-slate-3']);
  });

  test('chevron up and down are inverses across a grid boundary (round-trip)', async ({
    page,
  }) => {
    // Move a block down into the grid, then up — it must return to exactly where
    // it started. If down "skips" but up "enters", the block ends up trapped
    // inside the grid and the two chevrons stop being inverses.
    await page.setViewportSize({ width: 375, height: 812 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/grid-slates-test-page');

    const iframe = helper.getIframe();
    const order = () => helper.getBlockOrder('body');

    const before = await order();
    await iframe.locator('[data-block-uid="gs-title"]').first().click();
    await page.locator('.quanta-toolbar .chevron-down').click();
    await expect.poll(order).not.toEqual(before); // it moved
    await page.locator('.quanta-toolbar .chevron-up').click();
    await expect.poll(order).toEqual(before); // …and came all the way back
  });

  /**
   * Every popup the admin surfaces should render as a bottom sheet on
   * mobile — same geometry, same gesture. Assert each known popup's
   * bounding box pins to the bottom and spans full width.
   */
  const isBottomSheet = async (
    page: import('@playwright/test').Page,
    selector: string,
  ) => {
    const locator = page.locator(selector);
    await expect(locator).toBeVisible();
    const box = await locator.boundingBox();
    expect(box, `${selector} should have a box`).not.toBeNull();
    expect(box!.y + box!.height, `${selector} bottom edge`).toBeGreaterThan(
      812 - 20,
    );
    expect(box!.x, `${selector} left edge`).toBeLessThan(5);
    expect(
      box!.x + box!.width,
      `${selector} right edge`,
    ).toBeGreaterThan(370);
  };

  // These two ran in EDIT mode, where mobile-tablet.css deliberately hides the
  // frontend switcher:
  //   body.view-editview #toolbar-body .frontend-switcher-btn { display: none }
  // "editors need Undo + Cancel + Save more than meta actions during inline edits;
  // both stay reachable via ⋯". So the button could never be clicked and the tests
  // timed out waiting for it. The sheet geometry they actually assert is mode-agnostic
  // (the rules key off the viewport, not body.view-*), so exercise them in VIEW mode,
  // where the button is a first-class part of the designed bottom toolbar.
  test('frontend switcher panel renders as a bottom sheet', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await page.goto(`${URLS.voltoSsr}/test-page`);

    await page.locator('#toolbar-frontend-switcher').click();
    await isBottomSheet(page, '.frontend-switcher-panel');
  });

  test('frontend settings modal renders as a bottom sheet', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await page.goto(`${URLS.voltoSsr}/test-page`);

    await page.locator('#toolbar-frontend-switcher').click();
    await page
      .locator('.frontend-switcher-panel .frontend-switcher-settings-btn')
      .click();
    await isBottomSheet(page, '.frontend-settings-modal');
  });

  test('sidebar starts collapsed on mobile EVEN IF a desktop sidebar_expanded=true cookie exists', async ({
    page,
    context,
  }) => {
    // Reproduces the user-reported regression: a previous desktop
    // session left sidebar_expanded=true; visiting on mobile would
    // honour that cookie and open the full-screen sheet on first
    // load. Mobile should ignore the cookie and always start collapsed.
    await context.addCookies([
      {
        name: 'sidebar_expanded',
        value: 'true',
        url: URLS.voltoSsr,
      },
    ]);
    await page.setViewportSize({ width: 375, height: 812 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    await expect(page.locator('.sidebar-container.collapsed')).toBeAttached({
      timeout: 5000,
    });
    await expect(page.locator('#previewIframe')).toBeVisible();
  });

  test('main toolbar height matches Quanta (compact 44px bar)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');
    await helper.clickBlockInIframe('block-1-uuid');

    const tb = await page.locator('#toolbar-body').boundingBox();
    const qb = await page.locator('.quanta-toolbar').boundingBox();
    expect(tb!.height, 'main toolbar should be 44px tall').toBeLessThanOrEqual(
      50,
    );
    expect(qb!.height, 'Quanta toolbar should be ~44px tall').toBeLessThanOrEqual(
      50,
    );
    // The two bars should feel balanced — within ±10px of each other
    expect(Math.abs(tb!.height - qb!.height)).toBeLessThanOrEqual(10);
  });

  test('view mode: every bottom-toolbar icon is vertically centred in the bar', async ({
    page,
  }) => {
    // The bar is 44px tall, but its <a>/<button> children are `display: block`
    // (align-items has no effect), so a 22px icon sits at padding-top:6px —
    // centre y 888 against the bar's 893. `.frontend-switcher-btn` happens to be
    // display:flex and lands dead centre, so the icons disagree by ~5px and the
    // row reads as misaligned. `.edit` is worse: its svg is `icon circled`
    // (padding 4 + border 2, content-box) = 34px, not 22px.
    await page.setViewportSize({ width: 412, height: 915 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await page.goto(`${URLS.voltoSsr}/test-page`);
    const bar = page.locator('#toolbar-body');
    await expect(bar).toBeVisible();

    const m = await bar.evaluate((el: HTMLElement) => {
      const b = el.getBoundingClientRect();
      const icons = Array.from(el.querySelectorAll('a svg, button svg'))
        .map((s) => s.getBoundingClientRect())
        .filter((r) => r.width > 0)
        .map((r) => ({ cy: r.y + r.height / 2, h: r.height }));
      return { barCy: b.y + b.height / 2, icons };
    });

    expect(m.icons.length).toBeGreaterThan(3);
    for (const icon of m.icons) {
      expect(
        Math.abs(icon.cy - m.barCy),
        `icon centre ${icon.cy} vs bar centre ${m.barCy}`,
      ).toBeLessThanOrEqual(1);
    }
  });

  test('view mode: the bottom toolbar does not overflow — Edit stays on screen', async ({
    page,
  }) => {
    // scrollWidth 422 > clientWidth 412: the primary action (Edit) hangs 10px
    // off the right edge and the bar silently becomes horizontally scrollable.
    await page.setViewportSize({ width: 412, height: 915 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await page.goto(`${URLS.voltoSsr}/test-page`);
    const bar = page.locator('#toolbar-body');
    await expect(bar).toBeVisible();

    const overflow = await bar.evaluate((el: HTMLElement) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(
      overflow.scrollWidth,
      'bottom bar must not scroll horizontally',
    ).toBeLessThanOrEqual(overflow.clientWidth);

    const edit = await page.locator('#toolbar-body .edit').boundingBox();
    expect(edit!.x + edit!.width, 'Edit must stay within the viewport').toBeLessThanOrEqual(412);
  });

  test('add-block chooser fills the width of the mobile bottom sheet', async ({
    page,
  }) => {
    // mobile-tablet.css turns `.add-new-block-popup` into a full-width bottom
    // sheet, but nothing touches the `.blocks-chooser` INSIDE it — Volto's
    // blocks.less pins that to `width: 310px`, so on a 412px phone the picker
    // occupies ~75% of the sheet with dead space to its right.
    await page.setViewportSize({ width: 412, height: 915 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');
    await helper.clickBlockInIframe('block-1-uuid');

    await page.locator('.volto-hydra-add-button').click();
    const sheet = page.locator('.add-new-block-popup');
    const chooser = page.locator('.blocks-chooser');
    await expect(chooser).toBeVisible();

    const sb = (await sheet.boundingBox())!;
    const cb = (await chooser.boundingBox())!;
    expect(sb.width, 'sheet spans the viewport').toBeGreaterThanOrEqual(410);
    expect(
      cb.width,
      `chooser ${cb.width}px should fill the ${sb.width}px sheet`,
    ).toBeGreaterThanOrEqual(sb.width - 12);
  });

  test("the add '+' never leaves the iframe canvas (would sit under the bottom toolbar)", async ({
    page,
  }) => {
    // The '+' is drawn at the selected block's bottom edge (`blockBottom + 8`) with no
    // vertical bound — the horizontal overflow IS clamped (isConstrained), the vertical
    // one never was. When the block's bottom is at the viewport bottom the button lands
    // outside the canvas, on top of the bottom toolbar, and swallows its clicks
    // ("<span>+</span> ... intercepts pointer events" on Save). Not a mobile-only bug:
    // any viewport where the block ends at the canvas edge reproduces it.
    await page.setViewportSize({ width: 375, height: 812 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const addBtn = page.locator('.volto-hydra-add-button');
    await expect(addBtn).toBeVisible({ timeout: 10000 });

    const add = (await addBtn.boundingBox())!;
    const canvas = (await page.locator('#previewIframe').boundingBox())!;

    expect(add.y, "'+' top must be inside the canvas").toBeGreaterThanOrEqual(canvas.y - 1);
    expect(
      add.y + add.height,
      `'+' bottom ${add.y + add.height} must not spill past the canvas bottom ${canvas.y + canvas.height}`,
    ).toBeLessThanOrEqual(canvas.y + canvas.height + 1);
  });

  test("a nested block's '+' pulled inside for lack of room stays at the block's TOP, not bottom", async ({
    page,
  }) => {
    // A block laid out in a ROW adds its next sibling to the RIGHT. The rightmost
    // one has no room to its right on a phone, so the '+' is pulled INSIDE the
    // block (isConstrained). Only the horizontal axis was constrained, so the
    // button must keep its vertical position at the block's TOP-right — it was
    // just "moved in a bit". Dropping it to the BOTTOM-right changes an axis that
    // never overflowed and reads as the button teleporting to the wrong corner.
    //
    // `col-2` (the right column of `columns-1`), NOT a grid cell. This used to
    // drive `grid-cell-1`, on the premise that a nested block always adds to the
    // right — nesting depth said so. It no longer does: the direction is measured
    // from where the siblings actually sit, and on a 375px phone the nuxt grid
    // stacks its cells full-width, so `bottom` is the correct answer there and
    // the '+' belongs under the block, unconstrained. Asserting 'top' for that
    // case would be asserting the old guess. The columns block still lays its
    // children out side by side at this width, so the constrained path — the
    // thing this test is actually about — lives there now.
    await page.setViewportSize({ width: 375, height: 812 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/container-test-page');
    await helper.getStableBlockCount();

    const iframe = helper.getIframe();
    // A container is not selectable by clicking its body — click its title.
    await helper.clickContainerBlockInIframe('col-2');

    const block = iframe.locator('[data-block-uid="col-2"]').first();
    const addBtn = page.locator('.volto-hydra-add-button');
    await expect(addBtn).toBeVisible({ timeout: 10000 });

    await expect
      .poll(
        async () => {
          const add = await addBtn.boundingBox();
          const blk = await block.boundingBox();
          if (!add || !blk) return 'missing';
          const nearTop = Math.abs(add.y - blk.y) <= 40;
          const nearBottom =
            Math.abs(add.y + add.height - (blk.y + blk.height)) <= 40;
          // Bottom-anchored (and NOT also near a short block's top) is the bug.
          if (nearBottom && !nearTop) return 'bottom';
          if (nearTop) return 'top';
          return 'elsewhere';
        },
        { timeout: 10000 },
      )
      .toBe('top');
  });

  test('Settings icon in bottom toolbar opens the sidebar (no ⋯ detour)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    await expect(page.locator('.sidebar-container.collapsed')).toBeAttached({
      timeout: 5000,
    });
    const toggle = page.locator('#toolbar-body .sidebar-toggle-toolbar-btn');
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(page.locator('.sidebar-container')).toBeVisible();
    await expect(page.locator('.sidebar-container.collapsed')).toHaveCount(0);
  });

  test('chevron ▲ disabled at top, ▼ disabled at bottom', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const order = await helper.getBlockOrder();
    await helper.clickBlockInIframe(order[0]);
    await expect(page.locator('.quanta-toolbar .chevron-up')).toBeDisabled();

    await helper.clickBlockInIframe(order[order.length - 1]);
    await expect(page.locator('.quanta-toolbar .chevron-down')).toBeDisabled();
  });

  /**
   * Slate LinkEditor on mobile.
   *
   * Desktop behavior (inline-editing-links.spec.ts:12): the LinkEditor
   * popup sits ON TOP OF Quanta in the same x/y as the format toolbar
   * — clicking "link" swaps Quanta for the URL form, same place.
   *
   * Mobile must preserve that mental model: the LinkEditor covers the
   * top toolbar (Quanta), full-width, NOT as a bottom sheet. The
   * picker (browse → ObjectBrowser, rendered inside SidebarPopup's
   * <aside class="sidebar-container">) takes the WHOLE SCREEN, like
   * the main sidebar does when expanded on mobile.
   */
  test('LinkEditor on mobile covers Quanta at the top of the viewport', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';
    await helper.editBlockTextInIframe(blockId, 'Tap me');
    const editor = await helper.getEditorLocator(blockId);
    await helper.selectAllTextInEditor(editor);
    await helper.clickFormatButton('link');

    const linkEditor = page.locator('.add-link').first();
    await expect(linkEditor).toBeVisible({ timeout: 5000 });

    // Pinned to top, full-width (NOT a bottom sheet).
    const lb = await linkEditor.boundingBox();
    expect(lb).not.toBeNull();
    expect(lb!.y, 'LinkEditor sits at the top of the viewport').toBeLessThan(5);
    expect(lb!.x, 'LinkEditor starts at viewport left').toBeLessThan(5);
    expect(
      lb!.x + lb!.width,
      'LinkEditor reaches viewport right',
    ).toBeGreaterThan(370);

    // Quanta sits at top:0 too — the LinkEditor must visually cover it.
    // Same vertical band (overlap), not below it.
    const qb = await page.locator('.quanta-toolbar').boundingBox();
    expect(qb).not.toBeNull();
    expect(
      lb!.y,
      'LinkEditor y must overlap Quanta y (i.e. cover it, not sit below)',
    ).toBeLessThanOrEqual(qb!.y + 5);

    // Can actually type + submit a URL from the top-pinned editor.
    const urlInput = await helper.getLinkEditorUrlInput();
    await urlInput.fill('https://plone.org');
    await urlInput.press('Enter');

    await expect(async () => {
      const html = await editor.innerHTML();
      expect(html).toContain('<a ');
      expect(html).toContain('https://plone.org');
    }).toPass({ timeout: 5000 });

    // After submit the LinkEditor goes away (Quanta still visible).
    await expect(page.locator('.add-link')).not.toBeVisible();
    await expect(page.locator('.quanta-toolbar')).toBeVisible();
  });

  test('object-browser picker takes the whole screen on mobile', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';
    await helper.editBlockTextInIframe(blockId, 'Tap me');
    const editor = await helper.getEditorLocator(blockId);
    await helper.selectAllTextInEditor(editor);
    await helper.clickFormatButton('link');

    await expect(page.locator('.add-link').first()).toBeVisible({
      timeout: 5000,
    });

    // The browse button inside the LinkEditor opens the ObjectBrowser
    // picker. It's rendered as <aside class="sidebar-container"> by
    // SidebarPopup (Volto core), so my existing
    // .sidebar-container:not(.collapsed) full-screen rule applies.
    await page.locator('.add-link .link-form-container button').first().click();

    const picker = page.locator('.object-browser').first();
    await expect(picker).toBeVisible({ timeout: 5000 });

    // The picker's wrapping .sidebar-container must be full-viewport.
    const wrapper = picker.locator('xpath=ancestor::*[contains(@class, "sidebar-container")]').first();
    const wb = await wrapper.boundingBox();
    expect(wb).not.toBeNull();
    expect(wb!.x, 'picker wrapper covers viewport left').toBeLessThan(5);
    expect(wb!.y, 'picker wrapper covers viewport top').toBeLessThan(5);
    expect(
      wb!.x + wb!.width,
      'picker wrapper covers viewport right',
    ).toBeGreaterThan(370);
    expect(
      wb!.y + wb!.height,
      'picker wrapper covers viewport bottom',
    ).toBeGreaterThan(800);
  });

  test('mobile: pick existing content in the object browser applies the link', async ({
    page,
  }) => {
    // The placement test above stops at "the picker opened full-screen". This drives the
    // whole flow on a phone — open the LinkEditor, browse, SELECT a page, and assert the
    // link actually lands in the text. The desktop equivalent is
    // inline-editing-links.spec.ts "can use browse button in link editor"; mobile has its
    // own full-screen-overlay tap/scroll quirks that a desktop pass doesn't cover.
    await page.setViewportSize({ width: 375, height: 812 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const blockId = 'block-1-uuid';
    await helper.editBlockTextInIframe(blockId, 'Click here');
    const editor = await helper.getEditorLocator(blockId);
    await helper.selectAllTextInEditor(editor);

    await helper.clickFormatButton('link');
    await helper.waitForLinkEditorPopup();

    // The Browse button only shows when the URL input is empty.
    const linkUrlInput = await helper.getLinkEditorUrlInput();
    if ((await linkUrlInput.inputValue())?.length > 0) {
      await linkUrlInput.clear();
    }
    const browseButton = await helper.getLinkEditorBrowseButton();
    await browseButton.click();

    const objectBrowser = await helper.waitForObjectBrowser();
    // Selecting a page auto-submits the link.
    await helper.objectBrowserSelectItem(objectBrowser, /Another Page/);

    const submitButton = page.getByRole('button', { name: 'Submit' });
    if (await submitButton.isVisible({ timeout: 1000 }).catch(() => false)) {
      await submitButton.click();
    }

    // The link must actually be applied to the selected text.
    await expect(async () => {
      const blockHtml = await editor.innerHTML();
      expect(blockHtml).toContain('<a ');
      expect(blockHtml).toContain('/another-page');
      expect(blockHtml).toContain('Click here');
    }).toPass({ timeout: 5000 });
  });

  /**
   * User-reported regression: on mobile in VIEW mode (not /edit), the
   * editor saw a big empty gap at the top of the screen and the
   * bottom toolbar's icons were squeezed/cut off.
   *
   * Root cause investigated against prod:
   *  - #toolbar > .pusher is a stock Volto layout element that
   *    reserves vertical space at the top (~100px on mobile) so page
   *    content sits BELOW where the toolbar would be. On desktop the
   *    toolbar is at the left/top so this reservation is correct.
   *    On mobile our CSS pulls #toolbar-body out to position:fixed
   *    bottom:0, so .pusher's reservation becomes a phantom gap with
   *    no toolbar inside it.
   *  - The toolbar's `height: 44px !important` + `padding-bottom:
   *    env(safe-area-inset-bottom)` fight on iOS: padding pushes
   *    actual height past 44px but max-height clamps content area to
   *    ~10px after the home-indicator padding, squeezing the icons.
   *
   * These tests assert the symptoms (no gap at top, toolbar fully
   * intact at bottom) so any future regression is caught.
   */
  test('view mode: no phantom gap at the top of the viewport', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToView('/test-page');

    // #main should start within ~10px of viewport top — i.e. no
    // reserved toolbar space pushing it down. The bug had it at y=100.
    const main = await page.locator('#main').boundingBox();
    expect(main).not.toBeNull();
    expect(
      main!.y,
      '#main must not be pushed down by phantom toolbar reservation',
    ).toBeLessThan(10);

    // Direct: the layout-space reservation element (#toolbar .pusher)
    // must collapse to zero height on mobile.
    const pusherH = await page
      .locator('#toolbar .pusher')
      .evaluate((el) => el.getBoundingClientRect().height);
    expect(
      pusherH,
      '#toolbar .pusher must have 0 height on mobile (it reserves space we do not need)',
    ).toBeLessThan(5);
  });

  test('edit mode: no phantom gap at the top either', async ({ page }) => {
    // Edit mode hides the gap visually because the iframe is fixed
    // over it, but the underlying layout reservation is still wrong.
    // Same assertion as view mode — .pusher should collapse.
    await page.setViewportSize({ width: 375, height: 812 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const pusherH = await page
      .locator('#toolbar .pusher')
      .evaluate((el) => el.getBoundingClientRect().height);
    expect(
      pusherH,
      '#toolbar .pusher must have 0 height on mobile in edit mode too',
    ).toBeLessThan(5);
  });

  test('bottom toolbar: full 44px content area, not squeezed by safe-area padding', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Probe: the icon button inside the toolbar must render at the
    // intended ~44px height. If safe-area padding squeezes the inner
    // content the buttons collapse and become unclickable.
    const tb = await page.locator('#toolbar-body').boundingBox();
    expect(tb).not.toBeNull();
    expect(tb!.height, 'toolbar visible band').toBeGreaterThanOrEqual(40);

    // Sample an actual icon button in the toolbar — it should be
    // ≥30px tall (not crushed). The Save button always exists.
    const saveBtn = page.locator('#toolbar-body .save').first();
    await expect(saveBtn).toBeVisible({ timeout: 5000 });
    const sb = await saveBtn.boundingBox();
    expect(sb).not.toBeNull();
    expect(
      sb!.height,
      'toolbar icon button must keep ~44px content area, not get crushed by safe-area padding',
    ).toBeGreaterThanOrEqual(30);
    // And the button must be inside the viewport vertically.
    expect(sb!.y + sb!.height, 'button bottom edge inside viewport').toBeLessThanOrEqual(812);
    expect(sb!.y, 'button top edge inside viewport').toBeGreaterThanOrEqual(0);
  });

  /**
   * User feedback after seeing the first deployed mobile toolbar:
   *  - "icons are clipped" — buttons overflow the viewport right edge
   *  - "scrolling on the bottom bar when editing" — toolbar has
   *    overflow-x: auto and content exceeds 375px
   *  - "the icons swap sides between view and edit modes" — the
   *    primary action (Edit pencil in view; Save in edit) lands in
   *    different positions; UX has no consistent "save" spot
   *  - "edit and save should both end up on the right" — primary
   *    action belongs on the right (standard mobile CTA position)
   */
  test('mobile toolbar (edit): Save is the rightmost visible button', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const positions = await page.evaluate(() => {
      const inner = document.querySelector('#toolbar-body .toolbar-body');
      if (!inner) return [];
      return [...inner.querySelectorAll('button, a')]
        .map((b) => {
          const r = b.getBoundingClientRect();
          return {
            label: b.getAttribute('aria-label') || b.textContent?.trim() || '?',
            right: r.x + r.width,
            visible: r.width > 0 && r.height > 0,
          };
        })
        .filter((b) => b.visible);
    });
    expect(positions.length, 'toolbar should have buttons').toBeGreaterThan(0);
    const rightmost = positions.reduce((max, b) =>
      b.right > max.right ? b : max,
    );
    expect(
      rightmost.label,
      `Save must be the rightmost button. Got order: ${positions.map((b) => b.label).join(' → ')}`,
    ).toBe('Save');
  });

  /**
   * Edit-mode toolbar gap: same shape as desktop's two-group toolbar.
   * The meta group on the LEFT (Undo + Settings) and the action group
   * on the RIGHT (Cancel + Save) must be separated by an explicit gap
   * (≥ 30 px) — without it the four icons pack to the left and the
   * right of the bar reads as empty/broken. The gap is implemented
   * via `justify-content: space-between` on the inner .toolbar-body
   * plus `width: 100%`; if either is reverted this assertion fires.
   */
  test('mobile toolbar (edit): visible gap between left meta group and right action group', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const buttons = await page.evaluate(() => {
      const inner = document.querySelector('#toolbar-body .toolbar-body');
      if (!inner) return [];
      return [...inner.querySelectorAll('button, a')]
        .map((b) => {
          const r = b.getBoundingClientRect();
          return {
            label: b.getAttribute('aria-label') || b.textContent?.trim() || '?',
            x: r.x,
            right: r.x + r.width,
            visible: r.width > 0 && r.height > 0,
          };
        })
        .filter((b) => b.visible)
        .sort((a, b) => a.x - b.x);
    });
    expect(buttons.length).toBeGreaterThanOrEqual(4);

    const settings = buttons.find((b) => b.label === 'Open settings');
    const cancel = buttons.find((b) => b.label === 'Cancel');
    expect(settings, 'Settings (left meta group) must be visible').toBeTruthy();
    expect(cancel, 'Cancel (right action group) must be visible').toBeTruthy();

    // The horizontal gap between the right edge of Settings and the
    // left edge of Cancel must be ≥ 30 px — proves the two button
    // groups are visibly separated, not stacked side-by-side.
    const gap = cancel!.x - settings!.right;
    expect(
      gap,
      `expected a visible gap between Settings (right=${settings!.right.toFixed(0)}) and Cancel (left=${cancel!.x.toFixed(0)})`,
    ).toBeGreaterThanOrEqual(30);
  });

  test('mobile toolbar (view): Edit is the rightmost visible button', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToView('/test-page');

    const positions = await page.evaluate(() => {
      const inner = document.querySelector('#toolbar-body .toolbar-body');
      if (!inner) return [];
      return [...inner.querySelectorAll('button, a')]
        .map((b) => {
          const r = b.getBoundingClientRect();
          return {
            label: b.getAttribute('aria-label') || b.textContent?.trim() || '?',
            right: r.x + r.width,
            visible: r.width > 0 && r.height > 0,
          };
        })
        .filter((b) => b.visible);
    });
    expect(positions.length, 'toolbar should have buttons').toBeGreaterThan(0);
    const rightmost = positions.reduce((max, b) =>
      b.right > max.right ? b : max,
    );
    expect(
      rightmost.label,
      `Edit must be the rightmost button. Got order: ${positions.map((b) => b.label).join(' → ')}`,
    ).toBe('Edit');
  });

  /**
   * Designed view-mode toolbar order (per the user's portrait mockup):
   *   Personal tools → Frontend & Viewport → More → Add → Contents → Edit
   * left to right. Primary CTA (Edit) is rightmost (matches mobile
   * convention + matches the mockup). Personal tools is the leftmost
   * "meta" affordance, Frontend & Viewport next to it. The middle
   * three (More / Add / Contents) are content-navigation. Edit pinned
   * right.
   */
  test('mobile toolbar (view): visible buttons match the designed order', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToView('/test-page');

    const labels = await page.evaluate(() => {
      const inner = document.querySelector('#toolbar-body .toolbar-body');
      if (!inner) return [];
      return [...inner.querySelectorAll('button, a')]
        .map((b) => {
          const r = b.getBoundingClientRect();
          return {
            label: b.getAttribute('aria-label') || b.textContent?.trim() || '?',
            x: r.x,
            visible: r.width > 0 && r.height > 0,
          };
        })
        .filter((b) => b.visible)
        .sort((a, b) => a.x - b.x)
        .map((b) => b.label);
    });

    expect(
      labels,
      `view-mode toolbar must match the designed order. Got: ${labels.join(' → ')}`,
    ).toEqual([
      'Personal tools',
      'Frontend & Viewport',
      'More',
      'Add',
      'Contents',
      'Edit',
    ]);
  });

  test('mobile toolbar: every visible button fits inside the viewport (no clipping)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const overflow = await page.evaluate(() => {
      const inner = document.querySelector('#toolbar-body .toolbar-body');
      if (!inner) return [];
      return [...inner.querySelectorAll('button, a')]
        .map((b) => {
          const r = b.getBoundingClientRect();
          return {
            label: b.getAttribute('aria-label') || b.textContent?.trim() || '?',
            x: r.x,
            right: r.x + r.width,
            visible: r.width > 0 && r.height > 0,
          };
        })
        .filter((b) => b.visible)
        .filter((b) => b.right > 375 || b.x < 0);
    });
    expect(
      overflow,
      `no toolbar button should overflow the viewport. Overflowing: ${overflow
        .map((b) => `${b.label} (x=${b.x.toFixed(0)}, right=${b.right.toFixed(0)})`)
        .join(', ')}`,
    ).toEqual([]);
  });

  test('mobile toolbar: no horizontal scrolling needed', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const overflow = await page.evaluate(() => {
      const tb = document.querySelector('#toolbar-body');
      if (!tb) return { sw: 0, cw: 0 };
      return { sw: tb.scrollWidth, cw: tb.clientWidth };
    });
    expect(
      overflow.sw,
      `toolbar scrollWidth (${overflow.sw}) should not exceed clientWidth (${overflow.cw}) — content must fit without horizontal scrolling`,
    ).toBeLessThanOrEqual(overflow.cw + 1);
  });

  /**
   * Second round of user feedback (after the right-align + no-scroll fix):
   *  - Settings icon should be a cog, not the sliders SVG
   *  - Settings icon shouldn't show in view mode (only relevant in edit)
   *  - Contents button should be back in view mode
   *  - Frontend & Viewport panel needs a close button on mobile
   *  - Edit toolbar should prioritize Undo + Cancel over Frontend switcher
   */
  test('mobile toolbar (edit): Settings shortcut renders an SVG cog icon (not bare sliders)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const btn = page.locator('#toolbar-body .sidebar-toggle-toolbar-btn');
    await expect(btn).toBeVisible({ timeout: 3000 });
    await expect(
      btn.locator('svg'),
      'Settings shortcut must render an SVG icon',
    ).toBeVisible();
    // Volto's stock settings.svg has a distinctive 3-slider path (paths
    // like `M10 20C8.897` — circle nodes on parallel lines). A cog has a
    // characteristic outer-gear path with radial teeth — different shape
    // entirely. Asserting the path content isn't `settings.svg`-shaped
    // is the cheapest regression catch.
    const svgContent = await btn.locator('svg').evaluate((el) => el.innerHTML);
    expect(
      svgContent,
      'Settings icon must NOT use stock sliders settings.svg (it should be a cog)',
    ).not.toContain('M10 20C8.897 20 8 19.103');
  });

  test('mobile toolbar (view): Settings shortcut is NOT shown', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToView('/test-page');

    await expect(
      page.locator('#toolbar-body .sidebar-toggle-toolbar-btn'),
      'Settings shortcut is editing-only and must not render in view mode',
    ).toHaveCount(0);
  });

  test('mobile toolbar (view): Contents link is visible', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToView('/test-page');

    // Contents anchor has no class — match by href suffix.
    const contents = page.locator('#toolbar-body a[href$="/contents"]');
    await expect(
      contents,
      'Contents link must remain accessible in view mode on mobile',
    ).toBeVisible();
  });

  test('mobile toolbar (edit): Undo is visible, Frontend & Viewport is NOT', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    await expect(
      page.locator('#toolbar-body .undo'),
      'Undo must be visible in edit mode (more important than Frontend switcher)',
    ).toBeVisible();
    await expect(
      page.locator('#toolbar-body .frontend-switcher-btn'),
      'Frontend & Viewport switcher does not belong in edit-mode bottom bar',
    ).toBeHidden();
  });

  test('frontend-switcher panel has a close button on mobile', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    // Open from view mode so the Frontend switcher button is visible.
    await helper.navigateToView('/test-page');

    await page.locator('#toolbar-frontend-switcher').click();
    const panel = page.locator('.frontend-switcher-panel');
    await expect(panel).toBeVisible({ timeout: 3000 });

    const back = panel.locator('.mobile-sheet-close');
    await expect(
      back,
      'Frontend & Viewport panel must have a close affordance on mobile',
    ).toBeVisible();

    // And it must dismiss the panel.
    await back.click();
    await expect(panel).not.toBeVisible({ timeout: 3000 });
  });

  /**
   * Comprehensive button-by-button audit of the mobile bottom toolbar.
   * For each button that's visible on mobile in each mode, this exercises:
   *   1. The button is visible at 375px (no clipping, in viewport)
   *   2. Clicking it actually does something observable (URL change OR
   *      a panel/menu opens in a visible state)
   *   3. If a panel/menu opens, it has a clear close affordance and
   *      that close affordance actually dismisses the panel
   *
   * If any single button is silently broken — click does nothing,
   * opens an off-screen panel, opens a panel that can't be closed —
   * the test fails with a specific name so the bug is obvious without
   * having to scroll a screenshot.
   */
  const VIEW_BUTTONS = [
    {
      label: 'Frontend & Viewport',
      selector: '#toolbar-body .frontend-switcher-btn',
      // Opens a portal panel rendered into #toolbar-content.
      expectPanel: '.frontend-switcher-panel',
      expectClose: '.frontend-switcher-panel .mobile-sheet-close',
    },
    {
      label: 'More',
      selector: '#toolbar-body .more',
      // Volto Toolbar's submenu container; its visibility is signalled
      // by .toolbar-content gaining the .show class.
      expectPanel: '.toolbar-content.show',
      // NOT the ⋯ button: opening a submenu hides the whole bottom bar
      // (`body[data-hydra-submenu-open] #toolbar-body { display: none }`) so the
      // editor only ever sees one bottom-anchored surface. The sheet brings its own
      // back-arrow (MobileSubmenuClose, portaled to body) — that IS the separate
      // close affordance the old comment here wished for.
      expectClose: 'body > .mobile-submenu-close',
    },
    {
      label: 'Contents',
      selector: '#toolbar-body a[href$="/contents"]',
      // Navigation link — assert URL changes to /contents.
      expectUrlContains: '/contents',
    },
    {
      label: 'Add',
      selector: '#toolbar-body .add',
      // Volto's Add button calls toggleMenu(e, 'types'), which expands
      // .toolbar-content into the .show state with the Types submenu
      // rendered inside. The user reported "Add new content does
      // nothing"; this test catches a regression to actually-nothing
      // (no DOM change on click). If Add opens a menu but the menu is
      // visually broken on mobile, that's a SEPARATE Volto-stock
      // submenu-rendering bug — see project memory entry.
      expectPanel: '.toolbar-content.show',
      // Same as More: the bottom bar (and with it `.add`) is hidden while the
      // submenu sheet is open; the sheet's own back-arrow dismisses it.
      expectClose: 'body > .mobile-submenu-close',
    },
    {
      label: 'Edit',
      selector: '#toolbar-body .edit',
      expectUrlContains: '/edit',
    },
  ] as const;

  for (const btn of VIEW_BUTTONS) {
    test(`view mode: ${btn.label} button — visible, clickable, observable result, dismissible`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      const helper = new AdminUIHelper(page);
      await helper.login();
      await helper.navigateToView('/test-page');

      const btnLoc = page.locator(btn.selector);
      await expect(btnLoc, `${btn.label} must be visible on mobile`).toBeVisible(
        { timeout: 3000 },
      );

      // Visible AND fully inside the viewport.
      const box = await btnLoc.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x, `${btn.label} left edge inside viewport`).toBeGreaterThanOrEqual(0);
      expect(
        box!.x + box!.width,
        `${btn.label} right edge inside viewport`,
      ).toBeLessThanOrEqual(376);

      const beforeUrl = page.url();
      await btnLoc.click();
      await page.waitForTimeout(500);

      if ('expectUrlContains' in btn && btn.expectUrlContains) {
        await page.waitForURL((u) => u.toString().includes(btn.expectUrlContains!), {
          timeout: 5000,
        });
        expect(page.url()).not.toBe(beforeUrl);
        return;
      }

      if ('expectPanel' in btn && btn.expectPanel) {
        const panel = page.locator(btn.expectPanel).first();
        await expect(
          panel,
          `${btn.label} click must open ${btn.expectPanel}`,
        ).toBeVisible({ timeout: 3000 });

        const close = page.locator(btn.expectClose!).first();
        await expect(
          close,
          `${btn.label} panel must have a close affordance (${btn.expectClose})`,
        ).toBeVisible({ timeout: 3000 });
        await close.click();
        await expect(
          panel,
          `${btn.label} panel must dismiss after clicking its close affordance`,
        ).not.toBeVisible({ timeout: 3000 });
      }
    });
  }

  const EDIT_BUTTONS = [
    {
      label: 'Settings (cog)',
      selector: '#toolbar-body .sidebar-toggle-toolbar-btn',
      // Click toggles the .collapsed class on .sidebar-container.
      expectSideEffect: async (page: import('@playwright/test').Page) => {
        await expect(
          page.locator('.sidebar-container.collapsed'),
          'Settings click should open (uncollapse) the sidebar',
        ).toHaveCount(0, { timeout: 3000 });
      },
      // To restore for next test: click the X to re-close.
      cleanup: async (page: import('@playwright/test').Page) => {
        await page.locator('.sidebar-container .sidebar-close-button').first().click();
      },
    },
    {
      label: 'Cancel',
      selector: '#toolbar-body .cancel',
      // Cancel navigates back to view mode.
      expectUrlNotEndsWith: '/edit',
    },
    {
      label: 'Save',
      selector: '#toolbar-body .save',
      // Save persists + navigates to view mode.
      expectUrlNotEndsWith: '/edit',
    },
  ] as const;

  for (const btn of EDIT_BUTTONS) {
    test(`edit mode: ${btn.label} button — visible, clickable, observable result`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      const helper = new AdminUIHelper(page);
      await helper.login();
      await helper.navigateToEdit('/test-page');

      const btnLoc = page.locator(btn.selector);
      await expect(btnLoc, `${btn.label} must be visible on mobile`).toBeVisible(
        { timeout: 3000 },
      );

      const box = await btnLoc.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x, `${btn.label} left edge inside viewport`).toBeGreaterThanOrEqual(0);
      expect(
        box!.x + box!.width,
        `${btn.label} right edge inside viewport`,
      ).toBeLessThanOrEqual(376);

      const beforeUrl = page.url();
      await btnLoc.click();
      await page.waitForTimeout(800);

      if ('expectUrlNotEndsWith' in btn && btn.expectUrlNotEndsWith) {
        await page.waitForURL((u) => !u.toString().endsWith(btn.expectUrlNotEndsWith!), {
          timeout: 5000,
        });
        expect(page.url()).not.toBe(beforeUrl);
        return;
      }

      if ('expectSideEffect' in btn && btn.expectSideEffect) {
        await btn.expectSideEffect(page);
        if ('cleanup' in btn && btn.cleanup) await btn.cleanup(page);
      }
    });
  }

  test('edit mode: Undo button — visible and clickable (issues Undo)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const undoBtn = page.locator('#toolbar-body .undo');
    await expect(undoBtn).toBeVisible({ timeout: 3000 });
    const box = await undoBtn.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(376);

    // We don't assert state change (Undo on a fresh page with no edits
    // is a no-op) — just that the button isn't disabled and renders.
    await expect(undoBtn).toBeEnabled();
  });

  test('edit mode: Redo button is visible on mobile (reachable without a keyboard)', async ({
    page,
  }) => {
    // Redo used to be hidden on the compact mobile bar, leaving it unreachable
    // on a phone (no Ctrl+Y). It must render on the edit bar within the viewport.
    await page.setViewportSize({ width: 375, height: 812 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const redoBtn = page.locator('#toolbar-body .redo');
    await expect(redoBtn).toBeVisible({ timeout: 3000 });
    const box = await redoBtn.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(376);
    // On a fresh page there's nothing to redo, so it's present but disabled —
    // that's correct; the point is it's reachable once there's redo history.
  });

  /**
   * Stronger-than-toBeVisible tests: assert a panel is actually opaquely
   * rendered on top of the page content, not just present in the DOM.
   *
   * The original Add/More submenu bug looked "visible" to Playwright
   * (`toBeVisible()` passed) — the element existed at display:flex with
   * non-zero size — but it had no background-color and lived at z-index:
   * 3 in static position, so the iframe content bled through. The fix
   * needed two assertions Playwright doesn't have built-in:
   *
   *   1. The element under the user's tap at the panel's centre is the
   *      panel (or a descendant), not the iframe sitting behind it.
   *      We use document.elementFromPoint() in the page context — same
   *      hit-testing the browser does for a real tap.
   *
   *   2. The panel's computed background-color is not transparent
   *      (rgba(0,0,0,0) / 'transparent'). Pre-fix this returned
   *      rgba(0,0,0,0); post-fix it's a real solid colour.
   *
   * If either assertion fails the user would see content from the page
   * behind the menu — i.e. the bleed-through bug.
   */
  const SUBMENU_BUTTONS = [
    { label: 'Add', trigger: '#toolbar-body .add' },
    { label: 'More', trigger: '#toolbar-body .more' },
  ] as const;

  /**
   * Every bottom popup on mobile must share a consistent dismiss
   * affordance: a back-arrow (←) in the BOTTOM-LEFT corner. This
   * matches the user's portrait mockup where the Add-blocks popup and
   * the ⋯ menu both show a circular ← button anchored bottom-left.
   * Same style, same position, same dismiss behavior across every
   * popup so the editor learns the gesture once.
   *
   * For each popup type below:
   *   - open it via its trigger
   *   - assert the dismiss affordance exists, is visible, is in the
   *     LEFT half of the panel and the BOTTOM quarter (bottom-left)
   *   - assert clicking it dismisses the panel
   */
  type PopupSpec = {
    label: string;
    setup: (page: import('@playwright/test').Page, helper: AdminUIHelper) => Promise<void>;
    panelSelector: string;
    closeSelector: string;
  };
  const POPUPS: PopupSpec[] = [
    {
      label: '⋯ dropdown menu',
      setup: async (page, helper) => {
        await helper.navigateToEdit('/test-page');
        await helper.clickBlockInIframe('block-1-uuid');
        await page.locator('.quanta-toolbar button:has-text("⋯")').click();
      },
      panelSelector: '.volto-hydra-dropdown-menu',
      closeSelector: '.volto-hydra-dropdown-menu .mobile-sheet-close',
    },
    {
      label: 'Frontend & Viewport panel',
      setup: async (page, helper) => {
        await helper.navigateToView('/test-page');
        await page.locator('#toolbar-frontend-switcher').click();
      },
      panelSelector: '.frontend-switcher-panel',
      closeSelector: '.frontend-switcher-panel .mobile-sheet-close',
    },
    {
      label: 'Add (Types) submenu',
      setup: async (page, helper) => {
        await helper.navigateToView('/test-page');
        await page.locator('#toolbar-body .add').click();
      },
      panelSelector: '#toolbar .toolbar-content.show',
      // MobileSubmenuClose portals the close button to document.body
      // (Volto's stock .toolbar-content has no injection point inside).
      // The button is at the same BOTTOM-LEFT viewport geometry but a
      // body-level sibling, not a panel descendant.
      closeSelector: 'body > .mobile-submenu-close',
    },
    {
      label: 'More submenu',
      setup: async (page, helper) => {
        await helper.navigateToView('/test-page');
        await page.locator('#toolbar-body .more').click();
      },
      panelSelector: '#toolbar .toolbar-content.show',
      closeSelector: 'body > .mobile-submenu-close',
    },
  ];

  for (const popup of POPUPS) {
    test(`bottom popup: ${popup.label} has a bottom-left back-arrow that dismisses it`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      const helper = new AdminUIHelper(page);
      await helper.login();
      await popup.setup(page, helper);

      const panel = page.locator(popup.panelSelector).first();
      await expect(
        panel,
        `${popup.label} did not open`,
      ).toBeVisible({ timeout: 3000 });
      await page.waitForTimeout(200); // animation settle

      const close = page.locator(popup.closeSelector).first();
      await expect(
        close,
        `${popup.label} must have a dismiss affordance at ${popup.closeSelector}`,
      ).toBeVisible({ timeout: 3000 });

      // BOTTOM-LEFT corner geometry:
      //   close.x is in the LEFT half of the panel (x < panel.midX)
      //   close.y is in the BOTTOM quarter of the panel
      const cb = await close.boundingBox();
      const pb = await panel.boundingBox();
      expect(cb).not.toBeNull();
      expect(pb).not.toBeNull();
      const panelMidX = pb!.x + pb!.width / 2;
      const panelBottomQuarter = pb!.y + (pb!.height * 3) / 4;
      expect(
        cb!.x,
        `${popup.label} dismiss must be in the LEFT half (panel midX=${panelMidX.toFixed(0)}, close x=${cb!.x.toFixed(0)})`,
      ).toBeLessThan(panelMidX);
      expect(
        cb!.y,
        `${popup.label} dismiss must be in the BOTTOM quarter (panel bottomQuarter=${panelBottomQuarter.toFixed(0)}, close y=${cb!.y.toFixed(0)})`,
      ).toBeGreaterThan(panelBottomQuarter);

      // And: clicking it actually dismisses the panel.
      await close.click();
      await expect(
        panel,
        `${popup.label} must dismiss after clicking its dismiss affordance`,
      ).not.toBeVisible({ timeout: 3000 });
    });
  }

  for (const btn of SUBMENU_BUTTONS) {
    test(`view mode: ${btn.label} menu is opaque (no iframe bleed-through)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      const helper = new AdminUIHelper(page);
      await helper.login();
      await helper.navigateToView('/test-page');

      await page.locator(btn.trigger).click();
      const panel = page.locator('#toolbar #toolbar-content, #toolbar .toolbar-content').first();
      await expect(panel).toBeVisible({ timeout: 3000 });
      // Let any open/transition settle so elementFromPoint is stable.
      await page.waitForTimeout(300);

      // Strong assertion 1: at the panel's centre, the topmost element
      // under the pointer must be the panel or a descendant of it.
      // If the panel were transparent and at low z-index (the original
      // bug), elementFromPoint would return the iframe behind it.
      const hit = await page.evaluate(() => {
        const tc = document.querySelector('#toolbar .toolbar-content.show');
        if (!tc) return { err: 'no .toolbar-content.show' };
        const r = tc.getBoundingClientRect();
        const cx = r.x + r.width / 2;
        const cy = r.y + r.height / 2;
        const el = document.elementFromPoint(cx, cy);
        if (!el) return { err: 'no element at point' };
        // Walk up to see whether the panel is in the ancestor chain.
        let cur: Element | null = el;
        let panelAncestor = false;
        while (cur) {
          if (cur === tc) { panelAncestor = true; break; }
          cur = cur.parentElement;
        }
        return {
          hitTag: el.tagName,
          hitId: el.id,
          hitClass: typeof el.className === 'string' ? el.className.slice(0, 80) : '',
          panelAncestor,
        };
      });
      expect(
        hit.panelAncestor,
        `${btn.label} menu must be hit-target at its own centre (not the iframe). Hit: ${JSON.stringify(hit)}`,
      ).toBe(true);

      // Strong assertion 2: the panel's computed background-color must
      // not be transparent. The original bug had `background: none`.
      const bg = await page.evaluate(() => {
        const tc = document.querySelector('#toolbar .toolbar-content.show');
        if (!tc) return null;
        return window.getComputedStyle(tc).backgroundColor;
      });
      expect(bg).not.toBeNull();
      expect(
        bg,
        `${btn.label} menu must have a non-transparent background-color (got: ${bg})`,
      ).not.toBe('rgba(0, 0, 0, 0)');
      expect(bg).not.toBe('transparent');
    });
  }
});

/**
 * Select-parent button (⬆) in Quanta toolbar.
 *
 * Spec: docs/superpowers/specs/2026-06-09-select-parent-quanta-button-design.md
 *
 * Promoted from the ⋯ dropdown's "Select Container" item to a visible
 * Quanta button so editors can escape one level upward in a single tap.
 * Always-visible on all viewports (matches Gutenberg). The handler is
 * the existing onSelectBlock prop — iframe sync rides the existing
 * selectedBlock-watching effect in View.jsx.
 *
 * Nested block used for these tests: `manual-teaser` lives inside
 * `block-8-grid` (a gridBlock) per
 * tests-playwright/fixtures/content/test-page/data.json.
 */
test.describe("Quanta select-parent button (⬆) — mobile layout", () => {
  test("button uses an SVG icon (regression: was a low-contrast unicode glyph)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit("/test-page");
    await helper.clickBlockInIframe("manual-teaser");

    const btn = page.locator(".quanta-toolbar .step-up-btn");
    await expect(btn).toBeVisible();
    await expect(
      btn.locator("svg"),
      "select-parent button must render an SVG icon (not a bare unicode glyph)",
    ).toBeVisible();
  });

  test("regression: ⋯ dropdown no longer offers Select Container", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit("/test-page");
    await helper.clickBlockInIframe("manual-teaser");

    await page.locator(".quanta-toolbar .volto-hydra-menu-trigger").click();
    const menu = page.locator(".volto-hydra-dropdown-menu");
    await expect(menu).toBeVisible();
    await expect(menu.locator(":text(\"Select Container\")")).toHaveCount(0);
  });

  test("mobile: button fits inside the 375px viewport (no clipping)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit("/test-page");
    await helper.clickBlockInIframe("manual-teaser");

    const btn = page.locator(".quanta-toolbar .step-up-btn");
    await expect(btn).toBeVisible();
    const box = await btn.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(375);
  });
});
test.describe('Editor Guide screenshots — mobile', () => {
  test.skip(!CAPTURE_SHOTS, 'set CAPTURE_MOBILE_SCREENSHOTS=1 to capture');

  test.beforeAll(() => {
    fs.mkdirSync(SHOTS_OUT_DIR, { recursive: true });
  });

  const snap = async (
    page: import('@playwright/test').Page,
    name: string,
  ) => {
    const file = path.join(SHOTS_OUT_DIR, `${name}.png`);
    await page.screenshot({ path: file, fullPage: false });
  };

  test('screenshot: mobile-block-selected — Quanta top + compact bottom toolbar', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    await helper.clickBlockInIframe('block-1-uuid');
    await page.waitForTimeout(300);

    await snap(page, 'mobile-block-selected');
  });

  test('screenshot: mobile-dropdown-menu — ⋯ menu as a bottom sheet', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    await helper.clickBlockInIframe('block-1-uuid');
    await page.locator('.quanta-toolbar .volto-hydra-menu-trigger').click();
    await expect(page.locator('.volto-hydra-dropdown-menu')).toBeVisible({
      timeout: 3000,
    });
    await page.waitForTimeout(300);

    await snap(page, 'mobile-dropdown-menu');
  });

  test('screenshot: mobile-sidebar-fullscreen — sidebar covers everything', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    // Open via the bottom-toolbar Settings shortcut (the mobile path).
    await page.locator('#toolbar-body .sidebar-toggle-toolbar-btn').click();
    await expect(page.locator('.sidebar-container')).toBeVisible({
      timeout: 3000,
    });
    await expect(page.locator('.sidebar-container.collapsed')).toHaveCount(0, {
      timeout: 3000,
    });
    await page.waitForTimeout(300);

    await snap(page, 'mobile-sidebar-fullscreen');
  });

  test('screenshot: mobile-select-parent — ⬆ button on a nested block', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    // manual-teaser lives inside block-8-grid → parent button appears.
    await helper.clickBlockInIframe('manual-teaser');
    await expect(page.locator('.quanta-toolbar .step-up-btn')).toBeVisible(
      { timeout: 3000 },
    );
    await page.waitForTimeout(300);

    await snap(page, 'mobile-select-parent');
  });
});
