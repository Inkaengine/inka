# MCP for Agent Content Authoring — Design Proposal

> **Status: DRAFT. Not implemented, not deployed, not part of the published docs.**
> This captures the design so we can build it later. Nothing here ships yet.

## 1. Problem

We want agents to create and edit CMS pages — Hydra content, i.e. Volto/Plone
block documents. Handing an agent the raw model has two failure modes:

- **Emitting block JSON is error-prone and token-heavy**, slate rich text
  especially: nested `children`, marks-as-boolean-keys, the single-root-element
  rule, no text leaves at the root. (The discovery tooling literally ships a
  `validateSlateNode`/`collectSlateIssues` pass because this is so easy to get
  wrong — and rich text is the *most common* content.)
- **The structure is storage bookkeeping the agent shouldn't reason about**: the
  shared `blocks` dict + `blocks_layout` ordering, nested containers, idFields,
  and the `@type:"empty"` placeholder a region seeds when emptied.

The MCP's job is to give agents a surface that plays to their strengths
(markdown) while preserving the CMS's full power (blocks), and to hide all the
bookkeeping.

## 2. Principles

1. **Markdown-first ergonomics, native-JSON ceiling.** Markdown/directives for
   the 80%; a raw block-JSON escape hatch for the rest. Never either/or.
2. **Directives (`:::`) are the container syntax.** A directive maps 1:1 onto a
   block: `name` → `@type`, `{attrs}` → scalar fields, body → children (parsed
   recursively). `:::grid{columns=3}` containing `:::card{...}`s. Custom
   containers cost nothing — `:::anything{...}` → `@type:"anything"`.
3. **Id-addressable, versioned, schema-validated, read → edit → preview → commit
   loop.** Reads return content annotated with the uids writes will target.
4. **The MCP hides all storage bookkeeping** — block-id minting, `blocks_layout`
   ordering, `@type:"empty"` seeding, idFields — by reusing the existing helpers
   (`getEmptyBlockType`, the expand/seed helpers, `buildBlockPathMap`). The agent
   writes `add a card to the grid`; it never learns a region seeds `empty` vs a
   default.
5. **Schema is the source of truth for what's allowed.** The agent is only ever
   offered valid blocks/fields for the current context, so it can't propose
   something the CMS will reject.

## 3. I/O formats

- **Read** → markdown **plus** a `blockMap`: `uid → {type, summary, region}`, so
  a surgical edit can address a part of the page.
- **Write** accepts, in order of ergonomics:
  - **markdown** for prose blocks (→ slate, image, etc.),
  - **`:::` directives** for containers (grid/card/accordion/tabs → `@type` +
    fields + children),
  - **raw `block` JSON** escape hatch for the exotic (custom widgets, unusual
    variations),
  - **`edit_blocks`** for surgical, id-addressed operations on existing content.

(Container markdown conventions — the `:::` directive family, MyST/sphinx-design
names for grid/card/dropdown/tab-set, `<details>` for accordions on input — are
their own note; this spec assumes them.)

## 4. Tools (illustrative signatures)

Legend: **[REST]** = thin wrapper over existing Plone REST; **[NEW]** = block-aware
logic the MCP adds (the reason to build it at all); **[REST+conv]** = REST for
transport, [NEW] for the markdown↔blocks conversion. Most of the *management*
surface is [REST]; the *authoring* surface is [NEW].

**Discovery / read**
```
search_content(query, type?, path?) -> [...]            // [REST]       @search
get_page(path|uid, format:"markdown"|"blocks") -> {...} // [REST+conv]  GET + →markdown/blockMap
get_block(pageUid, blockUid) -> {...}                   // [NEW]        resolve uid in nested structure
```

**Introspection** (the content model — see §8)
```
list_block_types(containerUid?) -> [...]                // [NEW]  block-type schemas (not @types — see below)
describe_block(type) -> schema + example + preview      // [NEW]  §8
```

**Whole page**
```
create_page(parentPath, title, content:markdown|blocks, metadata?) -> {...} // [REST+conv]  POST
update_page(uid, {content?, metadata?}, expectedVersion?) -> {...}          // [REST+conv]  PATCH
delete_page(uid)                                                           // [REST]       DELETE
```

**Parts of a page** — one *batched, atomic* op tool rather than four separate
add/move/delete tools (fewer choices for the agent, no half-applied edits). **[NEW]**
— it PATCHes the `blocks`/`blocks_layout` field, but unlike a raw PATCH it
understands structure (nesting, ordering, empty seeding, idFields):
```
edit_blocks(pageUid, ops:[
  {op:"add",    at:{after|before|inside:uid, region?}, content:markdown|block},
  {op:"update", uid, fields?|content?},
  {op:"move",   uid, to:{after|before|inside:uid, region?}},
  {op:"delete", uid},
], expectedVersion?, dry_run?) -> {version|preview, results}
```

**Metadata / workflow / assets / structure** — all [REST]
```
set_metadata(uid, {title?, description?, seo?})   // PATCH
transition(uid, "publish"|"retract"|...)          // @workflow
upload_image(bytes|url, alt?) -> {uid, url}        // POST Image / @upload
move(uid, targetPath) / copy(uid, targetPath)     // @move / @copy
```

**The one management-ish need that *isn't* plain REST:** block-*type* schema
introspection (`list_block_types` / `describe_block`). `@types` returns
*content-type* field schemas; block schemas live in the frontend (Volto
`blocksConfig`) or the Plone block-types control panel. Introspection reads from
there — the same "schema lives on the frontend" wrinkle that bit the sanity-test
discovery this cycle.

**Curation note:** don't 1:1 mirror `@plone/restapi` as MCP tools — that's
tool-overload for the agent. Expose the small curated surface above (search / get /
create / update / delete / publish / upload / move) backed by REST, plus the [NEW]
block tools; leave the rest of REST reachable but unlisted.

## 5. Resources (read-only context)

- **Schema catalog** — every block type, its fields, variations, allowedBlocks
  (the vocabulary; §8).
- **Block gallery** — a rendered example per (type, variation) (§8).
- **The page** — as markdown + `blockMap`.

## 6. Whole-page vs part-of-page

- **Whole page** (`create_page` / `update_page`): authoring from scratch, bulk
  rewrites, imports. Clobbers → gate with `expectedVersion`.
- **Part of page** (`edit_blocks` by uid): "change the hero heading," "add a card
  to the grid," "reorder these," "publish." Precise, cheap, concurrency-safe.
  Requires a `get_page` first to learn the uids — that read → target → write is
  the core loop.

`edit_blocks` maps directly onto operations the bridge already implements
(add/move/reorder/convert/wrap-unwrap), so the MCP is a thin layer over proven
code rather than a reimplementation.

## 7. Preview — how would it work?

Preview is **non-destructive by default**: it renders the *proposed* state
(current page + pending edits) without persisting. Commit is a separate, explicit
step. Crucially, **preview is browserless in the common path** — a headless
browser is a screenshot-only, optional, externalizable add-on, not core MCP
infrastructure. Three tiers:

- **Structural (cheap, default).** Returns the resulting block tree + validation.
  Confirms structure, ordering, fields, legality. Pure data — no browser, no
  vision. Good for "did my edit land where I meant."
- **Rendered HTML.** Renders the proposed blocks through the frontend and returns
  HTML — the agent reads content, order, links, which variation rendered. This is
  enough for most self-checks; agents reason about HTML well and don't need a
  picture to know a heading is wrong. **How it's produced depends on the
  frontend:**
  - *SSR / `renderEndpoint` frontends* (Astro, Nuxt SSR, PHP): just an HTTP
    `POST {unit, formData} -> HTML` to the render endpoint the bridge already
    uses for live preview. **No browser** — the frontend's own server renders,
    and it returns the proposed HTML without persisting.
  - *Purely client-rendered frontends* (a React SPA with no server render): there
    is no endpoint to call, so a JS runtime — a browser, or an SSR shim — has to
    execute the components to produce any HTML. Here the browser is the *render
    engine*, not a screenshot tool.
- **Screenshot (the only inherently browser-dependent tier).** Rasterizing
  HTML+CSS to pixels is what a browser does, so this needs a headless engine. It
  answers the layout questions HTML can't — "does this look cramped, do the cards
  line up." Keep it **optional and externalizable**: request it on demand / for
  layout-heavy changes, and run it as a separate screenshot service or on the
  **Playwright infra this repo already has**, so the MCP itself stays a thin API
  and never embeds a browser on the request path.

Because the render endpoint renders a **unit**, preview works at any granularity:
a single block ("how does this card look?") or the whole page. And the "how it
looks" gallery (§8) is generated **at build time**, so even its screenshots never
touch the request path.

**The loop:**
```
edit_blocks(..., dry_run:true)   // or a dedicated preview(proposed) tool
  -> { preview: { blockTree, validation, html?, screenshot? } }
agent inspects -> adjusts -> edit_blocks(...)   // commit, explicit
```

This is the headless, agent-facing equivalent of the live preview a human already
gets over the iframe — but browserless in the common path, with pixels only when
asked (and even then, off the MCP's own box).

## 8. How does the agent know a block's options — and how it will look?

Two halves: **what options exist** (schema) and **how it looks** (rendered
examples). Neither is hand-maintained — both are derived from the live frontend,
so they can't drift.

### (a) Options → from the schema

`describe_block(type)` / `list_block_types(containerUid?)` return the block's
`blockSchema`, translated into authoring vocabulary:

- **fields** — name, type/widget (`slate`, `url`, `image`, `select`, …), `choices`
  for selects, `required`, `default`.
- **variations** — the `variation`/`blockTypeSelect` field and what each variant
  is (e.g. teaser: `default` / `imageLeft` / `imageTop`).
- **allowedChildren** for containers — and crucially this is **contextual**:
  `list_block_types(containerUid)` returns only what's valid *inside that
  container's region* (respects `allowedBlocks`), so the agent can't propose an
  illegal child.
- **the directive/markdown form** — e.g. `grid → :::grid{columns:1..4}, children:
  card | teaser | image`. The agent learns not just *that* a field exists but
  *how to write it*.

This is standard content-model introspection, and because it's read from the
running frontend's registered schemas it's always in sync (same source the
block-sanity discovery reads).

### (b) Appearance → from a rendered example gallery + live preview

Schemas don't convey appearance, so we add two things:

- **A block gallery** (resource). Each `(type, variation)` has a canonical example
  instance plus a **rendered preview** — HTML and a thumbnail screenshot —
  **auto-generated by rendering the example through the frontend** (the same
  render path as §7). The agent sees "this is a card," "here's teaser/imageLeft
  vs teaser/imageTop," and picks by appearance, not by guessing from field names.
  Because it's generated, not authored, it never drifts from what the frontend
  actually produces.
- **Live preview of the agent's own draft** (§7). The gallery gives *priors*
  ("cards look like this"); the preview gives *confirmation* ("here's how *my*
  card, with *my* content, actually looks"). Write → see → adjust.

**Synthesis:** options come from schema introspection (what's possible + legal +
how to write it); appearance comes from a rendered example gallery (priors) plus
live preview of the draft (empirical truth). Both are generated from the live
frontend, so the agent's mental model matches reality — the same discipline that
kept block-sanity honest this cycle.

## 9. Cross-cutting concerns

- **Optimistic concurrency** — `expectedVersion`/etag on writes so an agent never
  silently overwrites a human's concurrent edit. Non-negotiable for a multi-editor
  CMS.
- **Validation on the boundary** — reject/repair malformed structure and return
  *why*, rather than persisting corruption. The MCP is the right place to enforce
  the block contract (this whole cycle was a frontend choking on structure the
  admin produced).
- **Draft vs publish** — edits land as draft; `transition` publishes. Preview
  works against draft.
- **Media** — `upload_image` returns a referenceable asset; blocks reference it,
  agents never inline bytes.
- **Auth / scope** — the MCP runs as a Plone user; permissions and workflow gate
  what the agent can touch. (Details TBD.)

## 10. Runtime & topology

The MCP is a **standalone Node service** — the agent's authoring path — sitting
*beside* Volto, not inside it. Four roles, kept separate:

- **Plone (Python backend)** — system of record: storage, auth, workflow,
  server-side validation. All writes land here, through its REST API.
- **The frontend (SSR)** — renders blocks; owns preview via its `renderEndpoint`.
- **Volto** — the *human* admin UI, one client of Plone. **Not in the MCP's
  request path.** The agent path and the human path are siblings: both write to
  Plone, both render via the frontend.
- **The MCP service (Node)** — coordinates the above and holds the block logic. It
  reuses hydra/volto's JS block libraries (block manipulation, `edit_blocks` ops,
  `getEmptyBlockType`/seeding, `buildBlockPathMap`, markdown↔blocks) so the agent
  path runs the *same* code as the admin, not a reimplementation; persists via
  Plone REST (auth, workflow, the `expectedVersion` guard); and previews via the
  frontend's `renderEndpoint` (HTML) plus an optional external screenshot service
  (§7) — no browser on its own request path.

```
  agent ─▶ MCP service (Node) ──REST──▶ Plone backend     (storage, auth, workflow)
               · block libs    ──HTTP──▶ frontend (SSR)     (renderEndpoint → preview HTML)
               · md↔blocks      ··opt··▶ screenshot svc     (pixels, off the request path)

  human ─▶ Volto admin UI  ──REST──▶ Plone      (sibling path — not through the MCP)
```

### Prerequisite: dep-free block logic

Running the block logic server-side means it must be **Node-runnable and
dependency-free** — no Volto `config`/registry imports. This is not incidental:
`getEmptyBlockType` lives in `volto-hydra/blockPath.js`, which imports Volto's
`config`, which is exactly why the CJS block discovery couldn't import it and had
to mirror the rule by hand. The MCP hits the same wall at larger scale. So a real
dependency of this proposal is **hoisting the shared, pure block logic into
dep-free packages** — `hydra-js` and `helpers` mostly already are; the
`volto-hydra` pieces that reach for `config`/registry need factoring out. Same
"centralise the pure logic where both sides can import it" pattern that recurred
throughout the block-type and region work.

### The shortcut, and why it's a prototype path

You *can* embed a thin MCP route inside Volto's Node server, reusing the block
logic in-process and skipping the dep-free work. Viable for a spike — but it welds
agent-authoring to the admin's deployment and lifecycle, and drags Volto's
`config`/registry baggage into a server context it wasn't built for. Treat it as a
prototype, not the target topology.

## 11. Human-in-the-loop: preview & co-editing

The human's preview-and-edit surface already exists — it **is the Hydra admin**,
the iframe live-editor a human uses today. So don't build a separate preview UI
for the human; stream the agent's edits into the same live editor. What flows over
the wire is **block operations**, not rendered pixels or text diffs — Hydra
already addresses everything by `data-block-uid`, the admin already holds the
`formData` and re-renders the iframe on change, and the bridge ops
(add/update/move/delete) are exactly what an agent emits. That's why block-level
co-editing is feasible here where character-level co-editing (OT/CRDT) would not
be.

A spectrum, cheapest first:

- **Draft + review (v1, no new infra).** Agent writes a Plone draft; the human
  opens the admin on it, sees the rendered result live, edits, publishes.
  Turn-based — agent batches, human reviews.
- **Live reflection (v2).** A lightweight **backend→admin push** (SSE/websocket):
  the agent's writes are merged into the admin's `formData` so they appear live in
  the human's open session while they keep editing. Block-id addressing makes the
  merge tractable — block-level, not text OT; the `expectedVersion` guard /
  last-write-per-block resolves the rare same-block clash.
- **Co-editing / suggestion mode (v3).** A **direct MCP↔admin-session channel**:
  the agent's block ops flow into the human's live `formData` as **suggestions** —
  highlighted, pending, accept/reject *per block*, like Google-Docs suggesting
  mode at block granularity. Both see the same live iframe; the human can grab any
  block and edit while the agent works. Keeps the human in control (agent
  proposes, human approves).

**Presence-adaptive:**
- Human has the admin open → the agent joins that session (v2/v3): edits appear as
  live suggestions, the human co-edits, persist on save.
- No human present → the agent persists a Plone draft (v1); the human reviews later
  in the admin.

Same content, two surfaces: the **human** gets the full admin (real rendered page,
click any block); the **agent** gets the headless preview (HTML/screenshots, §7).
Same blocks underneath.

One-liner: **the human previews and edits in the Hydra admin itself; the MCP
streams the agent's block-ops into that live session as accept/reject suggestions,
falling back to a Plone draft when nobody's watching.**

## 12. Non-goals / open questions

- Not a page *builder UI* — this is an API surface for agents, not a replacement
  for the admin.
- Undo/history granularity, and whether `edit_blocks` batches are one revision.
- How rich the markdown→block mapping should be before it's better to drop to the
  JSON escape hatch (we own that boundary; keep it small + documented).
- Multi-frontend appearance: the gallery/preview reflect *one* frontend; a site
  with several frontends may need per-frontend previews.
- Reusing Volto's existing blocks-conversion tooling (HTML/markdown → blocks) vs
  writing our own serializer.

## 13. Why this fits Hydra specifically

Everything the MCP needs already exists: every block carries a stable
`data-block-uid` (id-addressing), the bridge already implements
add/move/reorder/convert/wrap-unwrap (`edit_blocks` is a thin wrapper), the
frontend already renders blocks and has a `renderEndpoint` (preview + gallery for
free), and the schemas are registered on the frontend and readable (introspection
+ contextual allowedBlocks). The MCP is mostly *composition of parts we have*,
plus the markdown/directive I/O layer and the bookkeeping-hiding.

One-liner: **markdown is the ergonomics, native JSON is the ceiling; the MCP is a
versioned, schema-validated, id-addressable read → edit → preview loop that hides
every bit of storage bookkeeping — and preview + "how it looks" both fall out of
rendering proposed blocks through the real frontend.**
