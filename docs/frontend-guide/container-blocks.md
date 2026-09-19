---
"@type": Document
UID: docs-container-blocks-001
allow_discussion: false
contributors: []
creators:
  - admin
description: A block — or the page itself — is divided into regions, and each
  region holds an ordered list of blocks. Sliders have a slides region, grids
  have columns, accordions have panels; a page has its main items region (and
  optionally a header, footer, …).
effective: 2025-01-01T00:00:00
exclude_from_nav: false
expires: null
id: container-blocks
is_folderish: false
language: "##DEFAULT##"
layout: document_view
preview_caption: null
preview_image: null
review_state: published
rights: ""
subjects:
  - containers
  - frontend
title: Container Blocks
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

# Container Blocks

A block — or the page itself — is divided into **regions**, and each region holds an ordered list of blocks. Sliders have a slides region, grids have columns, accordions have panels; a page has its main `items` region (and optionally a header, footer, …).

You declare regions in your `blockSchema` (or the page schema), and **you choose how each region is stored in the JSON**:

- **\`blocks\_layout\`** — the region's *ordering* is a named list inside the parent's shared `blocks_layout` dict, and the blocks themselves live in the parent's shared `blocks` dict. This is the default, and it's what persists through the backend (see [Why these persist](#why-these-persist-and-separate-top-level-fields-dont)).
- **\`object\_list\`** — the region is stored inline, as an array of objects on the field itself.

Both look and behave the same in the editor — selecting, dragging, nesting — and blocks can be dragged from one to the other; only the JSON storage differs.

<block type="separator" />

## blocks\_layout: a region in the shared dict

Each child has its own `@type` and schema (from `blocks`). The blocks live in the parent's shared `blocks` dict; the region's name is a key in the parent's shared `blocks_layout` dict that holds the ordering:

### Javascript

```javascript
// Schema definition — a 'slides' region on a slider block
slides: {
    title: 'Slides',
    widget: 'blocks_layout',
    allowedBlocks: ['slide', 'image'],
    defaultBlockType: 'slide',
    maxLength: 10,
}

// Resulting data — blocks in the shared dict, ordering under blocks_layout.slides
{
  "@type": "slider",
  "blocks": {
    "slide-1": { "@type": "slide", "title": "First" },
    "slide-2": { "@type": "image", "url": "..." }
  },
  "blocks_layout": { "slides": ["slide-1", "slide-2"] }
}
```

A block can declare several `blocks_layout` regions; they all share the one `blocks` dict, and each region gets its own list under `blocks_layout`.

\> **The region name is a key inside \`blocks\_layout\` — not a top-level field.** The > ordering list lives at `blocks_layout.<region>` (a plain array of ids). A tempting > mistake is to store it as a top-level field named after the region: > > \<!-- codeExample: json --> > \`\``json > // ✅ CORRECT — ordering keyed inside the shared blocks_layout dict > { "@type": "slider", "blocks": { … }, "blocks_layout": { "slides": ["slide-1", "slide-2"] } } > > // ❌ WRONG — an ad-hoc top-level `slides`  field holding { items: [...] } > { "@type": "slider", "blocks": { … }, "slides": { "items": ["slide-1", "slide-2"] } } >  `\``  > > The wrong form may *look* fine in a frontend that reads it back the same way, but >  `slides`  is **not a registered field**, so the backend **silently drops it on save** > (see [Why these persist](#why-these-persist-and-separate-top-level-fields-dont)) — > and tools that walk the shared dict (the block path map, the sanity checks, the > editor's reorder/drag) never see the region, because they look under >  `blocks\_layout`, never at a field named for the region. Renderers must read the > ordering from `blocks\_layout\[\<region>]`, not from `\<region>.items\`.

**Worked examples:** [Grid Block](../examples/grid/index.md) — one region of free children, narrowed by `allowedBlocks`; [Columns Block](../examples/columns.md) — a `columns` region whose children are themselves regions.

## Multiple regions

A container (or the page) can declare more than one **region** — each a schema property with its own `allowedBlocks`. The default region is `items`.

Storage is a property of **each region, not the container**: every region independently chooses `widget: 'blocks_layout'` or `widget: 'object_list'`, and a single container may **mix** them — e.g. a `blocks_layout` region for body content alongside an `object_list` region for a set of inline cards. A blocks\_layout region keys its ordering inside the shared `blocks_layout` dict (its children in the shared `blocks` dict); an object\_list region stores its items inline on its own field. So "is this container object\_list or blocks\_layout?" is never a meaningful question — you look at the region. Every blocks\_layout region's children still share the one `blocks` dict; the regions only partition *ordering*.

### Javascript

```javascript
// Schema definition — a page with a header, main content, and a footer
properties: {
    header: { widget: 'blocks_layout', title: 'Header', allowedBlocks: ['slate', 'image'], maxLength: 3 },
    items:  { widget: 'blocks_layout', allowedBlocks: ['slate', 'image'] },
    footer: { widget: 'blocks_layout', title: 'Footer', allowedBlocks: ['slate', 'link'] },
}

// Resulting data — ONE shared blocks dict, one list per blocks field
{
  "blocks": {
    "header-1": { "@type": "image" },
    "hero-1":   { "@type": "slate" },
    "footer-1": { "@type": "slate" }
  },
  "blocks_layout": {
    "header": ["header-1"],
    "items":  ["hero-1"],
    "footer": ["footer-1"]
  }
}
```

Each blocks field has its own `allowedBlocks` / `maxLength`. A declared field appears in the editor even when empty (it gets a seeded empty block so it is editable and a drop target).

**Worked example:** [Search Block](../examples/search.md) — facets in one region and results in another, on the same block.

### Why these persist (and separate top-level fields don't)

`blocks_layout` regions live as **keys inside the registered \`blocks\_layout\` dict** rather than as separate top-level fields (the older `header_blocks` / `footer_blocks` style) for one concrete reason: **persistence**.

The backend deserializer only saves values for **registered fields**. `blocks` and `blocks_layout` are registered behavior fields, so the entire `blocks_layout` dict — every list inside it — is stored verbatim. An ad-hoc top-level field like `footer_blocks` is **not** a registered field, so the backend **silently drops it on save**. (A footer might still appear on the live site if a layout template re-injects it on every load — but that footer is never actually persisted.) Keeping every region inside the registered `blocks_layout` dict makes them all persist for real.

## Restricting slate styles per region

A region can also declare which **slate styles** its text may carry — the same idea as `allowedBlocks`, one level down. Four optional keys, all lists of slate element `type` values:

### Javascript

```javascript
properties: {
    items: {
        widget: 'blocks_layout',
        allowedBlocks: ['slate', 'image'],
        allowedStyles: ['p', 'h2', 'h3', 'ul', 'ol', 'li', 'strong', 'em'],
        disallowedStyles: ['blockquote'],
        // Leaf marks, for plugins that use Editor.addMark. Rarely needed.
        allowedMarks: null,
        disallowedMarks: ['highlight'],
    },
}
```

`allowedStyles` names element types, which covers block-level formats (`p`, `h2`, `ul`, `li`) **and** inline ones — volto-slate models bold and italic as inline *elements* (`strong`, `em`, `del`, `sub`, `sup`, `u`, `code`), so one list matches what the toolbar actually toggles. `link` is structural rather than styling and is never restrictable: dropping it would lose an href.

### A design system's own styles

The style menu's entries are named by their CSS class with a **leading dot** — `.nsw-small`, the shape `getSlateVocabulary` reports them under, so a class called `p` cannot collide with the element type `p`:

### Javascript

```javascript
properties: {
    items: { widget: 'blocks_layout', disallowedStyles: ['.nsw-small'] },
    footer: { widget: 'blocks_layout' },   // still offers it
}
```

They need their own key because volto-slate does not retype the node for them: `toggleBlockStyleInSelection` writes `styleName: "nsw-small"` (space separated when several apply), beside a `type` that stays `p`. A disallowed one is **stripped** rather than retyped — the paragraph was always a paragraph, it was only wearing a style this region does not offer — and the style dropdown stops offering it, which is the surface an author applies it from.

Declaring nothing leaves every style available, so this changes nothing for a frontend that doesn't opt in.

### It applies everywhere, not just the toolbar

Hiding a toolbar button is cosmetic — the format still arrives by paste, by hotkey, or by a markdown shortcut. A declaration here is enforced at all of them: the block-format dropdown, `Ctrl+B`-style hotkeys, the `>`-space markdown shortcuts, paste (the pasted HTML is normalized before it becomes blocks), and the stored value itself, which is normalized when the editor loads the page. Anything the load pass would rewrite is also logged to the console, so a migration shows up while editing rather than as a surprise diff on the next save.

### There is no global level, and no per-field level

The page's own blocks fields — declared on the `_page` schema — are the outermost regions, so declaring there **is** the site-wide default. And every slate value belongs to a block, and every block to a region, so a region declaration already reaches a block's own slate fields (a teaser's `description`, a table cell) without a per-field key.

### Inheritance: deny accumulates, allow replaces

Rules fold from the outermost region inwards:

- **\`disallowedStyles\` accumulates.** A style banned at the page level stays

banned for everything nested inside it — a child region cannot re-enable it by   listing it in `allowedStyles`.

- **\`allowedStyles\` replaces.** A nested region restates the list for its own

subtree, and may deliberately widen it — an article region can allow `h4` even   when the page's default list stops at `h3`.

### What a disallowed style becomes

`config.settings.slate.styleAliases` maps a style to what it should become. It is a rename, not a permission — one global map, because a downgrade target has to be valid wherever the downgrade lands:

### Javascript

```javascript
config.settings.slate.styleAliases = { b: 'strong', i: 'em', blockquote: 'p' };
```

With no alias, a top-level node becomes `config.settings.slate.defaultBlockType` (`p`), and an inline one is unwrapped — its text stays, without the formatting. Nothing is ever deleted.

A downgrade never changes how many top-level nodes a slate field holds, because [a field always holds exactly one](./visual-editing.md#one-top-level-node-per-slate-field) and renderers are told they may assume it. So a denied *wrapper* collapses rather than splitting: denying `ul` turns `ul > li, li` into a single paragraph holding both items' content, not two paragraphs. Inline children survive the collapse — a `strong` inside a denied `blockquote` is still bold afterwards.

## object\_list: a region stored inline

The other storage choice for a region. Instead of ordering in the shared `blocks_layout` dict, all items share one inline schema and are stored as an array with an ID field, at the field itself. (To place the array deeper — e.g. `block.table.rows` — nest the field inside a `widget: 'object'`; see below.)

### Javascript

```javascript
// Schema
slides: {
    title: 'Slides',
    widget: 'object_list',
    idField: '@id',
    schema: {
        properties: {
            title: { title: 'Title' },
            image: { title: 'Image', widget: 'image' },
            description: { title: 'Description', widget: 'slate' },
        }
    }
}

// Resulting data — the array is stored at the field
{
  "@type": "slider",
  "slides": [
    { "@id": "slide-1", "title": "First", "image": "..." },
    { "@id": "slide-2", "title": "Second", "image": "..." }
  ]
}
```

**Worked examples:** [Accordion Block](../examples/accordion.md) — each panel an inline item holding its own region of child blocks; [Slider Block](../examples/slider.md) — slides as inline items with fields of their own.

## object\_list with allowedBlocks: Typed Items

When `allowedBlocks` is set on an `object_list`, items can have different types (like `blocks_layout`) but are still stored as an array. Each item's type is stored in the field specified by `typeField` (defaults to `'@type'`) and its schema is looked up from `blocks`:

### Javascript

```javascript
facets: {
    title: 'Facets',
    widget: 'object_list',
    allowedBlocks: ['checkboxFacet', 'selectFacet'],
    typeField: 'type',
    defaultBlockType: 'checkboxFacet',
}

// Resulting data
{
  "@type": "search",
  "facets": [
    { "@id": "facet-1", "type": "checkboxFacet",
      "title": "Content Type", "field": "portal_type" },
    { "@id": "facet-2", "type": "selectFacet",
      "title": "Subject", "field": "Subject" }
  ]
}
```

Both `blocks_layout` and `object_list` look the same in the editing UI and blocks can be dragged between them — data is automatically adapted when moving between formats (ID fields added/stripped, type fields set appropriately).

**Worked example:** [Form Block](../examples/form.md) — one item type per kind of field, chosen by `field_type`.

## widget: 'object': nesting fields (and containers) inside a block field

A `widget: 'object'` field groups sub-fields under one key. Its `schema.properties` are first-class — plain fields OR nested containers — and everything nests **inside** the object, exactly where the schema puts it. No `dataPath` indirection.

An **\`object\_list\`** inside an object stores its array at `object.<field>`:

### Javascript

```javascript
// A table block whose rows live at block.table.rows
table: {
    widget: 'object',
    schema: { properties: {
        rows: { widget: 'object_list', idField: 'key',
                schema: { properties: { cells: { widget: 'object_list', idField: 'key' /* … */ } } } },
    } },
}
// data
{ "@type": "slateTable", "table": { "rows": [ { "key": "r1", "cells": [ /* … */ ] } ] } }
```

A **\`blocks\_layout\`** inside an object makes the object its own mini-container: it holds its own `blocks` dict + `blocks_layout`, just like a columns/grid container block, one level deeper:

### Javascript

```javascript
table: { widget: 'object', schema: { properties: {
    body: { widget: 'blocks_layout' },
} } }
// data
{ "@type": "slateTable",
  "table": { "blocks": { "b1": { /* … */ } }, "blocks_layout": { "body": ["b1"] } } }
```

A **plain field** inside an object is edited in the canvas like any top-level field — address it inline with its `/`-path (`data-edit-text="content/headline"`, and the same for `data-edit-link` / `data-edit-media`). The object is *transparent*: `content/headline` writes back to `block.content.headline`, never a flat key. See [Field Path Syntax](./visual-editing.md#field-path-syntax) for the full grammar (`/` object descent, `..` = parent block, `/field` = page).

Blocks inside a nested container are edited in the canvas like any other container. The sidebar prefixes a nested container's **title** with the path (e.g. **Table / Rows**) so the nesting is visible.

This replaces `dataPath`: declare the container inside the object rather than hoisting it to the block's top level with a `dataPath` back-reference.

## Container schema reference

A block's schema is a standard [Volto block schema](https://6.docs.plone.org/volto/blocks/editcomponent.html) (fieldsets, `properties`, widgets, `default`, etc.). Inka reads three container-oriented `widget` values plus a few per-field keys — those are:

<block type="slateTable" table.fixed table.celled>

| `widget` | Storage | Key fields |
| --- | --- | --- |
| `blocks_layout` | children are ids in the parent's shared `blocks` dict; this field's name is a region key under `blocks_layout` | `allowedBlocks`, `maxLength`, `allowedTemplates`, `allowedStyles` / `disallowedStyles` / `allowedMarks` / `disallowedMarks` ([slate styles](#restricting-slate-styles-per-region)) |
| `object_list` | inline array on the field itself | `idField` (default `@id`), `schema` (item schema), `allowedBlocks` + `typeField` (typed items), `defaultBlockType`, `maxLength`, `addMode: 'table'` |
| `object` | groups sub-fields under one key; sub-fields (plain OR the two container widgets above) nest inside | `schema` (the nested properties) |

</block>

All three can nest inside `object`, and a container may mix a `blocks_layout` region and an `object_list` region. Everything else in a field def (`title`, `default`, `type`, `choices`, `mode`, …) is plain Volto and behaves as documented there.

## Rendering Containers in Your Frontend

Add `data-block-uid` to each child element. You don't need to mark the container element itself:

### Html

```html
<div class="slider" data-block-uid="slider-1">
  <div class="slide" data-block-uid="slide-1"
       data-block-add="right">
    <img src="/news.jpg"/>
    <h2>Big News</h2>
  </div>
  <div class="slide" data-block-uid="slide-2"
       data-block-add="right">
    ...
  </div>
  <a data-block-selector="-1">Prev</a>
  <a data-block-selector="+1">Next</a>
</div>
```

<block type="slate" data-json='{"value":[{"type":"ul","children":[{"type":"li","children":[{"type":"strong","children":[{"text":"`data-block-add=\"bottom|right\"`"}]},{"text":" — Controls where the &#39;+&#39; button appears. By default it will be the opposite of its parent. Use \"bottom\" for vertical stacking, \"right\" for horizontal."}]},{"type":"li","children":[{"type":"strong","children":[{"text":"`data-block-selector=\"+N|-N\"`"}]},{"text":" — the same directional selector as the carousel "},{"type":"code","children":[{"text":"+1"}]},{"text":" / "},{"type":"code","children":[{"text":"-1"}]},{"text":" below, generalised: "},{"type":"strong","children":[{"type":"code","children":[{"text":"N"}]},{"text":" tells how many of the next uids the next page shows"}]},{"text":" (so "},{"type":"code","children":[{"text":"+6"}]},{"text":" / "},{"type":"code","children":[{"text":"-6"}]},{"text":" for a grid that pages six at a time), which is how the bridge knows the control moves whole pages rather than one slide. Tag a paged container&#39;s next / previous controls with it so selecting a child from the sidebar can reach that child even when it is on another page. When the selected child is not in the DOM at all (it lives on a later page), the bridge finds the container, clicks the "},{"type":"code","children":[{"text":"+N"}]},{"text":" (or "},{"type":"code","children":[{"text":"-N"}]},{"text":") control, waits for the new page to render, and repeats until the child appears — so it also works for a dynamic container (a listing) whose page a given uid lands on isn&#39;t knowable ahead of time (the bridge just keeps clicking until the target renders, so "},{"type":"code","children":[{"text":"N"}]},{"text":" need not be exact). For this to work the container must actually "},{"type":"strong","children":[{"text":"render"}]},{"text":" its pager: a manual/static container computes its combined paging with the "},{"type":"code","children":[{"text":"staticBlocks"}]},{"text":" helper (which yields "},{"type":"code","children":[{"text":"totalPages"}]},{"text":" / "},{"type":"code","children":[{"text":"prev"}]},{"text":" / "},{"type":"code","children":[{"text":"next"}]},{"text":") just as a listing does, otherwise there is no control to tag or click. Add "},{"type":"code","children":[{"text":"data-linkable-allow"}]},{"text":" to a control that "},{"type":"strong","children":[{"text":"navigates itself"}]},{"text":" — the pager&#39;s own click handler changes the page — so "},{"type":"code","children":[{"text":"blockClickHandler"}]},{"text":" skips its normal block-selector handling and a real author click pages normally, while the bridge still synthesises a click to reveal. A carousel whose slides are all in the DOM and which the BRIDGE advances instead uses the "},{"type":"code","children":[{"text":"+1"}]},{"text":" / "},{"type":"code","children":[{"text":"-1"}]},{"text":" step without "},{"type":"code","children":[{"text":"data-linkable-allow"}]},{"text":"."},{"type":"blockquote","children":[{"type":"strong","children":[{"text":"Render every container&#39;s children the same way — always with paging."}]},{"text":" A renderer expands a region&#39;s children through two helpers that compose: "},{"type":"code","children":[{"text":"staticBlocks"}]},{"text":" windows the static (non-listing) children and "},{"type":"code","children":[{"text":"expandListingBlocks"}]},{"text":" fetches + windows the listing children. Both return "},{"type":"code","children":[{"text":"{ items, paging }"}]},{"text":", and you thread the running "},{"type":"code","children":[{"text":"seen"}]},{"text":" count from one call into the next ("},{"type":"code","children":[{"text":"seen"}]},{"text":" is "},{"type":"em","children":[{"text":"passed between"}]},{"text":" calls, not shared state) so a container that mixes static cards and a listing pages as ONE combined window. "},{"type":"strong","children":[{"text":"Paging is not conditional on a listing being present:"}]},{"text":" a plain grid of slate cards must page (and render a pager) exactly like a grid with a listing. Skipping "},{"type":"code","children":[{"text":"staticBlocks"}]},{"text":" for the \"no listing\" case — returning all children with no paging — is a bug: the container silently loses its pager, and a child on a later page then has no "},{"type":"code","children":[{"text":"data-block-selector=\"+N\""}]},{"text":" control for the bridge to reveal it through."}]}]},{"type":"li","children":[{"type":"strong","children":[{"text":"`data-block-selector=\"uid1 uid2 uid3 …\"`"}]},{"text":" — Space-separated list of uids this element should \"expose\" when any of them is selected from the admin. The bridge matches with the CSS word-list operator ("},{"type":"code","children":[{"text":"[data-block-selector~=...]"}]},{"text":"), so one trigger can cover many descendants. Use it on a disclosure trigger (collapsed details, accordion header, hidden tab panel button) so that picking any block within from the sidebar opens / scrolls / activates the enclosing container. For "},{"type":"code","children":[{"text":"<summary>"}]},{"text":" triggers the bridge sets "},{"type":"code","children":[{"text":"details.open = true"}]},{"text":" directly (idempotent — won&#39;t toggle an already-open disclosure); for everything else it "},{"type":"code","children":[{"text":".click()"}]},{"text":"s the trigger, skipping the click if "},{"type":"code","children":[{"text":"aria-expanded=\"true\""}]},{"text":". The contextNavigation "},{"type":"code","children":[{"text":"<summary>"}]},{"text":" and accordion panel buttons use this pattern; the carousel "},{"type":"code","children":[{"text":"+1"}]},{"text":" / "},{"type":"code","children":[{"text":"-1"}]},{"text":" / specific-slide-uid form above is a special case of the same attribute."}]}]}]}' />

The bridge resolves a **descendant** of a container that advertises itself: selecting a block nested below the handle walks up the block path map to the nearest ancestor that published one, so a container only has to name what it can reveal, not enumerate every block inside it. It also opens **outside in** — a handle that is itself inside a closed container is skipped until it can be reached, because clicking a hidden trigger opens its own container while the outer one stays shut. Enumerating uids is still worth doing for anything the path map cannot know, such as items a listing synthesises at render time.

- **\`data-block-selector="uid#fieldName"\`** — a handle that reveals **where one FIELD of that block is edited**, rather than the block as a whole. Use it when a block is drawn in several places at once with a different field in each, and each place has its own trigger. The design system cookie-consent block is the case it was written for: its `message` is rendered into a banner and its category wording into a preferences dialog, both built by the component's own JavaScript into `<body>`, both hidden until their trigger is pressed — while the block's element (an editing bar) is on screen the whole time. A block-level handle is one handle and one click, so whichever half it opened, the other half's wording stayed unreachable from the sidebar. `#` is used because `:` already means navigation (`uid:direction`). Everything except *which handle to click* treats `uid#field` exactly like `uid`: a `data-edit-*` inside such a handle still edits that block — which is why the place a field is edited usually carries the handle **too**, not just the trigger that opens it. Several elements may name the same field; the bridge clicks the first one that is **on screen**, so a hidden half is never the thing it tries to click.

A worked example, with the schema, the data and all four frontends: [Cookie Consent Block](../examples/cookie-consent.md).

The reveal is driven from the sidebar, through the message that already existed for it: when the cursor lands in a sidebar field the admin sends `FOCUS_FIELD { blockId, fieldName, moveCaret: false }`. The bridge shows that field's place if it is hidden, and does nothing at all unless a `uid#field` handle advertises that exact field — so it is safe to send on every focus. There is deliberately **no fallback to the block's own handle**: most sidebar fields (an alignment, a link, any setting) have no element on the canvas and never will, so "no element" is the ordinary case rather than a hidden one, and falling back meant every sidebar focus clicked whatever handle the block or its ancestors published. A field's place, when it has none of its own, simply IS the block's — and selecting the block already reveals that, transitively. `moveCaret` defaults to **true** — the original meaning, "reveal it and put the cursor in it", which is what the admin sends when handing editing back (a LinkEditor closing). One message, two intents; not two messages.

- **A form control as the handle — revealed by answering it.** A block that appears only when another question is answered — a form's conditional question, a search's answer — is revealed by giving that answer, so the handle goes on the control that gives it, and the bridge acts on it by what it is rather than clicking. An **`<option>`** is selected in its dropdown (and `input`/`change` fired on the `<select>`); an option has no box of its own, so it counts as on screen whenever its `<select>` is. A **checkbox or radio** is ticked — and one that is already ticked is left alone, because clicking a checkbox would untick it. A **text box** has no answer of its own, so it declares one: `data-block-selector-input="…"` is the value the bridge types in. A handle declaring a value is a field to fill, not a trigger, so a button beside it carrying the same uid stays the thing that is clicked. After filling, the bridge checks whether the block is now on screen: if it is — a conditional question appears the moment its question is answered — that is the reveal, and nothing is submitted. Only when filling alone did not reveal it, and there is no button to click, does the bridge submit the form: that is a search, whose answer arrives with the results.

Each option is its own element, so one question can reveal a different block for each answer — put the handle on each `<option>` or radio, naming the blocks that answer unlocks:

### Html

```html
<select name="topic">
  <option value="billing" data-block-selector="billing-address">Billing</option>
  <option value="other" data-block-selector="other-details">Other</option>
</select>
<input name="name" data-block-selector="name-chosen" data-block-selector-input="Ada">
```

- **A block drawn in two places** — put `data-block-uid` on the **content**, and `data-block-selector` on the trigger. A tab is the clearest case: its label lives on the button in the tab bar, its code in a panel that is hidden (or not rendered at all) unless that tab is active. If the button carried the uid, the bridge would see a visible element and conclude the block is on screen, so selecting an inactive tab from the sidebar would never reveal the code the author wants to edit. With the uid on the panel, the ordinary visibility check does the right thing, and `data-block-selector` on the button both reveals the tab and tells the bridge that a `data-edit-*` inside it edits *that* block, even though the uid element is elsewhere. Applies to any control that stands in for content it can show — tab buttons, thumbnail strips, step indicators.

## Table Mode

Set `addMode: 'table'` for table-like structures (rows containing cells). This lets users add and remove columns as easily as rows. The rows live inside a `table` object field (`block.table.rows`) — no `dataPath`:

### Javascript

```javascript
table: {
    widget: 'object',
    schema: { properties: {
        rows: {
            widget: 'object_list',
            idField: 'key',
            addMode: 'table',
            schema: { properties: {
                cells: {
                    widget: 'object_list',
                    idField: 'key',
                    schema: { properties: {
                        value: { title: 'Content', widget: 'slate' },
                    } },
                },
            } },
        },
    } },
}
```

**Worked example:** [Table Block](../examples/table.md) — `addMode: "table"` with an `idField`, so every row has the same cells.

## Empty Blocks

A container region can never be truly empty. When its last child is deleted, Inka fills it back in — but *what* it inserts depends on the region's config:

- If the region has a **\`defaultBlockType\`**, that type is added.
- If the region allows exactly **one** `allowedBlocks` type, that type is added.
- Only when the region has **no \`defaultBlockType\` and more than one \`allowedBlocks\`** is the choice ambiguous — so Inka inserts a placeholder child with `@type: "empty"` and shows a '+' for the user to pick a type in place.

So the simplest way to never deal with empty placeholders in a region is to give it a `defaultBlockType` (or a single-entry `allowedBlocks`). Otherwise your frontend must render `empty`.

Empty blocks are stripped before saving. Render them as empty space; Inka puts a '+' button in the middle for the user to pick a real type in place. You can override the look of that '+' by rendering something inside the empty block and adding `data-block-add="button"` to it.

### Making a region empty by default — `defaultBlockType: "empty"`

The rules above mean a region with a `defaultBlockType`, or a single-entry `allowedBlocks`, is *never* empty — it always seeds a block of that type. To declare a region that should sit **empty until an editor adds something**, while still restricting **what** they can add, set **\`defaultBlockType: "empty"\`** and do **not** list `"empty"` in `allowedBlocks`:

### Javascript

```javascript
announcement: {
    widget: 'blocks_layout',
    allowedLayouts: ['/templates/site-announcement'],
    allowedBlocks: ['globalAlert'], // the only thing an editor can add
    defaultBlockType: 'empty',      // ...but empty by default (no band shown)
}
```

This is the one case where `"empty"` is a **configured** default rather than the fallback Inka inserts for an ambiguous region. The seed and the add diverge on purpose:

- **Passive seed** (region loaded, or its last child deleted): Inka seeds a bare

`@type: "empty"` placeholder — nothing renders. `defaultBlockType` wins over the   single-`allowedBlocks` auto-fill, so the region genuinely shows empty.

- **The '+' (active add / fill)**: inserts a real block from `allowedBlocks`

(converting the empty placeholder **in place**), never another `empty`. The add   path reads `allowedBlocks`, not `defaultBlockType` — so a single-entry   `allowedBlocks` fills straight to that type with no chooser.

- **\`"empty"\` is never in \`allowedBlocks\`** — it isn't a type an editor opts into;

it's the "region is empty" state. On save the placeholder is stripped, so a   genuinely-empty region persists with no blocks.

Use this for optional site chrome — e.g. a header announcement that is usually absent but can hold a single global alert when needed. (Because the seed is `"empty"`, the frontend must render `empty` as a selectable slot — see below.)

**Forced regions are locked until unlocked.** When the region is a **forced layout** (`allowedLayouts`), it is template-controlled — its content lives in the shared template and is edited *centrally*, like a branded footer. So the seeded empty is stamped as a **locked template member** (`readOnly`, with the forced layout's `templateId`/`templateInstanceId`): it shows empty, but you cannot fill it until you **unlock** the template (enter template-edit-mode). This prevents an editor from silently filling it per-page — the announcement stays site-wide. Filling then happens in template-edit-mode and locking publishes it everywhere. (This stamping happens in the editor's empty-seeding — `ensureEmptyBlockIfEmpty` — so **view-mode merging still leaves an empty forced layout empty**; no empty is ever inserted at render time.)

### `empty` is a universal placeholder — renderers must tolerate it

In a no-default, multi-allowed region, `@type: "empty"` can appear in **any** container — including transiently, the moment a child is deleted and before the user picks a replacement. You never list `"empty"` in `allowedBlocks`; it isn't a type you opt into. So every container renderer has to render an `empty` child without erroring.

If your container renders its children by delegating each one to your central block dispatch (the function or component that switches on `@type`), you get this for free — just give that dispatch an `empty` case that renders a selectable placeholder.

The trap is a **custom** container renderer that only expects specific child types — a `contextNavigation` that walks `navItem`/`listing` children, say. Don't hand-roll an allow-list that rejects anything else, or a seeded `empty` will throw and break the whole container. Route non-special children through your central dispatch instead of throwing:

### Javascript

```javascript
for (const childId of items) {
    const child = blocks[childId];
    if (child['@type'] === 'navItem') { /* nav-specific rendering */ }
    else if (child['@type'] === 'listing') { /* expand listing */ }
    else renderBlock(childId, child);   // empty (or anything else) → central dispatch, never throw
}
```

Two more things a renderer must survive once the user picks a type for a seeded empty:

- **Re-render on the type change.** The child's `@type` flips from `empty` to the picked type in place (same `data-block-uid`). If your renderer memoises or does its work once (e.g. an async setup), make sure it re-runs when a child's type changes — otherwise it keeps showing the stale `empty`.
- **Tolerate a freshly-typed child with no data yet.** A just-picked `navItem` has no `href`; a just-picked form field has no value — render a placeholder, don't crash on the missing field.

## Synchronised Block Types in a Container

You can have one container type whose children are all kept the same `@type`, with the editor picking that type once on the parent. When the type changes, every child is converted (using each child's `fieldMappings`); when a new child is added it gets the selected type.

Declare `itemTypeField` on the *blocks field* — its value names a sibling field on the same schema whose value drives every child's `@type`. The sibling field is typically rendered with `widget: 'blockTypeSelect'`, which computes its `choices` from the blocks field's `allowedBlocks` at render time:

### Javascript

```javascript
blocks: {
    gridBlock: {
        blockSchema: {
            properties: {
                slides: {
                    widget: 'blocks_layout',
                    itemTypeField: 'variation',         // sync trigger
                    allowedBlocks: ['teaser', 'image'],
                },
                variation: {
                    widget: 'blockTypeSelect',          // dropdown
                },
            },
        },
    },
    teaser: {
        fieldMappings: {
            '@default': { '@id': 'href', 'title': 'title', 'image': 'preview_image' },
        },
    },
    image: {
        fieldMappings: {
            '@default': { '@id': 'href', 'title': 'alt', 'image': 'url' },
        },
    },
}
```

The relationship is local: read the schema and you can see "the children of `slides` get their `@type` from `variation`" right next to the field declaration. Works the same for `widget: 'blocks_layout'` and `widget: 'object_list'` children.

### Field-value syncing

On top of type syncing you can also have field \_values\_ centrally controlled at the parent — set once on the parent, applied to every child. Add ONE enhancer on the parent:

### Javascript

```javascript
gridBlock: {
    blockSchema: {
        properties: {
            slides: { widget: 'blocks_layout', itemTypeField: 'variation', allowedBlocks: ['teaser', 'image'] },
            variation: { widget: 'blockTypeSelect' },
        },
    },
    schemaEnhancer: { inheritSchemaFrom: {} },
}
```

`inheritSchemaFrom` does two things automatically:

1. Surfaces the **parent-claimed** fields on the parent's sidebar under an "Item Defaults" fieldset.
2. Auto-hides the same fields on every child's sidebar (via a `hideParentOwnedFields` enhancer that's applied to every block at INIT — no per-child opt-in).

The parent declares **what it claims** per child block type via `parentControlled`. If absent, the default is: parent claims everything \_not\_ listed in the child's `fieldMappings['@default']` mapping. The default works for typical cases; set `parentControlled` only when you want a different split (e.g. keep a meta-toggle field editable per-child):

### Javascript

```javascript
listing: {
    schemaEnhancer: {
        inheritSchemaFrom: {
            typeField: 'variation',
            mappingField: 'fieldMapping',
            // Only these fields are claimed by listing for teaser children.
            // The rest (including teaser's `overwrite` toggle) stay editable.
            parentControlled: {
                teaser: ['head_title', 'openLinkInNewTab', 'styles'],
            },
        },
    },
}
```

When `parentControlled[childType]` is set, it **replaces** the `@default` fallback for that child type. Both sides — the parent's "Item Defaults" fieldset and the child's hidden fields — are computed from the same single rule, so they can never get out of sync.

### Recipe options

- **\`inheritSchemaFrom\`** — schemaEnhancer recipe; surfaces parent-claimed fields on the parent and hides them on children.
- **\`itemTypeField\`** — declared on a `blocks_layout`/`object_list` field; names the sibling field whose value drives every child's `@type`.
- **\`typeField\`** — names the sibling field directly on `inheritSchemaFrom`. Use this when there is no blocks field to declare `itemTypeField` on (e.g. listings — see [Listings](./listings.md)).
- **\`mappingField\`** — name of the field where a per-block `fieldMapping` override is stored. Required for the `FieldMappingWidget` to appear.
- **\`parentControlled\`** — `{ childType: [fieldName, ...] }` per-child-type override. Replaces the `fieldMappings['@default']` fallback.
- **\`defaultsField\`** — prefix for the inherited fields on the parent's "Item Defaults" fieldset (default: `'itemDefaults'`).
- **\`blockTypeSelect\`** widget options:

\- **\`blocksField\`** — which sub-blocks field's `allowedBlocks` to use for the choices. Auto-discovers if omitted. Set to `'..'` when the choices should come from the *enclosing parent's* `allowedSiblingTypes`.   - **\`filterConvertibleFrom\`** — only offer types whose `fieldMappings` accept the named source. Typically `'@default'` for listings (every item type must be populatable from canonical content fields).
