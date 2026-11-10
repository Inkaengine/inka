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
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em,a/slate}" plaintext="${p,h*,ul,ol,blockquote,strong,em,a/text}" />
  <block type="title" _="${h1}" />
  <block type="image" description="${p?/textarea}" url="${img/src}" alt="${img?/alt}" title="${img?/title}" align="center" size="l" />
  <block type="codeExample">
    <region name="tabs" widget="object_list" idField="@id" typeField="@type">
      <block type="tab" label="${h3/text}" language="${pre/lang}" code="${pre/textarea}" />
    </region>
  </block>
---

# Form

A multi-field form with configurable field types, validation, and email submission. Fields are stored as a typed object_list — each field has a field_type that maps to a sub-block schema.

<block type="image">

![The form example block being edited in Inka](../images/form-edit.png)

</block>

<block type="form" data-json='{"default_from":"noreply@plone.org","title":"A simple form","default_to":"admin@example.com","default_subject":"New form submission","captcha":"honeypot","lastChange":1710238630312,"remove_data_after_days":-1,"send_email":true,"show_cancel":false,"store":true,"subblocks":[{"field_id":"1709833577467","field_type":"text","id":"1709833577467","label":"Name","required":true},{"field_id":"1709833592544","field_type":"from","id":"1709833592544","label":"Email","required":false,"use_as_bcc":false,"use_as_reply_to":false},{"field_id":"1709833604677","field_type":"textarea","id":"1709833604677","label":"Message","required":false},{"field_id":"1709833616406","field_type":"multiple_choice","id":"1709833616406","input_values":["Red","Green","Blue"],"label":"Select field","required":false}]}' />

## Submitting a form

A form is your frontend's: it draws the fields and, when a visitor submits, it posts the answers to the page's `@submit-form` endpoint (collective.volto.formsupport), which stores them and sends the email.

That post is anonymous unless your frontend sends a login with it. Plone refuses an anonymous submission on a page the public can't view yet, and every new page starts private, so an author can't try a form before publishing it. If you want authors to be able to, send the editor's token with the submission. A public visitor has no token, so their submissions stay anonymous.

In the browser, `getAuthHeaders()` from the bridge gives the token while the page is open in Inka, and nothing otherwise:

<block type="codeExample">

### Browser

```js
import { getAuthHeaders } from '@hydra-js/hydra.js';

const response = await fetch(`${apiUrl}${pagePath}/@submit-form`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
  body: JSON.stringify({ block_id: blockId, data }),
});
```

</block>

If your frontend submits from its server, read the token from the `access_token` cookie the bridge sets instead. Either way, a submission made like this is the editor's, with the editor's permissions: see [How an editor's login reaches the front end](../deploy-and-secure.md#how-an-editors-login-reaches-the-front-end).

<fields templateId="/inka-templates/block-reference-layout" templateInstanceId="tpl-inst-form" fixed=false readOnly=false>

<block type="codeExample" slotId="schema">

### Schema

```{literalinclude} ../../tests-playwright/fixtures/shared-block-schemas.js
:jsobject: form
```

</block>

<block type="codeExample" slotId="json-data">

### JSON

```{literalinclude} ./form.md
:block: form
:as: json
```

</block>

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
