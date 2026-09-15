# Universal CMS adapters: WordPress + Drupal

Design spec. Supersedes the WordPress-only sections of `hydra-plan.md` where they
conflict; `hydra-plan.md` remains the reference for the auth flows (A–D), the
adapter-declared UI extension contract, and the permissions/state model, none of
which this spec changes.

**Status:** approved design, not yet implemented.
**Branch:** `cms-adapters` (worktree). **Not to be pushed** until the repo move.

## 1. Goal

Turn Hydra from a Plone-bound visual editor into a CMS-agnostic one, with three
peer adapters — Plone, WordPress, Drupal — verified by a single conformance
suite that all three must pass.

The deliverable is not "a WordPress adapter". It is **an executable definition of
what an adapter is**, plus three implementations of it. If the definition is
right, a fourth CMS is a week of work by someone who has never read this repo.

## 2. Decisions

Five decisions were taken during design. Each is recorded with the reasoning,
because each has a plausible alternative that was rejected for a specific reason.

### 2.1 The harness runs real WordPress and a captured-fixture Drupal mock

WordPress runs for real, via `@wp-playground/cli` (v3.1.51) — actual WordPress
PHP compiled to WASM, running under Node with SQLite. It boots in seconds, needs
no Docker, and is seeded declaratively by a blueprint. Because it executes real
WordPress code, it can answer the question a mock never can: *does a vanilla WP
install preserve our block comment when the post is saved through Gutenberg?*
That is the riskiest claim in the whole design.

Drupal has no equivalent — there is no maintained PHP-WASM Drupal — so it gets a
mock: `mock-drupal-api.cjs`, in the same style as the existing
`mock-plone-api.cjs`.

**The mock's fixtures are captured, never hand-written.** `capture/capture-drupal.sh`
stands up a throwaway `drupal:11` container, applies the site config, seeds the
canonical content set, and records the real JSON:API responses. The mock replays
those. The script stays in-repo and is re-runnable, so the mock is *derived from
reality* on day one and can be re-derived when Drupal changes. Hand-writing the
mock would encode our beliefs about JSON:API rather than JSON:API's behaviour —
and JSON:API normalization is precisely where this adapter is most likely to be
wrong.

*Accepted cost:* nothing ever proves the Drupal adapter works against a live
Drupal. Mitigated but not eliminated by the capture script. A CI job that
re-captures and fails on diff is a cheap later addition, and is the right fix if
drift ever bites.

### 2.2 Assertions are layered: contract suite + thin E2E

The bulk of the assertions live in a headless Node contract suite that drives
adapters **directly** — no browser, no bridge, no Volto. A failure names the
intent that broke. On top of that sit roughly six Playwright specs per CMS that
prove the whole chain end to end.

The alternative — everything through Playwright, matching the existing
`tests-playwright/bridge` pattern — was rejected because a failing assertion
there could be the admin, the bridge, the adapter or the CMS, and every intent
costs a page load. The alternative in the other direction — contract suite only —
was rejected because it would never exercise the Gutenberg coexistence risk.

### 2.3 Adapters emit canonical shapes; one shared `plonify()` adapts to Volto

`hydra-plan.md` proposed that adapters synthesize Plone-shaped JSON (`@id`, `UID`,
`review_state`, `@components.*`) so Volto's reducers need no change. That is
correct arithmetic for one non-Plone adapter and wrong arithmetic for two: the
same Plone-isms get re-implemented per adapter, the conformance suite ends up
asserting Plone trivia rather than editor semantics, and every new field a Volto
reducer reads breaks every adapter silently.

Instead: adapters emit clean canonical shapes, and a single `plonify()` module
converts canonical → Plone-shaped on the way into the reducers.

**`plonify()` is admin-side** (`packages/volto-hydra/src/bridge/plonify.ts`), not
in `hydra-adapters-core`. Three consequences, all wanted:

- The wire carries canonical shapes only.
- Frontends never bundle Plone-isms — a WordPress site's JS has no idea Plone exists.
- When the reducers are eventually fixed to consume canonical shapes directly,
  one file is deleted and nothing else changes.

The Plone adapter's `http` passthrough returns raw Plone JSON. Its response
envelope carries `raw: true`, and `plonify()` is skipped for those. This is what
makes the transparency proof (§9, M2) meaningful: with the flag on, reducers see
byte-identical bytes to today.

### 2.4 Drupal stores blocks in a dedicated `string_long` field

`hydra-plan.md` claims Drupal can store blocks in "a JSON field via core
`json_native` or contrib" and that Drupal needs no module for content. **The core
half of that is false.** Drupal 11 core ships no JSON field type — its field
plugins are Boolean, Changed, Created, Decimal, Email, EntityReference, Float,
Integer, Language, Map, Password, String, StringLong, Timestamp, Uri, Uuid (plus
the text types in the `text` core module). `json_field` / `json_native` is
[contrib](https://www.drupal.org/project/json_field).

Blocks therefore live in `field_hydra_blocks`, a core `string_long` field added
to the node bundle by configuration:

```bash
# Positional entityType and bundle — there is no --bundle option.
drush field:create node page \
  --field-name=field_hydra_blocks --field-type=string_long \
  --field-widget=string_textarea --is-required=0 --cardinality=1
```

**Verified against real Drupal 11 on 2026-08-27.** Writes return 201 and the
blocks JSON round-trips byte-for-byte — a core `string_long` is opaque text to
Drupal, so there is none of the empty-map-versus-empty-list ambiguity PHP
inflicts on WordPress. Standing up that site took seven steps the line above
hides, each now encoded in `tests-adapters/capture/capture-drupal.sh`:

| Assumption | Reality |
| --- | --- |
| the image has drush | it does not — `composer require drush/drush` |
| the image has a database | it does not — SQLite, and the URL needs a host segment (`sqlite://localhost/…`) |
| `php vendor/bin/drush` | it is a SHELL wrapper; through `php` it just echoes itself |
| drush finds the site | only with `--root=/opt/drupal/web` |
| `standard` ships page/article | **Drupal 11 ships no content types at all** — they are core recipes |
| JSON:API accepts writes | read-only by default; every write 405s until `jsonapi.settings read_only 0` |
| `field:create --bundle=page` | positional `node page`, and `--field-widget` is required |

JSON:API then exposes it at `data.attributes.field_hydra_blocks` as a raw JSON
string, with no normalization surprises.

This is site-building, not a module install, so the "no contrib required" claim
survives honestly. Rejected alternatives: the `body` field with an HTML-comment
wrapper (mirrors WordPress and needs zero setup, but shares a field with real
content where text filters can reach it); `json_field` contrib (proper typed
storage, but drops the no-module claim and adds a composer dependency).

### 2.5 The contract suite is written first, against Plone

Sequence: contract suite → Plone green → WordPress green → Drupal green.

The suite must go green against **today's Plone behaviour** before any new
adapter exists. That is the whole point: it proves the suite describes the editor
we actually have rather than an editor we imagined. If it can't go green on
Plone, the suite is wrong and the suite gets fixed — not the CMS.

After that, each adapter is a pure red→green exercise against an already-trusted
target.

## 3. Architecture

```
Volto admin  (reducers, widgets, action creators)
     |  action.request { op, path, data, headers }        <- unchanged
     v
api.js middleware  ---- config.settings.useBridgeBackend
     |
     v
BridgeRPC.client   <--- plonify(canonical)  ------+       <- ONE module, admin-side
     |                                            |
     |  postMessage                               |
     v                                            |
hydra-js BridgeRPC (iframe)  ---------------------+
     |
     v   HydraAdapter.dispatch(intent, args)
  +--+--------+----------+
plone         wp       drupal
  |            |          |
  v            v          v
 CMS          CMS        CMS
```

The frontend owns the adapter and registers it at init:

```js
import { initBridge } from 'hydra-js'
import drupalAdapter from '@hydra-adapters/drupal'

initBridge({ adapter: drupalAdapter, cmsBaseUrl: location.origin })
```

The adapter therefore executes on the frontend's origin with the frontend's
cookies. The admin makes zero CMS requests and holds zero credentials.

**Version skew is real and expected.** The adapter ships with the frontend's
deployment, not with Hydra, so a site can run a six-month-old adapter against a
current Hydra. That is what the `protocolVersion` + `capabilities` handshake is
for: Hydra degrades affordances rather than breaking. The contract suite pins and
tests a specific protocol version, not "whatever is current".

### 3.1 Packages

| Package | Purpose | Depends on |
| --- | --- | --- |
| `hydra-types` | canonical TS types, zero runtime | — |
| `hydra-adapters-core` | `BaseAdapter`, error codes, retry-on-401, URL utils, block-envelope codec | types |
| `hydra-adapters-plone` | Plone adapter (`http` passthrough + semantic intents) | core |
| `hydra-adapters-wordpress` | WordPress adapter | core |
| `hydra-adapters-drupal` | Drupal adapter | core |
| `hydra-js/src/bridgeRpc.js` | envelope + iframe-side dispatch | types |
| `volto-hydra/src/bridge/` | admin RPC client **+ `plonify()`** | types |

Each unit is independently testable: `hydra-types` has no behaviour,
`adapters-core` is unit-testable without a CMS, each adapter is exercised by the
contract suite without a browser, `bridgeRpc` is exercised by Tier-0 without a
CMS, and `plonify()` is unit-tested per reducer-consumed field.

### 3.2 Message envelope

Unchanged from `hydra-plan.md` Phase 0, with one addition:

- `BACKEND_REQUEST { requestId, intent, args, meta: { timeoutMs } }`
- `BACKEND_RESPONSE { requestId, ok, raw?, result | error: { code, status, message, data } }`

`raw: true` marks a response that must bypass `plonify()` — set by the Plone
adapter's `http` passthrough.

Unsolicited iframe→admin: `ADAPTER_READY`, `AUTH_STATE`, `AUTH_REQUIRED`, as in
`hydra-plan.md`.

## 4. Test harness

### Tier 0 — protocol unit (vitest, no CMS, no browser)

`BridgeRPC` envelope behaviour only: requestId correlation, default 30s timeout,
per-intent timeout override, error coding, version-mismatch fallback,
`raw` passthrough marking.

### Tier 1 — the contract suite (vitest, headless Node)

This is the spec in executable form.

```
tests-adapters/
  contract/
    content-crud.spec.ts       get / create / update / delete / order / move
    search.spec.ts             search, navigation, breadcrumbs, tree.list
    schema.spec.ts             types.list, types.getSchema
    vocabulary.spec.ts         vocabulary.get, incl. 10k-term autocomplete
    asset.spec.ts              asset.upload, asset.imageUrl variants
    auth.spec.ts               whoami, 401 -> AUTH_REQUIRED, retry-on-401
    blocks-roundtrip.spec.ts   blocks survive write -> read -> write
    capabilities.spec.ts       advertised capabilities match actual behaviour
  targets/
    plone.ts       -> existing mock-plone-api.cjs        :8888
    wordpress.ts   -> @wp-playground/cli server          :8890   (real WP)
    drupal.ts      -> mock-drupal-api.cjs                :8891   (captured)
  fixtures/
    seed.json            <- ONE canonical content set, source of truth
    wp-blueprint.json    <- generated from seed.json
    drupal-seed/         <- generated from seed.json
  capture/
    capture-drupal.sh    <- one-off vs docker drupal:11; regenerates the mock
```

Each target module exports `{ start(), stop(), seed(), adapter }`. Run as
`TARGET=wordpress pnpm test:contract`, or across all three.

**The rule that makes one suite serve three CMSes: one seed set, three
projections.** `fixtures/seed.json` is the source of truth — a nested folder, a
draft and a published document, an image, and a 10 000-term taxonomy for the
autocomplete assertion. Each target's seeder projects it into its CMS. Every
assertion is written against the seed, never against per-CMS literals. If an
assertion needs a `wp-` prefix to pass, the abstraction has leaked and the suite
says so immediately.

`capabilities.spec.ts` deserves its own note: for every capability an adapter
advertises, the suite exercises the corresponding intent and asserts it works;
for every capability it does *not* advertise, the suite asserts the intent fails
cleanly. This makes false advertising a test failure rather than a UI bug.

### Tier 2 — E2E round-trip (Playwright)

Six specs, run per CMS, reusing the existing `tests-playwright` infrastructure
and helpers (`AdminUIHelper`, `BlockVerificationHelper`, `fixtures.ts`):

1. **connect** — frontend URL → iframe → `ADAPTER_READY` → editor chrome renders
2. **round-trip** — edit, save, reload; block content survives in the real store
3. **native-editor coexistence** — open the same post in Gutenberg, save there,
   assert the `hydra-blocks` comment survived. Only real WordPress can answer
   this, and it is the riskiest claim in the design.
4. **session expiry** — kill the session mid-edit; `AUTH_REQUIRED` toast appears,
   pending edits are preserved
5. **capability gating** — adapter without `workflow` → no Workflow button
6. **asset upload** — upload an image, assert the variant URL resolves

Test frontend: reuse `tests-playwright/fixtures/test-frontend`, parameterized
`?adapter=wp|drupal|plone`. One frontend, three adapter bundles. No new demo
applications.

## 5. WordPress adapter

| Concern | Approach |
| --- | --- |
| Test backing | `@wp-playground/cli server` — real WP on PHP-WASM, SQLite, blueprint-seeded from `seed.json` |
| E2E fixtures | `@wordpress/e2e-test-utils-playwright` `RequestUtils` for REST-based create/cleanup |
| Block storage | `<!-- wp:hydra-blocks/document {…} /-->` in `post_content`; codec shared from `adapters-core` |
| Auth | cookie + `X-WP-Nonce` same-origin; application password via the `form` method as fallback |
| Schema | synthesized from `/wp/v2/types/{type}` |
| Capabilities | `search-fulltext`, no `workflow` in MVP |
| Escape hatch | if WASM PHP proves unfaithful, swap `targets/wordpress.ts` to `@wordpress/env` (Docker) — same blueprint, no test changes |

## 6. Drupal adapter

| Concern | Approach |
| --- | --- |
| Test backing | `mock-drupal-api.cjs` serving `/jsonapi/*`, fixtures captured by `capture/capture-drupal.sh` from `drupal:11` |
| Block storage | `field_hydra_blocks` (core `string_long`), created by config in the seed script |
| Schema | static-schema fallback: `types.getSchema()` reads a bundled `schema.json`, **generated by the capture script** from live field config — derived, not invented |
| Normalization | JSON:API `data`/`included` flattening isolated in one `normalize.ts`; the heaviest adapter code in the project |
| Auth | cookie + `/session/token` CSRF; `basic_auth` (core module) for the contract suite |
| Capabilities | `search-filter`, **not** `search-fulltext` — no `search_api` contrib |

## 7. Milestones

| | Deliverable | Done when |
| --- | --- | --- |
| **M1** | `hydra-types`, `hydra-adapters-core`, `bridgeRpc`, admin `BridgeRPC.client`, `plonify()`, `ADAPTER_READY` / `AUTH_REQUIRED`, Tier-0 tests | lands dark behind `useBridgeBackend`, no callers |
| **M2** | Contract suite written, `targets/plone.ts`, Plone adapter | suite green on Plone **and** the existing Playwright suite green with `useBridgeBackend=true` |
| **M3** | wp-playground target, blueprint generator, WordPress adapter | same suite green on WordPress |
| **M4** | capture script, Drupal mock, Drupal adapter | same suite green on Drupal |
| **M5** | six E2E specs × three targets, test-frontend parameterization | Gutenberg coexistence proven against real WordPress |

M2 is load-bearing. Everything downstream assumes the suite is trustworthy, and
the only evidence for that is it passing unchanged against the CMS we already
know works.

## 8. Risks

1. **PHP-WASM fidelity.** WP Playground's PHP differs subtly from a LAMP stack.
   *Mitigation:* `@wordpress/env` swap behind the same target interface — a
   one-file change.
2. **Drupal mock drift.** The accepted cost of §2.1. *Mitigation:* the capture
   script stays in-repo and re-runnable; an opt-in CI job that re-captures and
   fails on diff is the fix if drift bites.
3. **`plonify()` completeness.** The `CANONICAL_FIELDS.md` audit is still
   required — grep every field read on `action.result` / `state.data` across
   `core/packages/volto/src/reducers/**` — but it is now one module's problem
   rather than three adapters'. *Mitigation:* a `plonify` unit test per
   reducer-consumed field, derived from that grep.
4. **Bridge contention.** `FORM_DATA` runs hot during typing and backend RPC
   shares the channel. *Mitigation:* move RPC to its own `MessageChannel` if
   traces show it.
5. **Drupal has no full-text search.** The UI must honour `search-filter` vs
   `search-fulltext` or the search box lies to the user. Covered by
   `capabilities.spec.ts`.
6. **Adapter / Hydra version skew.** Handled by the handshake, but the contract
   suite must pin a protocol version rather than tracking `main`.

## 8a. Permissions and state are one model, and they are in scope

**Amended 2026-08-26.** This spec originally deferred workflow and sharing.
That was wrong, for a reason that only became obvious when the end-to-end
journey was written down: *log in, create a page, edit it, publish it*. A
deliverable that cannot publish is not the product, and a headline test that
stops at "saved as draft" never proves content reaches a reader.

`hydra-plan.md` already models this correctly and this spec simply adopts it.
Plone presents workflow (a state machine) and sharing (per-content roles) as two
UIs, but they answer one question — who can do what, when. Modelling them
separately forces every adapter to invent the mapping twice, and most CMSes do
not have two concepts to map:

| CMS | `state` | `transitions` | `shareEntries` |
| --- | --- | --- | --- |
| Plone | `@workflow.state` | `@workflow.transitions` | from `@sharing` |
| WordPress | `post.status` | draft ↔ publish ↔ private ↔ future | usually null |
| Drupal | `moderation_state` | from configured workflow | null in core |

So WordPress's entire publish story is one field, `status` — the expense was
never WordPress, it was Plone's transition machinery and the generic UI.

Canonical shape: `PermissionsAndState` in `packages/hydra-types`. Intents:
`state.get`, `state.transition`, `permissions.update`. Capabilities: `state`,
`per-content-permissions`, `hierarchical-permissions`.

**One combined panel**, not two. The unification is in the data and the
capability story; the panel may still visually separate "what state am I in and
where can I go" from "who has access", so it stays familiar to Plone users. Each
half hides when its capability is absent — and `capabilities.spec.ts` already
makes a false claim a test failure rather than a UI that lies.

## 8b. Drupal hierarchy comes from menus, plus a virtual folder

**Decided 2026-08-27.** Drupal has no content hierarchy in core. Nodes are
flat and URLs come from path aliases, which carry no structural meaning. That
collides with three things the contract asserts — `tree.list`, `breadcrumbs`
and `content.move`.

**Menu links are the hierarchy.** `tree.list` walks menu children,
`breadcrumbs` follows the menu trail, and `content.move` re-parents the menu
link. This is how Drupal sites actually express structure, and site builders
already maintain it.

**A virtual folder covers what menus miss.** The obvious hole in a menu-based
hierarchy is content with no menu link: it would have no location and be
invisible in the contents view. So the contents view exposes a virtual folder
listing menu-less content, and giving such a document a home is the same
operation as any other move — it creates the menu link.

Two consequences recorded so they are not rediscovered:

- **A node may appear in several menus, or none.** The adapter designates one
  menu as the structural one; the rest are navigation only.
- **Moving does NOT change a Drupal URL.** Menus carry structure, aliases
  carry URLs, and re-parenting must not rewrite a published address. The move
  contract was corrected for this: it now asserts the document ends up under
  the new parent and is addressable there, NOT that its path changed. Plone
  (path is tree position) and WordPress (path derives from the parent chain)
  both still change it; requiring that would have forced a Drupal adapter to
  fake a path, which is how a contract quietly becomes a description of one
  CMS.

## 8c. Context expansion is part of the contract

Rendering one route makes the admin ask for the document and then, from
separate components, its breadcrumbs, navigation, available types and query
indexes. Instrumenting the Drupal journey put the cost in plain numbers: 149
CMS requests for five steps, most of it this per-route fan-out.

The admin cannot fix this. Those calls originate in different components at
different times, so nothing up there knows they belong to one route. The
adapter, handed the list, does know.

So `content.get` takes an `expand` argument:

```js
content.get(path, { expand: ['breadcrumbs', 'navigation', 'types', 'querystring'] })
  → Document & { context: { breadcrumbs, navigation, types, querystring } }
```

**Expansion is a bundling optimisation, never a new capability.** Every
expansion name stands in for an intent the admin could have called on its own,
and `EXPANSIONS` in `baseAdapter.js` is exactly that mapping. This is what
makes emulation legitimate, and the contract suite pins it down: each expanded
value must `toEqual` what the standalone intent returns. If expansion ever
became a second source of truth, callers would have to know which one they got.

`actions` maps onto `state.get`, so it is gated on the `state` capability —
Plone's adapter does not advertise it. The other four are universal.

### Why each adapter emulates rather than expands natively

Only Plone can expand natively, over its own `@components` set. The other two
were measured, not assumed:

- **WordPress `_embed`** follows resources declared in an object's `_links` —
  author, featured media, terms. Breadcrumbs, navigation, types and query
  indexes are not links on a page, and `_links.up` embeds only one level, so
  it cannot produce a breadcrumb chain.
- **WordPress `/batch/v1`** rejects reads outright. Asking it for a GET returns
  `requests[0][method] is not one of POST, PUT, PATCH, and DELETE`. It helps
  `content.order`, which is PATCHes, and nothing on this path.
- **Drupal JSON:API `include`** covers entity relationships, not site context.

So `BaseAdapter.expandContext` issues the calls itself, **concurrently**. That
concurrency is the entire win, and it is only available below the contract.
The contract suite asserts it by counting in-flight dispatches rather than by
timing, so a sequential implementation fails the test instead of merely being
slow.

Measured against WordPress on PHP-WASM, six independent reads:

| | wall clock |
|---|---|
| sequential | 7931ms |
| concurrent | 4038ms |

### GraphQL was measured and not adopted

WPGraphQL can express the whole bundle in one query — page, `ancestors`,
`menus`, `contentTypes`, `taxonomies` — so it was installed under Playground
and benchmarked against the same instance:

| | median |
|---|---|
| GraphQL, 1 request | 3495ms |
| REST, 4 concurrent | 4613ms |
| REST, 4 sequential | 9133ms |

GraphQL beats the concurrent emulation by ~1.3x, not the ~6x a naive
request-count argument predicts: WPGraphQL's own schema build makes one
GraphQL request far more expensive than one REST request, and concurrency has
already taken most of the win. Against that, it costs a plugin dependency, a
second code path, and — because `Document.fields` carries the raw REST post —
an expansion result that cannot be made byte-identical to the standalone
intent without rewriting those intents too.

It is therefore **available but not wired in**. The dependency-free change
below took the same win.

### Expansion is gated on native support, because emulation costs more

Turning the admin's expanders back on for an EMULATING adapter made things
worse, not better: the Drupal journey went from 190 CMS requests to 217. The
reason is that expansion cannot reduce request count when the adapter answers
it by issuing the same intents — and Volto's reducers already cache navigation,
types and actions in the store and skip re-fetching them, while expansion
re-requests the whole bundle on every content GET.

So the admin asks for expansion only when the adapter advertises
`expand-native` (today: Plone, via passthrough), where the bundle rides along
in a request being made anyway and five route requests collapse into one. That
decision is made when the adapter announces itself, not at config time — at
config time no adapter has spoken yet.

## 8d. Duplicate reads, and the cache that could not be written

Instrumenting the journey found the real cost, and it was not expansion:

```
150 GETs, 94 were a repeat of an identical earlier GET with no write between
  28  /jsonapi/menu_link_content   22  resolvePath('/news')   10  node_type
```

63% of reads were redundant. The admin cannot dedupe them: they come from
different components, and several are issued INSIDE one intent, below anything
it can see.

**What shipped.** Coalescing reads that are in flight at the same moment. Two
callers asking for the same URL simultaneously get one request — exactly what
they would have got had one asked a millisecond earlier. Journey: 190 requests
to 109.

**What is written but parked.** Retaining completed reads, keyed by URL and
invalidated whenever this admin writes, takes it further: 190 to 83. It needs
no scope and no attribution — an earlier per-route version foundered on that,
because dispatches interleave and the browser has no async-local storage to
tell them apart, whereas "until we write" is a lifetime that needs neither. Its
staleness assumption is the one Volto's own store already makes by holding
navigation and types for the session.

It is off, and NOT because it is broken. Instrumented, the adapter is right
every time:

```
[TREE] /news -> /news/first-post,/news/draft-post,/news/journey-1787984899268
```

The newly created page IS in the listing the adapter returns, and the contract
suite covers the semantics including a read overtaken by a write. What fails,
about two runs in five, is the admin: the Contents view does not render the row
it was handed within 20 seconds. Retention exposes that by answering fast
enough to change the ordering. Turning it on before the admin-side race is
understood buys 26 requests and an unstable editor, so the next piece of work
is in Volto, not in the adapters.

Invalidation lives on the WRITE INTENTS rather than in fetchJson, because
uploads are built by hand with FormData and a raw fetch (WordPress
/wp/v2/media, Drupal's two-step file + media create) and never pass through it.

**Expansion was retested here.** The theory was that expansion only looked
expensive because reads were not cached, and that a real cache would make the
extra breadcrumbs/navigation/types free. It does not: ungated, the Drupal
journey went from 1.5 minutes to 6.9 and failed. Caching removes duplicate
READS, but expansion still fans every content GET into four more intents, which
on an emulating adapter is four more things to go wrong per route. The
capability gate stays.

### The iframe aborts its own reads

Chasing the above surfaced a bug that predated all of it, and explains why the
journey's back-to-the-listing step had always been flaky: **the adapter runs
inside the iframe**, so anything that navigates that window — a back
navigation, a reload, following a link — aborts its in-flight fetches. The
listing's own data arrived correctly; a sibling read died with the navigation
and the view rendered empty.

`fetch()` reports that as a TypeError with no status, which is not the CMS
refusing: it is nobody having answered. Reads are retried once on it. Only
reads — a write aborted mid-flight may already have been applied, and
re-sending it would be the adapter deciding on its own to do it twice.

The journey no longer walks browser history to get back to the listing; it
navigates client-side, and history restore is asked directly in
`back-navigation.spec.ts` where it is the assertion rather than the noise.

Net effect on the Drupal journey: **190 CMS requests to 110**, and the
back-to-the-listing step from 80 requests to 19.

### The sequential walk was the real cost

`breadcrumbs.get` on WordPress used to re-resolve and re-fetch every ancestor
that the parent walk had *just* fetched — two extra round trips per level, at
~1.1s each, for posts already in hand. `ancestorChain()` now keeps them.

Discovering the chain stays sequential, because a post names only its
immediate parent; that part is irreducible. Everything after it is free.

## 8e. The proxy frame, and how credentials reach it

### The adapter is in the wrong window

The adapter has been hosted in the PREVIEW iframe — the one showing the page
being edited. That couples the CMS connection to what the editor happens to be
looking at, and it does not survive contact with the admin's own routing.

Traced in a WordPress run, with the admin sitting still on `.../edit`:

```
[ADMIN NAV]  /news/upload-probe-…/edit
[IFRAME NAV] /news/upload-probe-…?_edit=true     <- correct
[IFRAME NAV] http://localhost:8889/?_edit=false  <- reverted to VIEW, at the site root
[IFRAME_SRC] Skipping - state matches and iframeSrc already set
```

The admin never asked for that navigation — its own src logic logged a skip —
but from that moment the window answering the bridge was a different one. Every
request already sent was owed a reply by a window that no longer existed, so
`asset.upload`, `types.list`, `types.getSchema`, `state.get` and
`querystring.getIndexes` all expired at their 30s timeout. No `/wp/v2/media`
request was ever made. The symptom looked like a slow or broken upload; the
cause was the host window being replaced.

Three further consequences of the same coupling:

- **Routes without a preview have no proxy at all.** The iframe is mounted by
  the view and edit forms. The contents listing and the control panels are not
  those routes.
- **Every navigation discards the adapter's caches** — `resolvePath`,
  `restBases`, the read cache — which is most of what makes an editing session
  affordable against a CMS charging ~1.1s per request.
- **In-flight requests are silently orphaned.** Volto awaits a reply, so the
  bridge must always produce one; going quiet for 30s is the one thing it must
  not do.

### A dedicated proxy frame

A hidden iframe, created ONCE at admin boot, outside the router:

```
window.name = "hydra-proxy:<adminOrigin>"
```

It never routes and never renders. It loads a minimal document whose only job
is to host the adapter — no app bootstrap, no router, no DOM, no editing
chrome, nothing that can navigate it:

```html
<!doctype html>
<script type="module">
  import { connectProxy } from '/hydra.js';
  import adapter from './my-cms-adapter.js';
  connectProxy(adapter);
</script>
```

`window.name` is already how a frontend learns it is inside Hydra and which
origin the admin is (`hydra-edit:` / `hydra-view:`), so the third role costs no
new integration surface — and unlike a query parameter it survives navigation.
It takes NO `_edit`-style query fallback: a normal page must never be able to
promote itself to the proxy.

The preview iframe keeps its own channel for selection and block chrome, and
may navigate as freely as it likes. It no longer serves CMS calls, so only one
adapter instance exists and there is no question about which owns the caches.

If the proxy frame never announces, the admin says so plainly — the frontend
does not serve a Hydra proxy page — rather than falling back to the preview and
quietly reproducing the coupling.

### Authentication is a capability, not a mechanism

The credential must never originate in the admin. It is issued by the CMS to a
client acting on behalf of a user, which is what these APIs are built for — but
what they offer differs, so it is modelled the way every other difference in
this contract is:

- `auth.begin()` — a URL to send the user to, top-level, or `null` when the
  adapter is already authenticated by ambient means.
- `auth.complete(params)` — exchange whatever came back into a stored,
  origin-scoped credential.
- `auth.whoami()` — who we are now. Already in the contract.

| CMS | Delegated flow | Requirement |
|---|---|---|
| Plone | `@login` returns a JWT | `plone.restapi` |
| WordPress | `wp-admin/authorize-application.php?app_name=…&success_url=…` returns an application password | core 5.6+, **HTTPS** |
| Drupal | OAuth2 authorize endpoint | **`simple_oauth` is required** |

Drupal core's JSON:API has no token flow at all, and its session + CSRF pair is
cookie-based and therefore dead cross-site. Requiring `simple_oauth` is the
only honest option, and sits alongside the Media entity requirement already in
§8b.

The user always logs in at the CMS's own login page. The admin never sees a
password, and never handles one.

### How the user logs in

Login happens BEFORE the editor exists, so there is no unsaved work to protect
and nothing to resume. That makes the sequence simpler than it first appears.

**The CMS login cannot be framed.** Measured against WordPress:

```
/wp-login.php                        x-frame-options: SAMEORIGIN
                                     content-security-policy: frame-ancestors 'self'
/wp-admin/authorize-application.php  x-frame-options: SAMEORIGIN
                                     content-security-policy: frame-ancestors 'self'
```

So showing the CMS's login inside the proxy frame is not a design choice we
get to make; the browser refuses to render it. Authentication must happen in a
top-level context — which is also the only place the user can see an address
bar and know what they are typing a password into.

The sequence:

1. Admin boots and mounts the proxy frame, VISIBLE, filling a login shell.
   Before the editor exists there is nothing to overlay, so the login screen
   simply IS the proxy frame.
2. Proxy announces `ADAPTER_READY { user: null }`.
3. The frame renders its own sign-in button. The user clicks INSIDE the frame,
   which is what gives that frame the user activation it needs — activation is
   per-frame, so a click in the admin would not do.
4. The frame opens `auth.begin()`'s URL in a popup.
5. The user authenticates and consents on the CMS's own pages.
6. The CMS redirects the popup to a callback at the PROXY origin, which
   `postMessage`s the result to `window.opener` — the frame — and closes.
7. The frame runs `auth.complete(params)`, stores the credential, re-runs
   `whoami`, and announces `ADAPTER_READY { user }`.
8. The admin hides the frame and starts the editor.

On later visits the frame finds its stored credential and step 2 already
carries a user, so the login screen never appears.

### Why the admin never touches the credential

The admin COULD relay it. The callback's raw parameters would pass to
`auth.complete(params)` and the adapter would parse them — Plone's JWT string,
WordPress's user_login plus application password, Drupal's access/refresh/
expiry triple are all just `params` to an admin that never inspects them. That
is the same division of knowledge as everywhere else here: the adapter owns
CMS-specific shapes.

Which is precisely the argument against it. The admin would carry a secret it
cannot interpret — all of the risk, none of the benefit — and carry it badly:

- a redirect puts the credential in a URL at the ADMIN's origin, so it lands in
  browser history, and in server logs too when it arrives as a query parameter
  rather than a fragment;
- it sits in admin JS memory, reachable by any addon or third-party script on
  that page.

The popup keeps it in a `postMessage` between two windows of the proxy's own
origin: never in a URL at the admin origin, never in admin memory, and written
directly into the storage the frame will read from next time.

So the admin observes exactly two things — `user: null`, then `user: {…}`.

### The assumption to re-test

The simpler handoff would be for the top-level callback to write the credential
to the proxy origin's storage and let the embedded frame read it back. This
design assumes that does NOT work, because browsers partition storage for
third-party contexts: a frame of origin P embedded in admin origin A gets a
different bucket from a top-level page at origin P.

That assumption is why the credential travels by message rather than through
storage, and why the popup is opened by the frame rather than by the admin. It
is documented browser behaviour but has NOT been exercised here, unlike the
framing headers above, which were measured. If partitioning turned out not to
apply, the shared-storage handoff would become available — but it would still
be the weaker option, since the message path is what keeps the credential out
of the admin entirely.

### Where the proxy may be served, and by whom

Token auth removes the cookie constraint, and with it any need for the proxy to
be same-origin with the CMS or with the frontend. It may be served by the
frontend, by the CMS, or by a self-hosted Hydra.

**But the proxy origin is the trust boundary.** Whoever serves that page
controls the code holding the credential. So it must be an origin the site
owner trusts with CMS access. A self-hosted Hydra qualifies. A SHARED hosted
Hydra editing many sites does not: putting the proxy there would place every
site's credential in the vendor's origin, which is the thing this inversion
exists to prevent.

Consequences:

- The proxy URL is admin CONFIGURATION, not a convention derived from the
  frontend URL.
- The CMS must allow-list that origin twice: for CORS, and as an OAuth redirect
  URI (`success_url` on WordPress). Ordinary client registration.
- Cross-origin means **CORS preflights**. Every request carrying an
  `Authorization` header is non-simple and earns an `OPTIONS` first. Against
  WordPress at ~1.1s per request that roughly doubles everything unless the CMS
  sends `Access-Control-Max-Age` so the browser caches the preflight. That is a
  requirement, not a nicety: it is the difference between the measured
  83-request journey and one twice as slow.

### Two things this unlocks

**Control panels can delegate to the CMS.** Authorising the application means
the user logs in on the CMS's own pages, which leaves them with an ordinary
first-party session at that origin. A control-panel link can therefore point
straight at `wp-admin`, Drupal's admin, or Plone's control panel and simply
work — no reimplementation of every CMS's settings UI in Volto, and no second
login. `BaseAdapter.getAdminUrl()` is already the seam for this; it returns
null today.

The caveat to remember: the browser SESSION and the stored credential expire
independently. The token may outlive the session, so a control-panel link
followed weeks later can still land on the CMS's login page. That is the right
behaviour — it is the CMS's own login, which is the point of delegating — but
it means "the user will already be logged in" is true right after authorising,
not forever.

**More than one backend.** Eventually a site may route different sections to
different systems — a proprietary store for some sections alongside the main
CMS. Not designed here, but worth recording that this change is what makes it
tractable at all: with the adapter hosted in the preview there was one preview
and therefore one adapter, and no amount of routing would have given a second.
With proxy frames mounted at App level, N backends are N frames.

The seams that would have to become plural, none of which are load-bearing
today:

- `bridgeIframe()` looks up one element by id; it would become a lookup by
  backend id.
- `readyWindow` is a single window; it would become a map.
- `window.name` would carry the backend: `hydra-proxy:<adminOrigin>:<backendId>`.
- Capabilities are answered once per session; they would become per-backend,
  so the admin's UI gating becomes per-route rather than global.
- Each backend authenticates independently, so the login screen would have to
  handle several — including the case where one is authorised and another is
  not.

Deliberately deferred. Recorded so the single-backend assumptions above are
known choices rather than accidents.

### What this retires

- `access_token` passed in the iframe URL, then copied into `sessionStorage`.
  It is Plone-shaped — it assumes the admin's own token is meaningful to the
  CMS, which is true only when they share an auth system. Against WordPress and
  Drupal the value was literally a forged `fake-signature-…`. Credentials move
  to postMessage after the frame announces, and never appear in a URL, where
  they would leak into history, referrers and server logs.
- The `always-admin` test mu-plugin, which exists only because there was no
  real login path. With the authorise-application flow the fixture can hold a
  genuine application password and exercise the real auth path instead of
  bypassing it.
- The cross-site cookie dead end, and the CORS and `SameSite` workarounds that
  came with hosting the adapter on the frontend origin.

`BridgeRPC.peerReplaced()` stays — a frontend can still crash or reload — but
it becomes a genuine edge case rather than something load-bearing on every
navigation.


## 9. Out of scope

Unchanged from `hydra-plan.md`: history diff, comments, relations, content
rules, native Gutenberg block round-tripping, multilingual, cursor search, SSR
for the editor route, autosave. Strapi and Wagtail adapters are deferred — the
contract is designed to admit them, but nothing here builds them.

**No longer out of scope:** workflow and sharing, now unified as
Permissions & State — see §8a.

## 10. Workflow constraints

Built in the `cms-adapters` worktree at
`~/.config/superpowers/worktrees/inka/cms-adapters`. Commits are local only.
**Nothing is pushed** until the repos are moved. This spec lives in the worktree
so it travels with the branch through the move.
