---
"@type": Document
UID: 2508797173824f0e9f82bb2e7cfe922d
allow_discussion: false
contributors: []
creators:
  - admin
description: The Text Block allows you to add text to a web page. The text can
  be formatted and structured in different ways (bold, headings, etc.).
effective: 2023-07-06T18:35:00
exclude_from_nav: false
expires: null
id: slate
is_folderish: true
language: "##DEFAULT##"
layout: document_view
preview_caption: null
preview_image:
  blob_path: examples/slate/preview_image/black-starry-night.jpg
  content-type: image/jpeg
  filename: black-starry-night.jpg
  height: 1708
  size: 693013
  width: 2400
review_state: published
rights: ""
subjects:
  - blocks
  - text
  - editing
title: Text
blocks-matched: |
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
  <block type="title" _="${h1}" />
  <block type="separator" _="${hr}" styles={"align":"full"} />
  <block type="image" description="${p?/text}" url="${img/src}" alt="${img?/alt}" title="${img?/title}" align="center" size="l" />
  <block type="codeExample">
    <region name="tabs" widget="object_list">
      <block type="tab" label="${h3/text}" language="${pre/lang}" code="${pre/text}" />
    </region>
  </block>
blocks-tagged: |
  <block type="callout">
    <region name="items" widget="blocks_layout">
      <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
    </region>
  </block>
---

# Text

Rich text block powered by the Slate editor. Supports paragraphs, headings, lists, blockquotes, and inline formatting (bold, italic, strikethrough, underline, code, links).

<block type="image">

![The slate example block being edited in Inka](../images/slate-edit.png)

</block>

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.

<block type="separator" />

**This is bold text.**

*This is Italics.*

<block type="slate" data-json='{"value":[{"children":[{"text":""},{"children":[{"text":""}],"type":"em"},{"text":""},{"children":[{"text":"This is link."}],"data":{"url":"https://www.google.com/"},"type":"link"},{"text":""}],"type":"p"}]}' />

## This is H2

### This is H3

1. one
2. two
3. three

- This is unordered list
- This is unordered list
- This is unordered list

<block type="separator" />

<block type="heading" data-json='{"alignment":"left","tag":"h2","heading":" Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet. "}' />

<block type="separator" />

## Überschrift zweiter Ordnung (Headline H2)

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.

### Überschrift dritter Ordnung (Headline H3)

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet

<fields templateId="/templates/block-reference-layout" templateInstanceId="tpl-inst-text" data-json='{"fixed":false,"readOnly":false}'>

<block type="codeExample" slotId="schema">

### Schema

```{literalinclude} ../../tests-playwright/fixtures/shared-block-schemas.js
:jsobject: slate
```

</block>

<block type="codeExample" slotId="json-data">

### JSON

```{literalinclude} ./slate.md
:block: slate
:as: json
```

</block>

<fields slotId="rendering">

<block type="callout" variation="note">

The Astro examples below omit `data-block-uid` on the block's root element because `BlockRenderer.astro` wraps every block in `<div data-block-uid={uid}>`. See [Server-rendered frontends](../frontend-guide/server-rendered-frontends.md) for why.

</block>

### React

```jsx
function SlateBlock({ block }) {
  return (
    <div data-block-uid={block['@uid']} data-edit-text="value">
      {(block.value || []).map((node, i) => (
        <SlateNode key={i} node={node} />
      ))}
    </div>
  );
}

function SlateNode({ node }) {
  if (node.text !== undefined) return <>{node.text}</>;
  const children = (node.children || []).map((c, i) => <SlateNode key={i} node={c} />);
  const Tag = node.type === 'link' ? 'a' : node.type;
  const props = { 'data-node-id': node.nodeId };
  if (node.type === 'link') props.href = node.data?.url;
  return <Tag {...props}>{children}</Tag>;
}
```

### Vue

```vue
<!-- SlateBlock.vue -->
<template>
  <div :data-block-uid="block['@uid']" data-edit-text="value">
    <SlateNode v-for="(node, i) in block.value || []" :key="i" :node="node" />
  </div>
</template>

<script setup>
defineProps({ block: Object });
</script>

<!-- SlateNode.vue -->
<template>
  <template v-if="!node.type">{{ node.text }}</template>
  <a v-else-if="node.type === 'link'" :href="node.data?.url" :data-node-id="node.nodeId">
    <SlateNode v-for="(c, i) in node.children" :key="i" :node="c" />
  </a>
  <component v-else :is="node.type" :data-node-id="node.nodeId">
    <SlateNode v-for="(c, i) in node.children" :key="i" :node="c" />
  </component>
</template>

<script setup>
defineProps({ node: Object });
</script>
```

### Svelte

```svelte
<!-- SlateBlock.svelte -->
<script>
  import SlateNode from './SlateNode.svelte';
  export let block;
</script>

<div data-block-uid={block['@uid']} data-edit-text="value">
  {#each block.value || [] as node, i (i)}
    <SlateNode {node} />
  {/each}
</div>

<!-- SlateNode.svelte -->
<script>
  export let node;
</script>

{#if node.text !== undefined}
  {node.text}
{:else if node.type === 'link'}
  <a href={node.data?.url} data-node-id={node.nodeId}>{#each node.children || [] as c, i (i)}<svelte:self node={c} />{/each}</a>
{:else}
  <svelte:element this={node.type} data-node-id={node.nodeId}>{#each node.children || [] as c, i (i)}<svelte:self node={c} />{/each}</svelte:element>
{/if}
```

</fields>

</fields>
