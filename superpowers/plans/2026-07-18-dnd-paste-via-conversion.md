# Drag / paste into a spot via conversion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:executing-plans to implement this plan task-by-task (inline, no subagents — per user instruction). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a block drag/paste into a container it doesn't natively fit by converting it to a type the container accepts — auto-convert when one option, chooser popup when several.

**Architecture:** A static `conversionMap` (`{type: [reachableTypes]}`) built admin-side from the existing `fieldMappings` graph and shipped to the iframe on `INITIAL_DATA`. The iframe's drag-acceptance gate (`hydra.src.js:9073`) consults a shared pure `acceptableAt` predicate to offer convert-reachable spots. The admin re-resolves on drop/paste with `getConvertibleTypes` and converts (reusing the existing chooser overlay for the multi-option popup, ask-first/atomic).

**Tech stack:** React admin (`packages/volto-hydra`), Volto-free shared modules + bundled iframe bridge (`packages/hydra-js`, esbuild `hydra.src.js` → `hydra.js`). Tests: jest (hydra-js), vitest (admin utils), Playwright admin-mock (integration).

**Spec:** `docs/superpowers/specs/2026-07-18-dnd-paste-via-conversion-design.md`

---

## File structure

**Create:**
- `packages/hydra-js/conversionMap.js` — Volto-free pure module: `acceptableAt(type, allowed, isMulti, conversionMap)`. Imported by both `hydra.src.js` and the admin, so the iframe and admin agree by construction.
- `packages/hydra-js/conversionMap.test.js` — jest unit tests for `acceptableAt`.
- `tests-playwright/integration/dnd-convert.spec.ts` — integration coverage.

**Modify:**
- `packages/volto-hydra/src/utils/blockSync.js` — add `getConversionMap(blocksConfig)` next to `getConvertibleTypes` (~2012).
- `packages/volto-hydra/src/utils/blockSync.test.js` (or the existing vitest file) — unit test `getConversionMap`.
- `packages/hydra-js/hydra.src.js` — store `this.conversionMap` from `INITIAL_DATA` (~3776); use `acceptableAt` at the drag gate (~9073).
- `packages/volto-hydra/src/components/Iframe/View.jsx` — send `conversionMap` on the three `INITIAL_DATA` posts (~2021/3696/3784); extract `convertBlockInPlace` helper from `commitChooser` (~4236-4255); convert-on-drop in `MOVE_BLOCKS` (~2799); convert-on-paste in `handlePaste` (~951); add `pendingMove` handling to `commitChooser` (~4224).
- `tests-playwright/fixtures/shared-block-schemas.js` — a small conversion graph + a container restricted to a convert-target.
- `docs/custom-blocks.md` — note that DnD/paste offer convert-targets (short addition to the fieldMappings section).

**Build note:** `hydra.src.js` edits are picked up live by admin-mock (loaded directly). The distributable `hydra.js` must be rebuilt (`pnpm --filter @volto-hydra/hydra-js build`) before committing / for bridge (react/nuxt) CI — do NOT rebuild before running admin-mock tests locally (memory: `feedback_no_rebuild_hydra`).

---

## Task 1: `getConversionMap` (admin, pure)

**Files:**
- Modify: `packages/volto-hydra/src/utils/blockSync.js` (add export near `getConvertibleTypes:2012`)
- Test: `packages/volto-hydra/src/utils/blockSync.test.js`

- [ ] **Step 1: Write the failing test** (append to the vitest file)

```js
import { getConversionMap } from './blockSync';

describe('getConversionMap', () => {
  const cfg = {
    a: { id: 'a', fieldMappings: { b: { x: 'x' } } },        // a -> b
    b: { id: 'b', fieldMappings: { c: { y: 'y' } } },        // b -> c
    c: { id: 'c', fieldMappings: {} },                        // sink
    lone: { id: 'lone' },                                     // no fieldMappings
  };
  it('maps each source type to its full reachable set (BFS)', () => {
    const m = getConversionMap(cfg);
    expect(new Set(m.a)).toEqual(new Set(['b', 'c']));
    expect(new Set(m.b)).toEqual(new Set(['c']));
    expect(m.c || []).toEqual([]);
  });
  it('omits/empties types with no fieldMappings', () => {
    const m = getConversionMap(cfg);
    expect(m.lone || []).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`getConversionMap` undefined)

Run: `pnpm exec vitest run packages/volto-hydra/src/utils/blockSync.test.js -t getConversionMap`
Expected: FAIL (not exported).

- [ ] **Step 3: Implement** (in `blockSync.js`, after `getConvertibleTypes`)

```js
/**
 * Static map { sourceType: [reachableTypes] } over the fieldMappings conversion
 * graph — the full reachable set, UNFILTERED by any container's allowedBlocks
 * (the target filters at check time). Built once and shipped to the iframe so it
 * can offer convert-reachable drop spots. Types with no reachable targets map to [].
 */
export function getConversionMap(blocksConfig) {
  const map = {};
  if (!blocksConfig) return map;
  for (const sourceType of Object.keys(blocksConfig)) {
    map[sourceType] = getConvertibleTypes(sourceType, blocksConfig).map((t) => t.type);
  }
  return map;
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm exec vitest run packages/volto-hydra/src/utils/blockSync.test.js -t getConversionMap`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/volto-hydra/src/utils/blockSync.js packages/volto-hydra/src/utils/blockSync.test.js
git commit -m "feat(conversion): getConversionMap — static reachable-type map from fieldMappings"
```

---

## Task 2: `acceptableAt` predicate (Volto-free, shared)

**Files:**
- Create: `packages/hydra-js/conversionMap.js`
- Test: `packages/hydra-js/conversionMap.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { acceptableAt } from './conversionMap.js';

const cmap = { a: ['b', 'c'], d: ['b'] }; // a→{b,c}, d→{b}

describe('acceptableAt', () => {
  test('unrestricted container accepts anything', () => {
    expect(acceptableAt('a', null, false, cmap)).toBe(true);
  });
  test('native fit', () => {
    expect(acceptableAt('a', ['a'], false, cmap)).toBe(true);
  });
  test('single block: one convertible option → accept', () => {
    expect(acceptableAt('d', ['b'], false, cmap)).toBe(true);
  });
  test('single block: multiple convertible options → accept (popup)', () => {
    expect(acceptableAt('a', ['b', 'c'], false, cmap)).toBe(true);
  });
  test('multi block: exactly one option → accept', () => {
    expect(acceptableAt('a', ['b'], true, cmap)).toBe(true);   // only b in allowed
  });
  test('multi block: multiple options → reject (no popup chains)', () => {
    expect(acceptableAt('a', ['b', 'c'], true, cmap)).toBe(false);
  });
  test('not reachable → reject', () => {
    expect(acceptableAt('a', ['z'], false, cmap)).toBe(false);
  });
  test('no conversion map → native only', () => {
    expect(acceptableAt('a', ['b'], false, undefined)).toBe(false);
    expect(acceptableAt('a', ['a'], false, undefined)).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd packages/hydra-js && NODE_OPTIONS='--experimental-vm-modules' npx jest conversionMap.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `packages/hydra-js/conversionMap.js`

```js
/**
 * Can a block of `type` be dropped/pasted into a container whose sibling types
 * are `allowed`, given the static `conversionMap` ({type:[reachableTypes]})?
 *
 * - unrestricted container (allowed nullish) → always
 * - native fit (type ∈ allowed) → always
 * - else options = conversionMap[type] ∩ allowed:
 *     empty            → no
 *     single block     → yes (1 = auto-convert, >1 = popup; both are valid spots)
 *     multi block      → yes only if exactly one option (auto-only, no popup chains)
 *
 * Shared verbatim by the iframe drag gate and (implicitly, by construction) the
 * admin's drop resolution, so a spot the iframe offers is never rejected on drop.
 */
export function acceptableAt(type, allowed, isMulti, conversionMap) {
  if (allowed == null) return true;
  if (allowed.includes(type)) return true;
  const reachable = (conversionMap && conversionMap[type]) || [];
  const options = reachable.filter((t) => allowed.includes(t));
  if (options.length === 0) return false;
  if (isMulti) return options.length === 1;
  return true;
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `cd packages/hydra-js && NODE_OPTIONS='--experimental-vm-modules' npx jest conversionMap.test.js`
Expected: PASS (8 assertions).

- [ ] **Step 5: Commit**

```bash
git add packages/hydra-js/conversionMap.js packages/hydra-js/conversionMap.test.js
git commit -m "feat(conversion): acceptableAt — shared drop-acceptance predicate"
```

---

## Task 3: Ship `conversionMap` admin → iframe

No unit test (pure wiring); covered end-to-end by Task 5's integration test. Keep this task minimal.

**Files:**
- Modify: `packages/volto-hydra/src/components/Iframe/View.jsx` (3 INITIAL_DATA posts)
- Modify: `packages/hydra-js/hydra.src.js` (INITIAL_DATA handler ~3776, field init ~246)

- [ ] **Step 1: Admin — build the map once and attach it.** Near the top of the component (where `blocksConfig` is in scope), memoize:

```js
const conversionMap = useMemo(
  () => getConversionMap(config.blocks.blocksConfig),
  [],
);
```

Add `getConversionMap` to the `blockSync` import. On EACH of the three `type: 'INITIAL_DATA'` postMessages (~2021, ~3696, ~3784), add `conversionMap,` to the message object.

- [ ] **Step 2: Iframe — store it.** In `hydra.src.js` constructor (~246) add `this.conversionMap = {};`. In the `INITIAL_DATA` handler (~3776, alongside `setFormDataFromAdmin(...)`):

```js
if (e.data.conversionMap) this.conversionMap = e.data.conversionMap;
```

- [ ] **Step 3: Sanity check** — start admin-mock, open a page, and confirm in the iframe console `bridge.conversionMap` (or a temporary log) is populated. No automated assertion here.

- [ ] **Step 4: Commit**

```bash
git add packages/volto-hydra/src/components/Iframe/View.jsx packages/hydra-js/hydra.src.js
git commit -m "feat(conversion): ship conversionMap to the iframe on INITIAL_DATA"
```

---

## Task 4: Test fixtures — a conversion graph + a restricted container

**Files:**
- Modify: `tests-playwright/fixtures/shared-block-schemas.js`
- (Content fixture) a page with a draggable source block + a restricted container.

- [ ] **Step 1: Inspect what convertible types already exist** in the mock schemas so we reuse rather than invent where possible:

Run: `grep -n 'fieldMappings\|allowedBlocks' tests-playwright/fixtures/shared-block-schemas.js`

- [ ] **Step 2: Add a minimal deterministic graph.** Ensure there is:
  - a source block type `S` draggable at page level (in the page `allowedBlocks`),
  - `S.fieldMappings` reaching a target type `T` (single option) and, separately, a type reachable to two targets `T1`/`T2` for the popup test,
  - a container block `C` (reuse `grid`/columns if it already restricts, else add) whose region `allowedBlocks: ['T']` (single) — and a second container/region `allowedBlocks: ['T1','T2']` for the popup case.

  Prefer reusing existing types (e.g. slate/@default, teaser, facet types). Only add toy types if no existing pair fits. Keep names obvious (`convSource`, `convTargetA`, `convTargetB`) if adding.

- [ ] **Step 3: Add the content fixture** under `tests-playwright/fixtures/content/dnd-convert-page/data.json`: page with one `S` block in `items` and one restricted container `C` (seeded empty) in `items`.

- [ ] **Step 4: Commit** (fixtures only; no behavior yet)

```bash
git add tests-playwright/fixtures/shared-block-schemas.js tests-playwright/fixtures/content/dnd-convert-page
git commit -m "test(conversion): fixtures — conversion graph + restricted container"
```

---

## Task 5: Convert-on-drop, single option (auto)

**Files:**
- Modify: `packages/hydra-js/hydra.src.js` (drag gate ~9073)
- Modify: `packages/volto-hydra/src/components/Iframe/View.jsx` (extract `convertBlockInPlace`; MOVE_BLOCKS ~2799)
- Test: `tests-playwright/integration/dnd-convert.spec.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

test('drag a block into a container that only accepts a convert-target auto-converts it', async ({ page }) => {
  const helper = new AdminUIHelper(page);
  await helper.login();
  await helper.navigateToEdit('/dnd-convert-page');
  // Drag the source block onto the restricted container (empty seed).
  await helper.dragBlockOntoBlock('conv-source-1', 'restricted-container-empty-seed');
  // After drop: a block of the target type now lives in the container.
  await expect
    .poll(async () => helper.getBlockTypeInContainer('restricted-container-1'))
    .toBe('convTargetA');
});
```

(Use the existing DnD helper — inspect `AdminUIHelper` for the drag method name, e.g. `dragAndDropBlock`/`dragBlockTo`; adapt the assertion helper or read formData via an existing helper.)

- [ ] **Step 2: Run — expect FAIL** (drop rejected today; container stays empty)

Run: `pnpm exec playwright test tests-playwright/integration/dnd-convert.spec.ts --project=admin-mock`
Expected: FAIL.

- [ ] **Step 3a: Iframe drag gate** — `hydra.src.js:9073`, import `acceptableAt` at top (`import { acceptableAt } from './conversionMap.js';`) and replace:

```js
const allTypesAllowed = !allowedSiblingTypes || draggedBlockTypes.length === 0 ||
  draggedBlockTypes.every((type) => allowedSiblingTypes.includes(type));
```

with:

```js
const isMulti = draggedBlockTypes.length > 1;
const allTypesAllowed = draggedBlockTypes.length === 0 ||
  draggedBlockTypes.every((type) =>
    acceptableAt(type, allowedSiblingTypes, isMulti, this.conversionMap));
```

- [ ] **Step 3b: Extract shared convert helper** in `View.jsx` from `commitChooser` (~4236-4255):

```js
// Convert a block to newType IN PLACE (container-aware), returning new formData.
const convertBlockInPlace = (props, bpm, blockId, newType) => {
  const blockData = getBlockById(props, bpm, blockId);
  if (!blockData) return props;
  const hasChildren = getContainerRegionDescriptors(blockData['@type'], blocksConfig, intl, blockData)
    .some((d) => getChildBlockEntries(blockData, d).length > 0);
  if (hasChildren) {
    return convertContainerBlock(props, bpm, blockId, newType, blocksConfig, intl);
  }
  const typeFieldName = bpm?.[blockId]?.typeField || '@type';
  const newBlockData = convertBlockType(blockData, newType, blocksConfig, typeFieldName, intl);
  return updateBlockById(props, bpm, blockId, newBlockData);
};
```

Refactor `commitChooser`'s convert branch to call it (no behavior change; keep tests green).

- [ ] **Step 3c: MOVE_BLOCKS convert-on-drop** — `View.jsx:2799`. Replace the hard reject with resolution. For each block compute `options = getConvertibleTypes(type, blocksConfig, targetAllowedTypes).map(t=>t.type)`:
  - native → leave as-is;
  - `options.length === 1` → `newFormData = convertBlockInPlace(newFormData, currentBpm, bid, options[0])` (rebuild bpm) BEFORE the move loop;
  - single-block & `options.length > 1` → open the popup (Task 6) and RETURN (don't move here);
  - `options.length === 0` && not native → keep the existing reject `break`.

  Do the conversions first (updating formData + a rebuilt pathMap), THEN run the existing move loop so the moved block already has the accepted type.

- [ ] **Step 4: Run — expect PASS** (single-option case)

Run: `pnpm exec playwright test tests-playwright/integration/dnd-convert.spec.ts --project=admin-mock -g "auto-converts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/hydra-js/hydra.src.js packages/volto-hydra/src/components/Iframe/View.jsx tests-playwright/integration/dnd-convert.spec.ts
git commit -m "feat(conversion): drag into a restricted container auto-converts (single option)"
```

---

## Task 6: Convert-on-drop, multiple options (ask-first popup)

**Files:**
- Modify: `packages/volto-hydra/src/components/Iframe/View.jsx` (`chooser` pendingMove; `commitChooser` ~4224; MOVE_BLOCKS branch from Task 5)
- Test: `tests-playwright/integration/dnd-convert.spec.ts`

- [ ] **Step 1: Write failing tests** — popup appears + choose converts&moves as one undo; cancel leaves the block at origin.

```ts
test('drag into a container with multiple convert-targets opens the chooser and commits atomically', async ({ page }) => {
  const helper = new AdminUIHelper(page);
  await helper.login();
  await helper.navigateToEdit('/dnd-convert-page');
  await helper.dragBlockOntoBlock('conv-source-1', 'multi-container-empty-seed');
  await expect(page.locator('.blocks-chooser')).toBeVisible();       // ask-first: no move yet
  expect(await helper.getBlockTypeInContainer('multi-container-1')).toBeNull();
  await page.locator('.blocks-chooser').getByText('convTargetB').click();
  await expect.poll(() => helper.getBlockTypeInContainer('multi-container-1')).toBe('convTargetB');
  // one undo restores both the move and the conversion
  await helper.undo();
  await expect.poll(() => helper.getBlockTypeInContainer('multi-container-1')).toBeNull();
});

test('cancelling the convert chooser leaves the block where it was', async ({ page }) => {
  const helper = new AdminUIHelper(page);
  await helper.login();
  await helper.navigateToEdit('/dnd-convert-page');
  await helper.dragBlockOntoBlock('conv-source-1', 'multi-container-empty-seed');
  await expect(page.locator('.blocks-chooser')).toBeVisible();
  await page.mouse.click(5, 5); // outside → dismiss
  await expect(page.locator('.blocks-chooser')).toBeHidden();
  expect(await helper.getBlockTypeInContainer('multi-container-1')).toBeNull();
  // source still present/unchanged at page level
  expect(await helper.blockExists('conv-source-1')).toBe(true);
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm exec playwright test tests-playwright/integration/dnd-convert.spec.ts --project=admin-mock -g "multiple convert-targets|cancelling"`
Expected: FAIL.

- [ ] **Step 3a: Open the popup from MOVE_BLOCKS** (the `options.length > 1`, single-block branch from Task 5):

```js
setChooser({
  kind: 'convert',
  blockId: moveBlockId,
  allowedBlocks: options,                 // BlockChooser lists only these
  pendingMove: { targetBlockId, insertAfter, targetParentId, replaceTargetId },
});
break; // do not move now — ask first
```

- [ ] **Step 3b: `commitChooser` honors `pendingMove`** (~4256, convert branch). After computing `updatedProperties = convertBlockInPlace(properties, bpm, chooser.blockId, newType)`, if `chooser.pendingMove` is set, run the move on the converted formData and feed ONE `onChangeFormData`:

```js
let out = convertBlockInPlace(properties, bpm, chooser.blockId, newType);
if (chooser.pendingMove) {
  const bpm2 = buildBlockPathMap(out, blocksConfig, intl);
  const pm = chooser.pendingMove;
  const srcParent = bpm2[chooser.blockId]?.parentId || null;
  out = moveBlockBetweenContainers(
    out, bpm2, chooser.blockId, pm.targetBlockId, pm.insertAfter,
    srcParent, pm.targetParentId, blocksConfig, intl,
  ) || out;
}
onChangeFormData(out);            // single update → single undo
```

(Dismiss already no-ops via the existing outside-click effect → `setChooser(null)`, and nothing was moved, so cancel needs no rollback.)

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm exec playwright test tests-playwright/integration/dnd-convert.spec.ts --project=admin-mock -g "multiple convert-targets|cancelling"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/volto-hydra/src/components/Iframe/View.jsx tests-playwright/integration/dnd-convert.spec.ts
git commit -m "feat(conversion): multi-option drop opens the chooser, converts+moves atomically"
```

---

## Task 7: Convert-on-paste

**Files:**
- Modify: `packages/volto-hydra/src/components/Iframe/View.jsx` (`handlePaste` ~951)
- Test: `tests-playwright/integration/dnd-convert.spec.ts`

- [ ] **Step 1: Write failing test** — copy/cut a source block, paste into the restricted container → auto-convert (single); paste into the multi container → chooser.

```ts
test('pasting a block into a restricted container auto-converts it', async ({ page }) => {
  const helper = new AdminUIHelper(page);
  await helper.login();
  await helper.navigateToEdit('/dnd-convert-page');
  await helper.selectBlock('conv-source-1');
  await helper.copyBlock();                    // or cut
  await helper.selectBlock('restricted-container-empty-seed');
  await helper.pasteBlock();
  await expect.poll(() => helper.getBlockTypeInContainer('restricted-container-1')).toBe('convTargetA');
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm exec playwright test tests-playwright/integration/dnd-convert.spec.ts --project=admin-mock -g "pasting"`
Expected: FAIL (paste blocked today).

- [ ] **Step 3: Implement** — in `handlePaste` (~951), replace the all-or-nothing reject with per-block resolution against `allowedTypes`:
  - native → keep;
  - `options.length === 1` → convert the clone to `options[0]` before insertion (`convertBlockInPlace` on the staged formData, or convert the block data in `cloneWithIds` via `convertBlockType`);
  - single pasted block & `options.length > 1` → `setChooser({ kind:'convert', ..., pendingPaste })` (mirror `pendingMove`; commit path inserts then converts). *(If time-boxing, the single-block-multi-option paste popup can reuse the same `pendingMove` mechanism by inserting first then converting; keep atomic.)*
  - `options.length === 0` && not native → keep the existing reject `return`.
  - multi-paste → auto-only (no popup): drop any block that would need a popup, log it.

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm exec playwright test tests-playwright/integration/dnd-convert.spec.ts --project=admin-mock -g "pasting"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/volto-hydra/src/components/Iframe/View.jsx tests-playwright/integration/dnd-convert.spec.ts
git commit -m "feat(conversion): paste into a restricted container converts (auto / popup)"
```

---

## Task 8: Multi-block auto-only

**Files:**
- Test: `tests-playwright/integration/dnd-convert.spec.ts` (behavior already implemented via `acceptableAt` isMulti + Task 5 loop)

- [ ] **Step 1: Write test** — select two source blocks each with exactly one convert-target → drag into the restricted container → both auto-convert. Then a case where one selected block has multiple options → the container is NOT a valid drop (indicator not offered / drop rejected), asserting native-only fallback.

- [ ] **Step 2: Run — expect it to PASS already** (if `acceptableAt(isMulti)` + the drop loop are correct). If the multi-option member is NOT rejected, fix the MOVE_BLOCKS loop to skip/reject a batch block whose `options.length !== 1 && !native`.

- [ ] **Step 3: Commit**

```bash
git add tests-playwright/integration/dnd-convert.spec.ts packages/volto-hydra/src/components/Iframe/View.jsx
git commit -m "test(conversion): multi-block drag auto-converts single-option members only"
```

---

## Task 9: Regression + rebuild bundle

- [ ] **Step 1: Native DnD/paste regression** — the existing specs must stay green:

Run: `pnpm exec playwright test tests-playwright/integration/drag-and-drop.spec.ts --project=admin-mock`
Expected: PASS (esp. `:461`, `:496`, `:26`).

- [ ] **Step 2: Unit suites**

Run: `cd packages/hydra-js && NODE_OPTIONS='--experimental-vm-modules' npx jest conversionMap` and `pnpm exec vitest run packages/volto-hydra/src/utils/blockSync.test.js`
Expected: PASS.

- [ ] **Step 3: Rebuild the distributable bundle** (for bridge/react/nuxt CI which loads built `hydra.js`):

Run: `pnpm --filter @volto-hydra/hydra-js build`
Then `git add packages/hydra-js/hydra.js packages/hydra-js/hydra.js.map`.

- [ ] **Step 4: Commit**

```bash
git commit -m "build(hydra-js): rebuild bundle with convert-drop acceptance"
```

---

## Task 10: Docs

**Files:**
- Modify: `docs/custom-blocks.md` (fieldMappings / conversion section)

- [ ] **Step 1: Add a short paragraph** under the conversion section: dragging or pasting a block into a container that only accepts a *convertible* type now converts it on drop — auto when one target type is reachable, a chooser popup when several; multi-block and mobile (cut/paste) are auto-only. Keep it brief (memory: `feedback_concise_docs`).

- [ ] **Step 2: Commit**

```bash
git add docs/custom-blocks.md
git commit -m "docs(conversion): DnD/paste offer convert-reachable destinations"
```

---

## Verification (whole feature)

1. `cd packages/hydra-js && NODE_OPTIONS='--experimental-vm-modules' npx jest conversionMap` — green.
2. `pnpm exec vitest run packages/volto-hydra/src/utils/blockSync.test.js` — green.
3. `pnpm exec playwright test tests-playwright/integration/dnd-convert.spec.ts --project=admin-mock` — all green.
4. `pnpm exec playwright test tests-playwright/integration/drag-and-drop.spec.ts --project=admin-mock` — no regression.
5. Bundle rebuilt; push branch, open PR (separate from #256). Full suite on CI (don't run large suites locally — memory `feedback_ci_for_large_suites`).

## Risks / watch-items

- **Iframe/admin agreement:** iframe uses `acceptableAt(conversionMap)`, admin uses `getConvertibleTypes(...allowed)`. They agree because `conversionMap[t] = getConvertibleTypes(t)` unfiltered, `∩ allowed` = filtered. Keep both derived from the same graph; don't hand-edit one.
- **Atomicity:** convert+move must be ONE `onChangeFormData` (Task 6 Step 3b) — verify undo is single-step in the test.
- **Rebuild:** don't rebuild `hydra.js` before admin-mock runs (live-reload uses `hydra.src.js`); DO rebuild before pushing (bridge CI uses the bundle).
- **Empty-seed anchor:** a restricted container drop-target needs a real `data-block-uid` anchor — the seeded `empty` placeholder provides it (existing behavior); the convert path reuses the same shade/replace flow.
