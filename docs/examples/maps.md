---
"@type": Document
UID: e090d954d0a448bca81c1a646e673a12
allow_discussion: false
contributors: []
creators:
  - admin
description: The maps block can have embeded a Map (Google Maps, OpenMaps, etc).
effective: 2023-09-22T16:09:00
exclude_from_nav: false
expires: null
id: maps
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
title: Maps
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
  <block type="maps" title="${p/text}" url="${p/href}" />
---

# Maps

Embeds a map from a URL (Google Maps, OpenStreetMap, etc.) using an iframe. The url field should contain the embed URL, and title provides an accessible label.

<block type="image">

![The maps example block being edited in Inka](../images/maps-edit.png)

</block>

<block type="maps">

[Plone Conference 2024 Location](https://www.google.com/maps/embed?pb=!1m14!1m12!1m3!1d48400.376998388674!2d-47.9029345500163!3d-15.808744945878342!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!5e0!3m2!1sde!2sde!4v1710241027280!5m2!1sde!2sde)

<fields align="wide" />

</block>

---

## Text Heading H2&#x20;

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.

<block type="maps">

[Ploneconf 2022 was in Namur, Belgium ](https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2468.496805908769!2d4.867355714504337!3d50.46334407876937!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x47c1996d6ee4733f%3A0x1e62003289f50ea5!2zVGjDqcOidHJlIGRlIE5hbXVy!5e1!3m2!1sde!2sde!4v1710240653269!5m2!1sde!2sde)

<fields align="center" />

</block>

<block type="separator">

---

<fields styles:align="left" />

</block>

### Text Heading H3

<block type="maps">

[Ploneconf 2023 was in Eibar, Basque Country](https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d11636.817018227113!2d-2.482132780659554!3d43.184224884135176!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0xd4e2a88f426a197%3A0x4d516b1201c5b562!2s20600%20Eibar%2C%20Gipuzkoa%2C%20Spanien!5e0!3m2!1sde!2sde!4v1710240766721!5m2!1sde!2sde)

<fields align="right" />

</block>

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem iusto odio dignissim qui blandit praesent luptatum zzril delenit auguevel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore

blandit praesent luptatum zzril qui Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem iusto odio dignissim qui blandit praesent luptatum zzril delenit auguevel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore

blandit praesent luptatum zzril qui.

<block type="maps">

[Ploneconf 2018 was in Tokyo, Japan](https://www.google.com/maps/embed?pb=!1m14!1m12!1m3!1d205767.4968598755!2d139.73212733058264!3d35.74059553032941!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!5e0!3m2!1sde!2sde!4v1710240866243!5m2!1sde!2sde)

<fields align="left" />

</block>

### Text Heading H3

Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem iusto odio dignissim qui blandit praesent luptatum zzril delenit auguevel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore

blandit praesent luptatum zzril qui Lorem ipsum dolor sit amet adipiscing elit, sed diam nonummy nibh euismod tincidunt ut laoreet dolore magna aliquam erat volutpat. Ut wisi enim ad minim veniam, quis nostrud exerci tation ullamcorper suscipit lobortis nisl ut aliquip ex ea commodo consequat. Duis autem iusto odio dignissim qui blandit praesent luptatum zzril delenit auguevel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore

blandit praesent luptatum zzril qui.

<block type="maps">

[Ploneconf 2019 was in Ferrara, Italy](https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d22634.237371369458!2d11.585803356749143!3d44.83623754078171!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x477e4e0bde2b11dd%3A0x3c3b79ae53712b2e!2sFerrara%2C%20Italien!5e0!3m2!1sde!2sde!4v1710240969607!5m2!1sde!2sde)

<fields align="full" />

</block>

<block type="slate" />

<fields templateId="/templates/block-reference-layout" templateInstanceId="tpl-inst-maps" data-json='{"fixed":false,"readOnly":false}'>

<block type="codeExample" slotId="schema">

### Schema

```{literalinclude} ../../tests-playwright/fixtures/shared-block-schemas.js
:jsobject: maps
```

</block>

<block type="codeExample" slotId="json-data">

### JSON

```{literalinclude} ./maps.md
:block: maps
:as: json
```

</block>

<block type="codeExample" slotId="rendering">

### React

```{literalinclude} examples/react/MapsBlock.jsx
:language: jsx
```

### Vue

```{literalinclude} examples/vue/MapsBlock.vue
:language: vue
```

### Svelte

```{literalinclude} examples/svelte/MapsBlock.svelte
:language: svelte
```

</block>

</fields>
