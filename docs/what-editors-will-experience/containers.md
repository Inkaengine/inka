---
"@type": Document
UID: docs-what-editors-will-experience-containers-001
allow_discussion: false
contributors: []
creators:
  - admin
description: A container block holds other blocks inside it — sliders, columns,
  accordions, grids, generic sections. The blocks inside are called its
  children. Containers can be nested (a column inside a row inside a section).
effective: 2025-01-01T00:00:00
exclude_from_nav: false
expires: null
id: containers
is_folderish: false
language: "##DEFAULT##"
layout: document_view
preview_caption: null
preview_image: null
review_state: published
rights: ""
subjects: []
title: Containers
blocks-matched: |
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
  <block type="callout">
    <region name="items" widget="blocks_layout">
      <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
    </region>
  </block>
  <block type="title" _="${h1}" />
  <block type="image" description="${p?/text}" url="${img/src}" alt="${img?/alt}" title="${img?/title}" align="center" size="l" />
  <block type="image" url="${img/src}" alt="${img?/alt}" title="${img?/title}" align="center" size="l" />
---

# Containers

A **container block** holds other blocks inside it — sliders, columns, accordions, grids, generic sections. The blocks inside are called its **children**. Containers can be nested (a column inside a row inside a section).

This page covers operations that change container structure: wrap a selection, unwrap a container, drag the edge of a container to absorb or expel adjacent blocks, and convert a container's type while keeping the children.

<block type="callout" variation="note">

Which container types are available depends on your design system. A site might offer columns, accordions, sliders, and generic sections; another might only have a single "section" container with style variants. The wrap / unwrap / edge-drag / convert mechanics work the same regardless — the chooser just shows whatever your site registered.

</block>

## Wrap

Select one or more blocks (see [Selecting blocks](./selecting-blocks.md)), then choose **Wrap in...** from the Quanta toolbar dropdown (or sidebar block actions). A popup shows container types that:

1. Accept every selected block type (their `allowedBlocks` covers the selection).
2. Are themselves allowed in the current parent container.

Pick one. The selected blocks are pulled out of their original positions and placed as children of the new container, in the original order. The new container takes the first selected block's position.

<block type="image">

![Two adjacent paragraphs multi-selected, "Wrap in..." chooser open showing container types in Most Used / Common groups.](/docs/images/wrap-chooser.png)

</block>

Use this to retroactively group content — e.g. wrap two paragraphs and an image into a card, or wrap three columns of content into a row.

## Unwrap

Select a container in block mode (one Escape from text mode). Choose **Unwrap container** from the Quanta toolbar dropdown.

The container's children are promoted to the parent at the container's position, and the container itself is removed.

Unwrap is **disabled** when the parent wouldn't accept some of the children — for example, if the children are columns and the parent's `allowedBlocks` doesn't include columns. Hover the disabled action for the reason.

## Edge-drag

When a container is selected (block mode), thin **edge handles** appear on the container's borders. Drag a handle:

- **Outward** — the adjacent block(s) on that side get **absorbed** into the container as new children.
- **Inward** — the edge-most child blocks of the container get **expelled** to the parent at the container's position.

Multiple blocks can cross in a single drag — keep dragging and a "ghost boundary" line shows where the new edge will land. Release to commit. Until release, the page DOM is unchanged; you can drag back across blocks to restore.

<block type="callout" variation="note">

**Cross-axis neighbours move as a single atom.** If you drag a column's right edge into the next column, that next column's whole vertical stack of children gets absorbed — there's no useful midpoint to land between them on the horizontal drag axis. For vertical-axis containers absorbing loose siblings, blocks are absorbed one at a time as the cursor crosses each midpoint.

</block>

<block type="image">

![Container selected with edge handles visible. The bottom handle is being dragged toward the next sibling.](/docs/images/edge-drag-ghost.png)

</block>

This makes a container feel like a resizable divider: drag its edge to "grow" it across adjacent content rather than dragging blocks one at a time.

Edge handles only appear when the container is selected. They don't render on edges where there's nothing to do (the page edge, or against a fixed/readonly block that can't be moved).

## Convert (change container type)

In the Quanta toolbar dropdown, **Convert to...** lists block types this block can be converted to. For containers, conversion preserves the children:

- **Layout shape conversion** — children move into the new container's layout field automatically (whether the source uses `blocks_layout` or `object_list`).
- **Recursive child conversion** — if some children's `@type` isn't in the target's `allowedBlocks`, those children are themselves converted (using their `fieldMappings`) so they fit. If no path exists, the conversion target is shown disabled with a tooltip.

![A grid container selected, "Convert to..." chooser open showing compatible target container types.](/docs/images/container-convert.png)

<block type="slate">

Use this to reshape an existing layout — e.g. a 2-column row into a 3-column grid, or columns into an accordion.

</block>

## The `section` block

`section` is a generic container that accepts any child block type. It's useful when you don't have a more specific container for what you're building — a "marketing section", a "case study block", a "page break with anything inside". Frontends typically render it as a `<section>` element with optional styling.

## Limits

- A container with `fixed` or `readOnly: true` (typically inherited from a template) can't be unwrapped or have its children rearranged via edge-drag. You can still edit child blocks if the children themselves aren't readonly.
- A container's `maxLength` caps how many children it can hold — wrap and edge-drag respect this. The action shows disabled with a tooltip if respecting it would mean refusing the operation.
- When dragging children **between** containers via edge-drag, the destination's `allowedBlocks` filter still applies. A block that's not in the target's `allowedBlocks` is skipped from the absorb plan.

## Things still on the roadmap

- **Split** — drag a container's edge outward through itself to create a sibling container of the same type with the children divided between them.
- **Merge** — combine two adjacent same-type containers into one.
- **Tab / Shift+Tab** — keyboard nest / unnest from inside a container.
- **Sidebar drag-to-reparent** — drag a block in the sidebar outline to move it under a different parent.
