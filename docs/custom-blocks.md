---
"@type": Document
UID: docs-custom-blocks-001
allow_discussion: false
contributors: []
creators:
  - admin
description: Define custom block types directly in your frontend configuration
  via the blocks option in initBridge. No Volto plugin deployment required. Each
  block type needs an id, title, and a blockSchema with its field properties.
effective: 2025-01-01T00:00:00
exclude_from_nav: false
expires: null
id: custom-blocks
is_folderish: false
language: "##DEFAULT##"
layout: document_view
preview_caption: null
preview_image: null
review_state: published
rights: ""
subjects:
  - blocks
  - frontend
title: Custom Blocks
blocks-matched: |
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
  <block type="title" _="${h1}" />
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

# Custom Blocks

Define custom block types directly in your frontend configuration via the `blocks` option in `initBridge`. No Volto plugin deployment required. Each block type needs an `id`, `title`, and a `blockSchema` with its field properties.

## `initBridge()` Reference

`initBridge(options)` opens the iframe bridge and registers your frontend's page and block configuration with the admin. Call it once during page setup when running inside the admin iframe.

### Js

```js
import { initBridge } from '@hydra-js/hydra.js';

const bridge = initBridge({
  page:        { /* page-level blocks fields */ },
  blocks:      { /* block type registry */ },
  voltoConfig: { /* other Volto settings */ },
  onEditChange: (formData) => { /* re-render on edit */ },
  pathToApiPath: (path) => path,
  debug: false,
});
```

### `page` — page-level blocks fields

Defines the **blocks fields of a page** where blocks can live. `page.schema.properties` is keyed by field name; each `widget: 'blocks_layout'` entry is one blocks field. The field name is the key inside the page's `blocks_layout` dict (the default field is `items`), so they all persist inside the registered `blocks_layout` field.

### Js

```js
page: {
  schema: {
    properties: {
      items:  { widget: 'blocks_layout', title: 'Content', allowedBlocks: ['slate', 'image', 'slider'] },
      header: { widget: 'blocks_layout', title: 'Header',  allowedBlocks: ['slate'], maxLength: 3 },
      footer: { widget: 'blocks_layout', title: 'Footer',  allowedBlocks: ['slate', 'link'] },
    },
  },
}
```

Per-field options:

- **\`title\`** — sidebar section title (defaults to the field name).
- **\`allowedBlocks\`** — array of block-type names this region accepts. Acts as a per-region filter on top of the registry.
- **\`allowedTemplates\`** — array of template URLs shown in the BlockChooser's "Templates" group for this field. See [Templates](./templates.md).
- **\`allowedLayouts\`** — array of template URLs shown in the Layout dropdown for this field.
- **\`maxLength\`** — maximum number of blocks in the field.

Defaults and side effects:

- If you don't include `blocks_layout`, it's auto-added with `{ title: 'Blocks' }`.
- The sidebar shows one section per field when no block is selected.
- **Auto-restrict**: any block type that's not in *any* field's `allowedBlocks` is auto-restricted (hidden from the BlockChooser globally). To bypass, set the block's `restricted` to a function instead of `true`/`false`.
- Fields not present in saved page data are auto-initialised with `{ items: [] }` on load.
- You can't currently change the page metadata schema itself — custom content types are created via "Site Setup > Content types" in Volto.

### `blocks` — block type registry

Defines or overrides individual block types. Each key is the block type name (matching what appears in `allowedBlocks` and `@type` on saved blocks).

### Js

```js
blocks: {
  slider: {                          // new custom block
    id: 'slider',
    title: 'Slider',
    icon: 'data:...',
    group: 'common',
    mostUsed: true,
    blockSchema: { properties: { /* fields */ } },
  },
  toc: {                             // override a built-in block
    blockSchema: { /* YOUR fields — see "Overriding a built-in block" */ },
  },
}
```

Per-block options (most are passed through to Volto's block config):

- **\`id\`** — block type identifier (matches the key).
- **\`title\`** — display name in the BlockChooser.
- **\`icon\`** — icon shown in the BlockChooser (data URL or SVG component).
- **\`group\`** — chooser group (e.g. `'common'`).
- **\`restricted\`** — `true` hides the block from the chooser; can also be a function for conditional restrictions.
- **\`mostUsed\`** — pin to the top of the chooser.
- **\`disableCustomSidebarEditForm\`** — use only the schema form in the sidebar (no custom edit component). **Defaults to \`true\` for any block you give a \`blockSchema\`** — see [Overriding a built-in block](#overriding-a-built-in-block). Set `false` to keep the admin's own edit component for a block whose sidebar does something a JSON schema cannot express.
- **\`blockSchema\`** — JSON-schema-style definition of the block's fields. See [Schema Enhancers](#schema-enhancers) below and the [Block reference](./examples/index.md).
- **\`fieldMappings\`** — block-to-block conversion rules. See [Block Conversion & fieldMappings](#block-conversion--fieldmappings) below.
- **\`schemaEnhancer\`** — recipe-based schema modifier; supports `fieldRules`, `inheritSchemaFrom`, etc. See [Schema Enhancers](#schema-enhancers).

`page` and `blocks` interact via name lookup: a region's `allowedBlocks: ['slate', 'slider']` references keys of the `blocks` registry. You can use one without the other — `page` alone restricts placement of built-in blocks; `blocks` alone registers custom types and gets a default `blocks_layout` region accepting everything.

### Overriding a built-in block

Your frontend is the thing that renders, so it decides what an author can set. Give a built-in block a `blockSchema` and **your schema is the whole schema**: the sidebar shows your fields and nothing else.

### Js

```js
blocks: {
  toc: {
    blockSchema: {
      fieldsets: [{ id: 'default', title: 'Default', fields: ['levels'] }],
      properties: {
        levels: { title: 'Heading levels', type: 'array', items: { choices: [['h2', 'Heading 2']] } },
      },
      required: [],
    },
  },
}
```

That sidebar offers `levels`. It does not offer the admin's `hide_title`, `ordered`, `title` or `variation`, because your frontend never said it renders them.

This is deliberate: before, the admin's fields were merged in and its edit component kept rendering the sidebar, so an author was offered settings the frontend could not honour — they ticked a box and the page did not change.

Two consequences worth knowing:

- **Variations follow the schema.** Variations are a separate registry the admin fills in. Declare a `blockSchema` and the admin's variations for that block are dropped too; send your own `variations` to keep a picker.
- **Labels are yours.** The admin's built-in labels come from its translation catalogue. A schema sent over the bridge carries plain strings, so an overriding frontend supplies its own — in whatever language it wants them.

`slate` is the one exception: the admin's slate schema carries the `value` field that block-sync and inline editing depend on, which a frontend cannot know to send, so declaring a slate schema adds to it rather than replacing it.

To keep the admin's edit component for one block — a picker or upload UI a schema cannot describe — send `disableCustomSidebarEditForm: false` for that block.

### Other top-level options

- **\`onEditChange(formData)\`** — callback invoked with the new form data whenever the editor changes anything. See [Live Preview › Setting Up the Bridge](./live-preview.md#setting-up-the-bridge).
- **\`pathToApiPath(path)\`** — function transforming a frontend path to the API/admin path on `PATH_CHANGE` messages. Use when your frontend embeds state (paging, filters) in URL segments that don't exist on the CMS side. See [Listings › Path Transformation](./listings.md#path-transformation-pathtoapipath).
- **\`voltoConfig\`** — passes additional Volto config (non-block settings) through to the admin. Future home for things like slate formats ([TODO #109](https://github.com/collective/volto-hydra/issues/109)) and toolbar actions.
- **\`debug\`** — `true` enables verbose console logging in the bridge. Default `false`.

### Returns

The `Bridge` instance, which exposes additional API methods you can call from the frontend (e.g. `getAccessToken()`, `sendBlockUpdate()`, `sendBlockAction()`). See [Advanced › Custom Sidebar UI](./advanced.md#custom-sidebar-and-cms-ui) for those.

## Defining a custom block

### Javascript

```javascript
const bridge = initBridge({
    page: {
        schema: {
            properties: {
                blocks_layout: {
                    title: 'Content',
                    allowedBlocks: ['slate', 'image', 'video', 'slider'],
                },
            },
        },
    },
    blocks: {
        slider: {
            id: 'slider',
            title: 'Slider',
            icon: 'data:...',
            group: 'common',
            restricted: false,
            mostUsed: true,
            disableCustomSidebarEditForm: false,
            blockSchema: {
                properties: {
                    slider_timing: {
                        title: 'Delay',
                        widget: 'float',
                    },
                    slides: {
                        title: 'Slides',
                        widget: 'blocks_layout',
                        allowedBlocks: ['slide', 'image'],
                        defaultBlockType: 'slide',
                    }
                },
            }
        },
        slide: {
            id: 'slide',
            title: 'Slide',
            blockSchema: {
                properties: {
                    url: { title: 'Link', widget: 'url' },
                    title: { title: 'Title' },
                    image: { title: 'Image', widget: 'image' },
                    description: { title: 'Description',
                                   widget: 'slate' },
                },
            },
        },
    },
});
```

Child block types (like `slide` above) must be defined at the top level of `blocks`. You can also:

- Set `restricted: true` to hide a block from the block chooser (only usable as child blocks)
- Set `mostUsed: true` to pin a block to the top of the chooser
- Set `disableCustomSidebarEditForm: true` to use only the schema form in the sidebar (no custom edit component)
- Use `fieldsets` in the schema to organize fields into tabs

**A \`widget: 'slate'\` field holds one top-level node.** A slate field — like `description` on the `slide` above — stores a single paragraph, heading, or list, not a document of several. Pasting or typing multiple paragraphs into it flattens them back into one node; only the built-in `slate` *block* splits multi-node content into separate blocks. Design slate fields for single-node content, and use a `blocks_layout`/`object_list` of `slate` blocks when you need several. See [Visual Editing › One top-level node per slate field](./visual-editing.md#one-top-level-node-per-slate-field).

**Worked example:** [Heading Block](./examples/heading.md) — roughly the smallest custom block there is: one field, one annotation.

## Inline-editable fields: annotation and schema must agree

A field is inline-editable only when BOTH halves are in place. They are easy to get out of step, because each half looks fine on its own.

**1. Your markup renders something to click**, annotated with the field name:

### Html

```html
<h3 data-edit-text="title">Sydney Opera House</h3>
```

An *empty* field still has to render its element in edit mode — the editor reveals empty fields by marking them `data-empty` and drawing a "Click to edit" placeholder, and it can only mark an element that exists. A field that renders nothing when empty can never be filled in on the canvas. (In view mode, render nothing — the annotations are edit-mode only.)

Text with no box on screen is not inline-editable at all: a `.sr-only` element is clipped to 1×1, so there is nothing to put a cursor in. Leave it unannotated and let the sidebar edit it.

**2. Your schema declares that field as text.** The bridge will not make a field editable unless its schema says it is one:

### Javascript

```javascript
properties: {
    title:       { title: 'Title', type: 'string' },
    description: { title: 'Description', type: 'string', widget: 'textarea' },
    body:        { title: 'Body', widget: 'slate' },
}
```

`type` is the DATA type (`string`, `array`, `object`, `boolean`) and `widget` is the editor. Do not put a widget name in `type` — `{ type: 'textarea' }` is not a textarea field, and the bridge will silently refuse to make it editable, with no error and no clue in the DOM. Either declare both (`type: 'string', widget: 'textarea'`) or the widget alone.

`block-sanity` checks both halves: every schema text field visible on screen has to be annotated, and every annotated field has to become editable and take the caret when clicked.

It asks the same question of the fields that never reach the canvas. A sidebar OPTION — one offering a choice, so `choices` / a `Choice` factory / a boolean — has no annotation to look for, so it proves itself by being SET in at least one of your content examples. An option no example sets is reported by name: nothing renders it, so nothing can tell you it has stopped working, and no doc page shows an author what it does. Set it somewhere — a content fixture is enough, it does not have to be a page you ship — or drop the option.

## Widgets hydra registers

A schema names a widget by string, so anything in `config.widgets.widget` is available — Volto's own included (`select_querystring_field`, `query_sort_on`, `object_browser`, …). These are the ones hydra adds:

<block type="slateTable" table.fixed table.celled>

| widget | picks | documented |
| --- | --- | --- |
| `blockTypeSelect` | which block type a container's item is | [container blocks](./container-blocks.md#blocktypeselect-widget-options) |
| `schemaFieldSelect` | a field of a CONTENT TYPE, from `/@types` | [listings](./listings.md) |
| `vocabularySelect` | WHICH vocabulary (not a term from one) | below |
| `blockPicker` | a block, storing a named field value from it | below |
| `querystringSelect` | catalog indexes, one or several | below |
| `field_mapping` | how one block's fields map onto another's | [fieldMappings](#block-conversion--fieldmappings) |

</block>

Three more are swapped in rather than named: `url`, `blocks_layout` and `object_list` replace Volto's own so the bridge can handle them.

Reach for a Volto widget first where one fits; each section below says when it does.

## Picking a vocabulary (`vocabularySelect`)

A field can reference a vocabulary — "suggest this answer from the site's keywords", "offer these states". Volto has widgets for picking a **term from** a vocabulary; it has none for picking **which vocabulary**, and the reason is structural rather than an oversight:

- Vocabularies are named utilities, and `GET /@vocabularies` lists them all.
- But it answers `{"@id", "title"}` per item, while Volto's vocabulary reducer

reads `{token, title}` — so a built-in select aimed at the listing shows every   name and stores `undefined`.

`vocabularySelect` reads the listing itself and keeps the **name** (the last segment of `@id`), which is what every consumer accepts — `@vocabularies/<name>`, Volto's `getVocabulary`, a schema's `vocabulary: { "@id": … }`.

### Js

```js
suggest_from: {
  title: 'Suggest from',
  widget: 'vocabularySelect',
  // Optional: only offer vocabularies whose NAME matches this expression.
  vocabularyFilter: 'Keywords|Subject',
}
```

The stored value is a name (`plone.app.vocabularies.Keywords`), not a URL, so content does not carry one environment's origin.

### What it deliberately does not offer

**Catalog queries.** A query is not a list of terms. "Content matching these criteria" belongs to a listing's `querystring`, which has its own widget.

**Field-bound sources.** In `zope.schema` a vocabulary *is* a source, and `@sources/<field>` will even enumerate one when it is `IIterableSource` — the same serializer answers both. But a source has no name to store: it is identified by a field on an object (`field.bind(context).source`), so nothing registers it and nothing can list it. `@sources` and `@querysources` also require the `plone.restapi.vocabularies` permission (Manager / Site Administrator), while `@vocabularies` is `zope2.View` — so an anonymous visitor filling in a form can read a vocabulary and can never read a source.

### Searching a vocabulary

`@vocabularies/<name>` supports `?title=` (a case-insensitive substring filter, applied server-side) and `b_start` / `b_size` batching. A type-ahead should send `?title=` per keystroke rather than fetch every term — a long vocabulary is exactly the case where a list is the wrong control.

## Picking a block, and a value from it (`blockPicker`)

A field that names **another block** — "show this question when THAT one is answered" — should offer a menu, not ask for a uid. `blockPicker` reads `blockPathMap`, the same container/region map the editor uses, and stores a **field of the block chosen**.

### Js

```js
show_when_when: {
  title: 'Show when',
  widget: 'blockPicker',
  scope: 'siblings',      // 'siblings' (default) | '..' (parent's siblings) | '<region>'
  direction: 'before',    // only blocks earlier than this one
  blockTypes: ['text', 'select', 'single_choice'],
  valueField: 'field_id', // what to STORE (default: the block's own id)
  labelField: 'label',    // what to SHOW  (optional — see below)
}
```

`valueField` is the part worth understanding. A rule is evaluated against the value a field submits — a form question's `field_id` — so storing the block's uid would produce a rule that reads correctly in the sidebar and never matches anything. Name the field the consumer actually resolves.

`direction: 'before'` is what keeps skip logic honest: a question cannot depend on an answer given after it, and the first question has nothing to depend on at all (the menu is then empty rather than wrong).

### What a candidate reads as

`labelField` only nominates where THIS kind of block keeps its name. Without it, a block is named by the shared `blockDisplayTitle` — `title`, then `label`, then the block's own rich text read live, then the stored `plaintext`, then the block type's configured title, then the raw type.

Live text comes before `plaintext` on purpose. Nothing in the editor writes `plaintext`: the backend serializer does, at save time. Preferring it would name a heading by its previous wording for as long as the author kept typing, so the slate value is read directly (`slateNodesText`) and the stored text is the fallback for blocks whose words are not slate.

That is the same function the sidebar's child list uses, deliberately: a question that reads "Your name" in one list and "Text" in another is confusing in a way nobody reports. Set `labelField` when a block's name lives somewhere the chain would not look — a form question's `label` beats its `plaintext`.

### Not the same as `schemaFieldSelect`

<block type="slateTable" table.fixed table.celled>

|  | `schemaFieldSelect` | `blockPicker` |
| --- | --- | --- |
| choices | the CONTENT TYPE's schema fields, from `/@types` | blocks on the page, from `blockPathMap` |
| scope | the whole type | relative — siblings, `..`, a named region |
| stores | the field name | any field of the chosen block |

</block>

They share only their tail (build choices, hand them to the select). One asks the backend what a content type looks like; the other walks the block tree in the editor.

## Picking a catalog index (`querystringSelect`)

A field that names a catalog index — what a listing sorts on, what a facet filters by — should offer the site's indexes, not a text box. A typo in a text box produces a sort option that appears in the menu and silently sorts nothing.

One widget covers both shapes: `multiple: false` (the default) stores one index name, `multiple: true` stores a chosen subset in the author's order.

`indexes: "sortable"` (also the default) offers only what the catalog can sort on. That list is worth taking as given rather than deriving: index type sets the floor — a KeywordIndex like `Subject` is multi-valued and has no single key to sort by, a ZCTextIndex is ranked text — but Plone layers judgment on top. In its registry `portal_type` and `review_state` are both `FieldIndex`, and only `review_state` is flagged sortable. Filtering an index list by type would offer things Plone deliberately does not.

**Volto's own widgets, for comparison.** Both are registered and pass straight through a hydra schema:

<block type="slateTable" table.fixed table.celled>

| widget | for |
| --- | --- |
| [\`query\_sort\_on\`](https://github.com/plone/volto/blob/main/packages/volto/src/components/manage/Widgets/QuerySortOnWidget.jsx) | ONE index to sort by — a menu grouped by the registry's `group` |
| `select_querystring_field` | ONE index to query on (what the facet examples use) |

</block>

Prefer `query_sort_on` for a single sort field in a schema that also carries a `querystring` field, where its grouped menu is nicer and the data is already loaded. Prefer this widget otherwise, and for every `multiple` case.

The reason for "already loaded": `query_sort_on` reads `state.querystring.sortable_indexes` but never dispatches `getQuerystring()` — in Volto's listing sidebar the `QueryWidget` beside it does the asking. Alone in a hydra schema it renders an empty menu with no error. This widget asks for itself.

Volto has no declarative answer at all for the `multiple` case: its search block builds that field imperatively in `SearchBlockEdit`, which writes `sortOnOptions.items.choices` before rendering — a route a JSON schema cannot take.

### Json

```json
"sortOnOptions": {
  "title": "Sort-by options",
  "type": "array",
  "widget": "querystringSelect",
  "indexes": "sortable",
  "multiple": true
}
```

<block type="slateTable" table.fixed table.celled>

| option | meaning |
| --- | --- |
| `indexes` | `"sortable"` (default) offers only what the catalog can sort on; `"all"` offers every queryable index |
| `multiple` | `true` stores an array — a chosen subset, in the author's order, which is what a "sort by" menu is |
| `emptyLabel` | wording of the "none" entry in single mode (default `— no sorting —`). Single mode needs one: no sorting is a real answer, usually the default. Ignored when `multiple`, where an empty list says it already |

</block>

The stored value is the index NAME (`effective`, `sortable_title`), because that is what a query is built from; the title is only what the author reads.

`@querystring` is loaded once for the whole editor, so the widget asks for it only if nothing else has, and shows an empty menu — not a crash — while it is still in flight.

## Schema Enhancers

Schema enhancers modify block schemas dynamically:

### Javascript

```javascript
const bridge = initBridge({
    blocks: {
        myBlock: {
            blockSchema: {
                properties: {
                    mode: {
                        title: 'Mode', widget: 'select',
                        choices: [['simple', 'Simple'], ['advanced', 'Advanced']],
                    },
                    advancedOptions: { title: 'Advanced Options', type: 'string' },
                },
            },
            schemaEnhancer: {
                fieldRules: {
                    advancedOptions: { when: { mode: 'advanced' }, else: false },
                },
            },
        },
    },
});
```

**\`fieldRules\`** — add, remove, or conditionally modify field definitions. The value for each rule key can be:

- `false` — always hide the field
- `{ set: { title: '...', widget: '...' } }` — always add or replace the field definition
- `{ when: { fieldName: value }, else: false }` — show only when condition met
- `{ when: { fieldName: { gte: 2 } }, set: { ... } }` — conditional definition override
- `[rule, rule, ...]` — switch: first matching rule wins. A bare `false` in the array is a catch-all hide: `[{ when: A }, { when: B }, false]` shows on A or B, hides otherwise.
- `'parent.child': false` — hide a field inside a widget's inner schema
- `{ when: { ... }, error: 'message' }` — mark the field invalid when the condition holds

Condition operators: `is`, `isNot`, `isSet`, `isNotSet`, `oneOf`, `notOneOf`, `contains`, `notContains`, `containsAny`, `notContainsAny`, `containsAll`, `notContainsAll`, `regex`, `notRegex`, `gt`, `gte`, `lt`, `lte`. A bare value (`{ mode: 'advanced' }`) is shorthand for `is`. An operand may be a literal or `{ field: '<path>' }` — see [compare against another field](#-field----compare-against-another-field).

Each operator is driven by the field's **declared type**, never the value shape. A field reduces to one of four **surfaces**, and an operator used off its surface raises an error (a mis-authored rule fails loudly rather than silently mismatching):

<block type="slateTable" table.fixed table.celled>

| surface | fields | operators |
| --- | --- | --- |
| **string** | text, textarea, url, Choice, **slate** (its plaintext) | `is`/`isNot`, `isSet`, `oneOf`/`notOneOf`, `contains`/`notContains` = **substring**, `regex`/`notRegex` |
| **number** | integer, float, number | `is`/`isNot`, `oneOf`, `isSet`, `gt`/`gte`/`lt`/`lte` = compare |
| **boolean** | boolean | `is`/`isNot`, `isSet` |
| **array** | multiselect (its values), **region** (its child block **types**) | `isSet`, `is`/`isNot` = **set-equality**, `contains`/`notContains` = membership, `containsAny`/`containsAll` (+inverses), `gt`/`gte`/`lt`/`lte` = **count** |

</block>

`oneOf` (scalar value ∈ set) and `containsAny` (array shares any with a set) differ only on the field side — `oneOf` is for a single-valued field, `containsAny` for a multiselect; `oneOf` on an array throws (use `containsAny`).

### `error` — a rule that refuses a value

A rule can raise a validation error instead of showing or hiding something:

### Javascript

```javascript
fieldRules: {
    maxItems: {
        when: { maxItems: { isSet: true, lt: { field: 'minItems' } } },
        error: 'The maximum is below the minimum.',
    },
},
```

The message lands on the field, and everything an author sees is Volto's own: the widget goes red, the form shows its error summary, and **the save is blocked** (`Form.onSubmit` validates every block against its enhanced schema and refuses to submit while any block has errors).

An `error` composes with a `set` in the same rule — the field can be re-titled *and* marked — and it is skipped entirely when the rule's `when` does not match, so a form that has not been filled in yet is not scolded for it.

**Write a cross-field rule on the field that should show the error.** There is no block-level address, and adding one would do less: an error keyed to a field is the only shape Volto acts on, so a block-level error would show a banner and let the save through. If a constraint genuinely belongs to no single field, list the same rule under each field it concerns.

### `warning` — a rule that says something rather than refusing it

Not every constraint should stop a save:

### Javascript

```javascript
fieldRules: {
    image: {
        when: { image: { regex: '\\.png$' } },
        warning: 'A pictogram should be an SVG drawn to the 48×48 grid.',
    },
},
```

An `error` is **refused** — a registered validator turns it into a form error and `Form.onSubmit` will not submit. A `warning` is **said**: it is deliberately not a validator, so nothing blocks. The sidebar shows it beside the field, and the page saves.

Use a warning when the value may well be right and the author should simply know: artwork a little off the 48×48 grid is still the right artwork, and refusing to save over it would be hostile. Use an error when the value cannot work at all — a raster where the design system inlines an SVG.

Both actions compose with `set`, and both work in a switch (`[rule, rule, …]`), where the first matching entry wins — so a rule can refuse one case and merely advise on another.

### `{ field: '...' }` — compare against another field

Any operand may name a field instead of a literal:

### Javascript

```javascript
{ when: { maxItems: { lt: { field: 'minItems' } } } }        // this block
{ when: { b_size:   { gt: { field: '../pageSize' } } } }     // parent's field
```

The reference goes through the same path grammar as a `when` key, so `../` steps work in an operand exactly as they do in a key.

### Reading into a value, and arithmetic

A `when` path may continue INTO the field's value, and an operand may do basic arithmetic:

### Javascript

```javascript
fieldRules: {
    image: [
        {
            when: { 'image_scales.image.0.content-type': { isNot: 'image/svg+xml' } },
            error: 'A pictogram must be an SVG: it is inlined and takes its colour from the page.',
        },
        {
            when: {
                'image_scales.image.0.width': {
                    gt: { field: 'image_scales.image.0.height', times: 1.1 },
                },
            },
            warning: 'A pictogram is drawn square, on a 48×48 grid.',
        },
    ],
},
```

Some of what a rule needs to ask about is not a field at all. Volto stores an image's mime type and dimensions ALONGSIDE the reference, in `image_scales`, so "is this an SVG" and "is it square" are answerable from data the block already carries — no fetching, no extra state.

- **A sub-path's surface comes from the VALUE**, because no schema describes

`image_scales.image.0.width`. This is the one place the rule engine reads a   value's shape, and only because a declared type does not exist to consult.

- **A sub-path that leads nowhere is UNSET**: every comparison is false, and

only `isSet`/`isNotSet` answer. A rule must not fire on a block whose image   has not been chosen yet.

- **\`times\` and \`plus\`** apply to a field reference, so a comparison can carry a

tolerance — "square, within a tenth" rather than exactly equal, which no real   measurement is.

Two things to know:

- **Surfaces still apply.** A reference does not smuggle a value past the

operator table — `lt` on a `string` surface throws whether the operand is a   literal or a field. Comparing two date strings is therefore not expressible;   that needs a date surface, which is a separate question from where the operand   comes from.

- **An empty reference makes the condition false.** If the named field holds

nothing there is no value to compare against, and reading that as "no   constraint" would fire the rule on every form where the other field has not   been filled in yet.

Two extras drive **position-** and **type-**&#x61;ware rules:

- The virtual field **\`@index\`** reads a block's ordinal position within its parent `object_list` region (a `number` surface) — `{ '@index': { lt: 1 } }` means "first in my region", and `../@index` is the parent block's index. Distinct from a region's `count` (which counts children).
- A rule whose **\`set\` is a block-type NAME** (a string) rather than a field definition is a **\`@type\` rule** — it changes the item's *type* by position, not a field. Declared as `typeRule` on a typed `object_list`; see [\`typeRule\` — position picks a typed item's \`@type\`](#typerule--position-picks-a-typed-items-type). The retype is applied by CONVERSION (a schema enhancer can't rewrite stored `@type`), which brings up the confirm described under [Drag / paste via conversion](#drag--paste-via-conversion).

### Javascript

```javascript
schemaEnhancer: {
    fieldRules: {
        // multiselect `elements: ['image','date','tag']` — reveal each option's field
        date: { when: { elements: { contains: 'date' } }, else: false },
        media: { when: { elements: { containsAny: ['image', 'video'] } }, else: false },
        layout: { when: { elements: { containsAll: ['image', 'date'] } }, else: false },
        // scalar Choice
        invert: { when: { colour: { oneOf: ['brand-dark', 'black'] } }, else: false },
        // text: substring / pattern
        cta: { when: { title: { contains: 'Sale' } }, else: false },
        year: { when: { title: { regex: { pattern: '\\b20\\d\\d\\b', flags: 'i' } } }, else: false },
    },
}
```

For a **region** (an `object_list` field, or a single `blocks_layout` region named by its region key), the array surface is its **child block types**, and the numeric operators **count** that region's children — only its own, never a cross-region total:

### Javascript

```javascript
schemaEnhancer: {
    fieldRules: {
        // reveal a caption field only when the `body` region has an image block
        caption: { when: { body: { contains: 'image' } }, else: false },
        // offer "columns layout" only once the `columns` region has ≥2 blocks
        columnsLayout: { when: { columns: { gte: 2 } }, else: false },
        // "carousel options" only when the `slides` object_list has >1 item
        carouselOptions: { when: { slides: { gt: 1 } }, else: false },
    },
}
```

To condition on a block's **position** rather than a field value, use the virtual field **\`@index\`** — a block's ordinal index within its parent `object_list` region (a `number` surface). It composes with the block-step grammar, so `../@index` is the parent block's index. Unlike the region's numeric ops (which *count* children), `@index` is *where this block sits*:

### Javascript

```javascript
schemaEnhancer: {
    fieldRules: {
        // a table cell's blocks region: cap at one block when this cell is in the
        // first row (a header row) — `../@index` is the cell's ROW index
        blocks: [
            { when: { '../../headerMode': { oneOf: ['row', 'both'] }, '../@index': { lt: 1 } }, set: { maxLength: 1 } },
            { when: { '../../headerMode': { oneOf: ['col', 'both'] }, '@index':    { lt: 1 } }, set: { maxLength: 1 } },
        ],
    },
}
```

A block that isn't an `object_list` item yields an unset `@index`, so comparisons are simply false (never an error). `lt: 1` is "first"; `lt: 2` is "first two", etc.

Field paths: `../field` for the parent block's field (and `@index` / `../@index` for position), `/field` for a page metadata field.

**Worked examples:** two blocks in the reference carry rules for their own reasons — the [Teaser Block](./examples/teaser.md) has nothing to ask for while it borrows the linked page's wording (`overwrite` off), and the [Image Block](./examples/image-block.md) offers no size for a full-width image, written as a list of rules with a bare `false` as the catch-all.

## Block Conversion & fieldMappings

`fieldMappings` (plural) on a block config defines how fields map between block types (and from linked content). This enables:

- **"Convert to..." UI action** — editors can convert a block to another type (e.g. teaser → image).
- **Listing item types** — query results are mapped to item blocks via `@default` (see [Listings](./listings.md)).
- **Synchronised container children** — a parent controls child type, all children convert together (see [Container Blocks › Synchronised Block Types](./container-blocks.md#synchronised-block-types-in-a-container)).
- **Drag / paste via conversion** — a block can be dropped or pasted into a container that only accepts a *convertible* type; it's converted on drop (see below).
- **Copy from a linked target** — a block pulls fields from the content item its link field points at, with a per-field linked/custom toggle (see [\`@target\`](#target--copy-from-a-linked-content-item)).

Each key in `fieldMappings` is either a **specific block type name**, **\`@default\`**, or **\`@target\`**.

**Worked example:** [Teaser Block](./examples/teaser.md) — `@default` mappings, so a converted or dragged block keeps its title, description and image.

### `@default` — the canonical content shape

`@default` is a virtual type representing a linked content item's fields — anything a catalog **search** returns as metadata (`metadata_fields: '_all'`): `@id`, `title`, `description`, `image`, `Subject` (tags), `created`/`effective` dates, and so on. A block with `fieldMappings['@default']` is saying "I can be populated from a content item." The keys are content/metadata field names — not this block's own field names (e.g. `label`, `field`, `required` are not content metadata and are invalid).

### Explicit type-to-type mappings

Use these when blocks share fields that aren't part of the `@default` set — for example, facet types sharing `{ title, field, hidden }` or form field types sharing `{ label, description, required }`.

### Javascript

```javascript
// Content item types: use @default (canonical fields) + explicit cross-mappings
teaser: {
    fieldMappings: {
        '@default': { '@id': 'href', 'title': 'title', 'image': 'preview_image' },
        image: { 'href': 'href', 'alt': 'title', 'url': 'preview_image' },
    },
},
image: {
    fieldMappings: {
        '@default': { '@id': 'href', 'title': 'alt', 'image': 'url' },
        teaser: { 'href': 'href', 'title': 'alt', 'preview_image': 'url' },
    },
},

// Non-content types: use explicit hub-type mappings (NOT @default).
// All facet types map through checkboxFacet as a hub:
selectFacet:  { fieldMappings: { checkboxFacet: { title: 'title', field: 'field', hidden: 'hidden' } } },
checkboxFacet: { fieldMappings: { selectFacet: { /* ... */ }, daterangeFacet: { /* ... */ } } },
```

### `@target` — copy from a linked content item

`@target` maps a **linked** content item's attributes onto this block's own fields — the generic version of the Volto teaser's "copy from target" button. It maps *source content attributes* (`title`, `description`, `image`, …) to *this block's fields*. The item is whichever the block's **link field** points at (the `object_browser mode: 'link'` field — its stored snapshot is the source), so you don't name a URL field separately: "the url is the link in the mapping".

### Javascript

```javascript
button: {
    // The Label (title) syncs from the linked item's title.
    fieldMappings: {
        '@target': {
            title: 'title',
            description: 'description',
            // image: the conversion is derived from the destination field's
            // widget, so the value is assembled into the shape it expects.
            image: 'preview_image',
        },
    },
},
```

Declaring `@target` is the **only** opt-in — no per-block enhancer wiring. Each mapped field then shows a small **🔗 pull from linked** toggle in the sidebar (only when a target is selected). Every mapped field is one of two states:

- **Linked** (default, toggle ticked) — the field *pulls from the linked item*.

Its value is filled from the target's snapshot when the page opens for editing   and re-pulled when you change the link, so it always mirrors the linked content.

- **Custom** (toggle unticked) — your own value, ignored by the target. A field

becomes custom the moment you edit it, or when you untick the toggle;   re-ticking re-pulls the target value. Custom fields are recorded in the block's   `_customFields` array (absence ⇒ linked), so the state persists with the block.

### Container ⇄ value (region-crossing paths)

A `fieldMappings` value is usually a sibling **field name**. It may instead be a **region-crossing path** `<region>/<type|*>/<field>`, which reaches the `<field>` of a container region's children — the one place the path grammar crosses a region boundary. This bridges a **container** block (a region of child blocks) and a **value** block (a scalar field), so a block can convert between the two shapes:

### Javascript

```javascript
tableHeaderCell: {                                   // the value form: one slate
    blockSchema: { properties: { value: { widget: 'slate' } } },
    // Declared ONCE on the value block; works both directions.
    fieldMappings: { tableCell: { value: 'blocks/slate/value' } },
},
tableCell: {                                         // the container form
    blockSchema: { properties: {
        blocks: { widget: 'object_list', typeField: '@type',
                  allowedBlocks: ['slate', 'image', 'video'] },
    } },
},
```

- **container → value (collapse)** — gather the region's matching children's

`<field>`; slate values are **merged** into one (lossless), not truncated.

- **value → container (expand)** — wrap the value in **one** child of `<type>` in

the region.

- `<type>` selects a child type; `*` = any child that exposes `<field>` (siblings

without it — an `image` for a `value` path — are skipped). A **concrete** type   (`blocks/slate/value`) makes expand unambiguous, so use it for a two-way bridge;   `*` suits read-only cross-region reads (e.g. a `when` condition).

Non-region scalar fields (`key`, `width`, …) carry over unchanged. This is the `convertValueContainer` helper; DnD/paste and the block chooser reuse it via the same `fieldMappings` graph. See `proposals/container-value-conversion.md`.

#### `typeRule` — position picks a typed item's `@type`

The bridge converts on demand; a **\`@type\` rule** on a typed `object_list` field decides *when*, by **position**. It is an ordinary `when`-based fieldRule (same grammar — `@index`, `../@index`, `../../<field>`, `oneOf`, `lt`, …) whose `set` is a block-**type name** instead of a field definition:

### Javascript

```javascript
cells: {
    widget: 'object_list', typeField: '@type',
    allowedBlocks: ['tableCell', 'tableHeaderCell'],
    typeRule: [
        // header row OR header column → the value form
        { when: { '../../headerMode': { oneOf: ['row', 'both'] }, '../@index': { lt: 1 } }, set: 'tableHeaderCell' },
        { when: { '../../headerMode': { oneOf: ['col', 'both'] }, '@index': { lt: 1 } },     set: 'tableHeaderCell' },
        { set: 'tableCell' },                                // otherwise the container form
    ],
},
```

The rule is evaluated in the same pass that applies field defaults (run on every edit): each typed item's target `@type` is re-resolved, and when it differs from the stored `@type` the item is **converted in place** via the bridge above. So moving a row to/from row 0 flips its cells between `tableHeaderCell` (a slate `value`) and `tableCell` (a `blocks` container), losslessly — no imperative "re-type the cells" code. Only meaningful on a **typed** object\_list (a `typeField` item has an `@type` to rewrite); it settles in one pass (the target type re-resolves to itself once the item is in place).

Each field's value is converted to the shape its destination widget expects (derived from the widget): strings copy across, an image field is assembled from the target's `image_scales` / `image_field`, multi-value fields (e.g. `Subject` → tags) pass through as-is.

The pull is **snapshot-based** — there is no separate live fetch. When you pick or type a link, the url widget stores the target's **full** metadata onto the link field (the object browser already fetches every item with `metadata_fields: '_all'`, and the field's `selectedItemAttrs` keeps the whole canonical set), so the block carries its own source data. Every mapped field then pulls straight from that stored snapshot: **on page open** (all blocks fill at once) and again whenever you change the link.

Only an **internal** link is a pull source. An external URL has no catalog item to search, so a field linked to one can't pull — the toggle is hidden and the field behaves as a plain editable field. (Unfurling external links via OpenGraph is a future enhancement.)

### Conversion graph rules

- Explicit `fieldMappings[typeName]` always creates a conversion edge.
- `@default` only creates edges between types that both have valid `@default` mappings (keys from `{ @id, title, description, image }`). Types with non-canonical `@default` keys are ignored.
- Types without `fieldMappings` never appear in the "Convert to..." menu.
- Transitive conversions use paths through intermediate types (e.g. hero → teaser → image).
- Unmapped fields are kept in the data so converting back restores them.

### Drag / paste via conversion

The same conversion graph gives drag-and-drop (and paste) more valid destinations: a block can be dropped or pasted into a container whose `allowedBlocks` only admits a type the block can *convert* to.

**Every drop/paste is TRIALLED before it commits.** The candidate result is normalised (the same pass that applies field defaults and evaluates [\`@type\` rules](#typerule--position-picks-a-typed-items-type)), then each block's `@type` is diffed against what was dropped. If **anything** converted — because the dropped block had to convert to fit the container, **or** because a rule re-typed a block by its new position (e.g. a table row moved to row 0 turns its cells into header cells) — a **"Convert blocks?"** confirm lists each `from → to` and waits: **Convert** commits the already-converted result, **Cancel** aborts the whole drop. Nothing converted → it commits silently.

The chooser popup survives only for the genuinely ambiguous case: a single block reachable to *several* target types, where you pick which one (cancelling leaves it untouched). Zero reachable types rejects the drop; multi-block selections are auto-only (every member must reach exactly one type). On mobile, conversion happens via cut → paste (drag/chevron move stays native-only). External-link and other type restrictions are unaffected; only the container's `allowedBlocks` gate is relaxed to "allowed or convertible".

### Mapping value format

A mapping value is either a string (simple field rename) or `{ field, type }` (rename with type conversion):

### Json

```json
{
    "@id": { "field": "href", "type": "link" },
    "title": "title",
    "description": "description",
    "image": "preview_image"
}
```

When `type` is specified, the value is converted at runtime:

<block type="slateTable" table.fixed table.celled>

| Type | Conversion |
| --- | --- |
| `string` | Arrays joined with `", "`; image objects resolved to URL string |
| `link` | String wrapped as `[{ "@id": value }]` (Volto link format) |
| `image` | Pass through (expects `{ "@id", image_field, image_scales }`) |
| `array` | Non-arrays wrapped in `[value]` |
| `(none)` | Copied as-is |

</block>

### FieldMappingWidget

When a parent block has `mappingField` set in its `inheritSchemaFrom` recipe, the admin sidebar shows a widget that lets editors configure field mappings visually:

- Shows the `@default` source fields (`@id`, `title`, `description`, `image`) on the left.
- For each source field, lets the editor pick a field from the selected child type's schema.
- Auto-detects the conversion `type` from the target field definition (e.g. `object_browser` with `mode=link` → `type: "link"`).
- Saves the result as `fieldMapping` (singular) on the block data.

The saved `fieldMapping` is read at render time by `expandListingBlocks` — no block registry access needed at render time.

## HTML Paste Support (TODO)

When the editor pastes rich HTML into the page, Hydra will eventually be able to recognise it as a custom block by matching against a CSS selector mapping. The proposed shape:

### Javascript

```javascript
video: {
    fieldMappings: {
        'css:video': { 'src': 'url', 'caption[@class="alt"]': 'alt' },
    },
}
```

The `css:<selector>` key in `fieldMappings` matches a pasted HTML element; the value maps element attributes to block fields. Not yet implemented — open question on whether this should run via `htmlTagsToSlate` (bypassing slate conversion) or be encoded into slate so attributes/classes survive.
