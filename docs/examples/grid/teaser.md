---
"@type": Document
UID: c2adb9f7b0824bd5a3e07048d887f48d
allow_discussion: false
contributors: []
creators:
  - admin
description: The Grid block allows adding multi-column blocks. A grid block can
  contain between one and four columns of different blocks. Text, teasers,
  images and videos can be added in a grid block.
effective: 2023-07-06T18:35:00
exclude_from_nav: false
expires: null
id: teaser
language: "##DEFAULT##"
layout: document_view
preview_caption: null
preview_image: null
review_state: published
rights: ""
subjects: []
title: Grid-Teaser block
blocks-matched: |
  <block is="title" _="${h1}" />
blocks-tagged: |
  <block is="teaser" title="${h?/text}" head_title="${strong?/text}" href="${h?/link}" description="${p?/textarea}" />
  <block is="gridBlock" headline="${h/text}">
    <region name="items" widget="blocks_layout">
      <block is="teaser" title="${h/text}" head_title="${strong?/text}" href="${h/link}" description="${p?/textarea}" />
    </region>
  </block>
---

# Grid-Teaser block

<block is="gridBlock">

## Block Title

<block is="teaser">

### [Teaser Title H2](../content-types/page.md)

**Head title**

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

<fields :styles='{"align":"left"}' :preview_image="[]" />

</block>

</block>

<block is="gridBlock">

<fields :styles='{"align":"left"}'>

<block is="teaser">

### [Teaser Title H2](../content-types/page.md)

**Head title**

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

</block>

<block is="teaser">

### [Teaser Title H2](../content-types/page.md)

**Head title**

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

</block>

</fields>

</block>

<block is="gridBlock">

<fields :styles='{"align":"left"}'>

<block is="teaser">

### [Teaser Title H2](../content-types/page.md)

**Head title**

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu.

</block>

<block is="teaser">

### [Teaser Title H2](../content-types/page.md)

**Head title**

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu.

</block>

<block is="teaser">

### [Teaser Title H2](../content-types/page.md)

**Head title**

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu.

</block>

</fields>

</block>

<block is="gridBlock">

<fields :styles='{"align":"left"}'>

<block is="teaser">

### [Teaser Title H2](../content-types/page.md)

**Head title**

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl.

</block>

<block is="teaser">

### [Teaser Title H2](../content-types/page.md)

**Head title**

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl.

</block>

<block is="teaser">

### [Teaser Title H2](../content-types/page.md)

**Head title**

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl.

</block>

<block is="teaser">

### [Teaser Title H2](../content-types/page.md)

**Head title**

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl.

</block>

</fields>

</block>

<fields :styles='{"backgroundColor":"grey"}'>

<block is="gridBlock">

## Block Title

<block is="teaser">

### [Teaser Title H2](../content-types/page.md)

**Head title**

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

<fields :styles='{"align":"left"}' />

</block>

</block>

<block is="gridBlock">

<fields :styles='{"align":"left"}'>

<block is="teaser">

### [Teaser Title H2](../content-types/page.md)

**Head title**

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

</block>

<block is="teaser">

### [Teaser Title H2](../content-types/page.md)

**Head title**

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

</block>

</fields>

</block>

<block is="gridBlock">

<fields :styles='{"align":"left"}'>

<block is="teaser">

### [Teaser Title H2](../content-types/page.md)

**Head title**

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu.

</block>

<block is="teaser">

### [Teaser Title H2](../content-types/page.md)

**Head title**

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu.

</block>

<block is="teaser">

### [Teaser Title H2](../content-types/page.md)

**Head title**

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu.

</block>

</fields>

</block>

<block is="gridBlock">

<fields :styles='{"align":"left"}'>

<block is="teaser">

### [Teaser Title H2](../content-types/page.md)

**Head title**

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl.

</block>

<block is="teaser">

### [Teaser Title H2](../content-types/page.md)

**Head title**

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl.

</block>

<block is="teaser">

### [Teaser Title H2](../content-types/page.md)

**Head title**

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl.

</block>

<block is="teaser">

### [Teaser Title H2](../content-types/page.md)

**Head title**

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl.

</block>

</fields>

</block>

</fields>
