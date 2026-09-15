---
"@type": Document
UID: 7ab9c48ede33415fa2a66a99549c8f70
allow_discussion: false
contributors: []
creators:
  - admin
description: The Page content type can be used to display content on a single
  page of the website. Pages can be structured using text, images and blocks.
effective: 2023-07-06T18:35:00
exclude_from_nav: false
expires: null
id: page
is_folderish: true
language: "##DEFAULT##"
layout: document_view
preview_caption: null
preview_image:
  blob_path: examples/content-types/page/preview_image/black-starry-night.jpg
  content-type: image/jpeg
  filename: black-starry-night.jpg
  height: 1708
  size: 693013
  width: 2400
review_state: published
rights: ""
subjects:
  - content
title: Page
blocks-matched: |
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
  <block type="title" _="${h1}" />
  <block type="separator" _="${hr}" styles={"align":"full"} />
  <block type="image" description="${p?/text}" url="${img/src}" alt="${img?/alt}" title="${img?/title}" align="center" size="l" />
  <block type="image" url="${img/src}" alt="${img?/alt}" title="${img?/title}" align="center" size="l" />
---

# Page

<block type="image" align="wide" description="Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt." size="l" title="Title Image" url="/docs/examples/content-types/image-dark" />

---

<block type="introduction" data-json='{"value":[{"children":[{"text":"Highlight Title H2 "}],"type":"h2"}]}' />

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat.&#x20;

---

## Text Heading H2

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

### Text Heading H3

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

### Lists

1. Ordered List Bullett Point One
2. Ordered List Bullett Point Two
3. Ordered List Bullett Point Three
4. Ordered List Bullett Point Four

- Unordered List Bullett Point One
- Unordered List Bullett Point Two
- Unordered List Bullett Point Three
- Unordered List Bullett Point Four

### Inline Styles

Text can be **bold** or *Italic*.

[Link internal ](../button.md)

[Link external](https://www.google.com)

---

<block type="introduction" data-json='{"value":[{"children":[{"text":"Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. "}],"type":"p"}]}' />

---

<block type="image" align="center" description="Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt." size="l" title="Title Image" url="/docs/examples/content-types/image-dark" />

<block type="separator">

---

<fields data-json='{"styles":{"align":"left"}}' />

</block>

<block type="image" align="right" description="Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt." size="l" title="Title Image" url="/docs/examples/content-types/image-dark" data-json='{"styles":{"size:noprefix":"large"}}' />

## Text Heading H3

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem iusto odio dignissim qui blandit praesent luptatum zzril delenit auguevel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore blandit praesent luptatum zzril qui Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

<block type="image" align="left" description="Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt." size="l" title="Title Image" url="/docs/examples/content-types/image-dark" data-json='{"styles":{"size:noprefix":"large"}}' />

## Text Heading H3

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem iusto odio dignissim qui blandit praesent luptatum zzril delenit auguevel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore blandit praesent luptatum zzril qui Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

<block type="separator">

---

<fields data-json='{"styles":{"align":"left"}}' />

</block>

<block type="image" align="left" description="Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt." size="m" title="Title Image" url="/docs/examples/content-types/image-dark" data-json='{"styles":{"size:noprefix":"medium"}}' />

## Text Heading H3

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem iusto odio dignissim qui blandit praesent luptatum zzril delenit auguevel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore blandit praesent luptatum zzril qui Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

<block type="image" align="right" description="Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt." size="m" title="Title Image" url="/docs/examples/content-types/image-dark" data-json='{"styles":{"size:noprefix":"medium"}}' />

## Text Heading H3

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem iusto odio dignissim qui blandit praesent luptatum zzril delenit auguevel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore blandit praesent luptatum zzril qui Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

<block type="separator">

---

<fields data-json='{"styles":{"align":"left"}}' />

</block>

<block type="image" align="left" description="Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt." size="s" title="Title Image" url="/docs/examples/content-types/image-dark" data-json='{"styles":{"size:noprefix":"small"}}' />

## Text Heading H3

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem iusto odio dignissim qui blandit praesent luptatum zzril delenit auguevel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore blandit praesent luptatum zzril qui Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

<block type="image" align="right" description="Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt." size="s" title="Title Image" url="/docs/examples/content-types/image-dark" data-json='{"styles":{"size:noprefix":"small"}}' />

## Text Heading H3

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem iusto odio dignissim qui blandit praesent luptatum zzril delenit auguevel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore blandit praesent luptatum zzril qui Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.
