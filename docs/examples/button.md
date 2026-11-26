---
"@type": Document
UID: 405582582e70493c96a6c549444a1eaa
allow_discussion: false
contributors: []
creators:
  - admin
description: The button block shows a button for which a link (internal or
  external) can be stored. The button can be displayed left, right or center and
  have a background color.
effective: 2023-07-06T18:35:00
exclude_from_nav: false
expires: null
id: button
language: "##DEFAULT##"
layout: document_view
preview_caption: null
preview_image: null
review_state: published
rights: ""
subjects:
  - blocks
title: Button
blocks-matched: |
  <block is="slate" value="${p,h*,ul,ol,blockquote,strong,em,a/slate}" />
  <block is="title" _="${h1}" />
  <block is="separator" _="${hr}" :styles='{"align":"full"}' />
  <block is="image" description="${p?/textarea}" url="${img/src}" alt="${img?/alt}" title="${img?/title}" align="center" size="l" />
  <block is="codeExample">
    <region name="tabs" widget="object_list" idField="@id" typeField="@type">
      <block is="tab" label="${h3/text}" language="${pre/lang}" code="${pre/textarea}" />
    </region>
  </block>
blocks-tagged: |
  <block is="button" title="${a/text}" href="${a/link}" />
---

# Button

A call-to-action button with an editable label and link.

<block is="image">

![The button example block being edited in Inka](../images/button-edit.png)

</block>

---

<block is="button">

[Button](/)

<fields :styles='{"buttonAlign":"wide"}' />

</block>

---

<block is="button">

[Button](/)

<fields inneralign="center" :styles='{"buttonAlign":"wide"}' />

</block>

---

<block is="button">

[Button](/)

<fields inneralign="right" :styles='{"align":"full","buttonAlign":"wide"}' />

</block>

---

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nib euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

<block is="button">

[Button](/)

</block>

---

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

<block is="button">

[Button](/)

<fields inneralign="center" />

</block>

---

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

<block is="button">

[Button](/)

<fields inneralign="right" />

</block>

<block is="heading" alignment="left" heading="Button Block" :styles='{"backgroundColor":"grey"}' />

<block is="separator">

---

<fields :styles='{"align":"full","backgroundColor":"grey"}' />

</block>

<block is="button">

[Button](/)

<fields :styles='{"backgroundColor":"grey","buttonAlign":"wide"}' />

</block>

<block is="separator">

---

<fields :styles='{"align":"full","backgroundColor":"grey"}' />

</block>

<block is="button">

[Button](/)

<fields inneralign="center" :styles='{"backgroundColor":"grey","buttonAlign":"wide"}' />

</block>

<block is="separator">

---

<fields :styles='{"align":"full","backgroundColor":"grey"}' />

</block>

<block is="button">

[Button](/)

<fields inneralign="right" :styles='{"backgroundColor":"grey","buttonAlign":"wide"}' />

</block>

<block is="separator">

---

<fields :styles='{"align":"full","backgroundColor":"grey"}' />

</block>

<block is="slate">

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nib euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

<fields :styles='{"backgroundColor":"grey"}' />

</block>

<block is="button">

[Button](/)

<fields :styles='{"backgroundColor":"grey","buttonAlign":"center"}' />

</block>

<block is="separator">

---

<fields :styles='{"align":"full","backgroundColor":"grey"}' />

</block>

<block is="slate">

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nib euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

<fields :styles='{"backgroundColor":"grey"}' />

</block>

<block is="button">

[Button](/)

<fields inneralign="center" :styles='{"backgroundColor":"grey","buttonAlign":"center"}' />

</block>

<block is="separator">

---

<fields :styles='{"align":"full","backgroundColor":"grey"}' />

</block>

<block is="slate">

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nib euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

<fields :styles='{"backgroundColor":"grey"}' />

</block>

<block is="button">

[Button](/)

<fields inneralign="right" :styles='{"backgroundColor":"grey","buttonAlign":"center"}' />

</block>

<defaults templateId="/inka-templates/block-reference-layout" templateInstanceId="tpl-inst-button">

<fields :fixed="false" :readOnly="false">

<block is="codeExample" slotId="schema">

### Schema

```{literalinclude} ../../tests-playwright/fixtures/shared-block-schemas.js
:jsobject: button
```

<fields slotId="schema-tabs" />

</block>

<block is="codeExample" slotId="json-data">

### JSON

```{literalinclude} ./button.md
:block: button
:as: json
```

<fields slotId="json-data-tabs" />

</block>

<block is="codeExample" slotId="rendering">

### React

```{literalinclude} examples/react/ButtonBlock.jsx
:language: jsx
```

<fields slotId="rendering-tabs" />

### Vue

```{literalinclude} examples/vue/ButtonBlock.vue
:language: vue
```

<fields slotId="rendering-tabs" />

### Svelte

```{literalinclude} examples/svelte/ButtonBlock.svelte
:language: svelte
```

<fields slotId="rendering-tabs" />

</block>

</fields>

</defaults>
