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
is_folderish: false
language: "##DEFAULT##"
layout: document_view
review_state: published
rights: ""
subjects: []
title: Cookie Consent Block
blocks-matched: |
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
  <block type="title" _="${h1}" />
  <block type="codeExample">
    <region name="tabs" widget="object_list">
      <block type="tab" label="${h3/text}" language="${pre/lang}" code="${pre/text}" />
    </region>
  </block>
---

# Cookie Consent Block

A consent banner and a preferences dialog, written by one block. It is the worked example for revealing the place a FIELD is edited — data-block-selector="uid#fieldName".

## Live example

<block type="cookieConsent" analyticsPurpose="Counts visits and pages, so we can see what is worth improving. Never used to identify you." data-json='{"message":[{"type":"p","children":[{"text":"We use essential cookies to make this site work, and analytics cookies to see how it is used."}]}]}' />

<fields templateId="/templates/block-reference-layout" templateInstanceId="tpl-inst-cookie-consent">

<block type="codeExample" slotId="schema" source="cookieConsent" format="schema" />

<block type="codeExample" slotId="json-data" source="cookieConsent" format="json" />

<block type="codeExample" slotId="rendering">

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
