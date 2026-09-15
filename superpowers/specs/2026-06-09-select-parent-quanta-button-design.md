# Quanta toolbar: promote "Select Container" to a visible button

**Status:** Draft for review
**Issues addressed:** part of epic #82 (mobile usability — easier escape from deep-nested selection)
**Branch:** `feat/mobile-tablet-admin-layout` (PR #226 draft)

---

## Goal

Make "walk up to the parent container" a first-class, one-tap action in the Quanta toolbar — instead of buried in the ⋯ dropdown menu. The current model (tap selects deepest block) is preserved on all viewports; the editor just gets a faster way to escape *upward* through ancestors, which is especially needed on mobile where there's no Escape key.

Matches Gutenberg's "Select Parent Block" toolbar button pattern.

---

## Background — what already exists

- Tap-to-select in the iframe walks `event.target.closest('[data-block-uid]')` → the deepest block under the pointer wins. (`hydra.src.js:3825`)
- `blockPathMap[blockId].parentId` already tracks every block's parent.
- `onSelectBlock(uid | null)` is the existing selection-update channel; `null` deselects, an ancestor's UID selects it. (`View.jsx:623`, prop on `SyncedSlateToolbar.jsx`)
- The iframe re-syncs automatically when `selectedBlock` changes — `View.jsx` already has a `selectedBlock`-watching effect that postMessages `SELECT_BLOCK` to the iframe.
- The ⋯ dropdown menu currently has the affordance: `DropdownMenu.jsx:93-98` defines `handleSelectContainer = () => { onClose(); onSelectBlock(parentId); }` and renders a `⬆️ Select Container` item at line 474, shown when `parentId && parentId !== PAGE_BLOCK_UID`.
- Two parallel parent-walk affordances exist today: Escape key (`View.jsx:1230`) and the sidebar `‹` breadcrumb in `ParentBlocksWidget.jsx`.

The work is **promotion**, not invention — same handler, same condition, new visible placement.

---

## Design

### One JSX button added to `SyncedSlateToolbar.jsx`

In Quanta's existing render tree, between the format-buttons chunk and the ⋯ dropdown trigger:

```jsx
{(() => {
  const parentId = blockPathMap?.[selectedBlock]?.parentId;
  if (!parentId || parentId === PAGE_BLOCK_UID) return null;
  return (
    <button
      type="button"
      className="select-parent-btn"
      aria-label="Select parent container"
      title="Select parent container"
      onClick={() => onSelectBlock(parentId)}
    >
      ⬆
    </button>
  );
})()}
```

- **Visibility**: rendered only when the selected block has a non-page parent. Same exact gate as the existing dropdown item.
- **Handler**: `onSelectBlock(parentId)` — the same function the dropdown item calls. Iframe sync happens via the existing `selectedBlock`-watching effect; no new event, no postMessage.
- **All viewports**: visible on desktop, tablet, and mobile alike — matches Gutenberg, matches the sidebar `‹` breadcrumb which is also always-visible.
- **Icon**: keep the existing `⬆️` (or unicode `⬆`) for v1, cheap and recognisable. SVG swap is an optional polish follow-up.

### Visual placement in Quanta

Quanta toolbar reads left-to-right:

```
[ drag-handle / ▲ ▼ ] | [ ¶  B  I  link  format buttons ] | [ ⬆ select-parent ] [ ⋯ menu ]
```

- The ▲ ▼ chevrons (mobile-only, sibling reorder within parent) stay on the **left** of the toolbar where they already sit. They're conceptually about *within-parent* movement.
- The new ⬆ "select parent" button sits on the **right end**, immediately left of the ⋯ dropdown. Conceptually about *escaping upward*, grouped with the other meta/navigation actions in the ⋯ menu.

### Remove the duplicate dropdown item

`DropdownMenu.jsx`'s `⬆️ Select Container` rendering block (around line 456-485 — the conditional + the menu item div) is deleted. `handleSelectContainer` becomes dead and is removed too, along with the unused `onSelectBlock` parameter destructure if it has no other consumer in that file. Leaving the menu item alongside the new button would give editors two affordances for the same action and clutter the dropdown.

### What stays exactly as-is

- Tap-to-select in iframe (leaf-first via `closest`)
- Escape key parent-walk on desktop (`View.jsx:1230`)
- Sidebar `‹` parent breadcrumb (`ParentBlocksWidget.jsx`)
- Text editing entry (tap inside text of a selected slate block)
- Click-outside-iframe to deselect

The new button is **additive** to the existing parent-walk paths — it doesn't replace any of them.

---

## Tests

Single new Playwright spec or additions to the existing mobile spec (`tests-playwright/integration/mobile-tablet-admin-layout.spec.ts`):

1. **Button visible when nested block selected.** Select a block inside a column inside a grid. The `.select-parent-btn` is visible.
2. **Click walks selection up by one.** Click the button; assert `selectedBlock` is now the immediate parent (verified via the sidebar breadcrumb or a `[data-selected="true"]` attribute on the iframe block).
3. **Button not rendered when selected block is page-level.** Select a top-level block; the button has zero count in the DOM.
4. **Repeat-click walks up the chain to the top.** Click N times; on the Nth click reaches a top-level block and the button disappears.
5. **Regression: ⋯ dropdown no longer offers Select Container.** Open ⋯ menu with a nested block selected; `text=Select Container` has zero count.
6. **Regression: existing parent-walk paths still work.** Escape key on desktop still walks up. Sidebar `‹` breadcrumb still walks up.
7. **Mobile-specific:** at 375px viewport, the button is visible inside Quanta and tappable (no horizontal overflow hiding it).

All asserted with `toBeVisible` / `toHaveCount` / state-after-click checks — not raw coordinates.

---

## Risks

| Risk | Mitigation |
|---|---|
| Quanta becomes too wide on mobile with one more button | Quanta already has `overflow: hidden` and `max-width` constraints. The button is small (⬆ icon, similar size to ⋯). If it overflows in practice, the existing `quanta-toolbar` overflow rules handle it — fall through to the dropdown chevron expansion for any items that don't fit. |
| Editors miss the moved menu item in ⋯ | The button at the right end of Quanta is more discoverable than a dropdown item. Sidebar breadcrumb is also still there. If muscle memory complaints surface, the menu item can be re-added in a follow-up. |
| Selecting parent on desktop changes some existing flow we don't know about | The handler is byte-identical to the existing `handleSelectContainer`. The only change is the DOM element that triggers it. No new code paths. |

---

## Out of scope

- Outside-in drill model (rejected during brainstorming in favour of leaf-first + parent walk).
- Long-press gestures for container selection.
- SVG icon swap for the ⬆ button (cheap polish, follow-up).
- Mobile-specific long-press / context menu behavior.
- Changing how text editing is entered (still tap-in-text of a selected slate block).
