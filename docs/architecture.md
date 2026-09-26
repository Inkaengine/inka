---
"@type": Document
UID: docs-architecture-001
allow_discussion: false
contributors: []
creators:
  - admin
description: Inka is the page-building and governance layer between your CMS and
  your front ends. Content stays in the CMS, rules come from your design system,
  and front ends in any framework render the result. Editing is private;
  publishing is public.
effective: 2025-01-01T00:00:00
exclude_from_nav: false
expires: null
id: architecture
is_folderish: false
language: "##DEFAULT##"
layout: document_view
preview_caption: null
preview_image: null
review_state: published
rights: ""
subjects:
  - frontend
  - editing
title: How Inka Works
blocks-matched: |
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
  <block type="title" _="${h1}" />
  <block type="separator" _="${hr}" styles={"align":"full"} />
  <block type="codeExample">
    <region name="tabs" widget="object_list">
      <block type="tab" label="${h3/text}" language="${pre/lang}" code="${pre/text}" />
    </region>
  </block>
blocks-tagged: |
  <block type="slateTable">
    <region name="table.rows">
      <block type="row">
        <region name="cells">
          <block type="cell" value="${td/slate}" />
        </region>
      </block>
    </region>
  </block>
---

# How Inka Works

Inka is the page-building and governance layer between your CMS and your front ends. Content stays in the CMS, rules come from your design system, and front ends in any framework render the result. Editing is private; publishing is public.

<block type="separator" />

## Your design system as blocks and rules

Pages are laid out in blocks, and the blocks are your design system. Each block type is a component your developers already wrote in the front end. With each one go the rules for using it:

- **What can go inside what.** Each region lists the block types it accepts, and how many (`allowedBlocks`, `maxLength`).
- **Which fields an editor can change.** A block's schema lists its fields; templates and layouts can lock blocks so they can't be moved or edited (`fixed`, `readOnly`).
- **What those fields accept.** Field rules check a value and either block the save or give advice.
- **Which combinations are not allowed.** A rule can compare one field with another, so a setting that only works with certain others can be refused.

Editors get a page builder that only offers what your design system allows. They drag, drop and type on the rendered page, on a phone as well as a desktop (see [editing on a phone](./editor-guide/index.md#editing-on-a-phone)), but there is no freeform mode to fall out of, so an off-system page is not something anyone has to catch in review. [Rules and checks](./compliance/index.md) has an example of each kind of rule.

## Three layers

Inka splits a site into three layers, and each can change without the others:

- **The CMS**, such as Plone, Drupal or WordPress, keeps the content, workflow, users, permissions, scheduling and translation. It connects to Inka through an [adapter](./adapters/index.md).
- **Inka** does the page building and applies your design system's rules while people edit. It is not a CMS and stores no content of its own.
- **Front ends** render the pages, in any framework, as a static site (SSG), server-rendered (SSR) or a single-page app (SPA). One site can have several.

This is more decoupled than a typical headless CMS. A headless CMS still owns the page builder, so its editing screens decide what a page can be. With Inka, the front end decides. Each front end declares its block schemas and rules through the bridge script (`initBridge`), and Inka applies them while people edit. Change your design system and the editing rules change with it, with no CMS release. Change the CMS and keep the editor and the front ends; rebuild a front end and keep the CMS and the rules.

### Diagram

```text
                        ┌───────────── behind login, can sit behind a VPN ──────────────┐
┌───────────────┐       │   ┌────────────────┐   postMessage    ┌───────────────────┐   │
│ CMS           │ save  │   │ Inka editor    │◄────────────────►│ Front end,        │   │
│ Plone,        │◄──────┼───┤ page building, │    (iframe)      │ editing build     │   │
│ Drupal,       │ read  │   │ design rules   │                  │ + bridge script   │   │
│ WordPress     ├───────┼──►└────────────────┘                  └─────────▲─────────┘   │
│ (adapters)    │ read  │                                                 │             │
│               ├───────┼─────────────────────────────────────────────────┘             │
│               │       └───────────────────────────────────────────────────────────────┘
│               │ read, published content only        ┌───────────────────┐
│               ├────────────────────────────────────►│ Public front end  │  no Inka, no bridge
└───────────────┘                                     └───────────────────┘
```

### More than one content store

An adapter connects Inka to a content store through one contract, so editors get the same experience whatever sits behind it: Plone, Drupal, WordPress or a custom store. Different sections of one site can come from different stores, for example news from one system, a product catalogue from another and policies from a third. Editors work on all of it in the same editor. If your content lives somewhere that isn't a CMS, write an adapter for it; it uses the same contract as the built-in ones. See the [CMS adapter guide](./adapters/index.md).

### More than one front end

Nuxt, Next.js, Astro, Vue and Framework7 front ends work today, and so do server-rendered sites in PHP, Django, Rails or Laravel (see [server-rendered front ends](./frontend-guide/server-rendered-frontends.md)). A front end adds one small JavaScript file, the bridge, and a few HTML attributes on the elements editors can change. There is no SDK to adopt and no framework to switch to.

One site can have several front ends reading the same content, for example the main website and a mobile app. Editors switch between them in the toolbar while they edit, to see the same page rendered by a different front end and design system.

## Editing is private, publishing is public

Inka is only used to edit. The public site never talks to it.

- **Inka sits behind login.** Editors sign in with their CMS account, so single sign-on, roles and approval workflow are the CMS's, used as they are. You can also put Inka behind a VPN, because nothing public needs to reach it.
- **The public site is a read-only front end.** It reads published content straight from the CMS API and never loads Inka.
- **The bridge script is only for editing.** Load it only when the page is opened inside Inka's editing iframe, or ship it only in a separate editing build of your front end. Your public build does not need it.
- **Edits travel over `postMessage`.** Inka opens your front end in an iframe. The bridge and Inka talk only through `postMessage`, and each side checks the other's origin: the bridge sends only to the Inka origin, and accepts messages only from that origin or from its own page.
- **Inka saves to the CMS, the bridge does not.** When an editor saves, Inka writes the page through the CMS's API with the editor's own login, so the CMS's permissions and workflow apply. The front end only reads: it fetches content with the editor's token so the preview can show unpublished pages, and the bridge sends the edits to Inka.

[Deploy and secure Inka](./deploy-and-secure.md) covers the settings that keep this split tight, such as `frame-ancestors` on the editing front end.

## Rules while editing

Rules run as the page is written, not in a review afterwards. Field rules do one of two things:

- **A hard rule stops the save.** A required field left empty, or a value that cannot work (a field rule with `error`), marks the field invalid, and the page can't be saved until it is fixed.
- **An advisory rule gives advice.** A field rule with `warning` shows beside the field while the editor works, and the page still saves.

Region rules (`allowedBlocks`, `maxLength`, `allowedStyles`) act earlier still: the editor is only offered the blocks and text styles the region accepts.

The same mechanism covers more than layout. Accessibility and other standards you are held to, the structure of your design system, and what the site says, such as words your brand avoids, can all be written as rules. See [Rules and checks](./compliance/index.md).

A machine can check colour contrast or heading order. It can't tell whether alt text says anything useful, whether the reading level suits the audience, or whether a photo belongs on the page. Those need a person's judgement. [Inka Assure](https://inka.sh/plugins/inka-assure), in development and planned for late 2026, will save that judgement against the version of the page it applies to: who signed it off, when, and on what basis. When the page changes, the item will come back for review. Overrides will be recorded the same way.

## AI agents

An MCP connection for AI agents is [coming soon](https://inka.sh/plugins/mcp). An agent will connect with the access an editor has and be held to the same rules. There is no separate path for agents, so an agent can't write its way around the rules.

An agent that comes in through the same door can be asked to check as well as write, for example cross-checking a claim against your own documents, or finding a figure that doesn't match its source. You set which checks run and which need a person to sign off.

## Inka is stateless

Inka has no database and no content store of its own. Content, users and history live in the CMS. Each editor's own settings, such as the front ends they have added, live in their browser.

So Inka is easy to run yourself: it is one Node.js process you can scale to zero between editing sessions. To recover, redeploy it; there is nothing to restore. When you run it on your own infrastructure, nothing phones home, no content leaves your network, and you decide when to upgrade. PretaGov also runs Inka as a managed service, on a dedicated instance for each customer.

## The iframe ↔ admin bridge

During editing the frontend is loaded inside an iframe owned by Inka's admin UI. The two communicate via `postMessage` over the iframe boundary:

- **Admin → frontend**: form-data updates, selection changes, route changes.
- **Frontend → admin**: which block was clicked (selection), which slate node holds the cursor, where blocks live in the rendered DOM, slate transform requests so the admin can compute the new value.

This split lets the frontend stay 100% headless when not in admin (just renders content), while the admin gets full visual editing without the frontend having to know any React, any block-form widgets, or any sidebar UI.

## The chrome pattern

Selection outlines, the block toolbar, drag handles, edge handles, the empty-block "+" — none of these are rendered by the frontend. They're rendered in the admin (React) layered above the iframe. The frontend only:

1. Adds the data attributes that mark editable elements (`data-block-uid`, `data-edit-text`, `data-edit-link`, `data-edit-media`, `data-node-id`).
2. Captures pointer events through invisible elements so the admin's chrome stays interactive.
3. Reports element rects on demand so the chrome can position itself.

The benefit: a frontend's CSS can never break the editing UI, because the editing UI doesn't live in the frontend. Switching frontends mid-edit (Nuxt → Next → Astro) works because the bridge protocol is the same — only the rendered DOM changes. Server-only frameworks without client-side reactivity (Astro, PHP, Django, Rails) participate via the [server-render pattern](./frontend-guide/server-rendered-frontends.md) — same bridge protocol, plus a small HTTP endpoint the bridge POSTs to.

## Slate (rich text) transforms

When the editor types in a slate field, the frontend doesn't compute the new slate value itself — the admin does, by running the slate transform against the previous slate value. The frontend's job is to:

1. Receive the new slate value via `SLATE_TRANSFORM_RESULT` and re-render.
2. Send slate node `data-node-id` attributes back so the admin can place the cursor at the right node after re-render.

This is why every slate node needs a `data-node-id` attribute on its rendered HTML — without one, the admin can't track the cursor across re-renders. See [Visual Editing › Renderer Node-ID Rules](./frontend-guide/visual-editing.md#renderer-node-id-rules).

## Building a frontend

The steps for creating an Inka-compatible frontend are the same across frameworks: catch-all route → fetch the page from your CMS's API → render blocks recursively → add `data-block-uid` and `data-edit-*` attributes on editable elements → load `hydra.js` only inside the admin iframe.

See [Build a frontend](./frontend-guide/build-a-frontend.md) for the full step-by-step guide, or the example frontends: [Nuxt.js](https://github.com/Inkaengine/inka/tree/main/examples/nuxt-blog-starter), [Next.js](https://github.com/Inkaengine/inka/tree/main/examples/hydra-nextjs), [F7-Vue](https://github.com/Inkaengine/inka/tree/main/examples/hydra-vue-f7).

## Layers of adoption

Inka is **additive**: each layer below works on its own, and each next row enhances editing without breaking what came before. You can ship at any row, mix rows on the same site, and add the next layer when you're ready.

<block type="slateTable" table.fixed table.celled>

| Step | What you wire up | What editors get |
| --- | --- | --- |
| **Plain headless** | Frontend fetches your CMS's API. No `hydra.js` involved. | Sidebar editing in Inka, frontend reloads on save. Editors flip between the Inka edit tab and a frontend tab to see results — works fine, but loses inline editing and realtime preview. |
| **Bridge installed** | Load `hydra.js`, call `initBridge({ page: { schema: { properties: { ... } } } })`. See [Live Preview › Setting Up the Bridge](./frontend-guide/live-preview.md#setting-up-the-bridge). | Frontend follows admin navigation (and vice versa). Frontend renders private content via shared auth ([Authentication](./frontend-guide/advanced.md#authentication)). Page metadata (title, description, etc.) editable from the admin. |
| **Custom block types** | Add a `blocks: { ... }` config to `initBridge`. See [Custom Blocks › \`initBridge()\` Reference](./frontend-guide/custom-blocks.md#initbridge-reference). | Editors can add, configure, and convert your custom block types — schema renders in the sidebar with no editor plugin to deploy. Cross-block conversion ([fieldMappings](./frontend-guide/custom-blocks.md#block-conversion-and-fieldmappings)) becomes possible. |
| **Block selection in preview** | Add `data-block-uid` to your rendered blocks. See [Visual Editing › HTML Annotations](./frontend-guide/visual-editing.md#html-annotations-for-visual-editing). | Click-to-select on the preview. Block toolbar above selected blocks. Sidebar↔preview selection scrolls into view. Multi-select with Shift/Ctrl-click. |
| **Realtime preview** | Register `onEditChange` and render from the `formData` it gives you instead of from the API. | Preview updates as the editor types. Drag-and-drop, slash menu, container ops (wrap, unwrap, edge-drag, convert) all unlock — see the [Editor Guide](./editor-guide/index.md). |
| **Direct field editing** | Add `data-edit-text`, `data-edit-link`, `data-edit-media` to specific elements. | Click rendered text and start typing. Click an image to pick or upload. Click a link to open the link picker. Markdown shortcuts (`##`, `**bold**`, etc.). |
| **Templates and layouts** | Configure `allowedTemplates` / `allowedLayouts` on a region; use `expandTemplates` at render time. See [Templates](./frontend-guide/templates.md). | Editors pick layouts from a dropdown, insert template snippets via the BlockChooser, recognise locked vs editable vs slot blocks. |
| **Listings and dynamic content** | Configure listing block types and pass `fetchItems` to `expandListingBlocks`. See [Listings](./frontend-guide/listings.md). | A `fieldMapping` widget on listing blocks maps query results to item fields. Listings render as repeated blocks, editable per item. |
| **Custom UI / advanced** | Override the editor's components through Volto's add-on system. See [Advanced](./frontend-guide/advanced.md#custom-sidebar-and-cms-ui). | Bespoke widgets and custom block edit forms. |

</block>

Different parts of the same site can sit at different rows — inline-editable headlines on a marketing page, sidebar-only editing on a complex catalog page.

## Inside the editor (for contributors)

This section is for people working on Inka itself. You don't need it to build a front end. It describes how the editor, which builds on Volto (Plone's React editor), handles template membership and URLs.

### Template membership (edit-side slot assignment)

A block's template membership — `templateId`, `templateInstanceId`, `slotId`, `fixed`, `readOnly` — is not intrinsic to the block; the admin **assigns** it at edit time. The [merge](./frontend-guide/templates.md#how-the-merge-works) reads these fields to place content at render time. Crucially, assignment is **gated on edit mode** — editing a template is a different act from moving content around inside a template you're *not* editing:

- **Normal editing** (you are *not* editing the template): a block's slot is **implicit**, derived from position. A moved/pasted block **takes on the membership of wherever it lands and carries nothing from where it came from**. Drag direction is irrelevant — a given drop position always yields the same membership.
- **Template edit mode** (you *are* editing the template, having unlocked it): the `slotId` is **explicit** — there's a `slotId` field, and you *rename* slots rather than change them by dragging. So a move that stays **inside** the template **keeps** its `slotId`; you can even build an invalid arrangement this way (save/lock validation, not the drag, is what refuses it). A move **out** of the template still **strips** it — dragging out exits, even while editing.

Fixed template blocks are only movable in template edit mode and their slot/`fixed` identity *is* the template, so they always keep their membership.

**Deriving membership from position** (the normal-mode path, and the "is this inside the template" test) — `getTemplateInfoFromNeighbors` in `blockSync.js` (reached via `applyBlockDefaultsWithContext`). Given a position in a container region it inspects the immediate neighbours and asks whether a slot *faces this gap*:

- a **non-fixed slot neighbour** on either side → join its `slotId`;
- a **fixed anchor** whose slot region faces the gap — the block *before* the gap via its `nextSlotId` (a trailing slot), or the block *after* it via its `prevSlotId` (a leading slot). `nextSlotId`/`prevSlotId` are an anchor's record of an *empty* adjacent slot (when the slot has content, the non-fixed neighbour above already covers it); they are mirror images, for top- vs bottom-anchored layouts;
- otherwise, if the **container itself is a template instance** (e.g. a `columns` block carrying a `templateId`), the block joins that instance and is given a freshly generated `slotId`.

If none apply, the position is **outside every template** and the function returns `undefined` — plain page content. A slot member is never fixed, so membership derived this way is always `fixed: false`.

**Applying it on a move or paste** — the `MOVE_BLOCKS` handler and the add/paste helper in `View.jsx`. Four things make the gated rule actually happen:

<block type="slate" data-json='{"value":[{"type":"ol","children":[{"type":"li","children":[{"type":"strong","children":[{"text":"Strip the source membership — but only when the destination should re-derive it."}]},{"text":" A moved/pasted non-fixed block has its "},{"type":"code","children":[{"text":"templateId"}]},{"text":" / "},{"type":"code","children":[{"text":"templateInstanceId"}]},{"text":" / "},{"type":"code","children":[{"text":"slotId"}]},{"text":" / "},{"type":"code","children":[{"text":"readOnly"}]},{"text":" deleted "},{"type":"em","children":[{"text":"before"}]},{"text":" the recompute, so "},{"type":"code","children":[{"text":"applyBlockDefaultsWithContext"}]},{"text":" can only refill them from the destination. This runs in "},{"type":"strong","children":[{"text":"normal mode"}]},{"text":", and in *"},{"type":"em","children":[{"text":"template edit mode only when the block lands "}]},{"text":"outside"},{"type":"em","children":[{"text":" the template"}]},{"type":"em","children":[{"text":" (a same-instance block no longer sits both before and after the landing gap) — that&#39;s the drag-out exit. For an "}]},{"type":"em","children":[{"text":"in-template move while editing"}]},{"type":"em","children":[{"text":", the strip is skipped, so the recompute&#39;s "}]},{"text":"prefer-existing-"},{"type":"code","children":[{"text":"slotId"}]},{"type":"em","children":[{"text":" keeps the authored slot. "}]},{"type":"em","children":[{"text":"Fixed"}]},{"text":"* blocks are never stripped."}]},{"type":"li","children":[{"type":"strong","children":[{"text":"Exclude the block from its own neighbour scan."}]},{"text":" On a move the block already sits in the layout at its new index, so a naïve "},{"type":"code","children":[{"text":"getNeighborData(position)"}]},{"text":" returns the block itself — it would offer its own stale slot back to itself. The recompute filters the moved block out and treats "},{"type":"code","children":[{"text":"position"}]},{"text":" as the insertion gap between its real prev/next neighbours (also the basis of the \"inside the template?\" test above)."}]},{"type":"li","children":[{"type":"strong","children":[{"text":"Write back against the original."}]},{"text":" The update guard compares the recompute result to the "},{"type":"em","children":[{"text":"originally stored"}]},{"text":" block, not the stripped copy — otherwise a block whose stripped recompute is a structural no-op is never written back and the stale membership survives."}]},{"type":"li","children":[{"type":"strong","children":[{"text":"`templateEditModeRef` for the mode check."}]},{"text":" The handler reads the current set of unlocked template instances from a ref (not the effect-closure value), so the gate sees the live edit-mode state."}]}]}]}' />

In normal mode the net effect matches the merge's own placement rules (a top/bottom slot outside a fixed anchor): dropping a block past a **free** edge flows it into that slot; dropping it past a **both-anchored** edge exits it to the surrounding page region. The drag scan that decides the drop position lives in `hydra.js` and, on a distance tie between coincident edges, prefers the deeper (inner) edge so a reorder inside a container isn't ejected to the outer level.

### URL flattening and `publicURL`

Volto's stock URL helpers (`flattenToAppURL`, `isInternalURL`, `toPublicURL`) assume there's one "public URL" — usually the same origin the admin runs on, configured via `RAZZLE_PUBLIC_URL`. In Inka the admin and the published frontend(s) live on different origins, and the editor switches between published frontends at will, so there is no single public URL.

**Do not set \`RAZZLE\_PUBLIC\_URL\`** in an Inka deployment. Pinning `settings.publicURL` to one value would break flattening for every other frontend — pastes from them would be misrecognised as external and saved verbatim instead of as `/path` references.

Inka makes `settings.publicURL` follow the currently active iframe frontend:

- **Boot** — `applyConfig` reads the `iframe_url_<port>` cookie (set by `View.jsx` on previous visits), looks up the matching saved-frontends entry, and writes `settings.publicURL = entry.publishUrl || entry.url`. A returning editor sees the right value before they open the switcher.
- **Switch** — when the editor picks a different frontend in the toolbar switcher (`FrontendSwitcherPanel`), it dispatches `setFrontendPreviewUrl(url)`. Inka's `publicUrlSync` Redux middleware intercepts the action and updates `settings.publicURL` before the next render.
- **Other frontends** — `flattenToAppURL` and `isInternalURL` are shadowed to strip `publicURL` (the active frontend) **plus** every other saved frontend's edit / publish URL, so a paste from a frontend you're not currently viewing still flattens cleanly.

Saved frontends come from two sources, merged: the `RAZZLE_DEFAULT_IFRAME_URL` env (baseline list shipped with the deployment, format `Name|EditURL[|PublishURL],…`) and the `saved_urls_<port>` cookie (per-editor additions made via the toolbar Settings modal). The optional third slot in each entry is for setups where the published site lives at a different origin than the edit-mode frontend (e.g. `edit.example.com` for previews, `www.example.com` for production).

What we deliberately did NOT shadow: `UniversalLink`'s fallback `href` when an item is empty, Volto's admin-side `Robots.txt` / `Sitemap.xml` generators, `ContentMetadataTags` / `AlternateHrefLangs` in the admin's `<head>`, and the `RegistryImageWidget` site-logo URL. All of these inherit the dynamic `publicURL` transparently, and in an Inka deployment the authoritative `robots.txt` / `sitemap.xml` / SEO tags are served by the frontends, not the admin.
