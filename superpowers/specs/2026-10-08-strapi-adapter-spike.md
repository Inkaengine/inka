# Strapi adapter — what a real spike found (2026-10-08)

Spiked against a real Strapi 5 (SQLite, `create-strapi --non-interactive`), not a
mock, specifically because a mock would encode my assumptions — and four of them
turned out to be wrong.

`hydra-plan.md` already analysed Strapi and named the headline problem: "no URL
concept in the data layer at all". That still stands. What follows is what only a
real instance told us.

## Blocks go in a JSON field, NOT a dynamic zone

This is the finding that reverses the obvious design.

A dynamic zone *looks* like the perfect home: an ordered array where each entry
carries its own `__component` type and id, which is structurally `blocks` +
`blocksLayout`. A real response:

```json
"body": [
  { "id": 3, "text": "Hello",            "__component": "blocks.slate" },
  { "id": 2, "url": "…", "alt": "X",     "__component": "blocks.image" },
  { "id": 4, "text": "Second paragraph", "__component": "blocks.slate" }
]
```

Note the ids are 3, 2, 4 — array ORDER is the ordering, which is the right way
round for us.

It still fails, because Hydra's block model is **recursive and open** and a dynamic
zone's component list is **closed and flat**. Writing the contract's own fixture
(`columnsBlock` → `column` → `slate`, each level with its own `blocks_layout`) gets:

```
__component must be one of the following values: blocks.slate, blocks.image
```

and even a declared `columnsBlock` component has nowhere to put
`data.blocks.c1.blocks.t1`. Strapi cannot express recursive components.

So Strapi stores blocks in a single `json` field — exactly what Drupal does in
`field_hydra_blocks` and WordPress in a `data-hydra-blocks` element. Those two are
NOT settling for opaque JSON: it is the only representation that round-trips a
recursive model. Plone is the outlier, because its native storage IS that model.

Verified with `deepStrictEqual` against the contract's fixture, through
create → read → update → read: nesting, admin-minted uids and `"quoted" & <tags>`
all survive.

**Cost:** blocks are then not editable in Strapi's own admin UI, where a dynamic
zone would be. A site wanting both needs a lossy mapping the contract rejects.

## The adapter must not touch block uids

`blocks-roundtrip.spec.ts` is explicit: "Where the blocks physically live is adapter
business… The contract is only that what goes in comes back out." The admin mints
uids; the adapter stores and returns them.

A dynamic zone has nowhere to put a uid the admin chose, which is what tempted me
into adding a `uid` field to every component — a content-model requirement imposed
on every Strapi site, to solve a problem created by choosing the wrong storage. With
a JSON field the uids are dict keys and the question disappears.

(Strapi's own component ids cannot serve: it assigns and reassigns them on write.)

## Hierarchy is a `parent` self-relation

Strapi ships no tree. A `manyToOne` self-relation plus its `oneToMany` inverse gives
one, declared in the content type — the same kind of modelling choice as Drupal
borrowing its tree from menu links.

Paths resolve by walking one query per segment, with `filters[parent][id][$null]` at
the root. Verified parent-scoped with a same-slug decoy: `/dup` → the root document,
`/news/dup` → the child.

One query per segment rather than a deep populate chain, because Strapi's populate
nests explicitly (`populate[parent][populate][parent]…`) — an arbitrary-depth path
cannot be expressed as one populate, and a fixed depth would silently truncate.

## `slug` must be `string`, not `uid`

Strapi's `uid` type is **globally** unique, so `/news/first-post` and
`/about/first-post` cannot coexist — every other CMS here allows them. A path
segment needs SIBLING uniqueness, which Strapi has no field type for.

Consequence: sibling uniqueness is unenforced. Two siblings sharing a slug makes a
path ambiguous and the walk picks one arbitrarily. A real integration needs a
lifecycle hook; the adapter cannot fix it.

## Operational notes

- `create-strapi --non-interactive --dbclient sqlite` writes an EMPTY
  `DATABASE_FILENAME`, and the config does `env('DATABASE_FILENAME', '.tmp/data.db')`
  — which only defaults on *undefined*. The path collapses to the project root and
  SQLite fails with `unable to open database file`, naming nothing. Pass `--dbfile`.
- The admin panel build fails under pnpm (`Could not resolve
  "@codemirror/streamparser"`). Irrelevant: `--no-watch-admin --no-build-admin`
  starts the API alone, in ~10s. For a contract fixture that is a feature — the
  admin bundle is the slowest, most fragile part of a Strapi boot.
- Component and content-type schema changes need a RESTART; the watcher does not
  reload them.
- A plain `POST` sets `publishedAt`, so a create publishes immediately. Drafts need
  `status=draft`. That is the whole of Strapi's workflow: two states.
- Unauthenticated reads are 403 by default, which matters for the public-read tests.

## Where it got to

A blocking CI target. `TARGET=strapi pnpm test:contract` runs the same 152 tests
every other adapter runs: **119 pass, 33 skip, 0 fail**, against a real Strapi 5
booted by the harness, and `strapi` is in the `test-adapter-contract` matrix.

The adapter advertises `content`, `search-filter`, `schema`, `asset`, `reference`
and `vocabulary` — each added only once the suite proved it, because
capabilities.spec checks the converse too: an unadvertised capability must answer
NOT_IMPLEMENTED rather than half work.

Four things Strapi has no answer for, and so the adapter does not either:

- **No path.** Strapi stores no address of any kind, so there is no index to
  delegate a path query to and no result can be addressed without walking
  parents. One `addressingMap()` read computes every path, which is also what
  makes a subtree filter possible at all.
- **No published flag on a draft.** Strapi keeps a draft and a published variant
  of each document, and the draft's own `publishedAt` is ALWAYS null — a
  published document reads as null in the draft it is edited through. So the
  workflow state cannot be read off the document; `withPublishedState()` asks
  whether a published variant exists, once per result set.
- **No schema over the API.** `/api/content-type-builder` needs an admin session,
  which an API token cannot have. The fixture exposes `GET
  /hydra/schema/:collection` — unmapped, deliberately: turning Strapi's field
  types into canonical ones is the adapter's job, and doing it in the CMS would
  put Hydra knowledge where no test of the adapter could see it. Same role as the
  WordPress companion plugin.
- **No identity.** An API token is not a user, and `/api/users/me` belongs to a
  JWT session. `auth.whoami` proves the credential by making a request only a
  credential can make — the companion route, since the fixture grants the public
  role read on the collection. `auth.logout` drops the token here, because that
  is the part of a logout that matters: Strapi revokes tokens in its own admin,
  not over the content API.

## Strapi's menu is the Plone shape, not the WordPress one

First attempt here was `Target.menus: false` — "Strapi has no menu, skip the
view-membership suite". That was wrong, and the question that showed it was
simply: if it has no menu, is it like Plone with one hierarchy?

It is. Plone's menu view IS the content tree — `ordered: 'main'`,
`holdsContent: true`, the same hierarchy as Contents — and its only extra is
`exclude_from_nav`, which is what earns it `remove: 'unlink'`. Strapi is the
same: one hierarchy, and `navigation.get` is built from it, so a visitor already
reads the tree as the menu. What Strapi lacked was not navigation. It was a
place to store MEMBERSHIP.

So the adapter is told about one more field, `excludeFromNav`, and the menu view
is advertised with `ordered: 'main'` and `remove: 'unlink'`, exactly as Plone's
is. All five applicable view-membership tests pass against a real Strapi — a
page taken out of the menu disappears from an anonymous read and stays
readable at its own address — and the two that skip do so on the view's own
declared abilities, the same mechanism Plone skips the relabel test on:

    allowsLabels: false   nowhere to put a per-menu label
    allowsLinks:  false   the collection has no url field, so no Link

Why a convention field is right HERE and was wrong for WordPress: WordPress has
`nav_menu_item`, a real menu system, and inventing post meta went AROUND it —
producing a capability true only on sites running our plugin. Strapi has no
navigation concept to go around, and this adapter is already told about four
fields that are pure convention (`slug`, `parent`, `hydraBlocks`, `sortOrder`)
because Strapi has no content model of its own. A fifth is the same kind of
configuration, and it is how a real Strapi site would have to do it.

One load-bearing detail: the filter is `$or` of `$null` and `$eq false`, not
`$ne true`. A row written before the field existed holds NULL, and SQL's
`NULL != true` is NULL — so `$ne true` would drop every untouched page from the
navigation. Unset means not excluded.

Also fixed while there: `state.spec`'s "refuses a transition the document does
not offer" was missing the `advertises('state')` gate its three siblings have,
so a CMS with no workflow failed for not implementing the one thing it had
already said about itself.

## The CI trap: pnpm installs the WORKSPACE, not the app

The first CI run failed with `Cannot find module
.../strapi-app/app/node_modules/@strapi/strapi/bin/strapi.js` while the suite
was green locally.

The app sits inside this repo's pnpm workspace, and a plain `pnpm install` in a
directory under a workspace root installs the WORKSPACE — "Scope: all 25
workspace projects", the app's own package.json ignored, no node_modules beside
it. `create-strapi --install` does exactly that, so the scaffold reports
success and leaves an app with no Strapi in it.

It passed locally only because `STRAPI_APP` pointed at a scratchpad OUTSIDE the
workspace, so my "validating the CI path" validated the boot and not the
install. The fix is `pnpm install --ignore-workspace`, run by the fixture
script, which then asserts the CLI exists rather than letting the harness
discover it at spawn time.

Behind it was a second layer of the same kind. pnpm 10 refuses a dependency's
install script unless the project NAMES it in `pnpm.onlyBuiltDependencies`, and
reports that as a warning while exiting 0 — so better-sqlite3 installed with no
native binding and Strapi died at boot with "Could not locate the bindings
file", listing eleven paths and no cause. create-strapi writes that field
itself, with `core-js-pure` and `sharp`, and omits the three that matter:
better-sqlite3, @swc/core, esbuild. The script merges them in.

That one bit CI and not this machine because the approval is per project AND per
pnpm version — 10.34 in CI, 10.18 here, which ran the scripts without asking.
Which is the lesson both layers taught: a local run that differs from CI in
where or how it installs proves nothing about CI. The script now asserts the
artifacts (the CLI file, the compiled binding) rather than trusting an exit
code, because an install that exits 0 having skipped the work fails later,
somewhere that cannot explain it.

## Still owed

- The `collection` view shape, which is what Strapi is really the forcing function
  for: a backend with no tree at all is the sharpest test of whether the contract
  degrades gracefully or quietly assumes Plone.
- `search-fulltext`. Strapi has no full-text search without a plugin, so the
  three gated search tests skip; `querystringSearch` covers the listing block.
- Nested-vocabulary and relation fields: `vocabulary.get` reads a flat collection,
  which is what the fixture has.
