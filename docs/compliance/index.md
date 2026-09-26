---
"@type": Document
UID: docs-compliance-00000000000001
allow_discussion: false
creators:
  - admin
description: The rules your front end sets are applied while people edit, from
  blocked saves to advice beside a field. Inka Assure, in development, will keep
  the record of what was checked and signed off.
effective: 2025-01-01T00:00:00
exclude_from_nav: false
review_state: published
is_folderish: true
layout: document_view
title: Rules and checks
id: compliance
blocks-matched: |
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
  <block type="title" _="${h1}" />
  <block type="codeExample">
    <region name="tabs" widget="object_list">
      <block type="tab" label="${h3/text}" language="${pre/lang}" code="${pre/text}" />
    </region>
  </block>
---

# Rules and checks

Your front end tells Inka what each block allows, and Inka applies those rules while people edit. Some rules stop a save. Others give advice and let the save go ahead. All of them are open source and work today.

## Rules that work now

Rules live in the block schemas and regions your front end passes to `initBridge`. Here is one short example of each kind.

### A value that cannot work: `error`

A field rule with `error` marks the field invalid and blocks the save until it is fixed.

### Javascript

```javascript
fieldRules: {
  image: {
    when: { 'image_scales.image.0.content-type': { isNot: 'image/svg+xml' } },
    error: 'A pictogram must be an SVG.',
  },
},
```

### A value that may be wrong: `warning`

A field rule with `warning` shows advice beside the field. The page still saves.

### Javascript

```javascript
fieldRules: {
  image: {
    when: { image: { regex: '\\.png$' } },
    warning: 'A pictogram should be an SVG drawn to the 48×48 grid.',
  },
},
```

### Which blocks go where: `allowedBlocks`

Each region lists the block types it accepts, and `maxLength` caps how many.

### Javascript

```javascript
header: { widget: 'blocks_layout', allowedBlocks: ['slate', 'image'], maxLength: 3 },
```

### Which text styles: `allowedStyles`

A region can limit the text styles its rich text may use.

### Javascript

```javascript
items: {
  widget: 'blocks_layout',
  allowedStyles: ['p', 'h2', 'h3', 'ul', 'ol', 'li', 'strong', 'em'],
},
```

### Parts nobody can change: locked template blocks

A template or layout marks blocks as `fixed` (can't be moved) and `readOnly` (can't be edited), and leaves named slots where editors add their own blocks. Offer templates with `allowedTemplates`, and force a layout with `allowedLayouts`.

### Json

```json
"footer": { "@type": "slate", "fixed": true, "readOnly": true, "slotId": "footer" }
```

Block fields also take the usual schema rules, such as `required` and `maxLength`, and those block the save too. For the full rule language see [Schema enhancers](../frontend-guide/custom-blocks.md#schema-enhancers), [Container blocks](../frontend-guide/container-blocks.md) and [Templates](../frontend-guide/templates.md).

## Sign-off and the record: Inka Assure

Rules catch problems while a page is written. Some things need a person's judgement, and an organisation often needs proof of what was checked.

[Inka Assure](https://inka.sh/plugins/inka-assure) is PretaGov's governance record service for Inka. It is **in development and planned for late 2026**. It will be available licensed, to run yourself, or as a hosted service. It will:

- record which checks ran on each published version, and what they found;
- let people sign off exceptions, with who, when and why;
- support approval checklists at workflow steps;
- keep an inventory of where each block and template is used;
- offer optional AI-based rules, used only if you turn them on.

## What is open source and what is licensed

- **Open source (MIT):** the Inka editor, the bridge script, the rules above, templates and layouts, the adapters, and the test suites.
- **Licensed:** Inka Assure, once it is released, either to run yourself or hosted by PretaGov.
