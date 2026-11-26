# M3: WordPress adapter, unified Permissions & State, and the journey test

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A person logs into WordPress, creates a page in Hydra, edits it with
blocks, publishes it, and an anonymous visitor can read it.

**Prerequisite:** M2b (`2026-08-26-cms-adapters-m2b-iframe-hoist.md`). The Add
route deadlocks until that lands, and step 2 of the journey is Add.

**Tech:** `@wp-playground/cli` (real WordPress on PHP-WASM, SQLite, blueprint-seeded),
`@wordpress/e2e-test-utils-playwright` for fixtures.

---

## The journey is the headline test

Everything else in this milestone exists to make this pass. Write it first, let
it fail for real reasons, and work backwards.

```
1. log in     blueprint seeds a logged-in WP cookie   → Flow A: no login UI at all
2. create     toolbar Add → content.create           → the post exists in WP
3. edit       drag a block, type into it             → content.update
4. link       select text, open the object browser, pick another page
                                                     → search / tree.list, then
                                                       store the target's ID
5. verify     reload                                 → blocks survive in post_content
6. rename     rename the LINK TARGET                 → the link still resolves
7. publish    state.transition draft → publish       → the combined panel
8. confirm    ANONYMOUSLY: REST says status=publish, AND the FRONTEND renders
                the text and a working link
```

Steps 4 and 6 are the first in the journey to involve a *relationship* between
two documents, and relationships are where path-addressing breaks. A link
stored as a path dies the moment an editor renames the target — silently, with
no error anywhere, discovered by a reader hitting a 404.

So links are stored by `Document.id`, which is the stable handle, and resolved
through `reference.resolve` at render time. Each CMS supplies its own
indirection:

| CMS | Native mechanism |
| --- | --- |
| Plone | `resolveuid/<UID>` — the catalog resolves UID to the current path |
| WordPress | none; the post id is stable but the permalink is not, so the adapter is the indirection |
| Drupal | `entity:node/<uuid>` link URIs |

Step 6 is what makes the link step real rather than decorative: rename the
target, then assert the link still resolves. `reference.spec.ts` pins exactly
this at the contract level and is green against Plone.

Step 6 is what makes it real: it leaves Hydra entirely and asks, with no
session, whether the thing was actually published. None of the 44 contract
assertions can lie their way past that.

**Do not assert on WordPress's own public page.** Verified against real
WordPress 2026-08-26: `content.rendered` for a published page carrying our
block comment is the empty string, because `wp:hydra-blocks/document` is not a
registered block and WordPress renders nothing for it. That is by design — in a
headless setup the reader-facing surface is the frontend, not WP's theme. So
step 6 has two halves: anonymous REST proves the CMS state really changed, and
an anonymous fetch of the FRONTEND proves a reader can see the content.

## Verified against real WordPress (2026-08-26)

Established by hand before writing any code, so the target is not built on
assumptions:

| Claim | Result |
| --- | --- |
| `@wp-playground/cli` boots real WP, no Docker | PHP 8.3, WP latest, ~40s, 6 workers |
| Block comment survives a write/read round trip | **byte-for-byte identical** via `context=edit` |
| Publish via REST | `POST {status:'publish'}` works |
| Anonymous REST read of a published page | works, reports `status: publish` |
| WP renders the unknown block on its own page | **no** — `content.rendered` is `''` |
| Cookie auth alone is enough for REST | **no** — `users/me` returns nothing |
| Nonce source | `GET /wp-admin/admin-ajax.php?action=rest-nonce` |

Two operational notes that cost time to discover:

- **No pretty permalinks.** Use `/?rest_route=/wp/v2/...`, not `/wp-json/...`,
  which 302s.
- **`--login` auto-logs-in every fresh session**, so a naive "anonymous" fetch
  is not anonymous. Send `Cookie: playground_auto_login_already_happened=1`
  with no auth cookies to stay genuinely logged out.

**Why the journey and not only slices.** Six isolated specs localise failures
well but never exercise ordering, and every defect found in M1/M2 was an
ordering or lifetime bug: transport chosen before the bridge existed, an adapter
whose host was gated behind the request it had to answer, a re-announcement
missing on SPA navigation. A journey test would have hit the bootstrap deadlock
at step 2 on day one. Keep both: the journey answers *does it work*, the slices
answer *where did it break*.

## Task 1: The journey spec, failing

**Files:**
- Create: `tests-adapters/e2e/journey-wordpress.spec.ts`

- [ ] **Step 1: Write all six steps end to end**

Assert against the seed, not per-CMS literals, exactly as the contract suite
does. Step 6 must use a fresh browser context with no storage state — reusing
the authenticated context would let a draft render and pass.

- [ ] **Step 2: Run it and read the failure**

Expected: fails at step 1 or 2. Record which. Do not fix anything yet.

## Task 2: WordPress target

**Files:**
- Create: `tests-adapters/targets/wordpress.ts`
- Create: `tests-adapters/fixtures/wp-blueprint.json`
- Modify: `tests-adapters/targets/index.ts` (register in `TARGETS`)

- [ ] **Step 1: Generate the blueprint from `seed.json`**

Same rule as `project-plone.mjs`: `seed.json` is the source of truth and each
target projects it. Do not hand-author WordPress content.

- [ ] **Step 2: Implement the `Target` interface**

The Plone target defines what is needed — `start/stop/seed`, `types`,
`vocabularies`, `capabilities`, `expireSession`, `fetchAsSession`, plus the port
preflight that refuses to reuse a server it did not start.

| Member | WordPress |
| --- | --- |
| `types` | `page → page`, `folder → page`, `image → attachment` |
| `vocabularies` | `categories → categories` |
| `capabilities` | content, search-fulltext, vocabulary, schema, asset, **state** |
| `expireSession` | invalidate the nonce |
| `fetchAsSession` | cookie + `X-WP-Nonce` |

Note `per-content-permissions` is absent: vanilla WP has no per-post grants, so
the sharing half of the panel must hide. `capabilities.spec.ts` enforces this.

- [ ] **Step 3: Run the existing contract suite against it**

Run: `TARGET=wordpress pnpm test:contract 2>&1 | tee /tmp/wp-contract.log`
Expected: red, one intent at a time. Work through them; do NOT weaken an
assertion to get green without first checking the assertion is genuinely
CMS-specific — that judgement is what produced the slug and breadcrumb
corrections in M2.

## Task 3: Permissions & State — intents and the combined panel

**Files:**
- Create: `tests-adapters/contract/state.spec.ts`
- Modify: `packages/hydra-adapters-plone/index.js`, `packages/hydra-adapters-wordpress/index.js`
- Create: `packages/volto-hydra/src/components/PermissionsPanel/`

- [ ] **Step 1: Contract spec for `state.get` / `state.transition`**

Assert the canonical `PermissionsAndState` shape; that a draft seed document
reports a draft state and offers a transition to published; that performing it
changes `state.name`; and that `shareEntries` is null when
`per-content-permissions` is not advertised.

- [ ] **Step 2: Implement for Plone and WordPress**

```js
// WordPress — the whole of publish
case 'state.transition':
  return this.fetchJson(`/wp/v2/${type}/${id}`, {
    method: 'POST', body: { status: args.id },
  });
```
```js
// Plone
case 'state.transition':
  return this.fetchJson(`${args.path}/@workflow/${args.id}`, { method: 'POST' });
```

The mock Plone API has `@workflow` for reads but no transition endpoint — add
one, the same way M2 added DELETE, `@types` 404s and session blobs. Each of
those was a place the mock had drifted from real Plone and made an intent
untestable.

- [ ] **Step 3: The combined panel**

One panel, two halves, per spec §8a: lifecycle ("what state am I in, where can
I go") above access ("who can see and edit this"). Each half renders only if its
capability is advertised — so on WordPress the panel shows a status control and
no sharing, with no WP-specific code in the admin.

Transitions render from `transitions[]`. Do not hardcode a Publish button:
the point of the model is that the adapter says what is possible.

- [ ] **Step 4: Run the journey again**

Expected: reaches step 5 and publishes.

## Task 4: Slices, and the probe

- [ ] **Step 1: The six focused specs**

connect · round-trip · Gutenberg coexistence · session expiry · capability
gating · asset upload. Coexistence is the one only real WordPress can answer:
open the post in Gutenberg, save there, assert the `hydra-blocks` comment
survived.

- [ ] **Step 2: Falsification probe — NOT optional**

Remove the adapter registration from the test frontend and re-run the journey.
It MUST fail. M2's first bridge run passed 20/20 while the bridge carried no
traffic at all; a green run is not evidence the bridge did anything. Restore
afterwards.

- [ ] **Step 3: `attach` over the bridge**

`BridgeApi` forwards superagent's `attach` but nothing consumes it, so multipart
uploads do not cross the bridge. The contract suite missed this because
`asset.upload` sends base64 JSON. Either implement multipart transfer over the
bridge or make it fail loudly — silently dropping an upload is the worst option.

## Known scope

- Vanilla WordPress, no plugin. Blocks live in `post_content` as
  `<!-- wp:hydra-blocks/document {…} /-->`.
- Same-origin cookie + nonce is the happy path. Flow B (app password via the
  schema-driven `<AuthChallenge>`) gets its own spec; blueprints can seed a
  logged-out state to reach it.
- `per-content-permissions` stays unadvertised for WordPress.

---

# Status at 2026-08-27

## Works

- Contract suite **47/47 against Plone**, including `reference.spec.ts` (a link
  survives its target being renamed).
- **WordPress adapter reaches 24 passed / 2 failed** on the same unchanged
  assertions. The 21 "skipped" are `beforeAll` hook timeouts, not assertion
  failures — see harness limits below.
- Bootstrap deadlock root-caused and fixed: `Form` renders `<Iframe>` only in
  its `visual` branch and `Add` forced `visual = false`, so that route hosted no
  adapter at all. The guard was stale — Hydra's fork already replaced
  `BlocksForm` in that branch with its own `<Iframe>`.

## Does NOT work: links over the bridge

Baselined cleanly, serially, one suite at a time:

| suite | direct fetch | over the bridge |
| --- | --- | --- |
| `inline-editing-links.spec.ts` | 10/10 | 7/10 |

Broken by the inversion: *can create a link*, *can edit link URL*, *can use
browse button in link editor*. The browse button times out inside
`AdminUIHelper.ts:5357`. No adapter-registration errors in that run, so the
adapter is up — this is the object browser's own traffic (`@search`,
`@querystring-search`) behaving differently over the bridge.

Investigate with instrumentation at the RPC boundary, NOT by guessing: three
successive fixes aimed at the wrong model already cost a day here.

## Harness limits found

- **WordPress per-file reset is too expensive.** `seed()` deletes every page and
  recreates the tree; under WASM PHP each REST call costs seconds and the
  60s `beforeAll` budget is exhausted. Needs snapshot/restore, or a reset that
  touches only what a file changed.
- **The WordPress adapter has an N+1.** `ancestryOf()` walks parents one fetch
  at a time and `search` calls it per result, so a 25-result search issues
  dozens of round trips. Correct, but it is why single assertions take 30-55s.
- **Never run two Playwright projects, or Playwright and the WordPress
  contract suite, concurrently.** They contend for CPU and collide on ports
  (`EADDRINUSE :3002`), and the resulting numbers are noise. A "7 failed vs 4"
  regression reported during this session was an artifact of exactly that.
