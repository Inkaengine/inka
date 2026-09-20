---
"@type": News Item
UID: 8cc3e9af77c0452aa2278b0bfdcf9c85
allow_discussion: false
changeNote: null
contributors: []
creators:
  - admin
description: The News Item content type can be used to display News content on the website.
effective: 2023-01-01T10:42:00
exclude_from_nav: false
expires: null
id: news-item
image: null
image_caption: null
is_folderish: true
language: "##DEFAULT##"
layout: newsitem_view
review_state: published
rights: ""
subjects:
  - news
title: News Item
blocks-matched: |
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
  <block type="title" _="${h1}" />
  <block type="separator" _="${hr}" styles={"align":"full"} />
  <block type="image" description="${p?/text}" url="${img/src}" alt="${img?/alt}" title="${img?/title}" align="center" size="l" />
  <block type="image" url="${img/src}" alt="${img?/alt}" title="${img?/title}" align="center" size="l" />
blocks-tagged: |
  <block type="introduction" value="${p,h*/slate}" />
---

<fields templateId="/templates/newsitem-view" templateInstanceId="tpl-ni-def">

<fields data-json='{"fixed":true,"readOnly":true}'>

<block type="dateField" data-json='{"dateField":"effective","slotId":"date","showTime":false}' />

<block type="title">

# News Item

<fields slotId="title" />

</block>

</fields>

<fields slotId="content" data-json='{"fixed":false,"readOnly":false}'>

<block type="image">

Der Inhaltstyp Bild kann verwendet werden um ein Bild in verschiedenen Formate (JPG, GIF, PNG, SVG) hochzuladen. Das hochgeladene Bild sollte dabei immer eine hohe Auflösung haben, damit es flexibel, z.B. auch als Banner-Bild eingesetzt werden kann. Plone liefert die Bilder automatisch in der besten Skalierung aus, so dass es nicht nötig ist Bilder manuell herunter zu skalieren.

![](./image-dark "Inhaltstyp: Image-1")

<fields align="wide" image_field="image" />

</block>

---

<block type="introduction">

## Highlight Title H2&#x20;

</block>

</fields>

</fields>

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat.&#x20;

<fields templateId="/templates/newsitem-view" templateInstanceId="tpl-ni-def" slotId="content" data-json='{"fixed":false,"readOnly":false}'>

---

## Headline H2&#x20;

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

### Headline H3&#x20;

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

<block type="introduction">

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat.&#x20;

</block>

---

<block type="image">

Der Inhaltstyp Bild kann verwendet werden um ein Bild in verschiedenen Formate (JPG, GIF, PNG, SVG) hochzuladen. Das hochgeladene Bild sollte dabei immer eine hohe Auflösung haben, damit es flexibel, z.B. auch als Banner-Bild eingesetzt werden kann. Plone liefert die Bilder automatisch in der besten Skalierung aus, so dass es nicht nötig ist Bilder manuell herunter zu skalieren.

![](./image-light.jpg "Image - Light")

<fields image_field="image" />

</block>

<block type="separator">

---

<fields styles:align="left" />

</block>

### Headline H3&#x20;

<block type="image">

Der Inhaltstyp Bild kann verwendet werden um ein Bild in verschiedenen Formate (JPG, GIF, PNG, SVG) hochzuladen. Das hochgeladene Bild sollte dabei immer eine hohe Auflösung haben, damit es flexibel, z.B. auch als Banner-Bild eingesetzt werden kann. Plone liefert die Bilder automatisch in der besten Skalierung aus, so dass es nicht nötig ist Bilder manuell herunter zu skalieren.

![](./image-light.jpg "Image - Light")

<fields align="right" image_field="image" />

</block>

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem iusto odio dignissim qui blandit praesent luptatum zzril delenit auguevel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit luptatum zzril delenit auguevel eum iriure dolor in hendrerit in vulputate velit esse&#x20;

<block type="image">

Der Inhaltstyp Bild kann verwendet werden um ein Bild in verschiedenen Formate (JPG, GIF, PNG, SVG) hochzuladen. Das hochgeladene Bild sollte dabei immer eine hohe Auflösung haben, damit es flexibel, z.B. auch als Banner-Bild eingesetzt werden kann. Plone liefert die Bilder automatisch in der besten Skalierung aus, so dass es nicht nötig ist Bilder manuell herunter zu skalieren.

![](./image-light.jpg "Image - Light")

<fields align="left" image_field="image" />

</block>

### Headline H3&#x20;

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem iusto odio dignissim qui blandit praesent luptatum zzril delenit auguevel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit&#x20;

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

<block type="separator">

---

<fields styles:align="left" />

</block>

<block type="image">

Der Inhaltstyp Bild kann verwendet werden um ein Bild in verschiedenen Formate (JPG, GIF, PNG, SVG) hochzuladen. Das hochgeladene Bild sollte dabei immer eine hohe Auflösung haben, damit es flexibel, z.B. auch als Banner-Bild eingesetzt werden kann. Plone liefert die Bilder automatisch in der besten Skalierung aus, so dass es nicht nötig ist Bilder manuell herunter zu skalieren.

![](./image-light.jpg "Image - Light")

<fields align="left" image_field="image" size="m" styles:size:noprefix="medium" />

</block>

### Headline H3&#x20;

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem iusto odio dignissim qui blandit praesent luptatum zzril delenit auguevel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum&#x20;

<block type="image">

Der Inhaltstyp Bild kann verwendet werden um ein Bild in verschiedenen Formate (JPG, GIF, PNG, SVG) hochzuladen. Das hochgeladene Bild sollte dabei immer eine hohe Auflösung haben, damit es flexibel, z.B. auch als Banner-Bild eingesetzt werden kann. Plone liefert die Bilder automatisch in der besten Skalierung aus, so dass es nicht nötig ist Bilder manuell herunter zu skalieren.

![](./image-light.jpg "Image - Light")

<fields align="right" image_field="image" size="m" styles:size:noprefix="medium" />

</block>

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem iusto odio dignissim qui blandit praesent luptatum zzril delenit auguevel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu luptatum zzril delenit auguevel eum iriure&#x20;

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

<block type="separator">

---

<fields styles:align="left" />

</block>

<block type="image">

Der Inhaltstyp Bild kann verwendet werden um ein Bild in verschiedenen Formate (JPG, GIF, PNG, SVG) hochzuladen. Das hochgeladene Bild sollte dabei immer eine hohe Auflösung haben, damit es flexibel, z.B. auch als Banner-Bild eingesetzt werden kann. Plone liefert die Bilder automatisch in der besten Skalierung aus, so dass es nicht nötig ist Bilder manuell herunter zu skalieren.

![](./image-light.jpg "Image - Light")

<fields align="left" image_field="image" size="s" styles:size:noprefix="small" />

</block>

### Headline H3&#x20;

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem iusto odio dignissim qui blandit praesent ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo  luptatum zzril delenit auguevel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu luptatum zzril delenit auguevel eum iriure dolor in hendrerit in&#x20;

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue&#x20;

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

<block type="image">

Der Inhaltstyp Bild kann verwendet werden um ein Bild in verschiedenen Formate (JPG, GIF, PNG, SVG) hochzuladen. Das hochgeladene Bild sollte dabei immer eine hohe Auflösung haben, damit es flexibel, z.B. auch als Banner-Bild eingesetzt werden kann. Plone liefert die Bilder automatisch in der besten Skalierung aus, so dass es nicht nötig ist Bilder manuell herunter zu skalieren.

![](./image-light.jpg "Image - Light")

<fields align="right" image_field="image" size="s" styles:size:noprefix="small" />

</block>

### Headline H3&#x20;

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem iusto odio dignissim qui blandit praesent ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo  luptatum zzril delenit auguevel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu luptatum zzril delenit auguevel eum iriure dolor in hendrerit in. Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem iusto odio dignissim qui blandit praesent ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo  luptatum zzril delenit auguevel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu luptatum zzril delenit auguevel eum iriure dolor in hendrerit in.

</fields>
