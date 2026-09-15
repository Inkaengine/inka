---
"@type": Document
UID: docs-what-editors-will-experience-001
allow_discussion: false
contributors: []
creators:
  - admin
description: This guide is for content editors using an Inka-powered site. It
  covers how to use the editor — how to select things, edit text, add and move
  blocks, work with containers and templates — without assuming you know how the
  site was built.
effective: 2025-01-01T00:00:00
exclude_from_nav: false
expires: null
id: what-editors-will-experience
is_folderish: true
language: "##DEFAULT##"
layout: document_view
preview_caption: null
preview_image: null
review_state: published
rights: ""
subjects:
  - editing
title: Editor Guide
blocks-matched: |
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
  <block type="title" _="${h1}" />
  <block type="image" description="${p?/text}" url="${img/src}" alt="${img?/alt}" title="${img?/title}" align="center" size="l" />
  <block type="image" url="${img/src}" alt="${img?/alt}" title="${img?/title}" align="center" size="l" />
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
order:
  - selecting-blocks
  - editing-text
  - links-and-media
  - adding-and-moving-blocks
  - containers
  - templates-and-layouts
---

# Editor Guide

This guide is for **content editors** using an Inka-powered site. It covers how to use the editor — how to select things, edit text, add and move blocks, work with containers and templates — without assuming you know how the site was built.

## Inka mechanics vs your site's design system

Two layers are stacked on the editor screen:

- **Inka's mechanics** — the toolbar, sidebar, selection borders, Quanta toolbar, slash menu, link picker, image picker, container operations. These look and behave the same on every Inka-powered site, and this guide covers them.
- **Your site's design system** — what block types exist, how they render, which fields are inline-editable, the names you see in menus. The live preview comes straight from your frontend, so a "paragraph" might be called "Lead paragraph", an image block might have a caption your developers added, the slash-menu list of available block types reflects what your site registered. The mechanics are the same; only the labels and visuals change.

If something in this guide doesn't match what you see, it's almost always because your design system named or styled it differently — the underlying interaction is still the same.

## What you see

The editor screen has three regions:

### Text

```text
┌───────────┬──────────────────────────────────┬──────────────┐
│           │                                  │              │
│  Toolbar  │   Live preview (your frontend)   │   Sidebar    │
│           │                                  │              │
│  • Save   │                                  │   Page title │
│  • Pages  │  Click anywhere here to edit.    │   Block list │
│  • Site   │                                  │   Settings   │
│           │                                  │              │
└───────────┴──────────────────────────────────┴──────────────┘
```

- **Toolbar (left)** — saving, navigating to other pages, site settings. Standard Volto, plus the **Frontend switcher** (see below).
- **Live preview (centre)** — your actual frontend, running inside an iframe. This is what readers will see. Click directly into the preview to edit.
- **Sidebar (right)** — when no block is selected, lists the page-level fields (title, description, blocks). When a block is selected, shows that block's settings, the chain of parent containers, and (for container blocks) the list of children. See [Selecting blocks](./selecting-blocks.md) for the navigation patterns.

### Frontend switcher

A toolbar button opens the **Frontend switcher** panel with two sections:

- **Viewport** — preview the page at common screen sizes (desktop, tablet, mobile). Pure visual switch — no content change.
- **Frontend** — list of saved frontend URLs the editor can switch between. Picking one swaps the iframe to that frontend immediately. Same content, different rendering — an Inka-defining feature: edit a page once, see it on the marketing site, the docs site, the mobile app's web version, and the email-renderer in turn without leaving the page.

A **Settings** button at the bottom of the panel manages the saved URLs (add, remove, rename). The currently active frontend is highlighted in the list.

<block type="image">

![Frontend switcher panel — Viewport section with Mobile/Tablet/Desktop, Frontend section listing four saved frontends, Settings button at the bottom.](/docs/images/frontend-switcher.png)

</block>

## Two ways to edit any field

Most fields can be edited from either side:

- **From the preview** — click the rendered text/image/link directly and start typing or replacing media.
- **From the sidebar** — find the field in the block's settings panel and edit it there.

Sidebar editing is always available. Inline editing depends on the frontend supporting it for that field; some fields show a thin underline when hovered to signal they're inline-editable. Either way the result is the same — there's only one source of truth.

## What's a block?

A block is a discrete piece of page content with a type (slate, image, listing, slider, etc.), a schema (its fields), and a position. Blocks can be added, removed, moved, and configured. Some blocks contain other blocks — those are called **container blocks** (columns, accordion, slider, grids, sections).

The page itself is a list of blocks (sometimes split across multiple regions like header / content / footer). When you click into the preview, you're clicking on a block.

## When in doubt — Escape

Pressing `Escape` is always safe. It progressively backs out:

1. If you're typing in a text field → leaves text editing, the block stays selected.
2. If a block is selected (block mode) → goes up to the parent container.
3. If nothing is selected → no-op.

So `Escape` repeatedly takes you up one level at a time. See [Selecting blocks](./selecting-blocks.md) for what selection looks like at each level.

## Editing on a phone

On narrow screens (≤767 px) the editor reshapes into a two-bar layout: the **Quanta toolbar** pins to the top of the viewport — always visible, never fades — and the **main toolbar** (Save, Cancel, Frontend switcher, Settings shortcut) sits as a compact bar at the bottom. The iframe canvas fills the space in between. There is no side panel: the sidebar opens as a full-screen sheet, popups slide up from the bottom, and the link editor takes over the top bar.

<block type="image">

![Mobile editing — Quanta toolbar pinned at the top with chevrons and format buttons, a slate block selected mid-screen with its selection outline, and the compact main toolbar at the bottom.](/docs/images/mobile-block-selected.png)

</block>

### Bottom-sheet popups

The `⋯` menu — and every other contextual chooser (block-type picker, frontend switcher, convert chooser) — slides up from the bottom of the screen with the canvas dimmed behind. Tap the back arrow at the bottom-left of the sheet to dismiss; the canvas underneath comes back unchanged.

<block type="image">

![Mobile ⋯ menu as a slide-up bottom sheet showing Settings, Make Template, Copy, Cut, Remove with a back arrow at the bottom-left and the canvas dimmed behind it.](/docs/images/mobile-dropdown-menu.png)

</block>

### Sidebar as a full-screen sheet

A side panel is impossible on a 375 px screen. Instead, opening the sidebar (via the **Settings** shortcut in the main toolbar, or by choosing **Settings** in the `⋯` menu) covers the entire viewport. The `X` button in the top-right closes it and brings you back to the canvas. While the sidebar is open, the iframe is hidden behind it — same source of truth, just a different surface.

<block type="image">

![Mobile sidebar as a full-screen sheet showing the Page header with an X close button, the DEFAULT section open with Title and Summary fields, and the DATES section below.](/docs/images/mobile-sidebar-fullscreen.png)

</block>

### Escaping nested blocks with `⬆`

Phones don't have an `Escape` key. To walk back up out of a nested block (a teaser inside a grid, a paragraph inside a column), the Quanta toolbar shows an extra **\`⬆\` button** to the left of `⋯` whenever the selected block has a parent. One tap selects the parent container; tap again to keep walking up.

<block type="image">

![Mobile Quanta toolbar with a nested teaser selected — the ⬆ select-parent button is visible to the left of ⋯, and the teaser's grid parent is highlighted with a dashed selection outline.](/docs/images/mobile-select-parent.png)

</block>

### Differences from desktop in one place

<block type="slateTable" table.fixed table.celled>

| Desktop / tablet | Mobile (≤767 px) |
| --- | --- |
| Quanta floats near the block, can fade after idle | Quanta pinned to top, always visible |
| Main toolbar on the left, full height | Main toolbar at the bottom, 44 px compact |
| Sidebar on the right as a side panel | Sidebar covers the whole screen |
| `⋯` menu drops down inline | `⋯` menu slides up as a bottom sheet |
| `Escape` key walks selection up | Tap the `⬆` button in Quanta |

</block>

Otherwise everything works the same: tapping a block selects it, tapping into text starts editing, the same fields and the same blocks. The mechanics are unchanged — only the placement and gestures differ.
