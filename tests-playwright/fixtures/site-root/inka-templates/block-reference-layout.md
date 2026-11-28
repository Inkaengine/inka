---
"@type": Document
UID: tpl-block-reference-layout
id: block-reference-layout
title: Block Reference Layout
review_state: published
description: Template for code examples at the bottom of block reference pages
effective: 2025-01-01T00:00:00
blocks-matched: |
  <block is="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
  <block is="separator" _="${hr}" :styles='{"align":"full"}' />
  <block is="codeExample">
    <region name="tabs" widget="object_list" idField="@id" typeField="@type">
      <block is="tab" label="${h3/text}" language="${pre/lang}" code="${pre/textarea}" />
    </region>
  </block>
---

<fields templateId="/inka-templates/block-reference-layout" templateInstanceId="tpl-block-ref-def">

<fields data-json='{"fixed":true,"readOnly":true}'>

<block is="separator">

---

<fields slotId="sep" />

</block>

<block is="slate">

## Developer Reference

<fields slotId="examples-heading" />

</block>

<block is="slate">

### Schema

<fields slotId="schema-heading" />

</block>

<block is="slate" slotId="schema-desc" data-json='{"value":[{"type":"p","children":[{"text":"Pass this object inside the "},{"type":"code","children":[{"text":"blocks"}]},{"text":" option when calling "},{"type":"code","children":[{"text":"initBridge()"}]},{"text":" to register this block type with the admin UI. See "},{"type":"link","data":{"url":"/docs/frontend-guide/custom-blocks"},"children":[{"text":"Custom Blocks"}]},{"text":" for the full setup guide."}]}]}' />

</fields>

<block is="codeExample" slotId="schema" data-json='{"fixed":false}'>

### Schema

```javascript

```

</block>

<fields data-json='{"fixed":true,"readOnly":true}'>

<block is="slate">

### JSON Block Data

<fields slotId="json-heading" />

</block>

<block is="slate">

Example JSON as stored in the Plone content API. This is the data structure your component will receive in the `block` prop.

<fields slotId="json-desc" />

</block>

</fields>

<block is="codeExample" slotId="json-data" data-json='{"fixed":false}'>

### JSON Block Data

```json

```

</block>

<fields data-json='{"fixed":true,"readOnly":true}'>

<block is="slate">

### Rendering

<fields slotId="rendering-heading" />

</block>

<block is="slate">

How this block renders in your frontend. Add its handling to your renderer, or — for list-style blocks — register a fetcher and reuse your list rendering.

<fields slotId="rendering-desc" />

</block>

</fields>

<block is="codeExample" slotId="rendering" data-json='{"fixed":false}'>

### React

```jsx

```

### Vue

```vue

```

### Svelte

```svelte

```

</block>

</fields>
