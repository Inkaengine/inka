# MCP for Agent Content Authoring — Design Proposal

> **Status: DRAFT, revised 2026-10-03. Not implemented.** Builds on the CMS
> adapter contract (#437, the `cms-adapters` branch) and the blockmd engine
> (`lib/prototype-mapping.mjs`). Supersedes the 2026-09 draft, which used the
> retired `:::` directive dialect and a standalone service beside Volto.

## 1. Problem

We want agents to create and edit pages in any CMS Inka edits: Plone, Drupal, WordPress, through the same adapter contract the admin uses. An agent given raw block JSON fails in two ways:

- **Emitting block JSON is error-prone and token-heavy.** Slate rich text is the worst case: nested `children`, marks as boolean keys, the single-root rule. And rich text is the most common content.
- **The structure is bookkeeping the agent shouldn't reason about.** That covers the shared `blocks` dict and `blocks_layout` ordering, nested containers, idFields, and the `@type: "empty"` placeholder a region seeds when it's emptied.

There's a third problem, specific to Inka. **What a page may contain is defined by its front ends, not the CMS.** Block schemas, `fieldRules`, `allowedBlocks` and `allowedStyles` are registered by each front end through `initBridge`. And what a page looks like exists only once a front end renders it. An agent that talks only to the CMS can neither know the rules nor see the result.

## 2. Principles

1. **Markdown for the agent, blocks for the CMS.** Agents read and write blockmd: the readable markdown the docs and site are already authored in, with `<block>` tags only where a shape needs one and `data-json` as the escape hatch. Conversion both ways is the blockmd engine (`decodePage` / `emitPage`), already tested on every docs and site page.
2. **Same rules as a person.** An agent edits through the same admin code and adapter contract as an editor. It's offered only what the front end allows in that place, its edits pass the same rules, and later the same Inka Assure checks and sign-offs (inka-site#21). It can't save what an editor couldn't.
3. **Id-addressed, versioned read → edit → preview → commit.** Reads return markdown plus a block map, so an edit can target one block by uid. Writes are atomic, take an expected version, and can be previewed first.
4. **The bookkeeping stays hidden.** Uid minting, `blocks_layout` ordering, empty-region seeding and idFields are handled by the existing helpers (`buildBlockPathMap`, `getEmptyBlockType`, the expand and seed helpers), not reimplemented.
5. **Everything the agent learns comes from what's live.** Options come from the front ends' registered schemas, appearance from their real render, and permissions and workflow from the CMS through the adapter. Nothing is hand-maintained, so nothing drifts.

## 3. Runtime: an admin host with the front ends loaded

The MCP runs **where the front ends are**: in an Inka admin session, not beside it. This reverses the 2026-09 draft, which put the MCP in a standalone Node service and called the in-admin route a prototype shortcut. That draft hit the problem itself ("the schema lives on the frontend") and had to work around it.

```
  agent ─MCP─▶ MCP server ──drives──▶ admin host (headless Inka admin session)
                                         · front-end iframe(s) + bridge: schemas, rules, rendering
                                         · BridgeApi.dispatch(intent) ──▶ adapter ──▶ CMS
  human ─────▶ Inka admin (browser) ─── same admin code, same bridge, same adapter
```

- **The admin host** is a headless browser session running the Inka admin, with the site's front ends loaded in their iframes, exactly as an editor has them. It's what the Playwright harness already drives in tests, run as a product service. It gives the MCP:
  - the **schemas and rules** each front end registered (`initBridge` → the admin's block registry), including contextual `allowedBlocks`;
  - the **rendered page** per front end: its DOM, HTML, measured block rects and screenshots, for any front end, client-rendered or SSR;
  - the **admin's own editing operations**: add, move, convert, wrap/unwrap and the empty-seeding rules, so the agent runs the same code paths as a person;
  - **persistence through `BridgeApi.dispatch`**, so through the adapter contract to whichever CMS the page lives in.
- **The MCP server** speaks MCP to the agent and drives an admin-host session per agent session. It holds no block logic of its own. Whether it drives the host through the browser's devtools protocol or a small in-admin agent API is an implementation choice (§12).
- **One session, one user.** The host signs in as the agent's user (`auth.whoami`), so the CMS's permissions and workflow gate what the agent can touch, as they do for a person.

The cost is a browser per active agent session. That's acceptable for authoring (sessions are few and short-lived compared with page views), and it's the only way to get the front ends' schemas, rules and rendering without duplicating them.

## 4. I/O formats

- **Read**: blockmd markdown (`emitPage`) plus a **block map** `uid → {type, region, summary}`, so an edit can address part of the page. Optionally the raw block JSON.
- **Write**, from most to least ergonomic:
  - **blockmd markdown** for content: bare markdown for prose, headings, lists, tables and images, and `<block type="…">` for blocks a prototype maps (`decodePage`);
  - **`edit_blocks` operations** for surgical, uid-addressed changes;
  - **raw block JSON**, the escape hatch, as `data-json` in blockmd or as a block in an operation.

The prototypes in force are the site's: the defaults (`lib/default-prototypes.mjs`) plus any a front end registers. So an agent writes the same markdown a person sees in the docs.

## 5. Tools

Legend: **[contract]** is a thin wrapper over an adapter intent through the admin host; **[admin]** reuses the admin's block operations and validation; **[blockmd]** is the markdown conversion; **[host]** is rendering or introspection the admin host provides.

**Read**
```
search_content(query, filters?) -> [...]                   // [contract] search / querystringSearch
get_page(path|uid, format:"blockmd"|"blocks") -> {...}     // [contract] content.get + [blockmd] emitPage + block map
get_block(pageUid, blockUid) -> {...}                      // [admin] getBlockData (nested-aware)
```

**Content model** (§8)
```
list_block_types(pageUid, at?:{inside:uid, region}) -> [...] // [host] registered schemas, filtered by allowedBlocks there
describe_block(type) -> {schema, blockmd form, example, preview}  // [host]
```

**Whole page**
```
create_page(parentPath, title, content:blockmd|blocks, metadata?)   // [contract] content.create + [blockmd] decodePage
update_page(uid, {content?, metadata?}, expectedVersion)            // [contract] content.update
delete_page(uid)                                                     // [contract] content.delete
```

**Part of a page**: one batched, atomic tool rather than four, so there are fewer choices for the agent and no half-applied edits.
```
edit_blocks(pageUid, ops:[
  {op:"add",    at:{after|before|inside:uid, region?}, content:blockmd|block},
  {op:"update", uid, fields?|content?},
  {op:"move",   uid, to:{after|before|inside:uid, region?}},
  {op:"delete", uid},
], expectedVersion, dry_run?) -> {version | preview, results}   // [admin] + [contract] content.update (batch)
```

**Workflow, structure, assets**: all [contract]
```
get_state(uid) / transition(uid, transition, form?)   // state.get / state.getForms / state.transition
move(uid, target) / copy(uid, target) / order(...)    // content.move / content.copy / content.order
upload_image(bytes|url, alt?) -> {uid, url}            // asset.upload
dependents(uid)                                        // reference.dependents ("what links here")
```

Don't mirror all 38 intents as tools. Expose the curated set above; the rest stay reachable through the host but unlisted.

## 6. Whole page vs part of a page

- **Whole page** (`create_page` / `update_page`) is for writing from scratch, bulk rewrites and imports. It replaces content, so it's gated on `expectedVersion`.
- **Part of a page** (`edit_blocks` by uid) is for "change the hero heading", "add a card to the grid", "reorder these". It needs a `get_page` first to learn the uids; that read → target → write is the core loop.

## 7. Preview

Preview renders the proposed state, meaning the current page plus pending edits, without saving. Commit is a separate, explicit step. Because the admin host has the front ends loaded, preview is the real render, per front end:

- **Structural**: the resulting block tree, plus validation against the rules (§9).
- **Rendered**: the front end's HTML for the block or the page, read from the iframe after the bridge applies the proposed data, as it does for an editor's unsaved changes. This works the same for client-rendered and SSR front ends, because the front end renders in its own iframe.
- **Screenshot**: on request, of a block or the page, per front end, at a given viewport width (desktop or mobile).

A site with several front ends (website, app) is previewed on each; the result says which.

## 8. How the agent knows a block's options and how it looks

- **Options come from the registered schema.** `describe_block` / `list_block_types` return each block's fields (widget, choices, required, default), variations, and allowed children for containers. That list is contextual: only what's valid in that region of that page. They also return the blockmd form, meaning the prototype that writes the block as markdown, so the agent learns how to write it, not just that it exists.
- **Appearance comes from rendering.** There's an example per block type and variation, rendered through the front end; the block-reference pages in the docs are exactly this, generated from the live instance. Then there's live preview of the agent's own draft (§7). The examples give priors; the preview gives the truth.

## 9. Rules, checks and validation

An agent's write goes through the same validation as an editor's save:

- **Before saving**, structural validity (the block contract) plus the front end's rules: `fieldRules` `error` blocks the save, and `warning`s come back as advice with the result. A rejected write returns *why*, with the block uid, field and rule.
- **With Inka Assure** (inka-site#21), the agent's edits run the same checkers. Findings that need sign-off are signed off by a person at a workflow step, as for anyone. An agent can't sign off its own exceptions unless the rule's policy allows it.

## 10. Concurrency, drafts and locks

- **Optimistic concurrency.** Every write carries `expectedVersion`; a stale write is refused, never merged silently.
- **Locks.** The host takes `content.lock` while an agent edits a page, as the admin does for a person, and releases it with `content.unlock`.
- **Drafts and publishing.** Edits land as the CMS's draft or working state; publishing is an explicit `transition`.

## 11. Human in the loop

The admin host *is* an admin session, so a person and an agent can share one view:

- **v1, draft and review.** The agent saves a draft; a person opens it in the admin, sees the real render, edits and publishes.
- **v2, live.** The agent's operations reach a person's open admin session on the same page, as block operations (not text diffs), so they appear as they're made.
- **v3, suggestions.** The agent's operations arrive as pending suggestions, accepted or rejected per block.

## 12. First slice

Prove the loop end to end on **one front end and one CMS** (Plone through its adapter):

1. Start the admin host for a page and sign in as the agent's user.
2. `get_page` returns blockmd plus the block map.
3. `list_block_types` / `describe_block` return the schemas and rules registered there.
4. `edit_blocks` with `dry_run` returns the validated tree plus the rendered HTML; without `dry_run` it saves through `content.update` with `expectedVersion`.
5. Tests drive the MCP against the mock API and the test front end, the same harness as the bridge tests.

Not in the first slice: whole-page create and delete, workflow, assets, screenshots, multiple front ends, co-editing.

## 13. Open questions

- **How the MCP server drives the admin host:** the devtools protocol from outside, or a small agent API exposed inside the admin. The second is cleaner but is new admin surface.
- **Host lifecycle:** one browser per agent session vs a pool, and idle timeouts.
- **Undo and history granularity:** is one `edit_blocks` batch one revision?
- **Prototypes per site:** where a site's own prototypes are registered (a front end's `initBridge`, or site configuration).
