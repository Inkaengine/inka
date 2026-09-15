# Deep-link Fragments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. (No subagents — user standing rule; execute inline.)

**Goal:** Let a link author deep-link to in-page anchors (`path#fragment`) that the frontend exposes via `data-linkable-id`, persisted per-block and offered by an "expand" control in the object browser.

**Architecture:** The frontend marks anchor elements with a real `id` + `data-linkable-id="Name"`. Hydra harvests them in its render-complete pass (echo-guarded), groups by nearest `[data-block-uid]`, and pushes a `LINKABLE_ANCHORS` map to the admin, which merges `block._linkableAnchors` into formData so it persists with the registered `blocks` field. The object browser's expand control does a full-object GET of a target, walks its blocks in document order, and lists the anchors; picking one appends `#id` to the link.

**Tech Stack:** vanilla JS bridge (`packages/hydra-js`), React/Volto admin (`packages/volto-hydra`), vitest unit tests, Playwright integration (`--project=admin-mock`), mock Plone API.

**Spec:** `docs/superpowers/specs/2026-07-23-deep-link-fragments-design.md`

---

## Conventions (locked)

- Block field: **`_linkableAnchors`** — `[{ id, name }]`, key omitted when a block has none.
- Iframe→admin message: **`LINKABLE_ANCHORS`** — `{ type: 'LINKABLE_ANCHORS', anchors: { [blockUid]: [{id,name}] } }`, the FULL current map (all blocks that currently have anchors). Admin reconciles: set for blocks present, delete for blocks that lost theirs.
- Frontend attr name in hydra tag family: **`linkable-id`** → `data-linkable-id`.
- Anchor = `{ id: el.id, name: el.getAttribute('data-linkable-id') }`. Skip elements with no `id`.

## File structure

- Create `packages/hydra-js/linkableAnchors.js` — pure `collectLinkableAnchors(rootEl)` (DOM → map). One responsibility: DOM harvest + nearest-ancestor grouping.
- Create `packages/hydra-js/linkableAnchors.test.js` — vitest (jsdom).
- Modify `packages/hydra-js/hydra.js` — register tag in `attrMap`; call collector in `afterContentRender`; echo-guard + post `LINKABLE_ANCHORS`.
- Create `packages/volto-hydra/src/utils/linkableAnchors.js` — `collectAnchorsFromContent(formData, blocksConfig, intl)` (ordered read-path collector).
- Create `packages/volto-hydra/src/utils/linkableAnchors.test.js` — vitest.
- Modify `packages/volto-hydra/src/components/Iframe/View.jsx` — handle `LINKABLE_ANCHORS`.
- Modify `packages/volto-hydra/src/customizations/volto/components/manage/Sidebar/ObjectBrowserBody.jsx` — expand control.
- Modify `tests-playwright/fixtures/test-frontend/renderer.js` — emit `id` + `data-linkable-id` from anchor-bearing block data.
- Create `tests-playwright/fixtures/content/deep-link-page/data.json` — fixture content with anchor blocks.
- Create `tests-playwright/integration/deep-link-fragments.spec.ts` — integration.
- Modify `docs/build-a-frontend.md` — document the `data-linkable-id` contract.

Run all unit tests with: `pnpm exec vitest run <path>`.

---

## Task 1: Pure DOM collector `collectLinkableAnchors`

**Files:**
- Create: `packages/hydra-js/linkableAnchors.js`
- Test: `packages/hydra-js/linkableAnchors.test.js`

- [ ] **Step 1: Write the failing test**

```js
// packages/hydra-js/linkableAnchors.test.js
import { describe, it, expect } from 'vitest';
import { collectLinkableAnchors } from './linkableAnchors.js';

function dom(html) {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
}

describe('collectLinkableAnchors', () => {
  it('groups anchors under their nearest data-block-uid ancestor', () => {
    const root = dom(`
      <div data-block-uid="b1">
        <h2 id="sec-one" data-linkable-id="Section One">One</h2>
        <p>text</p>
        <h3 id="sec-two" data-linkable-id="Section Two">Two</h3>
      </div>
      <div data-block-uid="b2">
        <h2 id="sec-three" data-linkable-id="Section Three">Three</h2>
      </div>`);
    expect(collectLinkableAnchors(root)).toEqual({
      b1: [
        { id: 'sec-one', name: 'Section One' },
        { id: 'sec-two', name: 'Section Two' },
      ],
      b2: [{ id: 'sec-three', name: 'Section Three' }],
    });
  });

  it('skips elements with no id (no fragment target)', () => {
    const root = dom(`
      <div data-block-uid="b1">
        <h2 data-linkable-id="No Id">x</h2>
        <h2 id="ok" data-linkable-id="Ok">y</h2>
      </div>`);
    expect(collectLinkableAnchors(root)).toEqual({ b1: [{ id: 'ok', name: 'Ok' }] });
  });

  it('skips anchors with no owning block', () => {
    const root = dom(`<h2 id="orphan" data-linkable-id="Orphan">x</h2>`);
    expect(collectLinkableAnchors(root)).toEqual({});
  });

  it('a container block does NOT absorb a child block’s anchors', () => {
    const root = dom(`
      <div data-block-uid="col">
        <div data-block-uid="child">
          <h2 id="deep" data-linkable-id="Deep">z</h2>
        </div>
      </div>`);
    // anchor belongs to nearest ancestor 'child', not 'col'
    expect(collectLinkableAnchors(root)).toEqual({ child: [{ id: 'deep', name: 'Deep' }] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/hydra-js/linkableAnchors.test.js 2>&1 | tee /tmp/test-output.log`
Expected: FAIL — `collectLinkableAnchors` is not exported / module missing.

- [ ] **Step 3: Write minimal implementation**

```js
// packages/hydra-js/linkableAnchors.js
/**
 * Harvest deep-link anchors from a rendered DOM subtree.
 *
 * Each element carrying `data-linkable-id` contributes an anchor to its NEAREST
 * `[data-block-uid]` ancestor (so a container never absorbs a child block's
 * anchors). Elements without an `id` are skipped — there is no fragment to link.
 *
 * @param {ParentNode} rootEl - element/document to scan
 * @returns {{ [blockUid: string]: Array<{id: string, name: string}> }}
 */
export function collectLinkableAnchors(rootEl) {
  const out = {};
  const els = rootEl.querySelectorAll('[data-linkable-id]');
  for (const el of els) {
    const id = el.getAttribute('id');
    if (!id) continue;
    const owner = el.closest('[data-block-uid]');
    if (!owner) continue;
    const uid = owner.getAttribute('data-block-uid');
    const name = el.getAttribute('data-linkable-id');
    (out[uid] ||= []).push({ id, name });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/hydra-js/linkableAnchors.test.js 2>&1 | tee /tmp/test-output.log`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/hydra-js/linkableAnchors.js packages/hydra-js/linkableAnchors.test.js
git commit -m "feat(deep-link): pure collectLinkableAnchors DOM harvester"
```

---

## Task 2: Register `linkable-id` in hydra's tag family

**Files:**
- Modify: `packages/hydra-js/hydra.js:1007-1016` (the `attrMap` in `applyHydraAttributes`)

- [ ] **Step 1: Add the tag mapping**

In `attrMap`, add the entry so the frontend can declare `linkable-id` via hydra-comment selectors (parity with the literal attribute):

```js
    const attrMap = {
      "block-uid": "data-block-uid",
      "block-readonly": "data-block-readonly",
      "edit-text": "data-edit-text",
      "edit-link": "data-edit-link",
      "edit-media": "data-edit-media",
      "block-add": "data-block-add",
      "block-selector": "data-block-selector",
      "block-container": "data-block-container",
      "linkable-id": "data-linkable-id"
    };
```

- [ ] **Step 2: Sanity — no unit test here (config line); covered by Task 7 integration.** Verify hydra still parses:

Run: `pnpm exec vitest run packages/hydra-js/ 2>&1 | tee /tmp/test-output.log`
Expected: PASS (no regressions).

- [ ] **Step 3: Commit**

```bash
git add packages/hydra-js/hydra.js
git commit -m "feat(deep-link): register linkable-id in hydra tag family"
```

---

## Task 3: Collect on render + push `LINKABLE_ANCHORS` (echo-guarded)

**Files:**
- Modify: `packages/hydra-js/hydra.js` — import collector (top), hook into `afterContentRender` (~5726), add `_maybeSendLinkableAnchors()`.

- [ ] **Step 1: Import the collector**

At the top of hydra.js (with the other module imports), add:

```js
import { collectLinkableAnchors } from "./linkableAnchors.js";
```

- [ ] **Step 2: Add the guarded sender method** (near other `sendMessageToParent` helpers)

```js
  /**
   * Harvest linkable anchors from the live DOM and, when the full map changed
   * since last send, push it to the admin so it can persist block._linkableAnchors.
   * Guarded by a JSON snapshot so a FORM_DATA echo → re-render never loops.
   */
  _maybeSendLinkableAnchors() {
    const anchors = collectLinkableAnchors(document);
    const json = JSON.stringify(anchors);
    if (json === this._lastSentAnchors) return;
    this._lastSentAnchors = json;
    this.sendMessageToParent({ type: "LINKABLE_ANCHORS", anchors });
  }
```

- [ ] **Step 3: Call it from `afterContentRender`**

At the end of `afterContentRender(...)` (after the existing block-selection work, around 5895 where `_renderInProgress` is cleared), add:

```js
    this._maybeSendLinkableAnchors();
```

- [ ] **Step 4: Verify no hydra unit regressions**

Run: `pnpm exec vitest run packages/hydra-js/ 2>&1 | tee /tmp/test-output.log`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/hydra-js/hydra.js
git commit -m "feat(deep-link): send LINKABLE_ANCHORS from render-complete pass, echo-guarded"
```

---

## Task 4: Admin merges `LINKABLE_ANCHORS` into formData

**Files:**
- Modify: `packages/volto-hydra/src/components/Iframe/View.jsx` — new `case 'LINKABLE_ANCHORS'` in the message switch (near INLINE_EDIT_DATA ~2233). Uses `getBlockById`/`updateBlockById` (already the mandated block accessors) and `buildBlockPathMap`.

- [ ] **Step 1: Add the handler**

Add a case (reconcile: set anchors for blocks in the map, delete `_linkableAnchors` for blocks that dropped theirs):

```jsx
        case 'LINKABLE_ANCHORS': {
          const incoming = event.data.anchors || {};
          let next = properties;
          const pmap = iframeSyncState.blockPathMap || blockPathMapRef.current;
          // Union of blocks that either have incoming anchors or currently store some.
          const uids = new Set(Object.keys(incoming));
          for (const [uid, info] of Object.entries(pmap || {})) {
            if (uid.startsWith('_')) continue; // skip meta keys (_schemas, etc.)
            const cur = getBlockById(next, pmap, uid);
            if (cur && cur._linkableAnchors) uids.add(uid);
            void info;
          }
          let changed = false;
          for (const uid of uids) {
            const block = getBlockById(next, pmap, uid);
            if (!block) continue;
            const want = incoming[uid];
            const have = block._linkableAnchors;
            if (JSON.stringify(want || null) === JSON.stringify(have || null)) continue;
            const updated = { ...block };
            if (want && want.length) updated._linkableAnchors = want;
            else delete updated._linkableAnchors;
            next = updateBlockById(next, pmap, uid, updated);
            changed = true;
          }
          if (changed) {
            setIframeSyncState((prev) => ({
              ...prev,
              formData: next,
              blockPathMap: buildBlockPathMap(next, config.blocks.blocksConfig, intl),
            }));
            onChangeFormData(next);
          }
          break;
        }
```

> Confirm at impl time that `getBlockById`/`updateBlockById` are already imported in View.jsx (per CLAUDE.md they are the mandated accessors); if not, add `import { getBlockById, updateBlockById } from '../../utils/blockPath';`. Confirm the local variable names (`properties`, `iframeSyncState`, `blockPathMapRef`, `onChangeFormData`, `setIframeSyncState`, `config`, `intl`) against the surrounding cases and adjust to match.

- [ ] **Step 2: (Covered by Task 7 integration — no isolated unit for the View switch.)** Verify admin builds/tests unaffected:

Run: `pnpm exec vitest run packages/volto-hydra/src/utils 2>&1 | tee /tmp/test-output.log`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/volto-hydra/src/components/Iframe/View.jsx
git commit -m "feat(deep-link): admin merges LINKABLE_ANCHORS into blocks formData"
```

---

## Task 5: Ordered read-path collector `collectAnchorsFromContent`

**Files:**
- Create: `packages/volto-hydra/src/utils/linkableAnchors.js`
- Test: `packages/volto-hydra/src/utils/linkableAnchors.test.js`

Walks a target's blocks in **document order** via `buildBlockPathMap` (which is built by walking `blocks_layout` arrays, so key order IS document order, recursing containers), reading each block's `_linkableAnchors`.

- [ ] **Step 1: Write the failing test**

```js
// packages/volto-hydra/src/utils/linkableAnchors.test.js
import { describe, it, expect } from 'vitest';
import { collectAnchorsFromContent } from './linkableAnchors';

const blocksConfig = {}; // page-level blocks_layout only; no custom container schemas needed

it('returns anchors in document (layout) order, not dict order', () => {
  const content = {
    blocks: {
      // intentionally NOT in layout order in the dict:
      b2: { '@type': 'slate', _linkableAnchors: [{ id: 'two', name: 'Two' }] },
      b1: { '@type': 'slate', _linkableAnchors: [{ id: 'one', name: 'One' }] },
      b3: { '@type': 'slate' }, // no anchors
    },
    blocks_layout: { items: ['b1', 'b2', 'b3'] },
  };
  expect(collectAnchorsFromContent(content, blocksConfig)).toEqual([
    { id: 'one', name: 'One', blockUid: 'b1' },
    { id: 'two', name: 'Two', blockUid: 'b2' },
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/volto-hydra/src/utils/linkableAnchors.test.js 2>&1 | tee /tmp/test-output.log`
Expected: FAIL — module/function missing.

- [ ] **Step 3: Write minimal implementation**

```js
// packages/volto-hydra/src/utils/linkableAnchors.js
import { buildBlockPathMap } from '@hydra-js/buildBlockPathMap';
import { getBlockById } from './blockPath';

/**
 * Collect a content item's linkable anchors in document order.
 *
 * Order comes from buildBlockPathMap, whose keys follow blocks_layout traversal
 * (recursing containers) — never the arbitrary `blocks` dict order.
 *
 * @param {object} content - full content object (blocks + blocks_layout)
 * @param {object} blocksConfig - registry blocks config
 * @param {object} [intl]
 * @returns {Array<{id: string, name: string, blockUid: string}>}
 */
export function collectAnchorsFromContent(content, blocksConfig, intl = {}) {
  const pmap = buildBlockPathMap(content, blocksConfig, intl);
  const anchors = [];
  for (const uid of Object.keys(pmap)) {
    if (uid.startsWith('_')) continue; // skip meta keys (_schemas, ...)
    const block = getBlockById(content, pmap, uid);
    const list = block?._linkableAnchors;
    if (!list) continue;
    for (const a of list) anchors.push({ ...a, blockUid: uid });
  }
  return anchors;
}
```

> Confirm the `@hydra-js/buildBlockPathMap` import alias against another util that already imports it (e.g. `copyFromTarget.js` / `View.jsx`); match whatever specifier they use.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/volto-hydra/src/utils/linkableAnchors.test.js 2>&1 | tee /tmp/test-output.log`
Expected: PASS. If order is wrong, add a nested-container fixture and switch to an explicit recursive `blocks_layout` walk — but key order should already be document order.

- [ ] **Step 5: Commit**

```bash
git add packages/volto-hydra/src/utils/linkableAnchors.js packages/volto-hydra/src/utils/linkableAnchors.test.js
git commit -m "feat(deep-link): ordered read-path anchor collector"
```

---

## Task 6: Expand control in the object browser

**Files:**
- Modify: `packages/volto-hydra/src/customizations/volto/components/manage/Sidebar/ObjectBrowserBody.jsx`

Adds a per-item "expand anchors" toggle. On expand it GETs the full object (search metadata has no blocks), collects ordered anchors, and lists them; picking one calls the existing select path with `#id` appended.

- [ ] **Step 1: Wire `getContent` + local anchor state**

- Import: `import { getContent } from '@plone/volto/actions/content/content';` and `import { collectAnchorsFromContent } from '../../../../../utils/linkableAnchors';` (verify the relative depth to `src/utils`).
- Add `getContent` to the component's `connect(...)` mapDispatch (it already connects `searchContent`), and read the fetched object from `content.subrequests[<key>]`.
- Component state: `{ expandedAnchorsFor: null, anchorsByItem: {} }`.

- [ ] **Step 2: Expand handler**

```jsx
  onToggleAnchors = async (item) => {
    const id = flattenToAppURL(item['@id']);
    if (this.state.expandedAnchorsFor === id) {
      this.setState({ expandedAnchorsFor: null });
      return;
    }
    if (!this.state.anchorsByItem[id]) {
      await this.props.getContent(id, null, `anchors-${id}`);
      const full = this.props.content?.subrequests?.[`anchors-${id}`]?.data
        || this.props.subrequests?.[`anchors-${id}`]?.data;
      const anchors = collectAnchorsFromContent(
        full, config.blocks.blocksConfig, this.props.intl,
      );
      this.setState((s) => ({ anchorsByItem: { ...s.anchorsByItem, [id]: anchors } }));
    }
    this.setState({ expandedAnchorsFor: id });
  };
```

> Confirm the subrequest read path against how Volto stores `getContent(url, version, key)` subrequests in this version (`state.content.subrequests[key].data`). Adjust the connected selector accordingly.

- [ ] **Step 3: Pick-an-anchor handler**

```jsx
  onSelectAnchor = (item, anchor) => {
    // Reuse the existing select path but append the fragment.
    this.onSelectItem({ ...item, '@id': `${item['@id']}#${anchor.id}` });
  };
```

`onSelectItem` (existing, ~289) already computes `url = item['@id']` and forwards to `this.props.onSelectItem(url, item)`, so the `#id` rides through unchanged.

- [ ] **Step 4: Render the control + list**

In the item row render (near `handleClickOnItem`, the browsable-item JSX ~595-602), add an expand button and, when `expandedAnchorsFor === flattenToAppURL(item['@id'])`, a list of `anchorsByItem[id]` rendering each `anchor.name` as a clickable row calling `onSelectAnchor(item, anchor)`. Only show the expand button when the item is a content object (has `@id`). Keep markup minimal and consistent with the surrounding Semantic UI usage.

- [ ] **Step 5: Verify admin utils still green**

Run: `pnpm exec vitest run packages/volto-hydra/src/utils 2>&1 | tee /tmp/test-output.log`
Expected: PASS. (UI behavior verified in Task 7.)

- [ ] **Step 6: Commit**

```bash
git add packages/volto-hydra/src/customizations/volto/components/manage/Sidebar/ObjectBrowserBody.jsx
git commit -m "feat(deep-link): expand-to-anchors control in object browser"
```

---

## Task 7: Integration — collect, persist, browse, pick

**Files:**
- Modify: `tests-playwright/fixtures/test-frontend/renderer.js` — emit `id` + `data-linkable-id`.
- Create: `tests-playwright/fixtures/content/deep-link-page/data.json`.
- Create: `tests-playwright/integration/deep-link-fragments.spec.ts`.

- [ ] **Step 1: Make the test frontend emit anchors**

In `renderSlateBlock` (renderer.js ~389), when a heading node carries an anchor descriptor (e.g. `node.data?.anchorId`), add `id` + `data-linkable-id` to the emitted tag. Minimal approach — emit for headings whose node has `data.anchorId`/`data.anchorName`:

```js
const anchorAttr = node.data?.anchorId
  ? ` id="${node.data.anchorId}" data-linkable-id="${node.data.anchorName || node.data.anchorId}"`
  : '';
// then include ${anchorAttr} on the h2/h3/... tags alongside nodeIdAttr
```

- [ ] **Step 2: Fixture content with anchors**

Create `deep-link-page/data.json`: a page with two slate blocks, each a heading node carrying `data.anchorId`/`data.anchorName` (e.g. `intro`/"Intro", `details`/"Details"), and a second target page to link FROM. Register the mount if the mock needs it (mirror `copy-target-page`).

- [ ] **Step 3: Write the failing integration test**

```ts
// tests-playwright/integration/deep-link-fragments.spec.ts
import { test, expect } from '@playwright/test';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

test('anchors persist in blocks and expand in the object browser', async ({ page }) => {
  const admin = new AdminUIHelper(page);
  await admin.gotoEdit('/deep-link-page');
  await admin.waitForIframeReady();

  // 1. Anchors were harvested into the block on render → assert via saved formData.
  //    (Read the block's _linkableAnchors from the admin form state / after save.)
  //    Assert blocks[...]._linkableAnchors contains {id:'intro', name:'Intro'}.

  // 2. On another page, open a link field's object browser, browse to deep-link-page,
  //    click the expand-anchors control, assert "Intro" and "Details" listed IN ORDER,
  //    pick "Details", assert the resulting link value ends with '#details'.
});
```

Flesh out selectors using existing `AdminUIHelper` methods (list them with the grep in CLAUDE.md). Prefer asserting persisted `_linkableAnchors` by reading the mock's saved content after a save, and asserting the picked link value carries `#details`.

- [ ] **Step 4: Run — expect red, then green after Tasks 1–6 wired**

Run: `pnpm exec playwright test tests-playwright/integration/deep-link-fragments.spec.ts --project=admin-mock 2>&1 | tee /tmp/test-output.log`
Expected: PASS once the fixture + renderer + handlers are all in place. Debug with the HTML report (`pnpm exec playwright show-report`).

- [ ] **Step 5: Commit**

```bash
git add tests-playwright/fixtures/test-frontend/renderer.js tests-playwright/fixtures/content/deep-link-page/ tests-playwright/integration/deep-link-fragments.spec.ts
git commit -m "test(deep-link): integration — persist anchors, expand + pick fragment"
```

---

## Task 8: Document the frontend contract

**Files:**
- Modify: `docs/build-a-frontend.md`

- [ ] **Step 1: Add a short section** (keep it concise — user rule)

Explain: mark a deep-linkable element with a real `id` (the fragment) AND `data-linkable-id="Friendly Name"` (picker label); both must survive into the published render so the anchor resolves at runtime; Hydra harvests them per-block on render and persists them, and the object browser offers them as deep-link targets. One short example block.

- [ ] **Step 2: Commit**

```bash
git add docs/build-a-frontend.md
git commit -m "docs(deep-link): document data-linkable-id anchor contract"
```

---

## Verification (whole feature)

1. Unit: `pnpm exec vitest run packages/hydra-js/linkableAnchors.test.js packages/volto-hydra/src/utils/linkableAnchors.test.js` — green.
2. Hydra regressions: `pnpm exec vitest run packages/hydra-js/` — green.
3. Integration: `pnpm exec playwright test tests-playwright/integration/deep-link-fragments.spec.ts --project=admin-mock` — green.
4. No object-browser regressions: run existing specs that touch link picking (`inline-editing-links.spec.ts`, `sidebar-forms.spec.ts`) on `--project=admin-mock`.
5. Push and let CI run the full suite (per standing rule — don't run 15+ min suites locally).

## Risks / watch-items

- **Echo loop:** the `_lastSentAnchors` JSON guard (Task 3) is load-bearing. Manually confirm no repeated `LINKABLE_ANCHORS` after a stable render (log once).
- **Subrequest shape (Task 6):** verify how this Volto version exposes `getContent(url,null,key)` results before relying on `content.subrequests[key].data`.
- **View.jsx local names (Task 4):** match the exact surrounding variable names — the switch handler is inside a large closure; don't assume identifiers.
- **Ordered traversal (Task 5):** if a nested-container fixture ever comes out of order, replace dict-key iteration with an explicit recursive `blocks_layout` walk (funnel-based) — the test guards this.
