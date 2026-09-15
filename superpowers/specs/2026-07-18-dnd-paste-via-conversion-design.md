# Drag / paste into a spot via conversion — design

**Status:** approved (brainstorm), pre-implementation
**Date:** 2026-07-18
**Scope:** separate PR from the copy-from-target work (#256).

## Problem

Today a block can only be dragged (or pasted) into a container whose
`allowedBlocks` already admits its `@type`. If the type isn't allowed, the drop
indicator is hidden during drag (`hydra.js`) and the move/paste is hard-rejected
in the admin (`View.jsx`). But Hydra already has a **conversion graph** over
`fieldMappings`: many blocks can be converted into one another. We should let a
block drop into a spot it doesn't natively fit **by converting it** to a type the
spot accepts.

This makes drag-and-drop (and paste) offer *more* valid destinations: any spot
reachable via an existing `fieldMappings` conversion.

## Decisions (from brainstorming)

1. **Indicators are identical.** A convert-drop spot looks exactly like a
   native-fit spot; conversion happens transparently on drop. No new drag chrome.
2. **Auto-convert when one option, popup when several.** If the source can
   convert to exactly one allowed type, convert silently. If multiple allowed
   target types are reachable, show the normal conversion chooser popup.
3. **Ask-first, commit atomically (popup case).** On release over a
   multi-option spot, show the popup *without moving*. Choosing a type performs
   convert + move as a single `formData` update (one undo). Dismissing is a
   no-op — the block never leaves its origin, so a container never briefly holds
   an invalid-typed block.
4. **Multi-block = auto-convert only, no popup chains.** A multi-block selection
   may drop into a spot only where every block is either natively allowed or has
   exactly one convertible target. If any block would need a popup, that spot
   stays native-only for the batch.
5. **Mobile via cut/paste.** Mobile chevron/edge move (`_computeEdgePlan`) keeps
   native-only targets. Conversion on mobile is reached through cut → paste,
   which this PR makes convert-aware. No new mobile geometry.
6. **No data migration.** Pure interaction/feature addition.

## Existing machinery (reused, not rebuilt)

- **Drag validity (iframe):** `hydra.js:7439-7471` walks up the parent chain for
  a container whose `allowedSiblingTypes` includes every dragged type; if none,
  it hides the indicator and rejects the spot. This is the single rejection point.
- **Drop re-validation (admin):** `View.jsx` `MOVE_BLOCKS` handler `:2799-2808`
  re-checks `allowedBlocks` and breaks (hard reject) on a disallowed type.
- **Paste re-validation (admin):** `View.jsx` `handlePaste` `:959` — same gate.
- **Conversion graph:** `getConvertibleTypes(sourceType, blocksConfig,
  allowedTypes)` (`blockSync.js:2012`) BFS's `fieldMappings` and returns
  the allowed types a source can convert into.
- **Conversion op:** `convertContainerBlock(formData, blockPathMap, blockId,
  targetType, blocksConfig, intl)` (`blockPath.js:1178`).
- **Chooser overlay:** `chooser` state in `View.jsx` (`kind: 'convert' | 'wrap'`)
  rendered via `BlockChooser`. The natural home for the multi-option popup.

## Design

### 1. A static conversion map to the iframe

New pure helper (admin-side, lives with the graph):

```js
// { [sourceType]: string[] }  — full reachable set, unfiltered by allowedBlocks
getConversionMap(blocksConfig)
```

Each value is `getConvertibleTypes(sourceType, blocksConfig)` mapped to type
names (no `allowedTypes` filter — the *target's* `allowedBlocks` filters at check
time). Computed once at init; recomputed only when `blocksConfig` changes. Sent
to the iframe in the payload that already carries config / `blockPathMap`.

Rationale: the graph stays a single source of truth in the admin; the iframe
does a cheap set-membership check; the map is small and static.

### 2. Iframe accepts convert-reachable spots

Extract the acceptance test into a shared pure predicate:

```js
// options = (conversionMap[type] || []) ∩ allowed
acceptableAt(type, allowed, isMulti, conversionMap):
  if !allowed            -> true          // unrestricted container
  if allowed.includes(type) -> true       // native fit
  if options.length === 0 -> false        // not reachable
  if isMulti             -> options.length === 1   // batch: auto-only
  return true                             // single block: 1=auto, >1=popup
```

Replace the inline `allTypesAllowed` computation at `hydra.js:7442` with
`draggedBlockTypes.every(t => acceptableAt(t, allowedSiblingTypes, isMulti,
conversionMap))`, `isMulti = draggedBlockTypes.length > 1`. The walk-up loop and
the empty-container "shade" branch (`findOnlyEmptyChildUid`) are unchanged — they
sit below this predicate, so convert-drops into empty containers fall out for
free.

### 3. Admin converts on drop (`MOVE_BLOCKS`)

Replace the hard reject at `View.jsx:2799` with per-block resolution against
`targetAllowedTypes`:

- native (`type ∈ allowed`) → move as today.
- `options = getConvertibleTypes(type, blocksConfig, targetAllowedTypes)`:
  - `length === 0` → reject (unchanged behaviour).
  - `length === 1` → auto-convert to `options[0]`, then move.
  - single block & `length > 1` → **ask first**: stash a `pendingMove`
    (`{ targetBlockId, insertAfter, targetParentId, replaceTargetId }`) on the
    `chooser` (`kind: 'convert'`), show `BlockChooser` scoped to `options`. On
    select → `convertContainerBlock` then `moveBlockBetweenContainers` in one
    `formData` chain (one undo). On dismiss → no-op.
- multi-block: each block auto-converts to its single option or is native; a
  block that would need a popup is re-rejected (the iframe won't have offered it,
  but the admin stays authoritative).

The post-move `applyBlockDefaultsWithContext` pass already runs and settles the
converted block's neighbour-derived fields.

### 4. Admin converts on paste (`handlePaste`)

Same resolution against the container's `allowedBlocks`: auto-convert
single-option pasted blocks; a single pasted block with multiple options opens
the same ask-first chooser; multi-paste is auto-only. This is the path mobile
uses (cut → paste), so mobile gains conversion without touching chevron geometry.

## Testing (TDD — red first)

- **Unit:**
  - `getConversionMap` — reachable sets for a small `fieldMappings` graph.
  - `acceptableAt` — truth table: native / single-convert / multi auto-only /
    reject / unrestricted. Pure and shared by iframe + admin.
- **Integration (Playwright, admin-mock):**
  - Drag into a restricted container that admits only a convert-*target* →
    drop auto-converts (single option); block is now the target type, in place.
  - Drag into a container with multiple convertible options → chooser popup →
    choose → convert+move is a single undo.
  - Popup cancel → block unchanged, still at origin.
  - Paste a block into a restricted container → auto-convert.
  - Multi-block drag where every block has one option → all auto-convert; a
    member with multiple options keeps the spot native-only (not offered).
  - Existing native drag/paste specs stay green (no regression).
- **Fixtures:** a small conversion graph (reuse `@default` / existing convertible
  types) + a container whose `allowedBlocks` admits only a convert-target of a
  draggable source.

## Scope guardrails / non-goals

- Identical indicators — no new drag chrome.
- Mobile chevron move stays native-only (conversion via cut/paste only).
- Convert popup is single-block only; multi-block is auto-convert only.
- No data migration; no changes to the conversion graph semantics.

## Risks

- **Iframe/admin agreement.** The iframe's `acceptableAt` must match the admin's
  drop resolution or a spot could show then reject. Mitigated by sharing the pure
  predicate and by the admin filtering with the same `getConvertibleTypes`.
- **Atomic convert+move.** Convert then move must be one `formData` update so undo
  is single-step and the intermediate never persists. Chain both before the
  single `onChangeFormData`.
- **`convertContainerBlock` on non-container blocks.** Confirm it converts a plain
  block (not only containers) via `fieldMappings`; generalize/rename if needed.
