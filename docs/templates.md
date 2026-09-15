---
"@type": Document
UID: docs-templates-001
allow_discussion: false
contributors: []
creators:
  - admin
description: Templates allow editors to centrally control content and reuse
  content. They allow a developer to not have to hard code layout decisions and
  instead use rules to apply user layouts in template content stored separately
  from the page, or give the user a choice on which layout they want.
effective: 2025-01-01T00:00:00
exclude_from_nav: false
expires: null
id: templates
is_folderish: false
language: "##DEFAULT##"
layout: document_view
preview_caption: null
preview_image: null
review_state: published
rights: ""
subjects:
  - templates
title: Templates & Layouts
blocks-matched: |
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
  <block type="callout">
    <region name="items" widget="blocks_layout">
      <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
    </region>
  </block>
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

# Templates & Layouts

Templates allow editors to centrally control content and reuse content. They allow a developer to not have to hard code layout decisions and instead use rules to apply user layouts in template content stored separately from the page, or give the user a choice on which layout they want.

<block type="separator" />

## Template Concepts

Templates:

- Can be created from any blocks
- Are always edited in-context in the current page (user can switch in and out of template edit mode)
- Are saved alongside the page into normal content so editing template permissions can use content permissions
- `allowedTemplates` and `allowedLayouts` applied to the blocks schema let the developer control loading templates: which templates are available for use, which are automatically applied as layouts, and which the editor can switch between
- During rendering, the frontend can use the provided helper (`expandTemplates` / `expandTemplatesSync`) to refresh templates found in the page content from the template content, and apply layouts based on rules (such as forcing a layout based on content type or metadata). Alternatively the frontend can write its own merge logic.

Templates are analogous to blocks themselves but are made up of blocks with special properties. Each block in a template can be one of:

- **Fixed + ReadOnly** — can't be edited or moved (e.g. branded headers/footers). Similar to fixed hard-coded HTML in a block.
- **Fixed** — can be edited but not moved (e.g. required sections). Similar to a block field.
- **Slot** (`fixed: false` / unset) — a named region (`slotId`) where editors can add their own blocks. Similar to a block field. The `"default"` slot receives leftover content.

The slot a block lives in is identified by its `slotId`. This is the field name used by `expandTemplates` / `expandTemplatesSync` and by the merge rules below — not `placeholder`.

### Json

```json
{
  "blocks": {
    "header": { "@type": "slate", "fixed": true,
               "readOnly": true, "slotId": "header" },
    "content": { "@type": "slate", "slotId": "default" },
    "footer": { "@type": "slate", "fixed": true,
               "readOnly": true, "slotId": "footer" }
  }
}
```

<block type="callout" variation="important">

**Every block in a template must declare a `slotId`** — not just slot blocks, but **`fixed` and `fixed+readOnly` blocks too, and every block *nested* inside a container.** The recursive merge keeps a nested block only when it has a `slotId` (or a `templateId`): `if (nested.slotId || nested.templateId)`. A block without one is **silently dropped** — the container survives but renders empty, with no error. This is the most common reason a template "half renders".

</block>

## Editing a template (central control)

The point of a template is that its locked parts are authored **once** and update **everywhere**. Templates are stored as their own normal content documents; a page only *references* one — its blocks carry the `templateId`. On render the merge injects the template's `fixed` / `fixed+readOnly` blocks and fills the slots with the page's own content.

To change a template for every page that uses it:

1. On a page using the template, toggle **template edit mode** (the `editTemplate`

control on the block).

1. Edit the `fixed` / `fixed+readOnly` blocks — in template edit mode these become

editable; normally they're locked.

1. Save. The edits are written **back into the template document**, so every page that

uses that template shows the change on its next render.

What propagates and what doesn't:

- **\`fixed\` / \`fixed+readOnly\` blocks edited in template edit mode** → propagate to all

pages using the template (template-controlled).

- **Slot content** (blocks editors add into a slot) is **per-page** — it lives on the page

and is never written back to the template.

- Editing a `fixed` block's content in *normal* mode overrides it for **that page only**;

the template's version stays the default for other pages.

**Reusing a template multiple times:** a page may apply the same template more than once (e.g. two of the same layout or snippet). Each use is a distinct *instance*; the merge gives every instance its own block ids, so they never collide.

## Which mechanism for which use case?

The two configurations below look similar but solve different problems. Pick by **who controls the structure** and **whether it repeats**:

<block type="slateTable" table.fixed table.celled>

| You want… | Use | How it's applied |
| --- | --- | --- |
| A reusable snippet the editor **inserts** where they choose — e.g. a contact CTA reused across many pages | **\`allowedTemplates\`** | Offered in the BlockChooser's "Templates" group and inserted **as a block** (the block carries `templateId`). |
| A layout **forced across an entire field/region** — a branded header/footer, or a mandated page structure | **\`allowedLayouts\`** | Applied across the whole blocks field; the field's content is merged into the layout's slots. The editor can't restructure it. |
| To let the editor **choose** between a few layouts | **\`allowedLayouts\`** (several, optionally `null`) | Offered in the Layout dropdown; `null` = "no layout". |

</block>

A **branded header/footer is the canonical \`allowedLayouts\` case**, *not* `allowedTemplates`: don't make the footer a `templateId` block the editor inserts — force a layout across the footer field. Within that layout, each block declares how locked it is:

- **\`fixed: true, readOnly: true\`** — can't be edited or moved (logo, branded chrome).
- **\`fixed: true\`** — content-editable but not movable (a required section).
- **slot** (`fixed` unset, with `slotId`) — a region where editors add their own blocks; the `"default"` slot receives leftover content.

For a fully-fixed branded footer, leave the blocks **field empty** (`{items: []}`) and let the layout content item supply everything — then editing the layout updates every page.

### Block structure inside a template (read this before debugging an empty merge)

**Nested containers are fully supported** (e.g. a branded footer built as a `columns` block). The merge recurses into any field whose `.items` array lists the block's nested block IDs — a `blocks_layout`-widget field of **any name** (a `columns` block's `columns` field counts). Two rules for nested content:

- Pair every nested `blocks` map with such a sibling layout field (or the merge throws "no sibling field whose `.items` array lists those block IDs").
- Give **every** block a `slotId` — the container, each column, and each block inside each column. A unique id per block (e.g. the block's own uid) works.

So a branded footer is, end to end: a `columns` block (`slotId`, `fixed`, `readOnly`) → each `column` (`slotId`, `fixed`, `readOnly`) → each leaf block (`slotId`, `fixed`, `readOnly`).

### object\_list containers (sliders, tables)

A container lays out its children one of two ways, and the merge treats **both the same** — as an ordered region of child blocks:

- **\`blocks\_layout\`** (columns, grid): children live in the block's shared `blocks` map,

ordered by a `blocks_layout` region (as above).

- **\`object\_list\`** (a slider's slides, a table's rows): children are an **inline array**

of block objects, each identified by an **id field** (`@id` by default).

Everything else is identical: every object\_list item still needs a `slotId` (plus `templateId` / `fixed` / `readOnly` as appropriate), and a slot item fills from the page's content just like a `blocks_layout` slot.

The merge identifies object\_list items by their **id field**, and it varies per field — a form's `subblocks` key on `field_id`, a slider's `slides` on `@id`, a table's `rows` on `key`. A frontend has no schema, so whenever you expand a template or layout that contains an object\_list container you MUST tell the merge each field's id field via an **\`idFieldMap\`** (`{ blockType: { field: idField } }`). Without it the merge falls back to `@id` — and for a `field_id`-keyed field that mints a broken id and the item is dropped on the next merge.

### Javascript

```javascript
const items = expandTemplatesSync(layout, {
    blocks, templateState, templates,
    idFieldMap: {
        form: { subblocks: 'field_id' }, // a form's fields key on field_id, not @id
        slider: { slides: '@id' },
    },
});
```

(On the admin this map is derived from the block schema automatically. When you re-enter to expand a **single** object\_list array on its own, the `idField` shorthand is enough: `expandTemplatesSync(block.slides, { templateState, templates, idField: '@id' })`.)

## allowedTemplates vs allowedLayouts

Configure templates in `page.schema.properties` on the blocks field:

### Javascript

```javascript
initBridge({
    page: {
        schema: {
            properties: {
                blocks_layout: {
                    allowedTemplates: ['/templates/form-snippet'],
                    allowedLayouts: ['/templates/article-layout'],
                },
            },
        },
    },
});
```

- **\`allowedTemplates\`** — Templates shown in the BlockChooser's "Templates" group, inserted as blocks.
- **\`allowedLayouts\`** — Templates shown in the Layout dropdown. They replace/merge the entire container content. A value of `null` allows for a no-template option. If none of those templates are already set as the layout then during editing, the first is applied automatically.

## Applying Merge Rules

Use `expandTemplates` (async) or `expandTemplatesSync` (sync with pre-fetched templates) to merge template content during rendering.

- **Edit Mode**: These functions auto-detect edit mode via `isEditMode()` and pass blocks through unchanged (just adding `@uid`). The admin handles template merging and adds `nodeId` attributes for inline editing.
- **SSR**: On SSR (no window), `isEditMode()` returns false so templates are expanded — this is correct since edit mode only exists in the browser iframe.

**Sync vs Async**:

- **\`expandTemplatesSync\`** — Use when templates are pre-fetched at page load. Better for Vue computed properties since it's synchronous.
- **\`expandTemplates\`** — Use when you need to lazy-load templates on demand. Handles on-demand loading of forced layouts not in page data.

<block type="callout" variation="important">

**A forced layout (`allowedLayouts`) under `expandTemplatesSync` must be pre-loaded.** It isn't referenced from page data, so `loadTemplates` won't auto-scan it. The async `expandTemplates` fetches it on demand, but the **sync** `expandTemplatesSync` (recommended for SSR / Vue computed) needs it already in `templates` — pass its id explicitly: `loadTemplates(data, loadTemplate, cache, ['/templates/footer-layout'])`. Otherwise you'll hit `Template "…" not found in pre-loaded templates`.

</block>

## Pre-loading with loadTemplates

**\`loadTemplates(data, loadTemplate)\`** scans page data for `templateId` references and loads them all in parallel. It follows nested references (templates referencing other templates) and has a 5s per-template timeout. It only loads templates actually in the page data — `allowedLayouts` options are loaded on demand when a forced layout is applied.

### Javascript

```javascript
import { loadTemplates, expandTemplatesSync, expandTemplates }
    from '@hydra-js/hydra.js';

const loadTemplate = async (id) =>
    fetch(`${apiBase}${id}`).then(r => r.json());

// Create the shared state ONCE per page render. Every expand call (top-level AND
// every nested container / object_list re-entry) must reuse this SAME object.
// Never reset or recreate it mid-render.
const templateState = {};

// Sync approach: pre-fetch templates, use in computed properties
const templates = await loadTemplates(pageData, loadTemplate);
const items = expandTemplatesSync(layout, {
    blocks, templateState, templates,
});

// Async approach: load templates on demand — reuse the SAME templateState
const items = await expandTemplates(layout, {
    blocks,
    templateState,
    loadTemplate: async (id) => fetch(id).then(r => r.json()),
});

// Render items - each has @uid for the block ID
for (const item of items) {
    renderBlock(item['@uid'], item);
}
```

Options:

- **\`blocks\`**: Map of blockId -> block data
- **\`templateState\`**: Create a fresh `{}` **once per page render** and share it across **every** `expandTemplatesSync`/`expandTemplates` call — top-level and every nested container / object\_list re-entry. It records the template instances minted this render so a re-entry is recognized as already-expanded content and passed through. **Never reset or recreate it mid-render** (e.g. don't `templateState = {}` again before rendering, and don't pass a fresh `{}` per call): wiping it drops the minted instances, so re-entries re-apply the template instead of passing through — infinite recursion / blank page. Recognition is **data-derived** (by `templateInstanceId`), so it is safe to hand blocks back as a Vue reactive value, a clone, or a `postMessage` copy — no `toRaw` needed. (In Vue/React, provide it once at the page root via provide/inject or context; see `examples/nuxt-blog-starter` and `examples/hydra-nextjs`.)
- **\`templates\`**: (sync only) Pre-fetched map of templateId -> template data
- **\`loadTemplate(id)\`**: (async only) Function to fetch template content
- **\`allowedLayouts\`**: Force a layout when container has no template applied

## How the Merge Works

The merge algorithm follows these rules:

1. Remove the blocks with the `templateId` to replace, storing any that aren't fixed and readOnly by `slotId`.
2. Insert in their place the template content: if fixed and readOnly, just insert it; if fixed, copy block content (not including block fields) from a page block with the same `slotId`; if a slot block, don't insert it, but insert the previous blocks with the same `slotId`.
3. Recursively replace any block fields using the same rules.
4. Any slot blocks left over are inserted at the end of a special slot called `"default"` if it exists, otherwise are dropped.

When a layout is applied, the rules are the same but applied across a whole blocks field. Content without a `slotId` ends up:

- In the `"default"` slot if it exists
- In the bottom slot outside the last fixed template block
- In the top slot outside the first fixed template block
- Otherwise it is dropped

### Diagram

```bash
Before:  [User Block A] [User Block B]
Layout:  [Fixed Header] [default] [Fixed Footer] [post_footer]
After:   [Fixed Header] [User Block A] [User Block B] [Fixed Footer]
```

## Forcing Layouts

A **forced layout** (`allowedLayouts`) is applied **automatically across a whole blocks field** — unlike a **snippet** (`allowedTemplates`), which the *editor* inserts as a block where they choose (see the decision table above). Forcing is **your frontend's** call: you pass `allowedLayouts`, so you decide **which** layout to force and **when**.

Pass a static layout to always force one (e.g. a footer):

### Javascript

```javascript
// Sync (with pre-fetched templates)
const items = expandTemplatesSync(layout, {
    blocks, templateState, templates,
    allowedLayouts: ['/templates/footer-layout'],
});

// Async — reuse the SAME shared templateState, never a fresh {}
const items = await expandTemplates(layout, {
    blocks, templateState, loadTemplate,
    allowedLayouts: ['/templates/footer-layout'],
});
```

### Choosing the layout with your own rules

`allowedLayouts` is just a value you compute, so apply whatever rule you like — content type, metadata, route, A/B bucket — then pass the result. Pass `undefined` (or omit it) to force nothing; pass **several** to let the editor pick from the Layout dropdown (include `null` for a "no layout" option).

### Javascript

```javascript
// Decide the forced layout from your own rules; force nothing when none match.
const forced =
    pageData['@type'] === 'News Item' ? '/templates/news-layout' :
    pageData.section === 'marketing' ? '/templates/campaign-layout' :
    null;

// Async loads the chosen layout on demand (the sync path needs it pre-loaded — see
// "Pre-loading with loadTemplates" above).
const items = await expandTemplates(layout, {
    blocks, templateState, loadTemplate,
    allowedLayouts: forced ? [forced] : undefined,
});
```

Note: during editing the admin side will load the templates so in order to apply the same rules of forcing a layout you will need to set `allowedLayouts` in `page.schema.properties` to ensure the page loads with the right template.
