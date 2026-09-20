---
"@type": Document
UID: docs-examples-suggest-001
allow_discussion: false
contributors: []
creators:
  - admin
description: A question whose answer is completed from a vocabulary the author picked.
effective: null
exclude_from_nav: false
expires: null
id: suggest
is_folderish: false
language: "##DEFAULT##"
layout: document_view
review_state: published
rights: ""
subjects: []
title: Suggest Block
blocks-matched: |
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
  <block type="title" _="${h1}" />
  <block type="codeExample">
    <region name="tabs" widget="object_list">
      <block type="tab" label="${h3/text}" language="${pre/lang}" code="${pre/text}" />
    </region>
  </block>
---

# Suggest Block

A question whose answer is completed from a vocabulary the author picked.

## Try it

<block type="suggest" label="Topic" suggestFrom="plone.app.vocabularies.Keywords" value="" />

<fields templateId="/templates/block-reference-layout" templateInstanceId="tpl-inst-suggest" data-json='{"fixed":false,"readOnly":false}'>

<block type="codeExample" slotId="schema">

### Schema

```{literalinclude} ../../tests-playwright/fixtures/shared-block-schemas.js
:jsobject: suggest
```

</block>

<block type="codeExample" slotId="json-data">

### JSON

```{literalinclude} ./suggest.md
:block: suggest
:as: json
```

</block>

<block type="codeExample" slotId="rendering">

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
