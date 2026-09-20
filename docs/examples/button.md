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
is_folderish: true
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
  <block type="button" title="${p/text}" href="${p/link}" />
---

# Button

A call-to-action button with an editable label and link.

<block type="image">

![The button example block being edited in Inka](../images/button-edit.png)

</block>

---

<block type="button">

[Button](/)

<fields inneralign="left" styles:buttonAlign="wide" />

</block>

---

<block type="button">

[Button](/)

<fields inneralign="center" styles:buttonAlign="wide" />

</block>

---

<block type="button">

[Button](/)

<fields inneralign="right" styles:align="full" styles:buttonAlign="wide" />

</block>

---

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nib euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

<block type="button">

[Button](/)

<fields inneralign="left" />

</block>

---

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

<block type="button">

[Button](/)

<fields inneralign="center" />

</block>

---

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

<block type="button">

[Button](/)

<fields inneralign="right" />

</block>

<block type="heading" alignment="left" heading="Button Block" tag="h2" styles:backgroundColor="grey" />

<block type="separator">

---

<fields styles:align="full" styles:backgroundColor="grey" />

</block>

<block type="button">

[Button](/)

<fields inneralign="left" styles:backgroundColor="grey" styles:buttonAlign="wide" />

</block>

<block type="separator">

---

<fields styles:align="full" styles:backgroundColor="grey" />

</block>

<block type="button">

[Button](/)

<fields inneralign="center" styles:backgroundColor="grey" styles:buttonAlign="wide" />

</block>

<block type="separator">

---

<fields styles:align="full" styles:backgroundColor="grey" />

</block>

<block type="button">

[Button](/)

<fields inneralign="right" styles:backgroundColor="grey" styles:buttonAlign="wide" />

</block>

<block type="separator">

---

<fields styles:align="full" styles:backgroundColor="grey" />

</block>

<block type="slate">

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nib euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

<fields styles:backgroundColor="grey" />

</block>

<block type="button">

[Button](/)

<fields inneralign="left" styles:backgroundColor="grey" styles:buttonAlign="center" />

</block>

<block type="separator">

---

<fields styles:align="full" styles:backgroundColor="grey" />

</block>

<block type="slate">

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nib euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

<fields styles:backgroundColor="grey" />

</block>

<block type="button">

[Button](/)

<fields inneralign="center" styles:backgroundColor="grey" styles:buttonAlign="center" />

</block>

<block type="separator">

---

<fields styles:align="full" styles:backgroundColor="grey" />

</block>

<block type="slate">

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nib euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

<fields styles:backgroundColor="grey" />

</block>

<block type="button">

[Button](/)

<fields inneralign="right" styles:backgroundColor="grey" styles:buttonAlign="center" />

</block>

<fields templateId="/templates/block-reference-layout" templateInstanceId="tpl-inst-button" data-json='{"fixed":false,"readOnly":false}'>

<block type="codeExample" slotId="schema">

### Schema

```{literalinclude} ../../tests-playwright/fixtures/shared-block-schemas.js
:jsobject: button
```

</block>

<block type="codeExample" slotId="json-data">

### JSON

```{literalinclude} ./button.md
:block: button
:as: json
```

</block>

<block type="codeExample" slotId="rendering">

### React

```{literalinclude} examples/react/ButtonBlock.jsx
:language: jsx
```

### Vue

```{literalinclude} examples/vue/ButtonBlock.vue
:language: vue
```

### Svelte

```{literalinclude} examples/svelte/ButtonBlock.svelte
:language: svelte
```

</block>

</fields>
