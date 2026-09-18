---
"@type": Document
UID: docs-what-editors-will-experience-adding-and-moving-blocks-001
allow_discussion: false
contributors: []
creators:
  - admin
description: The block chooser, slash menu, and drag handles are part of Inka
  and look the same everywhere. What you can pick from those choosers — the list
  of block types — comes from your site's design system. One site might offer
  "Lead paragraph", "Pull quote", "Stat highlight"; another might just have
  "Text" and "Image". Mechanic is identical.
effective: 2025-01-01T00:00:00
exclude_from_nav: false
expires: null
id: adding-and-moving-blocks
is_folderish: false
language: "##DEFAULT##"
layout: document_view
preview_caption: null
preview_image: null
review_state: published
rights: ""
subjects: []
title: Adding and moving blocks
blocks-matched: |
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
  <block type="title" _="${h1}" />
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

# Adding and moving blocks

The block chooser, slash menu, and drag handles are part of Inka and look the same everywhere. What you can pick from those choosers — the list of block types — comes from your site's design system. One site might offer "Lead paragraph", "Pull quote", "Stat highlight"; another might just have "Text" and "Image". Mechanic is identical.

## Adding a block

Three ways:

### "+" button in the preview

Hover or select a block in the preview. A "+" button appears outside one corner of it (typically below for vertical layouts, to the right for horizontal). Click it to open the **block chooser** — a popup listing the block types allowed at that position.

The chooser is filtered: it only shows block types that fit the surrounding container's `allowedBlocks`. Block types are grouped (Common, Site, Custom, Templates) and typically a "Most used" group is pinned to the top.

### Slash menu (in an empty text block)

Type `/` at the start of an empty text block (a fresh paragraph or a paragraph you've cleared). The slash menu opens with the list of block types you can convert to. Keep typing to filter; `Enter` picks; `Escape` dismisses.

This is the fastest way to add a heading, image, embed, or other block while you're already typing — no mouse needed.

### Enter from a selected block (block mode)

Press `Escape` to enter block mode, then `Enter`. A new block is created **after** the current one, of the most appropriate default type (or the only type allowed in the current container if there's just one).

If the current block is itself a container, `Enter` creates a new container of the same type and the cursor lands inside it on the first typeable leaf — so you can keep typing without aiming. Useful for sliders, columns, accordions: hit `Enter` once and you're already in the next slide / column / panel.

## Moving a block

### Drag and drop

Each selected block has a **drag handle** in the Quanta toolbar above it. Click and drag from there to move the block somewhere else. While dragging:

- A **line indicator** shows where the block will land between siblings.
- A **shaded overlay** highlights the whole drop target when you hover over an empty container — dropping there places the block as the container's first child (replacing the empty placeholder rather than landing as a sibling).
- The page auto-scrolls when you drag near the top or bottom of the viewport.

Drop targets are filtered by `allowedBlocks` — the line/shade indicator only appears where the block can land. This **includes regions that don't accept the block directly but accept a type it can convert to**: dropping there converts the block on the fly — silently when only one target type is possible, or via a small chooser when several are (pick one, or dismiss to cancel the move). So a "Text" block can be dropped into a region that only takes "Cards" and it becomes a Card on drop.

### Reordering from the sidebar

The sidebar's children list (visible when a container block is selected) has a drag handle (`⋮⋮`) on each child row. Drag it up or down to reorder children **within** the same container. Useful when the children are paged (slides of a slider, panels of an accordion) and you can't drag in the preview because only one is visible at a time. See [Selecting blocks › The children list](./selecting-blocks.md#the-children-list-going-down).

### Cut / copy / paste

Standard keyboard shortcuts work on the selected block(s):

- `Cmd/Ctrl+C` — copy
- `Cmd/Ctrl+X` — cut (block disappears from the original spot when you paste)
- `Cmd/Ctrl+V` — paste at the current selection

This works across pages — copy a block on one page, navigate to another, paste. Paste also **converts** like drag-and-drop: pasting into a region that only accepts a type the block can convert to converts it on paste. On touch devices, where dragging between distant spots is awkward, cut-and-paste is the easiest way to move (and convert) a block.

### Block-mode keyboard

In block mode (after pressing `Escape`):

<block type="slateTable" table.fixed table.celled>

| Key | Effect |
| --- | --- |
| `Arrow Up` / `Arrow Down` | Move selection to previous / next sibling |
| `Enter` | Add a new block after this one |
| `Delete` / `Backspace` | Remove the selected block(s) |
| `Escape` | Go up to the parent container (or deselect) |

</block>

`Arrow Up/Down` is **container-aware** — it walks across container boundaries. Pressing Down on the last block of a column jumps into the next column rather than getting stuck.

## Working with multiple blocks at once

If you've selected multiple blocks (see [Selecting blocks](./selecting-blocks.md)):

- **Drag and drop** — works on the whole group; line indicator shows where the group will land.
- **Delete** — removes all selected blocks.
- **Wrap / Convert / Cut / Copy / Paste** — all apply to the group. See [Containers](./containers.md) for wrap.

## Empty containers

Container blocks can never be truly empty — when the last child is deleted, the container shows a placeholder block in its place, with a "+" in the middle for adding the next block. The placeholder is stripped automatically when you save, so it never ends up in the saved page.

Drop a block onto an empty container and it replaces the placeholder rather than landing alongside it.
