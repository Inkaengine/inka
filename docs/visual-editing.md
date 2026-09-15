---
"@type": Document
UID: docs-visual-editing-001
allow_discussion: false
contributors: []
creators:
  - admin
description: ""
effective: 2025-01-01T00:00:00
exclude_from_nav: false
expires: null
id: visual-editing
is_folderish: false
language: "##DEFAULT##"
layout: document_view
preview_caption: null
preview_image: null
review_state: published
rights: ""
subjects:
  - editing
title: Visual Editing
blocks-matched: |
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
  <block type="title" _="${h1}" />
  <block type="codeExample">
    <region name="tabs" widget="object_list">
      <block type="tab" label="${h3/text}" language="${pre/lang}" code="${pre/text}" />
    </region>
  </block>
---

# Visual Editing

## HTML Annotations for Visual Editing

Add data attributes to your rendered HTML to enable progressively richer visual editing:

- **\`data-block-uid="blockId"\`** — Click-to-select blocks. Hydra.js adds click handlers and shows a blue outline and Quanta toolbar on selected blocks.
- **\`data-edit-text="fieldName"\`** — Inline text editing. For simple text, click and type directly. For rich text (slate widget), select text to apply formatting via the Quanta toolbar.
- **\`data-edit-media="fieldName"\`** — Visual media uploading. Editors can upload, pick or drag-and-drop images directly onto the element.
- **\`data-edit-link="fieldName"\`** — Link editing. Click behaviour is replaced with a link picker to select content, enter an external URL, or open the link.

Example of a fully annotated slide block:

### Html

```html
<div class="slide" data-block-uid="slide-1">
    <img data-edit-media="image" src="/big_news.jpg"/>
    <h2 data-edit-text="title">Big News</h2>
    <div data-edit-text="description">
        Check out <b>hydra</b>, it will change everything
    </div>
    <a data-edit-link="url"
       data-edit-text="buttonText"
       href="/big_news">Read more</a>
</div>
```

**Worked examples:** [Hero Block](./examples/hero.md) — text, rich text, media and link annotations in one block; [Button Block](./examples/button.md) — `data-edit-text` and `data-edit-link` on the same element.

## Comment Syntax

If you can't modify the markup (e.g., using a 3rd party component library), use comment syntax to specify block attributes:

### Html

```html
<!-- hydra block-uid=block-123
     edit-text=title(.card-title)
     edit-media=url(img)
     edit-link=href(a.link) -->
<div class="third-party-card">
  <h3 class="card-title">Title</h3>
  <img src="image.jpg">
  <a class="link" href="...">Read more</a>
</div>
<!-- /hydra -->
```

- Attributes without selectors apply to the root element: `block-uid=xxx`
- Attributes with selectors target child elements: `edit-text=title(.card-title)`
- Closing `<!-- /hydra -->` marks end of scope
- Self-closing `<!-- hydra block-uid=xxx /-->` applies only to next sibling element

Supported attributes: `block-uid`, `block-readonly`, `edit-text`, `edit-link`, `edit-media`, `block-add`

## Optional Fields — empty means absent

Render optional fields **data-driven**: no data, no element. Don't render an empty element just to give the editor something to click — it leaks empty markup into your published page.

### Jsx

```jsx
{block.heading && <h1 data-edit-text="heading">{block.heading}</h1>}
{block.image && <img data-edit-media="image" src={block.image} />}
```

Plain truthiness is enough — you never need `.length` or a null-safe walk. Hydra normalises a field the editor has cleared (widgets write `[]`, which is truthy) to absent before your renderer sees it.

To fill an empty field from the canvas, the editor selects the block and presses **reveal optional fields** in the Quanta toolbar. Hydra feeds your renderer a placeholder value for each empty field, so your own `&&` guard produces the element and it becomes editable. The placeholder exists only in the data handed to your renderer: it is never stored, so fields left unfilled leave no trace in saved content and render nothing in view. Your renderer needs no code for this.

Reveal is best-effort. Hydra offers any field whose type could be edited inline, which it cannot always tell apart from a field you keep in the sidebar (alt text and css classes are strings too). Fields you don't render inline simply don't appear — the editor fills those from the sidebar as usual.

Reveal replaces a per-block boolean only where "has data" and "should render" are the same thing. When they genuinely differ — the author has content but wants it hidden, or a field should appear only in certain configurations — add your own field and drive it with [\`fieldRules\`](./custom-blocks.md#schema-enhancers).

## Allowed Navigation (data-linkable-allow)

Add `data-linkable-allow` to elements that should navigate during edit mode (paging links, facet controls, etc.):

### Html

```html
<a href="/page?pg=2" data-linkable-allow>Next</a>
<select data-linkable-allow @change="handleFilter">...</select>
```

## Field Path Syntax

Every `data-edit-*` attribute — `data-edit-text`, `data-edit-link`, `data-edit-media` — takes a Unix-style **field path**, resolved the same way for all three. A path has two independent axes:

**Which block** (the leading part):

- **\`fieldName\`** — this block's own field (default)
- **\`../fieldName\`** — the parent **block**'s field
- **\`../../fieldName\`** — the grandparent block's field
- **\`/fieldName\`** — a page/root field

`..` always steps up one **block** — never an object or region level (see below).

**Where inside the block** (`/` descends objects):

- **\`content/headline\`** — descend a [\`widget: 'object'\`](./container-blocks.md#widget-object-nesting-fields-and-containers-inside-a-block-field)

field to a nested field (the key mirrors the storage path, `block.content.headline`)

The two compose: `../content/headline` is "the parent block, its `content.headline`". `/` descends objects only — a region (`object_list` / `blocks_layout`) or a value is the end of a path (a region's children are separate blocks with their own `data-block-uid`).

### Html

```html
<!-- page fields (not inside any block) -->
<h1 data-edit-text="/title">My Page Title</h1>
<p  data-edit-text="/description">Page description here</p>

<!-- inside a nested block, edit the parent container's title -->
<h3 data-edit-text="../title">Column Title</h3>

<!-- fields nested on a widget:'object' — text, link and media all use the same path -->
<h3 data-edit-text="content/headline">…</h3>
<a  data-edit-link="content/href">…</a>
<img data-edit-media="content/image" />
```

This lets fixed parts of the page (headers), parent-block fields, and fields grouped inside an object all be edited in place, with one addressing model.

### Where a page field comes from

A `/fieldName` path resolves against the **content type's schema**, not against anything the frontend declares. The admin reads the schema for the content being edited and hands the bridge a field type per property (`View.jsx` `extractBlockFieldTypes`: *"page-level field types from content type schema … accessed via /fieldName"*). So `data-edit-text="/title"` works on any content type with a `title`, and `data-edit-text="/effective"` works on one that has an `effective` — no registration step.

The corollary matters, because getting it wrong is silent: **do not add page metadata to \`initBridge\`'s \`page.schema.properties\`.** That schema lists the page's *blocks fields* (its regions), and the admin turns every entry in it into a region — `widget: 'blocks_layout'` is stamped on and an empty `blocks_layout[<name>]` minted. Declaring `title`/`effective` there gives the page phantom empty regions; page-level selection then lands on one of them, and `Cmd+A` selects one block where it should select all siblings.

If a field is annotated but clicking it does nothing, the field is missing from the content type's schema — the annotation renders either way, since the DOM knows nothing about schemas.

## Readonly Regions

Add `data-block-readonly` (or `<!-- hydra block-readonly -->` comment) to disable inline editing for all fields inside an element:

### Html

```html
<div class="teaser" data-block-uid="teaser-1">
  <div data-block-readonly>
    <h2 data-edit-text="title">Target Page Title</h2>
  </div>
  <a data-edit-link="href" href="/target">Read more</a>
</div>
```

Or using comment syntax:

### Html

```html
<!-- hydra block-readonly -->
<div class="listing-item" data-block-uid="item-1">...</div>
```

`data-block-readonly` is *your* call — use it when your frontend wants to lock a block for its own reasons (a teaser mirroring another page, a listing item).

You do **not** need it for template content. Hydra already knows which blocks a template marks read-only from the block data and enforces that itself, so your renderer doesn't need to detect template blocks or mark them.

## Renderer Node-ID Rules

When rendering Slate nodes to DOM, your renderer must follow these rules for `data-node-id`:

1. Element nodes (`p`, `strong`, `em`, etc.) must have `data-node-id` matching the Slate node's `nodeId`
2. Wrapper elements — If you add extra wrapper elements around a Slate node, ALL wrappers must have the same `data-node-id` as the inner element

hydra.js uses node-ids to map between Slate's data model and your DOM. When restoring cursor position after formatting changes, it walks your DOM counting Slate children.

### Html

```html
Valid wrapper pattern:
<strong data-node-id="0.1"><b data-node-id="0.1">bold</b></strong>
Both elements have the same node-id, so they count as one Slate child.

Invalid (missing node-id on wrapper):
<span class="my-style"><strong data-node-id="0.1">bold</strong></span>
This breaks cursor positioning because hydra.js can't correlate DOM structure to Slate structure.
```

## Non-editable content inside a slate field

Sometimes a renderer adds elements to slate output that are **not** part of the editable content — a decorative icon (an "opens in a new tab" glyph), a generated chip, an embedded non-editable widget. These have no `data-node-id` (they aren't Slate nodes), and they must be marked so that **both** the editor's caret and hydra's DOM→Slate reader skip them:

- **\`contenteditable="false"\`** — the browser treats the element as a

non-editable island: the caret steps over it, backspace/delete removes it as a   unit, and selection includes it whole. Add this to anything that must not be   typed into.

- **\`aria-hidden="true"\`** — for purely decorative chrome (e.g. icons), so

assistive tech ignores it too.

hydra's DOM→Slate reader skips any child (without a `data-node-id`) that carries **either** attribute — treating it as chrome, not content. Without this, the element's text would be read back into the Slate value on every edit / select / delete over it, corrupting the value.

### Html

```html
An <a data-node-id="0.1">external link<span class="external-icon"
  aria-hidden="true" contenteditable="false">&#8599;</span></a>
The icon is decoration: the caret skips it and it never enters the value.
```

Contrast this with the wrapper rule above: a wrapper that holds real content carries the inner node's `data-node-id` (and neither of these attributes), so it IS read; decorative / non-editable chrome carries these attributes and is skipped.

## One top-level node per slate field

A slate field's `value` is an array, but it always holds exactly **one top-level node** — a single paragraph, heading, list, or blockquote. Inline content (bold, links, …) lives in that node's `children`.

Editing can transiently produce more than one top-level node — pasting multiple paragraphs, pressing Enter, or a Backspace that demotes a list item to a paragraph (`[ul, p]`). Hydra normalizes that immediately:

- **Split** — when the field is the `value` of a `slate` block, each extra

node becomes its own `slate` block, inserted after the original in the   same container (`blocks_layout` or `object_list`). This is how pressing   Enter in a text block produces a new block.

- **Flatten** — when the field *can't* be split — a slate field of a

non-slate block (e.g. a `slateTable` cell's `value`), a slate field nested   on a `widget: 'object'` (`content/headline`), or a container that's full or   in table mode — the extra nodes' content merges back into the first node.   No text is lost.

A frontend renderer can therefore always assume one top-level node per slate field; it never has to handle a multi-node `value`.

**Worked example:** [Table Block](./examples/table.md) — a slate value per cell, each its own field.

## Complete Slate Rendering Example

Slate data structure (value is an array but always contains a single root node):

### Json

```json
{
  "value": [
    {
      "type": "p", "nodeId": "0",
      "children": [
        { "text": "Hello " },
        { "type": "strong", "nodeId": "0.1",
          "children": [{ "text": "world" }] },
        { "text": "! Visit " },
        { "type": "link", "nodeId": "0.3",
          "data": { "url": "/about" },
          "children": [{ "text": "our page" }] }
      ]
    }
  ]
}
```

Renderer:

### Javascript

```javascript
function renderSlate(nodes) {
  return (nodes || []).map(node => {
    if (node.text !== undefined) return escapeHtml(node.text);
    const tag = { p:'p', h1:'h1', h2:'h2', strong:'strong',
                  em:'em', link:'a' }[node.type] || 'span';
    const attrs = node.type === 'link'
      ? ` href="${node.data?.url || '#'}"` : '';
    return `<${tag} data-node-id="${node.nodeId}"${attrs}>${renderSlate(node.children)}</${tag}>`;
  }).join('');
}
```

Usage:

### Html

```html
<div data-block-uid="block-1" data-edit-text="value">
  <!-- renderSlate(block.value) output goes here -->
</div>
```

**Worked example:** [Slate (Text) Block](./examples/slate.md) — the block itself, rendered per stack.
