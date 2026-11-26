# M2b: hoist the adapter host above the form

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Break the bootstrap deadlock so the admin can reach the adapter on every route, without the admin ever holding a credential.

**Why:** `Add.jsx` renders `<Form>` only once `getSchema` resolves (`Add.jsx:277`,
falling back to `return <div />`). `getSchema` now goes over the bridge. The
bridge needs an adapter. The adapter lives in the iframe. `Form.jsx:798` renders
the iframe. So the schema request waits on an adapter that only exists inside
the component the schema request is blocking. Confirmed by instrumented run:
`[DIAG-RPC] QUEUE http {"op":"get","path":"/_test_data/@types/Document"}` with
no matching send, resolve or reject.

**Decision taken:** hoist the iframe so it mounts independent of any data load.
Rejected: a second hidden host iframe (two adapters whose auth can diverge);
a direct-fetch allowlist (breaks the zero-credential invariant exactly where
cross-origin WP/Drupal need it); shipping schemas in `ADAPTER_READY` (fixes only
schema — every other bootstrap call deadlocks the same way).

---

## The actual problem

`packages/volto-hydra/src/components/Iframe/View.jsx` is 6172 lines and fuses
two responsibilities that have different lifetimes:

| Responsibility | Needs | Lifetime |
| --- | --- | --- |
| **Adapter host** — the iframe element, its src, the bridge handshake, `BridgeRPC` | the frontend URL | the whole session |
| **Editing surface** — selection chrome, drag handles, slate sync, form wiring | `formData`, `schema`, 20 props from `Form` | one document being edited |

The deadlock is entirely a consequence of the first inheriting the second's
lifetime. Splitting them is the fix; everything below is mechanics.

## Task 1: Characterise before touching anything

- [ ] **Step 1: Enumerate what the iframe element and handshake actually need**

Run: `grep -n "props\." packages/volto-hydra/src/components/Iframe/View.jsx | grep -oE "props\.[a-zA-Z]+" | sort -u`
Record which of the 20 props are read before `ADAPTER_READY` is handled. Expect
the handshake path to need only the frontend URL and origin.

- [ ] **Step 2: Write the characterisation test**

Before restructuring, pin current behaviour with a test that fails only if the
editing surface changes:

Run: `pnpm exec playwright test --project=admin-mock tests-playwright/integration/block-selection.spec.ts tests-playwright/integration/inline-editing-basic.spec.ts 2>&1 | tee /tmp/m2b-before.log`
Record the counts. These must be identical at the end.

## Task 2: Extract the adapter host

**Files:**
- Create: `packages/volto-hydra/src/bridge/AdapterHost.jsx`
- Modify: `packages/volto-hydra/src/components/Iframe/View.jsx`

- [ ] **Step 1: Move the element and handshake out**

`AdapterHost` owns: the `<iframe id="previewIframe">` element, `iframeOriginRef`,
`rpcRef`, the `BACKEND_RESPONSE` / `ADAPTER_READY` branches, `markReady` /
`markNotReady`, and publishing `window.__hydraBridgeRpc`. It takes one prop: the
frontend URL. It renders children into the same DOM position so the editing
code's `document.getElementById('previewIframe')` lookups keep working
unchanged — that lookup is already how View.jsx addresses the element
(`View.jsx:798`, `:1057`, `:2227`), so nothing there needs to change.

- [ ] **Step 2: Expose the RPC client by context, not only by window global**

The window global stays (the `Api` shadow is constructed before React exists and
has no other way in), but React consumers should read context. Do not add a
second source of truth for anything else.

- [ ] **Step 3: Verify the editing surface is untouched**

Run: the Task 1 Step 2 command again. Counts must match `/tmp/m2b-before.log`.

## Task 3: Mount the host above the form

**Files:**
- Modify: `packages/volto-hydra/src/customizations/volto/components/theme/App/App.jsx`

- [ ] **Step 1: Mount `AdapterHost` at App level**

It must mount on the routes that need a CMS at all (edit, add, view) and must
NOT mount where there is no frontend to talk to (login). Gate on the same
condition the iframe URL cookie already uses — see
`packages/volto-hydra/src/utils/cookieNames.js` and `getSavedURLs`.

- [ ] **Step 2: Remove the iframe element from `Form.jsx`**

`Form` keeps every editing prop and behaviour; it no longer owns the element.

- [ ] **Step 3: Run the deadlock test — this is the red-to-green step**

Run: `pnpm exec playwright test --project=bridge-mock tests-playwright/integration/navigation.spec.ts 2>&1 | tee /tmp/m2b-after.log`
Expected: 20 passed. Before this change: 4 failed, 16 passed.

- [ ] **Step 4: Re-run the falsification probe**

Temporarily remove the adapter registration from
`tests-playwright/fixtures/test-frontend/index.html` and re-run the same spec.
Expected: it FAILS. A pass means the bridge is not actually carrying the
traffic and the green above is meaningless — this is not optional, it is the
only thing that distinguishes a real result from a vacuous one.
Restore the registration afterwards.

## Task 4: The transparency proof

- [ ] **Step 1: Full baseline, flag off**

Run: `pnpm exec playwright test --project=admin-mock --reporter=line 2>&1 | tee /tmp/pw-baseline.log`
Known state as of 2026-08-26: 839 passed, 8 failed, 16 skipped. Six of those 8
also fail at base commit `cbb32861`; the other two
(`inline-editing-basic.spec.ts:789`, `multi-element-blocks.spec.ts:547`) pass
2/2 in isolation and are load-flaky.

- [ ] **Step 2: Full bridge run, flag on, fresh server**

Run: `pnpm exec playwright test --project=bridge-mock --reporter=line 2>&1 | tee /tmp/pw-bridge.log`

`reuseExistingServer` is true, so confirm no Volto server is already running
first — a server started without `RAZZLE_USE_BRIDGE_BACKEND=true` is reused
silently and the proof means nothing:

Run: `lsof -nP -iTCP -sTCP:LISTEN | grep -E ":300[0-9]"`
Expected: no output before starting.

- [ ] **Step 3: Compare**

Counts must match Step 1. Any divergence is a defect in the inversion. Do not
adjust a test to make them match.

## Notes for M3 and M4

- **Every adapter milestone needs a falsification probe**, not just a passing
  run. The first bridge-mock run of M2 passed 20/20 while the bridge carried
  nothing at all, because the `Api` shadow chose its transport in the
  constructor and `window.__hydraBridgeRpc` did not exist yet. "Tests pass with
  the flag on" is not evidence the flag did anything.
- **The contract suite cannot catch lifetime bugs.** All 44 assertions pass
  against an adapter driven directly in Node. Everything found in this
  milestone — constructor-time transport selection, the bootstrap deadlock,
  SPA re-announcement — needed a real browser.
