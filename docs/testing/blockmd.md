---
"@type": Document
UID: docs-blockmd-001
allow_discussion: false
contributors: []
creators:
  - admin
description: Author Plone block content as readable Markdown. One loader turns a
  .md file into block JSON, so the same file is the content the API serves, the
  deploy ships, and the docs render — with no JSON to hand-edit.
effective: 2025-01-01T00:00:00
exclude_from_nav: false
expires: null
id: blockmd
is_folderish: false
language: "##DEFAULT##"
layout: document_view
preview_caption: null
preview_image: null
review_state: published
rights: ""
subjects:
  - blocks
  - content
title: Content as Markdown
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

# Content as Markdown

Block content in this project is authored as readable Markdown — a format we call **blockmd**. A single loader turns each `.md` file into the block JSON that the API serves, the deploy ships, and the documentation site renders. You write the Markdown; the JSON is generated, so there is nothing to hand-edit and nothing to keep in sync.

## A document is frontmatter plus a body

The frontmatter carries the page's own fields — its type, title, description, and workflow state. The body is the block content: plain prose, headings, and lists become blocks on their own, and an explicit tag is used only where the shape needs one.

### Markdown

```markdown
---
"@type": Document
title: About
description: Why this exists…
review_state: published
---

Plain prose becomes a text block. No wrapper needed.

## A heading is a text block too

A list, a quote, and a horizontal rule each map to their own block.
```

Two frontmatter sections, `blocks-matched` and `blocks-tagged`, describe how the body decodes — they are the mapping that lets a page be read back into blocks without a stored schema. Everything below is about writing that body.

## Three ways a block appears

A block shows up in the body in the cheapest form that can carry it:

- **Bare Markdown** — prose, a heading, a list, a fenced code block, a rule. It matches a *matched* prototype (usually the text block) with no wrapper at all.
- **A paired tag**, `<block type="…"> … </block>` — an explicit block, a container that holds regions of children, or a block that needs a field its plain Markdown cannot express.
- **A self-closing tag**, `<block type="…" … />` — the escape hatch, a raw block built from its attributes, with `data='{…}'` carrying any object fields verbatim.

Headings written inside a container are interpreted **relative** to that container, so a panel or section reads naturally as `##` no matter how deeply it is nested.

## Prototypes: matched versus tagged

A *prototype* maps a Markdown shape to a block type. It is written as a block tag whose fields hold `${…}` references, and which of the two frontmatter sections it lives in decides how it is matched:

- **`blocks-matched`** prototypes are matched **implicitly**, from bare Markdown. Order is a cascade, like CSS: the most specific prototype wins — specificity being the number of concrete node kinds it names — and ties go to the one declared later. That is why the text block is declared before `title`: a top heading ties on specificity, and the later `title` takes it.
- **`blocks-tagged`** prototypes match **only** when you write their `<block type="…">` tag. Use them for a shape too ambiguous to read from bare Markdown — a variable-shape container, or a leaf whose pattern would otherwise hijack a common reading. A teaser is a heading-with-a-link followed by prose, for instance, but you rarely want every such pair to silently become one, so a teaser is tagged.

## References

An attribute value is either a plain JSON scalar or a `${…}` reference; the two can never collide, because `${` is not a JSON token. A reference has three parts — a **type**, an optional **selector**, and an **accessor** — written as `${ type[selector]/accessor }`.

### Markdown

```markdown
<block type="heading" text="${h1/text}" tag="h${1/level}" />
<block type="callout" value="${p,blockquote/slate}" />
<block type="separator" _="${hr}" />
```

The first line reads the first heading's text and interpolates its level into a tag name. The second accepts a set of node kinds — any paragraph or quote — as a rich value. The third is *match-only*: the `_` field consumes the rule and stores nothing.

Selectors pick *which* node, by position or by label rather than by CSS (CSS cannot match on text):

- no selector — the first node of that kind
- `[2]` — the second, by position
- `[Summary]` — scoped to the section under a `## Summary` heading, by label text
- `[Summary][2]` — chained: the second, within that section

A trailing `?` marks a reference **optional** — matched when the node is present, skipped when it is absent (an optional subtitle, an image with no title string).

The node kinds a reference can target are the familiar Markdown ones: `p`, `h1`–`h6` (or `h` relative, `h*` for any), `img`, `a`, `ul`, `ol`, `li`, `blockquote`, `pre` (a fenced code block), `hr`, `table`, a lone-bold `strong` or lone-italic `em` paragraph, and a `dl` / `dt` / `dd` definition list.

The accessor after the slash says what to read:

- `text` — the node's text (from any node)
- `slate` — the node as a rich value (from any node)
- `src`, `alt`, `title` — an image's url, alt text, or title string
- `link` — a link target, stored as the object-browser form (`[{"@id": url}]`)
- `lang`, `text`, `meta` — a fenced block's language, code, or info string
- `level` — a heading's depth, for composing a tag name

Note that `src` and `link` name different fields, not two spellings of one: `src` is a bare source url (an image's `url`), while `link` is a link target in the object-browser form (a button or teaser `href`).

## Regions hold a container's children

A container names each region of children with a `<region>` tag and the widget that region uses.

### Markdown

```markdown
<block type="gridBlock">
  <region name="items" widget="blocks_layout">
    <block type="teaser" title="${h/text}" description="${p/text}" />
  </region>
</block>
```

A **`blocks_layout`** region is an ordered sequence of blocks — the standard shape, a `blocks` dictionary plus a `blocks_layout.items` order. It decodes using the global prototypes **plus** any the region scopes locally, so a grid can make a teaser prototype active only inside itself: the same `heading + copy + image` that is plain text elsewhere on the page becomes a card in the grid.

An **`object_list`** region is a list of typed items — accordion panels, code-example tabs — split out of a flat stream at each item's anchor, or iterated from an already-nested node's children (a table's rows and cells). A region name may be a dotted path such as `table.rows`.

You never author item ids or block uids — the loader mints them, deterministically.

## Attaching fields with `<fields>`

The `<fields>` tag sets field values on the blocks in its scope, and its form chooses that scope:

- **Self-closing**, `<fields align="left" />`, sets fields on the block it sits inside — the way to carry a field, such as `styles`, that a block's clean Markdown cannot.
- **Enclosing**, `<fields slotId="rendering"> … </fields>`, sets fields on every block it wraps, as defaults: a wrapped block's own value wins, and nested wrappers merge outer-into-inner. This is how a field shared across a run of blocks is hoisted out so the bodies stay readable.

## Typed attributes

An attribute's type comes from how it is written, with no schema involved:

- a bare name, `collapsed`, is boolean `true`
- an unquoted value, `size=3`, is coerced — number, boolean, null, or JSON
- a double-quoted value, `title="Hi ${1/text}"`, is a string (so any references inside it survive)
- a single-quoted `data='{ … }'` carries raw JSON object fields verbatim

## The fallback chain

Every block is written in the cheapest form that still reproduces it, stepping down only as needed: bare Markdown, then a light `<block>` tag, then a clean body with a `<fields>` tag, and finally a self-closing tag carrying `data='{…}'`. The last form always works, because it holds the block's full data, so nothing is ever lost — an irregular block simply falls further down the chain. Equality along the way is judged by meaning, ignoring derived or empty values, so a clean block is never pushed down the chain over incidental noise.

## A single source of truth

The Markdown is the source; the block JSON is a generated artifact. There is no stored JSON to edit and no round-trip to keep byte-identical — a page is correct because the loader can decode it and the shared content validator accepts it, not because it matches a saved copy. Block uids are minted by the loader rather than authored, so moving or copying a block is just moving or copying its Markdown.

## Where to look next

The richest examples are the documentation pages themselves and the block reference under [Examples](../examples/index.md) — every one is a blockmd file you can open and copy. To render, preview, and test this content locally, see [Previewing and Testing Content](./testing-content.md), which serves these same `.md` files as a Plone REST API.
