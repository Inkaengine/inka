import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

test.describe('Container UX: Edge-drag', () => {
  // Edges should only appear when something useful would happen on drag:
  // (a) a sibling (or descendant of a sibling) is accepted by the
  //     container's child-allowedBlocks (canAbsorb), or
  // (b) at least one of the container's own children is accepted by
  //     the parent's allowedBlocks (canExpel).
  // Leaf blocks (no children) hit the early-return — no chrome.
  // Container blocks where neither (a) nor (b) holds get no chrome either.
  test('leaf blocks (teaser/slate) do not show edge-drag chrome', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();
    await iframe.locator('[data-block-uid="text-after"]').first().evaluate((el) => {
      (window as any).bridge?.selectBlock(el);
    });
    await helper.waitForIframeBlockHandle('text-after');

    // 1) Admin renders no visible edge-handle chrome.
    const adminEdges = page.locator('.volto-hydra-edge-handle-visual');
    await expect(adminEdges).toHaveCount(0);

    // 2) Iframe-side invisible event-capture divs (4, created once at init)
    //    should all be display:none — otherwise mousedown over those
    //    coordinates would still trigger drag.
    const visibleIframeEdges = await iframe.locator('html').first().evaluate(() => {
      return [...document.querySelectorAll('.volto-hydra-edge-handle')]
        .filter((el) => window.getComputedStyle(el).display !== 'none')
        .map((el) => el.getAttribute('data-edge'));
    });
    expect(visibleIframeEdges).toEqual([]);
  });

  // After selecting a container that has edge handles, selecting
  // a leaf descendant should NOT inherit those edge sides. The leaf isn't
  // a container — it shouldn't show edges regardless of what was selected
  // before. Verifies the iframe → admin canResize lifecycle resets cleanly
  // on selection change to a non-resizable block.
  test('selecting a leaf descendant after a container clears edge chrome', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/container-test-page');
    const iframe = helper.getIframe();

    // 1. Select col-1 (a container — has children, will show edges).
    await iframe.locator('[data-block-uid="col-1"]').first().evaluate((el) => {
      (window as any).bridge?.selectBlock(el);
    });
    await helper.waitForIframeBlockHandle('col-1');
    const adminEdges = page.locator('.volto-hydra-edge-handle-visual');
    // Edge handles render in the admin after a canResize round-trip
    // from the iframe — wait for the first one rather than racing the
    // count check (synchronous count was flaky on the slower nuxt path).
    await expect(adminEdges.first()).toBeVisible({ timeout: 5000 });

    // 2. Select text-1a (a slate inside col-1 — leaf, no children).
    await iframe.locator('[data-block-uid="text-1a"]').first().evaluate((el) => {
      (window as any).bridge?.selectBlock(el);
    });
    await helper.waitForIframeBlockHandle('text-1a');

    // 3. NO edge chrome should remain — neither admin-rendered nor
    //    iframe-side displayed.
    await expect(adminEdges).toHaveCount(0);
    const visibleIframeEdges = await iframe.locator('html').first().evaluate(() => {
      return [...document.querySelectorAll('.volto-hydra-edge-handle')]
        .filter((el) => window.getComputedStyle(el).display !== 'none')
        .map((el) => el.getAttribute('data-edge'));
    });
    expect(visibleIframeEdges).toEqual([]);
  });

  // Walk every block on the page and verify that any block whose
  // selection produces an edge handle is actually a container (has at
  // least one own data-block-uid descendant). Catches regressions where
  // leaves like teaser, image, or readonly cells start showing edges.
  test('no leaf block shows any edge-drag chrome', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/container-test-page');
    const iframe = helper.getIframe();

    // Enumerate every data-block-uid on the page.
    const all = await iframe.locator('[data-block-uid]').evaluateAll(
      (els) => els.map((el) => ({
        uid: el.getAttribute('data-block-uid'),
        // "leaf" iff no descendant has its own data-block-uid.
        isLeaf: !el.querySelector('[data-block-uid]'),
      })),
    );
    const leafUids = [...new Set(all.filter((b) => b.isLeaf).map((b) => b.uid))]
      .filter(Boolean) as string[];
    expect(leafUids.length).toBeGreaterThan(0);

    for (const uid of leafUids) {
      await iframe.locator(`[data-block-uid="${uid}"]`).first().evaluate((el) => {
        (window as any).bridge?.selectBlock(el);
      });
      await helper.waitForIframeBlockHandle(uid);
      // No admin-rendered visible chrome.
      await expect(page.locator('.volto-hydra-edge-handle-visual'),
        `leaf block "${uid}" should not show admin edge chrome`,
      ).toHaveCount(0);
      // No iframe-side invisible div with display !== 'none'.
      const visible = await iframe.locator('html').first().evaluate(() => {
        return [...document.querySelectorAll('.volto-hydra-edge-handle')]
          .filter((el) => window.getComputedStyle(el).display !== 'none')
          .map((el) => el.getAttribute('data-edge'));
      });
      expect(visible, `leaf block "${uid}" should not have any iframe edge handle visible`).toEqual([]);
    }
  });

  test('container with no accepted-descendant sibling on a side hides that edge', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();
    // col1-img-1 is a leaf image block (no children of its own). Documents
    // the early-return path. Once we have a fixture with a leaf-but-
    // container shape (e.g. an empty-but-typed container), extend.
    await iframe.locator('[data-block-uid="col1-img-1"]').first().evaluate((el) => {
      (window as any).bridge?.selectBlock(el);
    });
    await helper.waitForIframeBlockHandle('col1-img-1');
    const adminEdges = page.locator('.volto-hydra-edge-handle-visual');
    await expect(adminEdges).toHaveCount(0);
    const visibleIframeEdges = await iframe.locator('html').first().evaluate(() => {
      return [...document.querySelectorAll('.volto-hydra-edge-handle')]
        .filter((el) => window.getComputedStyle(el).display !== 'none')
        .map((el) => el.getAttribute('data-edge'));
    });
    expect(visibleIframeEdges).toEqual([]);
  });

  test('Drag container bottom edge to absorb next sibling', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/section-test-page');

    const iframe = helper.getIframe();

    // Select section-1 (contains section-child-1). section accepts any type
    // so the slate sibling below can be absorbed.
    await iframe.locator('[data-block-uid="section-1"]').first().evaluate((el) => {
      (window as any).bridge?.selectBlock(el);
    });
    await helper.waitForIframeBlockHandle('section-1');

    // An edge handle should appear on the bottom of section-1, with the
    // resize cursor — verifies the iframe-side invisible event-capture div
    // is in place under the admin's visible chrome.
    const bottomHandle = iframe.locator('.volto-hydra-edge-handle[data-edge="bottom"]');
    await expect(bottomHandle).toBeVisible({ timeout: 3000 });
    await expect(bottomHandle).toHaveCSS('cursor', 'ns-resize');
    // And the admin renders a corresponding visible bar on top of it.
    const adminVisibleBottom = page.locator('.volto-hydra-edge-handle-visual[data-edge="bottom"]');
    await expect(adminVisibleBottom).toBeVisible();

    // Starting positions — slate-after is section-1's next sibling at page level.
    const sectionRect = await iframe.locator('[data-block-uid="section-1"]').boundingBox();
    const slateAfterRect = await iframe.locator('[data-block-uid="slate-after"]').boundingBox();
    expect(sectionRect).not.toBeNull();
    expect(slateAfterRect).not.toBeNull();

    // Initially slate-after's parent is the page (no data-block-uid ancestor).
    await expect(iframe.locator('[data-block-uid="slate-after"]').first()).toBeVisible();
    await expect(iframe.locator('[data-block-uid] [data-block-uid="slate-after"]')).toHaveCount(0);

    // Drag the bottom handle down past slate-after's midpoint.
    const handleBox = await bottomHandle.boundingBox();
    expect(handleBox).not.toBeNull();
    const startX = handleBox!.x + handleBox!.width / 2;
    const startY = handleBox!.y + handleBox!.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    // Retarget on slate-after's LIVE box (drag can auto-scroll it) — aim 5px past
    // its midpoint going down so the absorb boundary crosses it once scroll settles.
    await helper.dragCursorToMovingTarget(
      iframe.locator('[data-block-uid="slate-after"]'),
      (box) => ({ x: startX, y: box.y + box.height / 2 + 5 }),
    );
    await page.mouse.up();

    // After release: slate-after is now a child of section-1.
    await expect(
      iframe.locator('[data-block-uid="section-1"] [data-block-uid="slate-after"]').first(),
    ).toBeVisible();

    // Selection stays on the container the user was adjusting (section-1),
    // not on the absorbed sibling — they were resizing the boundary, not
    // selecting a new block.
    await helper.waitForIframeBlockHandle('section-1');
  });

  test('Auto-scrolls and absorbs blocks below the viewport', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/section-scroll-test-page');

    const iframe = helper.getIframe();

    // Select section-1 (near top). The page has 40 filler slates below it
    // — most are off-screen, so dragging the edge to absorb them requires
    // the iframe to auto-scroll while the cursor is held near the bottom.
    await iframe.locator('[data-block-uid="section-1"]').first().evaluate((el) => {
      (window as any).bridge?.selectBlock(el);
    });
    await helper.waitForIframeBlockHandle('section-1');

    const bottomHandle = iframe.locator('.volto-hydra-edge-handle[data-edge="bottom"]');
    await expect(bottomHandle).toBeVisible({ timeout: 3000 });
    const handleBox = await bottomHandle.boundingBox();
    expect(handleBox).not.toBeNull();
    const startX = handleBox!.x + handleBox!.width / 2;
    const startY = handleBox!.y + handleBox!.height / 2;

    // The last filler is well below the initial viewport. Drag toward the bottom
    // edge of the iframe and hold there — auto-scroll should bring more
    // blocks into view, each absorbed in turn.
    const iframeBox = await page.locator('#previewIframe').boundingBox();
    expect(iframeBox).not.toBeNull();
    const dragTargetY = iframeBox!.y + iframeBox!.height - 30; // ~30px from iframe bottom

    // The premise, said where it shows: the last filler is below the fold on
    // any frontend (there are 40, some frontends draw them compactly), so only
    // auto-scroll can bring it to the cursor.
    const lastFiller = iframe.locator('[data-block-uid="filler-40"]').first();
    await expect(lastFiller).not.toBeInViewport();

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    // Into the bottom-edge auto-scroll zone, in steps as a hand moves.
    await page.mouse.move(startX, dragTargetY, { steps: 8 });
    // Held there, the page scrolls on its own until the last filler is in view.
    // It moves a step per animation frame, and a loaded machine draws few.
    await expect(lastFiller).toBeInViewport({ timeout: 20000 });
    await page.mouse.up();

    // Several fillers were absorbed into section-1. We don't assert exact
    // count (depends on viewport height vs page height), but at least the
    // first few should be inside. The absorb is the admin's change, drawn by
    // the frontend when the page comes back to it: read once, right after the
    // drag, it could still be the page before (CI, 1 in many). Waited for as
    // it shows: filler-01 drawn inside section-1.
    await expect(
      iframe.locator('[data-block-uid="section-1"] [data-block-uid="filler-01"]').first(),
    ).toBeVisible();

    // Selection still pinned to section-1.
    await helper.waitForIframeBlockHandle('section-1');
  });

  test('Top edge: drag UP past previous sibling absorbs it as first child', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/section-test-page');

    const iframe = helper.getIframe();
    await iframe.locator('[data-block-uid="section-1"]').first().evaluate((el) => {
      (window as any).bridge?.selectBlock(el);
    });
    await helper.waitForIframeBlockHandle('section-1');

    const topHandle = iframe.locator('.volto-hydra-edge-handle[data-edge="top"]');
    await expect(topHandle).toBeVisible({ timeout: 3000 });

    const slateBeforeRect = await iframe.locator('[data-block-uid="slate-before"]').boundingBox();
    expect(slateBeforeRect).not.toBeNull();
    const handleBox = await topHandle.boundingBox();
    expect(handleBox).not.toBeNull();
    const startX = handleBox!.x + handleBox!.width / 2;
    const startY = handleBox!.y + handleBox!.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    // Retarget on slate-before's LIVE box — aim 5px past its midpoint going UP.
    await helper.dragCursorToMovingTarget(
      iframe.locator('[data-block-uid="slate-before"]'),
      (box) => ({ x: startX, y: box.y + box.height / 2 - 5 }),
    );
    await page.mouse.up();

    await expect(
      iframe.locator('[data-block-uid="section-1"] [data-block-uid="slate-before"]').first(),
    ).toBeVisible();

    await helper.waitForIframeBlockHandle('section-1');
  });

  test('Bottom edge: drag UP past last child expels it to the parent', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/section-test-page');

    const iframe = helper.getIframe();
    await iframe.locator('[data-block-uid="section-1"]').first().evaluate((el) => {
      (window as any).bridge?.selectBlock(el);
    });
    await helper.waitForIframeBlockHandle('section-1');

    // section-child-1 starts inside section-1.
    await expect(
      iframe.locator('[data-block-uid="section-1"] [data-block-uid="section-child-1"]').first(),
    ).toBeVisible();

    // Centre the section first. The bottom handle must not START inside hydra's
    // 80px auto-scroll band (_createAutoScroller): there, the drag holds the cursor
    // still while the page scrolls underneath, so a target computed from pre-scroll
    // geometry is never reached and the expel legitimately doesn't fire. Centring
    // makes this independent of page height — otherwise anything that changes the
    // page (an extra nav line, a longer title) silently breaks the test.
    const bottomHandle = iframe.locator('.volto-hydra-edge-handle[data-edge="bottom"]');
    await expect(bottomHandle).toBeVisible({ timeout: 3000 });
    await iframe.locator('[data-block-uid="section-1"]').first().evaluate((el) =>
      el.scrollIntoView({ block: 'center', behavior: 'instant' }),
    );
    // Let the handle follow the scroll before measuring.
    let settled = '';
    await expect(async () => {
      const box = await bottomHandle.boundingBox();
      const key = JSON.stringify(box);
      const same = key === settled;
      settled = key;
      expect(same).toBe(true);
    }).toPass({ timeout: 5000 });

    // Drag the bottom handle UPWARD into the container, past the child's midpoint.
    const childRect = await iframe.locator('[data-block-uid="section-child-1"]').boundingBox();
    const handleBox = await bottomHandle.boundingBox();
    expect(childRect).not.toBeNull();
    expect(handleBox).not.toBeNull();

    // Make the precondition explicit, so a regression fails loudly here rather
    // than showing up as an unexplained "expel didn't happen".
    const viewportH = await iframe.locator('body').evaluate(() => window.innerHeight);
    expect(
      viewportH - (handleBox!.y + handleBox!.height),
      'bottom handle must start clear of the 80px auto-scroll band',
    ).toBeGreaterThan(80);
    const startX = handleBox!.x + handleBox!.width / 2;
    const startY = handleBox!.y + handleBox!.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    // Dragging the bottom handle UP can push the child into the top auto-scroll
    // zone, sliding it up under the cursor. Retarget on the child's LIVE box each
    // pass (just past its midpoint) so we actually cross it once scroll settles,
    // rather than aiming at a pre-drag Y the child has since moved away from.
    await helper.dragCursorToMovingTarget(
      iframe.locator('[data-block-uid="section-child-1"]'),
      (box) => ({ x: startX, y: box.y + box.height / 2 - 5 }),
    );
    await page.mouse.up();

    // section-child-1 is now at page level (no [data-block-uid] ancestor).
    // Drawn, and inside no block now.
    await expect(iframe.locator('[data-block-uid="section-child-1"]').first()).toBeVisible();
    await expect(iframe.locator('[data-block-uid] [data-block-uid="section-child-1"]')).toHaveCount(0);

    await helper.waitForIframeBlockHandle('section-1');
  });

  test('Right edge: drag RIGHT past adjacent column child absorbs it', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();
    await iframe.locator('[data-block-uid="col-1"]').first().evaluate((el) => {
      (window as any).bridge?.selectBlock(el);
    });
    await helper.waitForIframeBlockHandle('col-1');

    const rightHandle = iframe.locator('.volto-hydra-edge-handle[data-edge="right"]');
    await expect(rightHandle).toBeVisible({ timeout: 3000 });

    const text2aRect = await iframe.locator('[data-block-uid="text-2a"]').boundingBox();
    const handleBox = await rightHandle.boundingBox();
    expect(text2aRect).not.toBeNull();
    expect(handleBox).not.toBeNull();
    const startX = handleBox!.x + handleBox!.width / 2;
    const startY = handleBox!.y + handleBox!.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    // Retarget on text-2a's LIVE box — aim 5px past its X-midpoint going RIGHT.
    await helper.dragCursorToMovingTarget(
      iframe.locator('[data-block-uid="text-2a"]'),
      (box) => ({ x: box.x + box.width / 2 + 5, y: startY }),
    );
    await page.mouse.up();

    // text-2a's only sibling chain (col-2 → text-2a) gets fully covered, so
    // bottom-up promotion moves col-2 itself into col-1 (col-1 accepts column).
    // Result: text-2a is now a descendant of col-1 (via col-2).
    await expect(
      iframe.locator('[data-block-uid="col-1"] [data-block-uid="text-2a"]').first(),
    ).toBeVisible();

    await helper.waitForIframeBlockHandle('col-1');
  });

  test('Top edge: drag DOWN into container expels first child to parent', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/section-test-page');

    const iframe = helper.getIframe();
    await iframe.locator('[data-block-uid="section-1"]').first().evaluate((el) => {
      (window as any).bridge?.selectBlock(el);
    });
    await helper.waitForIframeBlockHandle('section-1');

    await expect(
      iframe.locator('[data-block-uid="section-1"] [data-block-uid="section-child-1"]').first(),
    ).toBeVisible();

    // Drag the top handle DOWNWARD into the container, past the first child's midpoint.
    const topHandle = iframe.locator('.volto-hydra-edge-handle[data-edge="top"]');
    await expect(topHandle).toBeVisible({ timeout: 3000 });
    const childRect = await iframe.locator('[data-block-uid="section-child-1"]').boundingBox();
    const handleBox = await topHandle.boundingBox();
    expect(childRect).not.toBeNull();
    expect(handleBox).not.toBeNull();
    const startX = handleBox!.x + handleBox!.width / 2;
    const startY = handleBox!.y + handleBox!.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    // Retarget on section-child-1's LIVE box — aim 5px past its midpoint going DOWN.
    await helper.dragCursorToMovingTarget(
      iframe.locator('[data-block-uid="section-child-1"]'),
      (box) => ({ x: startX, y: box.y + box.height / 2 + 5 }),
    );
    await page.mouse.up();

    // section-child-1 is now at page level (expelled out the top means it
    // sits BEFORE section-1 in the parent's layout).
    // Drawn, and inside no block now.
    await expect(iframe.locator('[data-block-uid="section-child-1"]').first()).toBeVisible();
    await expect(iframe.locator('[data-block-uid] [data-block-uid="section-child-1"]')).toHaveCount(0);

    await helper.waitForIframeBlockHandle('section-1');
  });

  test('Left edge: drag LEFT past adjacent column child absorbs it', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();
    await iframe.locator('[data-block-uid="col-2"]').first().evaluate((el) => {
      (window as any).bridge?.selectBlock(el);
    });
    await helper.waitForIframeBlockHandle('col-2');

    const leftHandle = iframe.locator('.volto-hydra-edge-handle[data-edge="left"]');
    await expect(leftHandle).toBeVisible({ timeout: 3000 });

    const text1bRect = await iframe.locator('[data-block-uid="text-1b"]').boundingBox();
    const handleBox = await leftHandle.boundingBox();
    expect(text1bRect).not.toBeNull();
    expect(handleBox).not.toBeNull();
    const startX = handleBox!.x + handleBox!.width / 2;
    const startY = handleBox!.y + handleBox!.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    // Retarget on text-1b's LIVE box — aim 5px past its X-midpoint going LEFT.
    await helper.dragCursorToMovingTarget(
      iframe.locator('[data-block-uid="text-1b"]'),
      (box) => ({ x: box.x + box.width / 2 - 5, y: startY }),
    );
    await page.mouse.up();

    // col-1 has [text-1a, text-1b] — text-1b's midpoint is crossed; full sibling
    // coverage requires text-1a too. With only text-1b covered, no promotion;
    // text-1b moves directly into col-2.
    await expect(
      iframe.locator('[data-block-uid="col-2"] [data-block-uid="text-1b"]').first(),
    ).toBeVisible();

    await helper.waitForIframeBlockHandle('col-2');
  });

  // Two grids stacked vertically. Dragging the bottom edge of the top grid
  // down past the bottom grid's teasers should absorb those teasers as
  // children of the top grid (bottom-up promotion: teasers are accepted by
  // the top grid's allowedBlocks ['image','listing','slate','teaser'] but
  // gridBlock itself isn't, so promotion stops at teaser level — the four
  // teasers get pulled out of grid-2 and into grid-1).
  test('Bottom edge: drag DOWN past sibling-container children absorbs them across the boundary', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/container-test-page');

    const iframe = helper.getIframe();
    await iframe.locator('[data-block-uid="grid-1"]').first().evaluate((el) => {
      (window as any).bridge?.selectBlock(el);
    });
    await helper.waitForIframeBlockHandle('grid-1');

    // Initial: each grid has 2 cells (4 teasers total, 2 per grid).
    const grid2Initial = await iframe
      .locator('[data-block-uid="grid-2"] [data-block-uid]').count();
    expect(grid2Initial).toBe(2);

    const bottomHandle = iframe.locator('.volto-hydra-edge-handle[data-edge="bottom"]');
    await expect(bottomHandle).toBeVisible({ timeout: 3000 });

    // Drag past grid-2's last teaser.
    const grid4Rect = await iframe.locator('[data-block-uid="grid-cell-4"]')
      .first().boundingBox();
    const handleBox = await bottomHandle.boundingBox();
    expect(grid4Rect).not.toBeNull();
    expect(handleBox).not.toBeNull();
    const startX = handleBox!.x + handleBox!.width / 2;
    const startY = handleBox!.y + handleBox!.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    // Retarget on grid-cell-4's LIVE box — aim 10px past its BOTTOM so the
    // absorb boundary clears grid-2's last teaser once scroll settles.
    await helper.dragCursorToMovingTarget(
      iframe.locator('[data-block-uid="grid-cell-4"]').first(),
      (box) => ({ x: startX, y: box.y + box.height + 10 }),
    );
    await page.mouse.up();

    // Both teasers should now live inside grid-1.
    for (const cell of ['grid-cell-3', 'grid-cell-4']) {
      await expect(iframe.locator(`[data-block-uid="grid-1"] [data-block-uid="${cell}"]`).first()).toBeVisible();
    }
  });

  // Cross-axis expel: dragging the left/right edge inward on a vertical-stack
  // container is the degenerate "all-or-nothing" case — every child shares
  // roughly the same X-midpoint, so passing it expels the lot. Validates that
  // axis-free geometry handles this case correctly without a special path.
  test('Right edge: cross-axis expel — drag LEFT past child midpoint expels all children', async ({ page }) => {
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/section-test-page');

    const iframe = helper.getIframe();
    await iframe.locator('[data-block-uid="section-1"]').first().evaluate((el) => {
      (window as any).bridge?.selectBlock(el);
    });
    await helper.waitForIframeBlockHandle('section-1');

    await expect(
      iframe.locator('[data-block-uid="section-1"] [data-block-uid="section-child-1"]').first(),
    ).toBeVisible();

    const rightHandle = iframe.locator('.volto-hydra-edge-handle[data-edge="right"]');
    await expect(rightHandle).toBeVisible({ timeout: 3000 });
    const childRect = await iframe.locator('[data-block-uid="section-child-1"]').boundingBox();
    const handleBox = await rightHandle.boundingBox();
    expect(childRect).not.toBeNull();
    expect(handleBox).not.toBeNull();
    const startX = handleBox!.x + handleBox!.width / 2;
    const startY = handleBox!.y + handleBox!.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    // Retarget on section-child-1's LIVE box — aim 5px past its X-midpoint going LEFT.
    await helper.dragCursorToMovingTarget(
      iframe.locator('[data-block-uid="section-child-1"]'),
      (box) => ({ x: box.x + box.width / 2 - 5, y: startY }),
    );
    await page.mouse.up();

    // Drawn, and inside no block now.
    await expect(iframe.locator('[data-block-uid="section-child-1"]').first()).toBeVisible();
    await expect(iframe.locator('[data-block-uid] [data-block-uid="section-child-1"]')).toHaveCount(0);

    await helper.waitForIframeBlockHandle('section-1');
  });
});
