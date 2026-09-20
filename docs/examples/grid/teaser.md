---
"@type": Document
UID: c2adb9f7b0824bd5a3e07048d887f48d
allow_discussion: false
contributors: []
creators:
  - admin
description: >-
  
  The Grid block allows adding multi-column blocks. A grid block can contain
  between one and four columns of different blocks. Text, teasers, images and
  videos can be added in a grid block.
effective: 2023-07-06T18:35:00
exclude_from_nav: false
expires: null
id: teaser
is_folderish: true
language: "##DEFAULT##"
layout: document_view
preview_caption: null
preview_image: null
review_state: published
rights: ""
subjects: []
title: Grid-Teaser block
blocks-matched: |
  <block type="title" _="${h1}" />
blocks-tagged: |
  <block type="teaser" title="${h/text}" head_title="${strong?/text}" href="${h/link}" description="${p/text}" />
  <block type="gridBlock" headline="${h/text}">
    <region name="items" widget="blocks_layout">
      <block type="teaser" title="${h/text}" head_title="${strong?/text}" href="${h/link}" description="${p/text}" />
    </region>
  </block>
---

# Grid-Teaser block

<block type="gridBlock">

## Block Title

<block type="teaser">

### [Teaser Title H2](/docs/examples/content-types/page)

**Head title**

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

<fields styles:align="left" data-json='{"preview_image":[]}' />

</block>

</block>

<block type="gridBlock">

<block type="teaser">

### [Teaser Title H2](/docs/examples/content-types/page)

**Head title**

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

<fields styles:align="left" />

</block>

<block type="teaser">

### [Teaser Title H2](/docs/examples/content-types/page)

**Head title**

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

<fields styles:align="left" />

</block>

</block>

<block type="gridBlock">

<block type="teaser" data-json='{"head_title":"Head title","title":"Teaser Title H2","styles":{"align":"left"},"description":"Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu. ","href":[{"@id":"/docs/examples/content-types/page","@type":"Document","Title":"Page","Description":"The Page content type can be used to display content on a single page of the website. Pages can be structured using text, images and blocks.","title":"Page","head_title":null,"getRemoteUrl":null,"hasPreviewImage":true,"image_field":"preview_image"}]}' />

<block type="teaser">

### [Teaser Title H2](/docs/examples/content-types/page)

**Head title**

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu.

<fields styles:align="left" />

</block>

<block type="teaser">

### [Teaser Title H2](/docs/examples/content-types/page)

**Head title**

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu.

<fields styles:align="left" />

</block>

</block>

<block type="gridBlock">

<block type="teaser">

### [Teaser Title H2](/docs/examples/content-types/page)

**Head title**

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl.

<fields styles:align="left" />

</block>

<block type="teaser">

### [Teaser Title H2](/docs/examples/content-types/page)

**Head title**

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl.

<fields styles:align="left" />

</block>

<block type="teaser">

### [Teaser Title H2](/docs/examples/content-types/page)

**Head title**

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl.

<fields styles:align="left" />

</block>

<block type="teaser">

### [Teaser Title H2](/docs/examples/content-types/page)

**Head title**

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl.

<fields styles:align="left" />

</block>

</block>

<fields styles:backgroundColor="grey">

<block type="gridBlock">

## Block Title

<block type="teaser">

### [Teaser Title H2](/docs/examples/content-types/page)

**Head title**

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

<fields styles:align="left" />

</block>

</block>

<block type="gridBlock">

<block type="teaser">

### [Teaser Title H2](/docs/examples/content-types/page)

**Head title**

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

<fields styles:align="left" />

</block>

<block type="teaser">

### [Teaser Title H2](/docs/examples/content-types/page)

**Head title**

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

<fields styles:align="left" />

</block>

</block>

<block type="gridBlock">

<block type="teaser" data-json='{"head_title":"Head title","title":"Teaser Title H2","styles":{"align":"left"},"description":"Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu. ","href":[{"@id":"/docs/examples/content-types/page","@type":"Document","Title":"Page","Description":"The Page content type can be used to display content on a single page of the website. Pages can be structured using text, images and blocks.","title":"Page","head_title":null,"getRemoteUrl":null,"hasPreviewImage":true,"image_field":"preview_image"}]}' />

<block type="teaser" data-json='{"head_title":"Head title","title":"Teaser Title H2","styles":{"align":"left"},"description":"Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu. ","href":[{"@id":"/docs/examples/content-types/page","@type":"Document","Title":"Page","Description":"The Page content type can be used to display content on a single page of the website. Pages can be structured using text, images and blocks.","title":"Page","head_title":null,"getRemoteUrl":null,"hasPreviewImage":true,"image_field":"preview_image"}]}' />

<block type="teaser" data-json='{"head_title":"Head title","title":"Teaser Title H2","styles":{"align":"left"},"description":"Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu. ","href":[{"@id":"/docs/examples/content-types/page","@type":"Document","Title":"Page","Description":"The Page content type can be used to display content on a single page of the website. Pages can be structured using text, images and blocks.","title":"Page","head_title":null,"getRemoteUrl":null,"hasPreviewImage":true,"image_field":"preview_image"}]}' />

</block>

<block type="gridBlock">

<block type="teaser">

### [Teaser Title H2](/docs/examples/content-types/page)

**Head title**

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl.

<fields styles:align="left" />

</block>

<block type="teaser">

### [Teaser Title H2](/docs/examples/content-types/page)

**Head title**

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl.

<fields styles:align="left" />

</block>

<block type="teaser">

### [Teaser Title H2](/docs/examples/content-types/page)

**Head title**

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl.

<fields styles:align="left" />

</block>

<block type="teaser">

### [Teaser Title H2](/docs/examples/content-types/page)

**Head title**

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl.

<fields styles:align="left" />

</block>

</block>

</fields>
