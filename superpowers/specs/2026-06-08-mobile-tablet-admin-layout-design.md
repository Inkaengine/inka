# Mobile + Tablet Admin Layout — Design Spec

**Status:** Draft for review
**Issues addressed:** #82 (epic), #142, #143, #144, #145
**Authors:** Dylan Jay + Claude (brainstorming session)
**Hard constraint:** **Desktop behavior is unchanged.** No CSS rule, JSX change, or test added in this work can affect the rendered output at viewport widths ≥ 1024px.

---

## Goal

Make the Hydra admin usable on touch devices. The current admin renders for ~1280px+ desktop only: the Volto main toolbar is a left-side vertical column, the sidebar is a right-side vertical column, and the editable canvas (the iframe) shares horizontal space with both. On a 375px iPhone the sidebar covers the canvas, the Quanta toolbar is occluded by iOS's text-selection bubble (cut/copy/paste), drag-to-reorder is impossible, and there's no way to dismiss the sidebar back to the canvas.

This work delivers two new admin viewports:

- **Tablet (601–1023px)** — toolbar moves from left of canvas to far-right of the sidebar. Three columns: `[Canvas] [Sidebar] [Toolbar]`. Everything else looks and behaves like desktop.
- **Mobile (≤600px)** — Quanta toolbar pinned to the top, Volto main toolbar pinned to the bottom, canvas maximized between. Popups (⋯, +) become bottom sheets. Sidebar becomes a full-screen overlay opened via ⋯ → Settings and dismissed via a close button. Drag handle is replaced by chevron move-up / move-down buttons.

The epic's parent images and the Figma referenced in #144 describe both layouts.

---

## Architecture

**CSS-only.** The three admin viewports differ entirely via `@media (max-width: NNNpx)` rules. No `isMobile` Redux state, no `window.matchMedia` listener, no JSX branching by viewport. The same React tree renders at every width; CSS hides and positions.

**Small JSX additions** to existing components, hidden on desktop via `display: none`:

1. Two chevron buttons (▲ move-up, ▼ move-down) in the Quanta toolbar.
2. A back-arrow button inside the ⋯ popup.
3. A back-arrow button inside the + popup.
4. A close (X) button in the sidebar header.

These additions reuse handlers that already exist:

- Chevrons → the same block-move actions wired to keyboard arrows in the bridge.
- Popup back-arrows → the existing popup-close callback.
- Sidebar close → the existing sidebar toggle.

**No new behavior; no new state; no new handlers.** The work is purely a layout pass plus the four new visible affordances.

**Three breakpoints (max-width):**

| Layout | Range | Selector |
|---|---|---|
| Mobile | ≤ 600px | `@media (max-width: 600px)` |
| Tablet | 601–1023px | `@media (min-width: 601px) and (max-width: 1023px)` |
| Desktop | ≥ 1024px | (no media query — current rules) |

Vocabulary note: Hydra already has a `viewportPreset` Redux state (`mobile`/`tablet`/`desktop`) that controls the **preview iframe's** width. That has nothing to do with this work. We use "admin viewport" for the new media-query-driven layout and "preview viewport" for the existing Redux state. No code path is shared.

---

## Tablet (601–1023px)

**Single behavioral change:** the Volto main toolbar moves from `position: fixed; left: 0` to `position: fixed; right: 0`. The sidebar (`#sidebar`) sits between the canvas and the toolbar.

Resulting layout, left to right: `[Canvas] [Sidebar] [Toolbar]`.

Quanta toolbar (above-the-selected-block) keeps its current absolute positioning relative to the iframe. Popups behave as dropdowns, same as desktop. Drag handle visible. Bottom-sheet rules do NOT apply.

CSS additions live in the existing toolbar and layout stylesheets under `@media (min-width: 601px) and (max-width: 1023px)`. No JSX changes for tablet.

---

## Mobile (≤600px)

### #142 — Quanta top, main toolbar bottom

- **Quanta toolbar** (`.quanta-toolbar`): `position: fixed; top: 0; left: 0; right: 0; z-index: <above-iframe>`. Overrides the current "above-the-block" anchoring. Renders the format buttons from epic mockup 1: paragraph dropdown, B, I, link, ⋯. Also renders the two new chevron buttons (#145) on its left side.
- **Main toolbar** (`#toolbar`): `position: fixed; bottom: 0; left: 0; right: 0`. Renders the existing toolbar items plus the existing sidebar-toggle gear (⚙), with Cancel (✕) and Save (✓) on the right per the mockup.
- **Iframe canvas** (`.iframe-container`): `position: fixed; top: <quanta-height>; bottom: <toolbar-height>; left: 0; right: 0`. The editable surface fills the screen between the two bars.
- Use `100dvh` / `env(safe-area-inset-bottom)` where the fixed positioning interacts with iOS Safari's address bar and notch (see Risks).

### #143 — Bottom-sheet ⋯ and + menus

- Same React popup components as today. On mobile they get CSS rules that change their geometry without changing their open/close state machinery: `position: fixed; bottom: 0; left: 0; right: 0; max-height: 70vh; transform: translateY(0)` with a `transition: transform .2s` for the slide-up animation. Backdrop is a sibling `::before` or new element with semi-opaque background.
- **Back-arrow button** always rendered inside each popup; `display: none` on desktop and tablet, `display: flex` in the bottom-left of the sheet on mobile. `onClick` = the popup's existing close handler.
- Pressing the backdrop or back-arrow dismisses; matches desktop dropdown's outside-click behavior.

### #144 — Full-screen sidebar

- `#sidebar` on mobile: `position: fixed; inset: 0; z-index: <above-toolbars>; width: 100%; max-width: none`. Covers Quanta and main toolbars when open.
- **Close (X) button** always rendered in the sidebar header; `display: none` on desktop and tablet, visible at top-left on mobile. Reuses the existing sidebar-toggle handler.
- Internal scrolling + sticky stacked headers (`Sidebar.jsx`'s VS Code-style stacking) unchanged. Page metadata reachable by scrolling up to the sticky page-header section, same as desktop. No new view-switching mechanism.
- Opens via ⋯ → Settings (mockup 2). When no block is selected and the sidebar is opened, the user sees page metadata stacked at the top.

### #145 — Chevron move-up / move-down (replace drag handle)

- Two new `<button>` elements in the Quanta toolbar's left chunk: ▲ moves the selected block up within its parent, ▼ moves it down. `aria-label="Move block up"` / `"Move block down"`.
- `display: none` on desktop and tablet. Visible only on mobile.
- The drag handle (`.drag-handle` / `.block-handle`) gets the inverse: `display: none` on mobile, visible on desktop and tablet.
- Disabled state when the selected block is at the top or bottom of its parent — matches the existing keyboard-arrow handler's behavior at the same position (so the visual cue and the keyboard semantics agree).
- Move semantics: **within the current parent only.** ▲ on the top sibling of a parent does NOT step out to the grandparent — that matches what most editors expect from move-up/down buttons.

---

## Risks and how the spec addresses them

| Risk | Mitigation |
|---|---|
| iOS Safari address bar resizing the visible area (`100vh` ≠ visible area, fixed bottom bar jumps when bar shows/hides) | Use `100dvh` / `100svh` for the fixed-positioning sizing where it matters. CSS-only. |
| Soft keyboard covers the bottom toolbar when editing a text input | **Acknowledged, deferred to v2.** The native keyboard pushes content; `visualViewport` JS would help but violates "CSS-only". Documented in spec. |
| Safe-area inset on notched devices pushes the bottom toolbar over the home indicator | `padding-bottom: env(safe-area-inset-bottom)` on the bottom toolbar. CSS-only. |
| The current Quanta `position: absolute` anchoring above the selected block could regress when we override to `position: fixed` on mobile | Mobile rules scoped strictly to `@media (max-width: 600px)`. Tablet and desktop keep the existing positioning. A layout test asserts both. |
| Existing `viewportPreset` Redux state is unrelated but easily confused | Spec uses "admin viewport" vs "preview viewport" deliberately. No shared code path. |
| Drag-and-drop tests might fail on mobile-viewport runs | Drag tests stay desktop-only (existing specs run at the default viewport). The new mobile spec asserts chevrons instead. |
| Chevron move at the top/bottom edge of a nested container | Disabled state matches the keyboard-arrow handler's behavior at the same position — no surprise differences. Verified in interaction test. |
| Adding back-arrow / close-X / chevron `<button>` elements to existing JSX means the desktop DOM grows by 4 always-hidden buttons | Each is a single button with `display: none`. No noticeable cost. Test asserts they're not visible on desktop. |
| Tablet "toolbar moves to the right" might collide with the existing `right: 0`-positioned things (frontend switcher, etc.) | The existing toolbar has a `frontendSwitcher` plug rendered as `appExtras` — it sits inside the toolbar element itself, so it moves with it. Verified in interaction test. |

---

## Test plan

**Single new spec file:** `tests-playwright/integration/mobile-tablet-admin-layout.spec.ts`. Runs in the existing `admin-mock` Playwright project. No new project — no extra CI cost.

Three describe-blocks, one per breakpoint:

1. **Desktop control** (1280×800) — asserts the byte-for-byte unchanged layout: main toolbar bounding box on the left, sidebar on the right, drag handle visible, chevron buttons hidden, no bottom sheets when ⋯ is opened (it's a dropdown).
2. **Tablet** (768×1024) — asserts `[Canvas] [Sidebar] [Toolbar]` left-to-right via `boundingBox()` checks. Drag handle visible, chevrons hidden. Popups behave as dropdowns.
3. **Mobile** (375×812) — asserts Quanta pinned top, main toolbar pinned bottom, iframe canvas between. Drag handle hidden, chevrons visible. Tapping ⋯ asserts the popup is bottom-positioned with a visible back-arrow and backdrop. Tapping ⋯ → Settings asserts the sidebar is full-screen with a visible close X. Tapping ▼ asserts the selected block's order changes in the iframe.

Each test sets `page.setViewportSize(...)` once at the start. All other helpers (`login`, `navigateToEdit`, `clickBlockInIframe`, etc.) are unchanged.

---

## Out of scope (deferred follow-ups)

- **Soft-keyboard avoidance** for the bottom toolbar — needs `visualViewport` JS, would break the CSS-only constraint. Open follow-up issue if it bites in practice.
- **Touch gestures** like swipe-to-dismiss the bottom sheets — CSS-only animation is enough for v1.
- **Image / video block sidebars** — likely need their own mobile pass; this spec only covers the generic stacked sidebar.
- **`inline-editing-links` LinkEditor popup positioning on mobile** — popups treated as a class; specific edge cases handled in a follow-up if needed.
- **Doc updates beyond a short architecture.md paragraph and CLAUDE.md note**.
- **Tablet-specific Quanta toolbar tweaks** — Quanta stays positioned above the selected block on tablet, same as desktop. If the editor on a portrait tablet wants the mobile-style top-pinned Quanta, that's a v2 design decision.
