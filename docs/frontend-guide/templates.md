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
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em,a/slate}" plaintext="${p,h*,ul,ol,blockquote,strong,em,a/text}" />
  <block type="title" _="${h1}" />
  <block type="separator" _="${hr}" styles={"align":"full"} />
  <block type="codeExample">
    <region name="tabs" widget="object_list" idField="@id" typeField="@type">
      <block type="tab" label="${h3/text}" language="${pre/lang}" code="${pre/textarea}" />
    </region>
  </block>
blocks-tagged: |
  <block type="callout">
    <region name="items" widget="blocks_layout">
      <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em,a/slate}" plaintext="${p,h*,ul,ol,blockquote,strong,em,a/text}" />
    </region>
  </block>
  <block type="slateTable">
    <region name="table.rows" idField="key">
      <block type="row" _="${tr}">
        <region name="cells" idField="key" typeField="type">
          <block type="header" value="${th/slate}" />
          <block type="data" value="${td/slate}" />
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

**Every block in a template must declare a `slotId`** — not just slot blocks, but **`fixed` and `fixed+readOnly` blocks too, and every block *nested* inside a container.** The recursive merge keeps a nested block only when it has a `slotId` (or a `templateId`): `if (nested.slotId || nested.templateId)`. A block without one is **silently dropped** — the container survives but renders empty, with no error. This is the most common reason a template "half renders". The editor keeps this true for blocks an author places: an added, pasted or moved block, and everything nested in it, takes its slot from where it lands — one rule, described in [Template membership](../architecture.md#template-membership-edit-side-slot-assignment).

</block>

## A template is the id it was referenced by

A template's identity comes from where it was loaded from, never from data stored inside it. A definition **need not name itself**: its blocks can carry just `slotId`, `fixed` and `readOnly`, with no `templateId`, because where the document lives already says what it is. Pages that use a template still name it in their blocks' `templateId`.

When a page's template is loaded under an id (a path, a URL or a `resolveuid`), Inka gives the template's own blocks that id (`adoptTemplate`). So a template keeps working when it is moved, renamed, or served under a different prefix, and a definition that does name itself is relabelled with the id the page used, whatever its label says. Blocks that name a *different* template are nested templates and keep their own id.

A template either names itself or it doesn't. In one that does, an unlabelled nested block is still malformed and is dropped. In one that doesn't, every block with a `slotId` belongs to it.

Opened for editing, a document whose top-level blocks hold slots but name no template is a definition: it comes up as itself, with the unlock toggle, like one that names itself. Saving it from the editor stores its path on those blocks, which stays valid if it moves.

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

- **\`fixed+readOnly\` blocks edited in template edit mode** → propagate to all

pages using the template (template-controlled).

- **Slot content** (blocks editors add into a slot) is **per-page** — it lives on the page

and is never written back to the template.

- An editable `fixed` block's content is the page's: editing it changes **that page only**,

in either mode. The template's version stays the default for other pages (see How the Merge Works).

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

### object_list containers (sliders, tables)

A container lays out its children one of two ways, and the merge treats **both the same** — as an ordered region of child blocks:

- **\`blocks_layout\`** (columns, grid): children live in the block's shared `blocks` map,

ordered by a `blocks_layout` region (as above).

- **\`object_list\`** (a slider's slides, a table's rows): children are an **inline array**

of block objects, each identified by an **id field** (`@id` by default).

Everything else is identical: every object_list item still needs a `slotId` (plus `templateId` / `fixed` / `readOnly` as appropriate), and a slot item fills from the page's content just like a `blocks_layout` slot.

The merge identifies object_list items by their **id field**, and it varies per field — a form's `subblocks` key on `field_id`, a slider's `slides` on `@id`, a table's `rows` on `key`. The merge doesn't read block schemas, so whenever you expand a template or layout that contains an object_list container you MUST tell it each field's id field via an **\`idFieldMap\`** (`{ blockType: { field: idField } }`). Build it from the same blocks config you pass to `initBridge` with `buildIdFieldMap`, exactly as the admin does, rather than writing it by hand. Without it the merge falls back to `@id` — and for a `field_id`-keyed field that mints a broken id and the item is dropped on the next merge.

### Javascript

```javascript
import { buildIdFieldMap } from '@hydra-js/hydra.js';

// Once, from your block definitions: { form: { subblocks: 'field_id' }, slider: { slides: '@id' }, … }
const idFieldMap = buildIdFieldMap(blocksConfig);

const items = expandTemplatesSync(layout, {
    blocks, templateState, templates, idFieldMap,
});
```

(When you re-enter to expand a **single** object_list array on its own, the `idField` shorthand is enough: `expandTemplatesSync(block.slides, { templateState, templates, idField: '@id' })`.)

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

**A forced layout (`allowedLayouts`) under `expandTemplatesSync` must be pre-loaded.** It isn't referenced from page data, so `loadTemplates` won't auto-scan it. The async `expandTemplates` fetches it on demand, but the **sync** `expandTemplatesSync` (recommended for SSR / Vue computed) needs it already in `templates` — pass its id explicitly: `loadTemplates(data, loadTemplate, cache, ['/templates/footer-layout'])`. Otherwise you'll hit `Template "…" not found in pre-loaded templates`. With the backend addon, also name it in `expand.templates.extra` so it arrives with the page (see "Fetching templates with the page" below).

</block>

## Expand every container

**Pass the children of every container through the merge** — every `blocks_layout` region and every object_list field, in every container block you render, at every depth — with the same `templateState` the page-level call used.

An editor can place a template anywhere a block can go: inside a grid, a column, an accordion panel, a slider. The merge has no block schema, so it cannot find your containers by itself. It fills the regions of a template it applies, but a template placed inside a plain container stays exactly as stored — stale fixed content, no instance — until that container hands its children to the merge. A container that renders its children directly is a place where templates silently don't work.

The page-level call is no exception: each of the page's own blocks fields (`items`, a `footer` region, …) goes through the merge too.

The Inka editor follows the same contract for the page it edits (see [Merging templates](../architecture.md#merging-templates-every-container-is-expanded-by-whoever-renders)).

## Pre-loading with loadTemplates

**\`loadTemplates(data, loadTemplate)\`** scans page data for `templateId` references and loads them all in parallel. It follows nested references (templates referencing other templates) and has a 5s per-template timeout. It only loads templates actually in the page data — `allowedLayouts` options are loaded on demand when a forced layout is applied.

### Javascript

```javascript
import { loadTemplates, expandTemplatesSync, expandTemplates }
    from '@hydra-js/helpers';

const loadTemplate = async (id) =>
    fetch(`${apiBase}${id}`).then(r => r.json());

// Create the shared state ONCE per page render. Every expand call (top-level AND
// every nested container / object_list re-entry) must reuse this SAME object.
// Never reset or recreate it mid-render.
const templateState = {};

// Sync approach: pre-fetch templates, use in computed properties
const { templates } = await loadTemplates(pageData, loadTemplate);
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
- **\`templateState\`**: Create a fresh `{}` **once per page render** and share it across **every** `expandTemplatesSync`/`expandTemplates` call — top-level and every nested container / object_list re-entry. It records the template instances minted this render so a re-entry is recognized as already-expanded content and passed through. **Never reset or recreate it mid-render** (e.g. don't `templateState = {}` again before rendering, and don't pass a fresh `{}` per call): wiping it drops the minted instances, so re-entries re-apply the template instead of passing through — infinite recursion / blank page. Recognition is **data-derived** (by `templateInstanceId`), so it is safe to hand blocks back as a Vue reactive value, a clone, or a `postMessage` copy — no `toRaw` needed. (In Vue/React, provide it once at the page root via provide/inject or context; see `examples/nuxt-blog-starter` and `examples/hydra-nextjs`.)
- **\`templates\`**: (sync only) Pre-fetched map of templateId -> template data
- **\`loadTemplate(id)\`**: (async only) Function to fetch template content
- **\`allowedLayouts\`**: Force a layout when container has no template applied

## Fetching templates with the page

With the `inkaengine.inka` backend addon installed (`backend/` in the Inka repository), Plone returns every template a page needs in the same response as the page. Add `templates` to `expand`, and name any forced layouts in `expand.templates.extra`: they aren't referenced from the page, so the backend can't find them on its own. Then pass the whole response, `@components` included, to `loadTemplates`. It uses the templates that came back and only fetches what's missing.

### Javascript

```javascript
const forcedLayouts = ['/inka-templates/site-footer'];

const response = await fetch(
    `${apiBase}/++api++${path}?expand=templates` +
    `&expand.templates.extra=${encodeURIComponent(forcedLayouts.join(','))}`,
    { headers: { Accept: 'application/json' } },
);
const pageData = await response.json();

// Reads pageData['@components'].templates: no request per template.
const { templates, errors } = await loadTemplates(
    pageData, loadTemplate, {}, forcedLayouts,
);
```

- **Name forced layouts in both places:** in `expand.templates.extra`, so the backend returns them, and as `loadTemplates`' fourth argument, so they're still fetched from a backend without the addon.
- **Without the addon it still works.** Plone ignores `expand=templates`, and `loadTemplates` fetches each template one at a time, as before. It's slower, not broken.
- **A template the backend couldn't return** (missing, or one the visitor isn't allowed to view) is listed in `errors` and isn't requested again.
- **Only list the layouts your rules actually force in view mode.** Every template named in `extra` is included in every page response it's added to.

## How the Merge Works

A merge puts a template's blocks into a **target** document. Opening a page merges the template into the page. **Change on all pages** merges the page's instance into the stored template. Both directions follow the same rules, and every rule applies in every region: the page's own blocks fields, and every region inside a block (`blocks_layout` or object_list), at any depth.

1. **Collect the target's blocks of this instance**, by `slotId`.
   - A block of this template without a `templateInstanceId` counts as this instance's.
   - Fixed blocks are kept for their ids and, when editable, their fields. That includes a page's editable fixed block (`fixed`, not `readOnly`) in one of the template's fixed slots. So a page that has never been through a forced layout can still carry its own version of the layout's fixed heading, marked `templateId` + `slotId` + `fixed`.
   - Everything else is slot content. Each block is taken whole, with its children.
   - When a layout is forced across a blocks field, the field's blocks without a `slotId` are content with no slot.
2. **Place the template's blocks, in order.**
   - A **fixed, readOnly** block is the template's.
   - A **fixed** block that is editable is the template's, with the target's fields over it.
   - A fixed block's regions are filled by these same rules.
   - A **slot** is replaced by the target's content for that slot, in order. A slot name that appears more than once is filled where it first appears. A template inside that content, such as a snippet, is merged in place by these same rules, with its own instance and ids.
   - A slot the target has nothing for is the template's slot block, without anything it holds.
3. **Place the leftovers.** Content with no slot, or whose slot the template doesn't have, goes to the start of the first of these that exists:

   - the `"default"` slot;
   - the slot after the template's last fixed block;
   - the slot before its first fixed block.

   If none exists, it is dropped. Content takes the `slotId` of the slot it lands in. Any other target block in a fixed block's slot is a stale copy of that block, and is replaced.
4. **Keep the ids.**
   - Every block the target already has keeps its id.
   - Fixed blocks match the target's by slot. Where two share a slot name, they match in order.
   - A block new to the target gets a new id: from `uuidGenerator` when the caller passes one, otherwise `${instanceId}::${templateBlockId}`. The editor always passes one, so every id it saves is a uid. The other form is for a render that is never saved, so the server and the client's hydration give the same ids.

Applied in each direction, the rules give:

<block type="slateTable" table.fixed table.celled>

| Block | Opening a page | Change on all pages |
| --- | --- | --- |
| fixed, readOnly block | the template's | the page's edit goes to the template |
| fixed, editable block | the page keeps its own | the template keeps its own |
| slot | the page's content | the template's slot block |
| ids | the page keeps its own | the template keeps its own |

</block>

What a page puts in a slot, or writes in an editable fixed block, is never written to the template. To change an editable block's text for every page, edit the template itself.

**Switching layout** treats the old layout's blocks as the target's. Its slot content is kept and lands by slot as above. An editable fixed block takes over the new layout's editable fixed block in the same slot, with its id and fields. The old layout's other fixed blocks are dropped, including any the page edited. **Removing a layout** (`null`) keeps the content and strips every template mark from it.

### Diagram: opening a page

```bash
Before:  [User Block A] [User Block B]
Layout:  [Fixed Header] [default] [Fixed Footer] [post_footer]
After:   [Fixed Header] [User Block A] [User Block B] [Fixed Footer] [post_footer]
```

### Diagram: Change on all pages, after the header was edited

```bash
Page:      [Fixed Header*] [User Block A] [User Block B] [Fixed Footer] [post_footer]
Template:  [Fixed Header]  [default]                     [Fixed Footer] [post_footer]
Saved:     [Fixed Header*] [default]                     [Fixed Footer] [post_footer]
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
