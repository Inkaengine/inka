---
"@type": Document
UID: 6d37dd19ef754344aaa254fa288e44b4
allow_discussion: false
contributors: []
creators:
  - admin
description: |-
  
  The video block can contain videos from YouTube.
effective: 2023-07-06T18:35:00
exclude_from_nav: false
expires: null
id: video
is_folderish: true
language: "##DEFAULT##"
layout: document_view
preview_caption: null
preview_image: null
review_state: published
rights: ""
subjects:
  - blocks
  - media
title: Video
blocks-matched: |
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
  <block type="title" _="${h1}" />
  <block type="separator" _="${hr}" styles={"align":"full"} />
  <block type="image" description="${p?/text}" url="${img/src}" alt="${img?/alt}" title="${img?/title}" align="center" size="l" />
  <block type="image" url="${img/src}" alt="${img?/alt}" title="${img?/title}" align="center" size="l" />
  <block type="codeExample">
    <region name="tabs" widget="object_list">
      <block type="tab" label="${h3/text}" language="${pre/lang}" code="${pre/text}" />
    </region>
  </block>
---

# Video

Embeds a video from a URL. Detects YouTube links and renders an iframe embed; otherwise falls back to an HTML5 \<video> element.

<block type="image">

![The video example block being edited in Volto Hydra](/docs/images/video-edit.png)

</block>

## Video-Block (Full Width)

<block type="video" align="full" url="https://www.youtube.com/watch?v=_yaYy86jdk8" />

## Video-Block (Standard Size)

<block type="video" align="wide" url="https://www.youtube.com/watch?v=_yaYy86jdk8" />

---

### Headline H2

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

<block type="video" align="center" url="https://www.youtube.com/watch?v=_yaYy86jdk8" />

<block type="separator">

---

<fields data-json='{"styles":{"align":"left"}}' />

</block>

### Video-Block (Align: Left)

The Video-Block can be aligned to the left with text floating around it on the right side.

<block type="video" align="left" preview_image="http://localhost:8080/Plone/docs/examples/content-types/image-dark" url="https://www.youtube.com/watch?v=_yaYy86jdk8" />

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam. Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat quis nostrud exerci tation ullamcorper ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat quis Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam.

### Video Block (Align Right)

The Video-Block can be aligned to the right with text floating around it on the left side.

<block type="video" align="right" preview_image="http://localhost:8080/Plone/docs/examples/content-types/image-dark" url="https://www.youtube.com/watch?v=_yaYy86jdk8" />

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam. Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat quis nostrud exerci tation ullamcorper ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat quis Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam. Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt

<fields templateId="/templates/block-reference-layout" templateInstanceId="tpl-inst-video">

<block type="codeExample" slotId="schema" source="video" format="schema" />

<block type="codeExample" slotId="json-data" source="video" format="json" />

<block type="codeExample" slotId="rendering">

### React

```{literalinclude} examples/react/VideoBlock.jsx
:language: jsx
```

### Vue

```{literalinclude} examples/vue/VideoBlock.vue
:language: vue
```

### Svelte

```{literalinclude} examples/svelte/VideoBlock.svelte
:language: svelte
```

</block>

</fields>
