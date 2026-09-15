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
---

<fields templateId="/templates/newsitem-view" templateInstanceId="tpl-ni-def">

<fields data-json='{"fixed":true,"readOnly":true}'>

<block type="dateField" dateField="effective" slotId="date" data-json='{"showTime":false}' />

<block type="title">

# News Item

<fields slotId="title" />

</block>

</fields>

<fields slotId="content">

<block type="image" align="wide" image_field="image" size="l" title="Inhaltstyp: Image-1" url="/docs/examples/content-types/image-dark" data-json='{"description":"Der Inhaltstyp Bild kann verwendet werden um ein Bild in verschiedenen Formate (JPG, GIF, PNG, SVG) hochzuladen. Das hochgeladene Bild sollte dabei immer eine hohe Auflösung haben, damit es flexibel, z.B. auch als Banner-Bild eingesetzt werden kann. Plone liefert die Bilder automatisch in der besten Skalierung aus, so dass es nicht nötig ist Bilder manuell herunter zu skalieren."}' />

---

<block type="introduction" data-json='{"value":[{"children":[{"text":"Highlight Title H2 "}],"type":"h2"}]}' />

</fields>

</fields>

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat.&#x20;

<fields templateId="/templates/newsitem-view" templateInstanceId="tpl-ni-def" slotId="content">

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

<block type="introduction" data-json='{"value":[{"children":[{"text":"Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. "}],"type":"p"}]}' />

---

<block type="image" align="center" image_field="image" size="l" title="Image - Light" url="/docs/examples/content-types/image-light.jpg" data-json='{"description":"Der Inhaltstyp Bild kann verwendet werden um ein Bild in verschiedenen Formate (JPG, GIF, PNG, SVG) hochzuladen. Das hochgeladene Bild sollte dabei immer eine hohe Auflösung haben, damit es flexibel, z.B. auch als Banner-Bild eingesetzt werden kann. Plone liefert die Bilder automatisch in der besten Skalierung aus, so dass es nicht nötig ist Bilder manuell herunter zu skalieren."}' />

<block type="separator">

---

<fields data-json='{"styles":{"align":"left"}}' />

</block>

### Headline H3&#x20;

<block type="image" align="right" image_field="image" size="l" title="Image - Light" url="/docs/examples/content-types/image-light.jpg" data-json='{"description":"Der Inhaltstyp Bild kann verwendet werden um ein Bild in verschiedenen Formate (JPG, GIF, PNG, SVG) hochzuladen. Das hochgeladene Bild sollte dabei immer eine hohe Auflösung haben, damit es flexibel, z.B. auch als Banner-Bild eingesetzt werden kann. Plone liefert die Bilder automatisch in der besten Skalierung aus, so dass es nicht nötig ist Bilder manuell herunter zu skalieren."}' />

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem iusto odio dignissim qui blandit praesent luptatum zzril delenit auguevel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit luptatum zzril delenit auguevel eum iriure dolor in hendrerit in vulputate velit esse&#x20;

<block type="image" align="left" image_field="image" size="l" title="Image - Light" url="/docs/examples/content-types/image-light.jpg" data-json='{"description":"Der Inhaltstyp Bild kann verwendet werden um ein Bild in verschiedenen Formate (JPG, GIF, PNG, SVG) hochzuladen. Das hochgeladene Bild sollte dabei immer eine hohe Auflösung haben, damit es flexibel, z.B. auch als Banner-Bild eingesetzt werden kann. Plone liefert die Bilder automatisch in der besten Skalierung aus, so dass es nicht nötig ist Bilder manuell herunter zu skalieren."}' />

### Headline H3&#x20;

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem iusto odio dignissim qui blandit praesent luptatum zzril delenit auguevel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit&#x20;

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

<block type="separator">

---

<fields data-json='{"styles":{"align":"left"}}' />

</block>

<block type="image" align="left" image_field="image" size="m" title="Image - Light" url="/docs/examples/content-types/image-light.jpg" data-json='{"description":"Der Inhaltstyp Bild kann verwendet werden um ein Bild in verschiedenen Formate (JPG, GIF, PNG, SVG) hochzuladen. Das hochgeladene Bild sollte dabei immer eine hohe Auflösung haben, damit es flexibel, z.B. auch als Banner-Bild eingesetzt werden kann. Plone liefert die Bilder automatisch in der besten Skalierung aus, so dass es nicht nötig ist Bilder manuell herunter zu skalieren.","styles":{"size:noprefix":"medium"}}' />

### Headline H3&#x20;

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem iusto odio dignissim qui blandit praesent luptatum zzril delenit auguevel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum&#x20;

<block type="image" align="right" image_field="image" size="m" title="Image - Light" url="/docs/examples/content-types/image-light.jpg" data-json='{"description":"Der Inhaltstyp Bild kann verwendet werden um ein Bild in verschiedenen Formate (JPG, GIF, PNG, SVG) hochzuladen. Das hochgeladene Bild sollte dabei immer eine hohe Auflösung haben, damit es flexibel, z.B. auch als Banner-Bild eingesetzt werden kann. Plone liefert die Bilder automatisch in der besten Skalierung aus, so dass es nicht nötig ist Bilder manuell herunter zu skalieren.","styles":{"size:noprefix":"medium"}}' />

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem iusto odio dignissim qui blandit praesent luptatum zzril delenit auguevel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu luptatum zzril delenit auguevel eum iriure&#x20;

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

<block type="separator">

---

<fields data-json='{"styles":{"align":"left"}}' />

</block>

<block type="image" align="left" image_field="image" size="s" title="Image - Light" url="/docs/examples/content-types/image-light.jpg" data-json='{"description":"Der Inhaltstyp Bild kann verwendet werden um ein Bild in verschiedenen Formate (JPG, GIF, PNG, SVG) hochzuladen. Das hochgeladene Bild sollte dabei immer eine hohe Auflösung haben, damit es flexibel, z.B. auch als Banner-Bild eingesetzt werden kann. Plone liefert die Bilder automatisch in der besten Skalierung aus, so dass es nicht nötig ist Bilder manuell herunter zu skalieren.","styles":{"size:noprefix":"small"}}' />

### Headline H3&#x20;

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem iusto odio dignissim qui blandit praesent ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo  luptatum zzril delenit auguevel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu luptatum zzril delenit auguevel eum iriure dolor in hendrerit in&#x20;

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue&#x20;

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

<block type="image" align="right" image_field="image" size="s" title="Image - Light" url="/docs/examples/content-types/image-light.jpg" data-json='{"description":"Der Inhaltstyp Bild kann verwendet werden um ein Bild in verschiedenen Formate (JPG, GIF, PNG, SVG) hochzuladen. Das hochgeladene Bild sollte dabei immer eine hohe Auflösung haben, damit es flexibel, z.B. auch als Banner-Bild eingesetzt werden kann. Plone liefert die Bilder automatisch in der besten Skalierung aus, so dass es nicht nötig ist Bilder manuell herunter zu skalieren.","styles":{"size:noprefix":"small"}}' />

### Headline H3&#x20;

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem iusto odio dignissim qui blandit praesent ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo  luptatum zzril delenit auguevel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu luptatum zzril delenit auguevel eum iriure dolor in hendrerit in. Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem iusto odio dignissim qui blandit praesent ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo  luptatum zzril delenit auguevel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu luptatum zzril delenit auguevel eum iriure dolor in hendrerit in.

</fields>
