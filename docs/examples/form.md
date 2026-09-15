---
"@type": Document
UID: 13de82575e16493fbc54514e548a9f3c
allow_discussion: false
contributors: []
creators:
  - admin
description: A form block can be used to create forms
effective: 2024-03-08T12:40:00
exclude_from_nav: false
expires: null
id: form
is_folderish: true
language: "##DEFAULT##"
layout: document_view
preview_caption: null
preview_image: null
review_state: published
rights: ""
subjects:
  - blocks
  - forms
title: Form
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
---

# Form

A multi-field form with configurable field types, validation, and email submission. Fields are stored as a typed object\_list — each field has a field\_type that maps to a sub-block schema.

<block type="image">

![The form example block being edited in Volto Hydra](/docs/images/form-edit.png)

</block>

<block type="form" default_from="noreply@plone.org" title="A simple form" default_to="admin@example.com" default_subject="New form submission" captcha="honeypot" data-json='{"lastChange":1710238630312,"remove_data_after_days":-1,"send_email":true,"show_cancel":false,"store":true,"subblocks":[{"field_id":"1709833577467","field_type":"text","id":"1709833577467","label":"Name","required":true},{"field_id":"1709833592544","field_type":"from","id":"1709833592544","label":"Email","required":false,"use_as_bcc":false,"use_as_reply_to":false},{"field_id":"1709833604677","field_type":"textarea","id":"1709833604677","label":"Message","required":false},{"field_id":"1709833616406","field_type":"multiple_choice","id":"1709833616406","input_values":["Red","Green","Blue"],"label":"Select field","required":false}]}' />

<block type="slate" data-json='{"value":[{"children":[{"text":""}],"type":"p"}]}' />

<fields templateId="/templates/block-reference-layout" templateInstanceId="tpl-inst-form">

<block type="codeExample" slotId="schema" source="form" format="schema" />

<block type="codeExample" slotId="json-data" source="form" format="json" />

<block type="codeExample" slotId="rendering">

### React

```{literalinclude} examples/react/FormBlock.jsx
:language: jsx
```

### Vue

```{literalinclude} examples/vue/FormBlock.vue
:language: vue
```

### Svelte

```{literalinclude} examples/svelte/FormBlock.svelte
:language: svelte
```

</block>

</fields>
