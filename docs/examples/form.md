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
  <block is="slate" value="${p,h*,ul,ol,blockquote,strong,em,a/slate}" />
  <block is="title" _="${h1}" />
  <block is="image" description="${p?/textarea}" url="${img/src}" alt="${img?/alt}" title="${img?/title}" align="center" size="l" />
  <block is="codeExample">
    <region name="tabs" widget="object_list" idField="@id" typeField="@type">
      <block is="tab" label="${h3/text}" language="${pre/lang}" code="${pre/textarea}" />
    </region>
  </block>
---

# Form

A multi-field form with configurable field types, validation, and email submission. Fields are stored as a typed object_list — each field has a field_type that maps to a sub-block schema.

<block is="image">

![The form example block being edited in Inka](../images/form-edit.png)

</block>

<block is="form" default_from="noreply@plone.org" title="A simple form" default_to="admin@example.com" default_subject="New form submission" captcha="honeypot" :lastChange="1710238630312" :send_email="true" :store="true" :subblocks='[{"field_id":"1709833577467","field_type":"text","label":"Name","required":true},{"field_id":"1709833592544","field_type":"from","label":"Email","@type":"from"},{"field_id":"1709833604677","field_type":"textarea","label":"Message","@type":"textarea"},{"field_id":"1709833616406","field_type":"multiple_choice","input_values":["Red","Green","Blue"],"label":"Select field","@type":"multiple_choice"}]' />

## Submitting a form

A form is your frontend's: it draws the fields and, when a visitor submits, it posts the answers to the page's `@submit-form` endpoint (collective.volto.formsupport), which stores them and sends the email.

Whether that post carries a login is your frontend's choice. There are three cases, explained in [Who your frontend's requests run as](../frontend-guide/advanced.md#who-your-frontends-requests-run-as):

- **A public form** on a published page is anonymous. Send no token.
- **Trying a form while editing:** Plone refuses an anonymous submission on a page the public can't view yet, and every new page starts private. To let authors try a form before publishing it, send the editor's token with the submission. It is there only inside Inka's editor.
- **A form for signed-in visitors** needs your frontend's own login. The editor's token never reaches visitors.

For the second case, `getAuthHeaders()` from the bridge gives the editor's token while the page is open in Inka, and nothing otherwise, so the same code serves the public site anonymously:

### Browser

```js
import { getAuthHeaders } from '@hydra-js/hydra.js';

const response = await fetch(`${apiUrl}${pagePath}/@submit-form`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
  body: JSON.stringify({ block_id: blockId, data }),
});
```

If your frontend submits from its server, read the token from the `access_token` cookie the bridge sets instead. Either way, a submission made like this is the editor's, with the editor's permissions: see [How an editor's login reaches the front end](../deploy-and-secure.md#how-an-editors-login-reaches-the-front-end).

<defaults templateId="/inka-templates/block-reference-layout" templateInstanceId="tpl-inst-form">

<fields :fixed="false" :readOnly="false">

<block is="codeExample" slotId="schema">

### Schema

```{literalinclude} ../../tests-playwright/fixtures/shared-block-schemas.js
:jsobject: form
```

<fields slotId="schema-tabs" />

</block>

<block is="codeExample" slotId="json-data">

### JSON

```{literalinclude} ./form.md
:block: form
:as: json
```

<fields slotId="json-data-tabs" />

</block>

<block is="codeExample" slotId="rendering">

### React

```{literalinclude} examples/react/FormBlock.jsx
:language: jsx
```

<fields slotId="rendering-tabs" />

### Vue

```{literalinclude} examples/vue/FormBlock.vue
:language: vue
```

<fields slotId="rendering-tabs" />

### Svelte

```{literalinclude} examples/svelte/FormBlock.svelte
:language: svelte
```

<fields slotId="rendering-tabs" />

</block>

</fields>

</defaults>
