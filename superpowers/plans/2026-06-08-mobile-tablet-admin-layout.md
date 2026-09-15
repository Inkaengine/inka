# Mobile + Tablet Admin Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-06-08-mobile-tablet-admin-layout-design.md`
**Branch:** `feat/mobile-tablet-admin-layout`
**Draft PR:** #226

**Goal:** Ship the three-breakpoint admin layout (desktop unchanged, tablet 601–1023px, mobile ≤600px) with the 4 mobile affordances (#142 toolbar swap, #143 bottom-sheet popups, #144 full-screen sidebar, #145 chevron move buttons) — entirely via CSS media queries plus a small set of always-rendered hidden-on-desktop JSX additions.

**Architecture:** CSS-only via `@media` queries. Four JSX additions (chevrons ▲▼ in Quanta, back-arrow buttons in ⋯ and + popups, close X in sidebar) hidden on desktop with `display: none`. New buttons reuse existing handlers. No `isMobile` state, no `matchMedia` listener, no JSX branching by viewport.

**Tech Stack:** CSS3 media queries, React (JSX additions only — no new state), existing Volto/Hydra move-block actions, Playwright (single new layout spec).

---

## Conventions used in this plan

### Z-index ladder (use these constants, not arbitrary numbers)

| Layer | z-index | What lives here |
|---|---|---|
| iframe | 0 (default) | The preview iframe canvas |
| Toolbars | 100 | Main toolbar + Quanta toolbar (they live on opposite screen edges; same z-index is fine) |
| Sheet backdrop | 200 | Semi-opaque dim behind bottom sheets |
| Sheet popup | 201 | The ⋯ / + bottom sheets themselves |
| Full-screen sidebar | 300 | Covers everything when sidebar is open on mobile |

Set these in CSS custom properties at the top of each mobile CSS block so the plan reviewer (and the next person to touch this) can see the ladder at a glance.

### Inline-style overrides

`SyncedSlateToolbar.jsx:1224` styles `.quanta-toolbar` with inline `position: fixed; top/left/maxWidth/zIndex` driven by JS-calculated coordinates. Inline styles beat external CSS — so mobile CSS overriding Quanta's position MUST use `!important`. This is the only place in this plan that uses `!important`, and it's scoped to `@media (max-width: 600px)`. Out of scope: refactoring the inline styles to classes (would touch desktop CSS unnecessarily).

### File-naming convention

All new mobile/tablet CSS lives in `packages/volto-hydra/src/components/mobile-tablet.css`, imported once from `packages/volto-hydra/src/index.js` after the existing addon styles. One file makes the "is this CSS only?" check trivial in code review.

---

## File Structure

**Create:**
- `packages/volto-hydra/src/components/mobile-tablet.css` — the single source of all `@media (max-width: ...)` rules for this work.
- `tests-playwright/integration/mobile-tablet-admin-layout.spec.ts` — three describe-blocks (desktop control, tablet, mobile) covering layout positions and the mobile interactions.

**Modify (JSX additions only — each component gets 1 always-rendered button, hidden on desktop via the new CSS file):**
- `packages/volto-hydra/src/components/Toolbar/SyncedSlateToolbar.jsx` — add ▲ / ▼ chevron buttons next to the drag handle (Task 6).
- `packages/volto-hydra/src/components/Toolbar/DropdownMenu.jsx` (or the actual `⋯` popup component, verified in Task 4) — add a back-arrow button.
- `packages/volto-hydra/src/components/[BlockChooser]/[the + popup component]` — verified path in Task 4 — add a back-arrow button.
- `packages/volto-hydra/src/customizations/volto/components/manage/Sidebar/Sidebar.jsx` — add a close (X) button in the sidebar header.
- `packages/volto-hydra/src/index.js` — `import './components/mobile-tablet.css';` once.

**Reference only (no changes):**
- `packages/volto-hydra/src/customizations/volto/components/manage/Sidebar/Sidebar.css` — existing sidebar styles; the mobile rules in the new file cascade on top.
- `packages/volto-hydra/src/components/Iframe/styles.css` — existing iframe container styles; reference for tablet/mobile positioning.

---

## Task 1: Lock in "desktop unchanged" with a control test

**Why first:** Every later task asserts the desktop layout is byte-for-byte unchanged. We write that assertion *before* changing anything else, so a regression fails immediately.

**Files:**
- Create: `tests-playwright/integration/mobile-tablet-admin-layout.spec.ts`

- [ ] **Step 1: Write the desktop control test**

```ts
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

test.describe('Admin layout — desktop control (≥1024px)', () => {
  test('main toolbar on the left, sidebar on the right, drag handle visible, no chevrons', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');
    await helper.clickBlockInIframe('block-1-uuid');

    const toolbar = page.locator('#toolbar');
    const sidebar = page.locator('#sidebar');
    const dragHandle = page.locator('.quanta-toolbar .drag-handle');
    // Chevrons aren't in the DOM yet (added in Task 6). Use toHaveCount(0)
    // here; Task 6 Step 8 updates these two assertions to
    // toHaveCSS('display', 'none') once the buttons are always-rendered.
    const chevronUp = page.locator('.quanta-toolbar .chevron-up');
    const chevronDown = page.locator('.quanta-toolbar .chevron-down');

    const tb = await toolbar.boundingBox();
    const sb = await sidebar.boundingBox();
    expect(tb, '#toolbar bounding box').not.toBeNull();
    expect(sb, '#sidebar bounding box').not.toBeNull();

    // toolbar pinned to left edge, sidebar to right edge
    expect(tb!.x).toBeLessThan(50);
    expect(sb!.x + sb!.width).toBeGreaterThan(1280 - 50);
    expect(tb!.x + tb!.width).toBeLessThan(sb!.x); // no overlap

    await expect(dragHandle).toBeVisible();
    await expect(chevronUp).toHaveCount(0); // chevrons not in the DOM yet — switches to .toHaveCSS('display','none') after Task 6
    await expect(chevronDown).toHaveCount(0);
  });
});
```

- [ ] **Step 2: Run to verify it passes against the unchanged codebase**

```bash
pnpm exec playwright test tests-playwright/integration/mobile-tablet-admin-layout.spec.ts --project=admin-mock --reporter=line
```

Expected: PASS. If it fails, the assumptions about current desktop layout are wrong — STOP and re-audit.

- [ ] **Step 3: Commit**

```bash
git add tests-playwright/integration/mobile-tablet-admin-layout.spec.ts
git commit -m "test(mobile): desktop-control layout assertion (locks 'desktop unchanged')

Asserts the current desktop layout (main toolbar left, sidebar right,
drag handle visible, no chevrons). Every subsequent task in the
mobile-tablet plan must keep this green — that's the proof the
@media-scoped changes don't leak to desktop."
```

---

## Task 2: Create the mobile-tablet.css scaffold + tablet toolbar swap (#142 tablet half)

**Why:** Tablet is the simplest change (one positioning swap). Doing it first proves the scaffolding (new CSS file, import wiring, media-query targeting) before adding mobile complexity.

**Files:**
- Create: `packages/volto-hydra/src/components/mobile-tablet.css`
- Modify: `packages/volto-hydra/src/index.js` (add `import './components/mobile-tablet.css';`)
- Modify: `tests-playwright/integration/mobile-tablet-admin-layout.spec.ts` (add tablet describe-block)

- [ ] **Step 1: Write the failing tablet test**

Append to the spec file:

```ts
test.describe('Admin layout — tablet (601–1023px)', () => {
  test('order left-to-right: canvas, sidebar, toolbar', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');

    const toolbar = page.locator('#toolbar');
    const sidebar = page.locator('#sidebar');

    const tb = await toolbar.boundingBox();
    const sb = await sidebar.boundingBox();
    expect(tb, '#toolbar bounding box').not.toBeNull();
    expect(sb, '#sidebar bounding box').not.toBeNull();

    // toolbar pinned to RIGHT edge on tablet (was left on desktop)
    expect(tb!.x + tb!.width).toBeGreaterThan(768 - 50);
    // sidebar sits between canvas and toolbar
    expect(sb!.x + sb!.width).toBeLessThanOrEqual(tb!.x);
  });
});
```

- [ ] **Step 2: Run — should fail (toolbar is still on the left at 768px)**

```bash
pnpm exec playwright test tests-playwright/integration/mobile-tablet-admin-layout.spec.ts --project=admin-mock --grep "tablet" --reporter=line
```

Expected: FAIL — toolbar still pinned to `left: 0`.

- [ ] **Step 3: Create the CSS scaffold and tablet rule**

```css
/* packages/volto-hydra/src/components/mobile-tablet.css
 *
 * All `@media (max-width: ...)` rules for the mobile + tablet admin
 * layout. Desktop (≥1024px) inherits NO rules from this file — verify
 * via the desktop control test in mobile-tablet-admin-layout.spec.ts.
 *
 * Z-index ladder (set as custom properties so the rules below stay
 * legible):
 *   --hydra-z-toolbars:        100
 *   --hydra-z-sheet-backdrop:  200
 *   --hydra-z-sheet:           201
 *   --hydra-z-sidebar-mobile:  300
 *
 * Inline-style note: .quanta-toolbar is inline-styled in
 * SyncedSlateToolbar.jsx (top/left/maxWidth driven by JS-calculated
 * coordinates). Mobile rules that override its position MUST use
 * !important — scoped strictly to @media (max-width: 600px).
 */

:root {
  --hydra-z-toolbars: 100;
  --hydra-z-sheet-backdrop: 200;
  --hydra-z-sheet: 201;
  --hydra-z-sidebar-mobile: 300;
}

/* ─── Tablet (601–1023px) ─────────────────────────────────────────── */
@media (min-width: 601px) and (max-width: 1023px) {
  /* Move the main Volto toolbar from its desktop left-edge position to
   * the far right of the sidebar. The sidebar's natural right-edge
   * positioning is unchanged; the toolbar slides past it. */
  #toolbar {
    left: auto !important;
    right: 0 !important;
  }
  /* Sidebar pulls left so the toolbar's width has somewhere to go.
   * 60px matches the toolbar's measured width on desktop (verified in
   * Step 5 below — `page.locator('#toolbar').boundingBox()` returns
   * width=60 on the current main branch). If the toolbar width ever
   * changes, update this literal and the verification in Step 5. */
  #sidebar {
    right: 60px !important;
  }
}
```

- [ ] **Step 4: Wire the import**

In `packages/volto-hydra/src/index.js`, add (placement: alongside other CSS imports near the top):

```js
import './components/mobile-tablet.css';
```

Volto needs a restart to pick up the new file (HMR doesn't recognise newly-imported assets at the addon level).

- [ ] **Step 5: Restart Volto, re-run the tablet test**

```bash
lsof -ti:3001,3002 2>/dev/null | xargs kill -9 2>/dev/null
pnpm start:test &
until curl -sf http://localhost:3002/health > /dev/null; do sleep 3; done
pnpm exec playwright test tests-playwright/integration/mobile-tablet-admin-layout.spec.ts --project=admin-mock --reporter=line
```

Expected: PASS — desktop control + tablet both green.

> **Verify the 60px literal in the sidebar rule:** before declaring this task done, run a one-off in the dev console:
> `JSON.stringify((await page.locator('#toolbar').boundingBox()).width)` and confirm it's 60. If it differs, update the CSS rule's literal to match and re-run.

- [ ] **Step 6: Commit**

```bash
git add packages/volto-hydra/src/components/mobile-tablet.css \
        packages/volto-hydra/src/index.js \
        tests-playwright/integration/mobile-tablet-admin-layout.spec.ts
git commit -m "feat(mobile): tablet layout (toolbar to right of sidebar)

Adds mobile-tablet.css with the z-index ladder + tablet rule. Toolbar
moves from left-edge to right-edge on 601-1023px; sidebar shifts left
by the toolbar's width. Desktop CSS untouched (control test green)."
```

---

## Task 3: Mobile toolbar layout (#142 mobile half)

**Why:** This is the visible-immediately part of mobile. Everything else (sheets, sidebar, chevrons) goes inside the layout this task creates.

**Files:**
- Modify: `packages/volto-hydra/src/components/mobile-tablet.css`
- Modify: `tests-playwright/integration/mobile-tablet-admin-layout.spec.ts`

- [ ] **Step 1: Write the failing mobile-layout test**

Append to the spec file:

```ts
test.describe('Admin layout — mobile (≤600px)', () => {
  test('quanta pinned top, main toolbar pinned bottom, iframe canvas between', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const helper = new AdminUIHelper(page);
    await helper.login();
    await helper.navigateToEdit('/test-page');
    await helper.clickBlockInIframe('block-1-uuid');

    const quanta = page.locator('.quanta-toolbar');
    const toolbar = page.locator('#toolbar');
    const iframe = page.locator('#previewIframe');

    const qb = await quanta.boundingBox();
    const tb = await toolbar.boundingBox();
    const ib = await iframe.boundingBox();
    expect(qb).not.toBeNull(); expect(tb).not.toBeNull(); expect(ib).not.toBeNull();

    expect(qb!.y).toBeLessThan(20); // quanta pinned to top
    expect(tb!.y + tb!.height).toBeGreaterThan(812 - 20); // main toolbar pinned to bottom
    expect(ib!.y).toBeGreaterThanOrEqual(qb!.height - 1);
    expect(ib!.y + ib!.height).toBeLessThanOrEqual(tb!.y + 1);
  });
});
```

- [ ] **Step 2: Run — should fail (no mobile rules yet)**

Expected: FAIL.

- [ ] **Step 3: Add mobile CSS block**

Append to `mobile-tablet.css`:

```css
/* ─── Mobile (≤600px) ─────────────────────────────────────────────── */
@media (max-width: 600px) {

  /* Quanta toolbar: pinned to top, full-width.
   * !important because SyncedSlateToolbar.jsx inline-styles position. */
  .quanta-toolbar {
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    right: 0 !important;
    max-width: none !important;
    width: 100% !important;
    z-index: var(--hydra-z-toolbars) !important;
    border-radius: 0 !important;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08) !important;
  }

  /* Main Volto toolbar: pinned to bottom, full-width, safe-area-aware. */
  #toolbar {
    top: auto !important;
    bottom: 0 !important;
    left: 0 !important;
    right: 0 !important;
    width: 100% !important;
    height: auto !important;
    padding-bottom: env(safe-area-inset-bottom) !important;
    z-index: var(--hydra-z-toolbars) !important;
    flex-direction: row !important;
  }

  /* Iframe canvas: fills the area between Quanta top and main toolbar bottom.
   * 100dvh accounts for iOS Safari's collapsing address bar.
   *
   * Literals 44px (Quanta) and 56px (main toolbar) are measured values
   * — verified in Step 4 below via boundingBox(). If either toolbar's
   * intrinsic height changes, update the literal AND the verification.
   * Deliberately NOT using CSS custom-property fallbacks (`var(..., 44px)`)
   * — fallback-only vars hide the literal and violate the project's
   * no-fallback rule (CLAUDE.md / feedback_no_fallbacks). */
  #previewIframe,
  .iframe-container {
    position: fixed !important;
    top: 44px !important;
    bottom: 56px !important;
    left: 0 !important;
    right: 0 !important;
    width: 100% !important;
    height: auto !important;
  }
}
```

- [ ] **Step 4: Verify the 44px / 56px height literals**

In the mobile test, after Quanta + toolbar are visible, log their measured heights:

```ts
const qb = await quanta.boundingBox();
const tb = await toolbar.boundingBox();
console.log(`MEASURED quanta height: ${qb!.height}, toolbar height: ${tb!.height}`);
```

Run once. The mobile layout test should still assert `ib!.y >= qb!.height - 1` and `ib!.y + ib!.height <= tb!.y + 1` (those are tolerance-based and don't bake in a literal). If the measured heights differ from 44/56 by more than ~4px, update the CSS literals and the comment. Remove the `console.log` before commit.

- [ ] **Step 5: Re-run, verify mobile test passes + desktop + tablet stay green**

```bash
pnpm exec playwright test tests-playwright/integration/mobile-tablet-admin-layout.spec.ts --project=admin-mock --reporter=line
```

Expected: all 3 describe-blocks PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/volto-hydra/src/components/mobile-tablet.css \
        tests-playwright/integration/mobile-tablet-admin-layout.spec.ts
git commit -m "feat(mobile): #142 toolbar swap (Quanta top, main toolbar bottom)

Mobile rules pin Quanta to top (overriding inline JS styles via
!important, scoped to @media max-width:600px), main toolbar to
bottom with safe-area-inset padding, iframe canvas to the area
between via 100dvh-safe positioning."
```

---

## Task 4: Mobile bottom-sheet popups (#143)

**Why:** The ⋯ and + popups become bottom sheets on mobile, with a back-arrow inside. Identify the real popup components first (we know `.add-link` is one, but the ⋯ and + menus likely live in `DropdownMenu.jsx` / a BlockChooser component — verify before writing CSS).

**Files:**
- Modify: `packages/volto-hydra/src/components/Toolbar/DropdownMenu.jsx` (or the verified ⋯ popup component)
- Modify: `packages/volto-hydra/src/components/[BlockChooser]/[verified path]` (the + popup)
- Modify: `packages/volto-hydra/src/components/mobile-tablet.css`
- Modify: `tests-playwright/integration/mobile-tablet-admin-layout.spec.ts`

- [ ] **Step 1: Confirmed popup components (verified during plan-writing)**

  - **⋯ menu:** `packages/volto-hydra/src/components/Toolbar/DropdownMenu.jsx` — renders `.volto-hydra-dropdown-menu`. Already accepts an `onClose` prop (line 25). Already has a Settings item that calls `handleSettings` → `onOpenSettings` (line 263–265).
  - **+ menu:** the wrapper around `<BlockChooser>` in `packages/volto-hydra/src/components/Iframe/View.jsx:4086-4099` — the chooser inside renders `.blocks-chooser`. Existing close affordance is the button at line 4095 calling `setChooser(null)`. There's a second wrapper at line 4144 with the same pattern — add the back-arrow to BOTH wrappers.

If either of those locations has changed since this plan was written (verify by grepping for `.volto-hydra-dropdown-menu` and `<BlockChooser` first), STOP and re-establish before proceeding. Both popups must be pinned down before any JSX edits.

- [ ] **Step 2: Write the failing test**

Append to the spec file:

```ts
test('mobile: ⋯ menu opens as a bottom sheet with a visible back-arrow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const helper = new AdminUIHelper(page);
  await helper.login();
  await helper.navigateToEdit('/test-page');
  await helper.clickBlockInIframe('block-1-uuid');

  await page.locator('.quanta-toolbar button:has-text("⋯")').click();
  const menu = page.locator('.volto-hydra-dropdown-menu');
  await expect(menu).toBeVisible();
  const mb = await menu.boundingBox();
  expect(mb!.y + mb!.height).toBeGreaterThan(812 - 20); // pinned to bottom
  expect(mb!.x).toBeLessThan(20); // full-width-left
  expect(mb!.x + mb!.width).toBeGreaterThan(355); // full-width-right

  const back = page.locator('.volto-hydra-dropdown-menu .mobile-sheet-back');
  await expect(back).toBeVisible();
});
```

- [ ] **Step 3: Run — should fail (no bottom-sheet CSS, no back-arrow button)**

Expected: FAIL.

- [ ] **Step 4: Add the back-arrow button to the ⋯ menu (DropdownMenu.jsx)**

Inside `DropdownMenu.jsx`, append as the LAST child of the existing `.volto-hydra-dropdown-menu` container (so it appears at the visual bottom of the sheet on mobile):

```jsx
<button
  type="button"
  className="mobile-sheet-back"
  aria-label="Close menu"
  onClick={onClose}
>
  ←
</button>
```

`onClose` is already in scope (destructured prop, line 25). No new handler, no extraction, no prop-drilling.

- [ ] **Step 5: Add the back-arrow button to the + popup (View.jsx:4086 + 4144)**

In `packages/volto-hydra/src/components/Iframe/View.jsx`, find the existing close button at line 4095 (`onClick={() => setChooser(null)}`). Add a sibling `<button>` immediately before or after it:

```jsx
<button
  type="button"
  className="mobile-sheet-back"
  aria-label="Close menu"
  onClick={() => setChooser(null)}
>
  ←
</button>
```

Repeat for the second wrapper at line 4144. Same `setChooser(null)` handler — already in scope. No extraction.

- [ ] **Step 6: Add bottom-sheet CSS**

Append to the mobile block in `mobile-tablet.css`:

```css
  /* Bottom-sheet popups (⋯ and + on mobile).
   * The popup React state-machine is unchanged — only the geometry
   * changes here. */
  .volto-hydra-dropdown-menu,
  .blocks-chooser {
    position: fixed !important;
    bottom: 0 !important;
    left: 0 !important;
    right: 0 !important;
    top: auto !important;
    max-width: none !important;
    max-height: 70vh !important;
    width: 100% !important;
    border-radius: 12px 12px 0 0 !important;
    box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.12) !important;
    z-index: var(--hydra-z-sheet) !important;
    padding-bottom: env(safe-area-inset-bottom) !important;
    overflow-y: auto !important;
    transform: translateY(0) !important;
    animation: hydra-sheet-slide-up 0.2s ease-out !important;
  }

  @keyframes hydra-sheet-slide-up {
    from { transform: translateY(100%); }
    to   { transform: translateY(0); }
  }

  /* Back-arrow inside bottom sheets. Hidden on desktop / tablet. */
  .mobile-sheet-back {
    display: flex !important;
    align-items: center;
    justify-content: center;
    position: absolute;
    bottom: 12px;
    left: 12px;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    border: none;
    background: #f0f0f0;
    font-size: 20px;
    cursor: pointer;
  }
}

/* Hide the mobile-only back-arrow at desktop/tablet widths. */
@media (min-width: 601px) {
  .mobile-sheet-back { display: none !important; }
}
```

> Note: a backdrop dim layer was in the spec ("backdrop dims the page behind it"). Adding one with `body:has(.volto-hydra-dropdown-menu:not([hidden])) ::before` is doable but `:has()` support varies. Defer the backdrop to a follow-up if the bare sheet reads cleanly — the slide-up animation + the sheet's own background may be enough visual separation. **If deferring, file a follow-up issue titled "Mobile bottom-sheet backdrop (deferred from #82)" linking back to the epic and this PR — don't just mention it in the commit message; the spec called it out so it needs a tracked home.**

- [ ] **Step 7: Restart Volto, re-run all tests**

Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add packages/volto-hydra/src/components/Toolbar/DropdownMenu.jsx \
        packages/volto-hydra/src/components/[verified-+-popup-path] \
        packages/volto-hydra/src/components/mobile-tablet.css \
        tests-playwright/integration/mobile-tablet-admin-layout.spec.ts
git commit -m "feat(mobile): #143 ⋯ and + popups become bottom sheets

Same React popup state-machine; CSS scoped to @media max-width:600px
makes the geometry fill the bottom 70vh with a slide-up animation and
safe-area-inset-bottom padding. Back-arrow button added to both popup
JSX trees, hidden on desktop and tablet via display:none."
```

---

## Task 5: Full-screen sidebar with close button (#144)

**Files:**
- Modify: `packages/volto-hydra/src/customizations/volto/components/manage/Sidebar/Sidebar.jsx`
- Modify: `packages/volto-hydra/src/components/mobile-tablet.css`
- Modify: `tests-playwright/integration/mobile-tablet-admin-layout.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
test('mobile: opening sidebar makes it full-screen with a visible close button', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const helper = new AdminUIHelper(page);
  await helper.login();
  await helper.navigateToEdit('/test-page');
  await helper.clickBlockInIframe('block-1-uuid');

  // Open via ⋯ → Settings (matches mockup 2)
  await page.locator('.quanta-toolbar button:has-text("⋯")').click();
  await page.locator('.volto-hydra-dropdown-menu :text("Settings")').click();

  const sidebar = page.locator('#sidebar');
  await expect(sidebar).toBeVisible();
  const sb = await sidebar.boundingBox();
  expect(sb!.x).toBeLessThan(5);
  expect(sb!.x + sb!.width).toBeGreaterThan(370);
  expect(sb!.y).toBeLessThan(5);
  expect(sb!.y + sb!.height).toBeGreaterThan(800);

  const close = sidebar.locator('.sidebar-mobile-close');
  await expect(close).toBeVisible();
  await close.click();
  await expect(sidebar).not.toBeVisible();
});
```

- [ ] **Step 2: Confirm existing sidebar-toggle handler (verified during plan-writing)**

Open `packages/volto-hydra/src/customizations/volto/components/manage/Sidebar/Sidebar.jsx` and find the existing "Shrink sidebar" `<button>` — note the `onClick` handler name it uses. The new mobile close `<button>` calls the SAME handler. If the existing button has its handler inline (e.g. `onClick={() => setShrunk(true)}`), pass the same expression to the new close button — no extraction.

If the existing handler isn't immediately findable, grep first:

```bash
grep -n "Shrink sidebar\|aria-label=\"Shrink\|onClick=" packages/volto-hydra/src/customizations/volto/components/manage/Sidebar/Sidebar.jsx | head -10
```

- [ ] **Step 3: Add the close button to Sidebar.jsx header**

```jsx
<button
  type="button"
  className="sidebar-mobile-close"
  aria-label="Close sidebar"
  onClick={existingToggleHandler}
>
  ✕
</button>
```

Placement: at the top of whatever existing header div the sidebar already has, so it appears top-left on mobile.

- [ ] **Step 4: Add the full-screen CSS**

Append to the mobile block in `mobile-tablet.css`:

```css
  /* Sidebar full-screen on mobile. */
  #sidebar {
    position: fixed !important;
    inset: 0 !important;
    width: 100% !important;
    max-width: none !important;
    height: 100dvh !important;
    z-index: var(--hydra-z-sidebar-mobile) !important;
  }

  .sidebar-mobile-close {
    display: flex !important;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    border: none;
    background: transparent;
    font-size: 18px;
    cursor: pointer;
  }
```

Plus the always-hidden-on-desktop rule:

```css
@media (min-width: 601px) {
  .sidebar-mobile-close { display: none !important; }
}
```

- [ ] **Step 5: Restart, re-run tests**

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add packages/volto-hydra/src/customizations/volto/components/manage/Sidebar/Sidebar.jsx \
        packages/volto-hydra/src/components/mobile-tablet.css \
        tests-playwright/integration/mobile-tablet-admin-layout.spec.ts
git commit -m "feat(mobile): #144 full-screen sidebar with close button

Sidebar fixed inset:0 with 100dvh on @media max-width:600px. Close
button added to sidebar header JSX, reuses the existing sidebar-toggle
handler, hidden on desktop/tablet via display:none."
```

---

## Task 6: Chevron move-up/down buttons (#145)

**Why this is the trickiest task:** unlike the previous tasks (CSS + a single hidden button), the chevrons are functional UI — they must dispatch a Redux action that actually moves the selected block within its parent. The drag handle they're replacing is decorative (the chrome-pattern overlay handles the drag); the chevrons need a real handler.

**Files:**
- Modify: `packages/volto-hydra/src/components/Toolbar/SyncedSlateToolbar.jsx`
- Modify: `packages/volto-hydra/src/components/mobile-tablet.css`
- Modify: `tests-playwright/integration/mobile-tablet-admin-layout.spec.ts`

- [ ] **Step 1: Spike — confirm how Volto's keyboard move-up/down works in nested containers**

Per the spec reviewer's recommendation, verify the existing keyboard-arrow handler's behavior at the top/bottom edge of a nested container (does ▲ on the first sibling of a nested column do nothing, or step out to the page-level?). Find the handler:

```bash
grep -rn "moveBlockEnhanced\|ArrowUp.*moveBlock\|onKeyDown.*move\|move.*ArrowUp" packages/volto-hydra/src/ core/packages/volto/src/components 2>/dev/null | grep -v test | head -10
```

**Decision rule.** The spec says "within the current parent only — ▲ on the top sibling does NOT step out". Three outcomes are possible:

| Keyboard handler does… | Action |
|---|---|
| Stays within the current parent (matches the spec) | Reuse the handler as-is. Document the matching behavior in the commit. |
| Steps out to the grandparent (contradicts the spec) | **Spec wins** — the chevrons are a new affordance and should follow the spec's intent. Build a small `moveSelectedBlockWithinParent(direction)` wrapper that calls the same lower-level action but with a within-parent guard. Keep the keyboard handler unchanged. Document the divergence in the commit. |
| Already calls a within-parent helper but the at-edge guard isn't reused | Lift the existing helper + guard into named exports if they aren't already, so both call sites use the same code. Cap extraction at 20 lines net new code; if it would be larger, STOP and re-spec. |

The grep + 5 minutes of reading the handler decide which outcome applies. Document the answer in the commit message (one line) so the next maintainer knows.

- [ ] **Step 2: Write the failing test**

```ts
test('mobile: chevron ▼ moves the selected block down within its parent', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const helper = new AdminUIHelper(page);
  await helper.login();
  await helper.navigateToEdit('/test-page');

  // Capture initial block order (page-level)
  const initialOrder = await helper.getBlockOrder();
  // Select the first block
  await helper.clickBlockInIframe(initialOrder[0]);

  // Drag handle should be hidden on mobile
  await expect(page.locator('.quanta-toolbar .drag-handle')).toHaveCSS('display', 'none');

  const chevronDown = page.locator('.quanta-toolbar .chevron-down');
  await expect(chevronDown).toBeVisible();
  await chevronDown.click();

  const afterOrder = await helper.getBlockOrder();
  expect(afterOrder[0]).toBe(initialOrder[1]); // they've swapped
  expect(afterOrder[1]).toBe(initialOrder[0]);
});

test('mobile: chevron ▲ disabled at top, ▼ disabled at bottom', async ({ page }) => {
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
```

- [ ] **Step 3: Run — should fail (no chevrons in DOM)**

Expected: FAIL.

- [ ] **Step 4: Add the chevron buttons to SyncedSlateToolbar.jsx**

Inside the toolbar's left chunk (around the existing drag-handle rendering at line ~1245), add a new fragment. The existing drag-handle IIFE computes `isLocked` inline (line ~1252); the chevron site re-uses the same `isBlockPositionLocked` call rather than reaching into the IIFE's scope:

```jsx
{/* Mobile-only chevron move buttons. Hidden on desktop and tablet via
    display:none in mobile-tablet.css. Re-uses the same block-move
    action the keyboard ArrowUp/ArrowDown handlers use. PAGE_BLOCK_UID
    is imported at SyncedSlateToolbar.jsx:12; isBlockPositionLocked
    same module. */}
{(() => {
  if (!selectedBlock || selectedBlock === PAGE_BLOCK_UID) return null;
  const block = getBlock(selectedBlock);
  if (isBlockPositionLocked(block, templateEditMode)) return null;
  return (
    <div
      className="chevron-buttons"
      style={{ pointerEvents: 'auto', display: 'flex', flexDirection: 'column', gap: '1px' }}
    >
      <button
        type="button"
        className="chevron-up"
        aria-label="Move block up"
        disabled={isAtTopOfParent}
        onClick={() => moveSelectedBlockUp()}
      >▲</button>
      <button
        type="button"
        className="chevron-down"
        aria-label="Move block down"
        disabled={isAtBottomOfParent}
        onClick={() => moveSelectedBlockDown()}
      >▼</button>
    </div>
  );
})()}
```

The `isAtTopOfParent` / `isAtBottomOfParent` flags and `moveSelectedBlockUp` / `moveSelectedBlockDown` functions come from whatever the keyboard-arrow handler already uses (found in Step 1). If they're inline in the keyboard handler, extract them to small named functions in the same file so both the keyboard handler and the chevron button can call them. **Do not introduce new business logic — only reuse / extract. Cap extraction at 20 lines net new code (including the at-edge guards); if the extraction would be larger, STOP and re-spec.**

- [ ] **Step 5: CSS — show chevrons only on mobile, hide drag handle on mobile**

Append to mobile block in `mobile-tablet.css`:

```css
  /* Show chevrons, hide drag handle. */
  .quanta-toolbar .drag-handle { display: none !important; }
  .quanta-toolbar .chevron-buttons {
    display: flex !important;
  }
  .quanta-toolbar .chevron-buttons button {
    width: 32px;
    height: 22px;
    padding: 0;
    border: none;
    background: transparent;
    font-size: 14px;
    cursor: pointer;
  }
  .quanta-toolbar .chevron-buttons button:disabled {
    color: #ccc;
    cursor: default;
  }
```

Plus the desktop/tablet hide:

```css
@media (min-width: 601px) {
  .quanta-toolbar .chevron-buttons { display: none !important; }
}
```

- [ ] **Step 6: Restart, run all mobile-layout tests**

Expected: all green. Run existing drag-and-drop tests too to make sure they still pass at desktop widths:

```bash
pnpm exec playwright test tests-playwright/integration/drag-and-drop.spec.ts --project=admin-mock --reporter=line
```

Expected: PASS (drag tests use default desktop viewport; nothing should have changed for them).

- [ ] **Step 7: Update Task 1's desktop-control assertion**

The chevrons are now always-rendered (hidden via `display: none` on desktop / tablet). Replace these two lines in the desktop-control test:

```ts
await expect(chevronUp).toHaveCount(0);
await expect(chevronDown).toHaveCount(0);
```

with:

```ts
await expect(chevronUp).toHaveCSS('display', 'none');
await expect(chevronDown).toHaveCSS('display', 'none');
```

Re-run the desktop-control test to confirm green. Without this update, Task 1's gate fails after Task 6 lands.

- [ ] **Step 8: Commit**

```bash
git add packages/volto-hydra/src/components/Toolbar/SyncedSlateToolbar.jsx \
        packages/volto-hydra/src/components/mobile-tablet.css \
        tests-playwright/integration/mobile-tablet-admin-layout.spec.ts
git commit -m "feat(mobile): #145 chevron move-up/down replaces drag on mobile

Chevron buttons added to Quanta toolbar, wired to the same block-move
action the keyboard ArrowUp/ArrowDown handlers already use.
[NESTED-CONTAINER BEHAVIOR: <answer from Step 1 spike>]
Drag handle hidden on @media max-width:600px; chevrons hidden on
@media min-width:601px."
```

---

## Task 7: Final verification + flip PR to ready

- [ ] **Step 1: Full local sweep**

```bash
pnpm test                                                # vitest unchanged: 26/26
pnpm exec playwright test tests-playwright/integration/mobile-tablet-admin-layout.spec.ts --project=admin-mock --reporter=line  # all new layout tests
pnpm exec playwright test tests-playwright/integration --project=admin-mock --reporter=line                                      # full admin-mock matrix — no regressions on existing tests
```

Each must be green before pushing.

- [ ] **Step 2: Push and watch CI**

```bash
git push
gh pr checks 226 --watch
```

- [ ] **Step 3: Flip the draft PR to ready**

```bash
gh pr ready 226
```

Update the PR body's checklist (implementation done, tests green) and link the merged spec.

---

## Out-of-scope items (carry forward as follow-up issues if they bite)

- Soft-keyboard avoidance for the bottom toolbar — needs `visualViewport` JS, violates CSS-only rule.
- Swipe-to-dismiss for bottom sheets — pure-CSS animation only in v1.
- Image / video block sidebars on mobile — own design pass.
- Tablet-specific Quanta toolbar tweaks — Quanta keeps absolute-above-block on tablet; if the editor wants top-pinned Quanta on portrait tablet that's a v2 decision.
- Bottom-sheet dim backdrop (deferred in Task 4 if the bare sheet reads cleanly).
- Doc updates beyond a short architecture.md paragraph + CLAUDE.md note (do these alongside Task 7 if time permits, otherwise a tiny follow-up).
