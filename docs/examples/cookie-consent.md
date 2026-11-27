---
"@type": Document
UID: docs-examples-cookie-consent-001
allow_discussion: false
contributors: []
creators:
  - admin
description: A consent banner and a preferences dialog, written by one block. It
  is the worked example for revealing the place a FIELD is edited —
  data-block-selector="uid#fieldName".
effective: null
exclude_from_nav: false
expires: null
id: cookie-consent
language: "##DEFAULT##"
layout: document_view
review_state: published
rights: ""
subjects: []
title: Cookie Consent Block
blocks-matched: |
  <block is="slate" value="${p,h*,ul,ol,blockquote,strong,em,a/slate}" />
  <block is="title" _="${h1}" />
  <block is="codeExample">
    <region name="tabs" widget="object_list" idField="@id" typeField="@type">
      <block is="tab" label="${h3/text}" language="${pre/lang}" code="${pre/textarea}" />
    </region>
  </block>
blocks-tagged: |
  <block is="cookieConsent" message="${p,ul,ol/slate}" />
---

# Cookie Consent Block

A consent banner and a preferences dialog, written by one block. It is the worked example for revealing the place a FIELD is edited — data-block-selector="uid#fieldName".

## Live example

<block is="cookieConsent">

We use essential cookies to make this site work, and analytics cookies to see how it is used.

<fields analyticsPurpose="Counts visits and pages, so we can see what is worth improving. Never used to identify you." />

</block>

<defaults templateId="/inka-templates/block-reference-layout" templateInstanceId="tpl-inst-cookie-consent">

<fields :fixed="false" :readOnly="false">

<block is="codeExample" slotId="schema">

### Schema

```{literalinclude} ../../tests-playwright/fixtures/shared-block-schemas.js
:jsobject: cookieConsent
```

</block>

<block is="codeExample" slotId="json-data">

### JSON

```{literalinclude} ./cookie-consent.md
:block: cookieConsent
:as: json
```

</block>

<block is="codeExample" slotId="rendering">

### React

```{literalinclude} examples/react/CookieConsentBlock.jsx
:language: jsx
```

### Vue

```{literalinclude} examples/vue/CookieConsentBlock.vue
:language: vue
```

### Svelte

```{literalinclude} examples/svelte/CookieConsentBlock.svelte
:language: svelte
```

</block>

</fields>

</defaults>
