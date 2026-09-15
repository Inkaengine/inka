---
"@type": Document
UID: docs-live-preview-001
allow_discussion: false
contributors: []
creators:
  - admin
description: To make your site editable with Hydra you load hydra.js in your
  frontend and call initBridge(). This sets up a two-way communication channel
  that handles authentication, page navigation, and live content updates.
effective: 2025-01-01T00:00:00
exclude_from_nav: false
expires: null
id: live-preview
is_folderish: false
language: "##DEFAULT##"
layout: document_view
preview_caption: null
preview_image: null
review_state: published
rights: ""
subjects:
  - editing
title: Live Preview
blocks-matched: |
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
  <block type="title" _="${h1}" />
  <block type="separator" _="${hr}" styles={"align":"full"} />
  <block type="codeExample">
    <region name="tabs" widget="object_list">
      <block type="tab" label="${h3/text}" language="${pre/lang}" code="${pre/text}" />
    </region>
  </block>
---

# Live Preview

To make your site editable with Hydra you load hydra.js in your frontend and call `initBridge()`. This sets up a two-way communication channel that handles authentication, page navigation, and live content updates.

<block type="separator" />

## Setting Up the Bridge

Call `initBridge()` with an `onEditChange` callback to receive live content updates as the user edits. Your frontend re-renders in real time. Outside edit mode, fetch content from the API as normal.

### Javascript

```javascript
import { initBridge } from './hydra.js';

let bridge;
if (window.name.startsWith('hydra')) {
    bridge = initBridge({
        onEditChange: (formData) => renderPage(formData),
    });
} else {
    renderPage(await fetchContent(window.location.pathname));
}
```

The `formData` passed to `onEditChange` has the same structure as the Plone REST API response, so the same rendering code works for both live editing and normal page display.

Either hashbang (`/#!/path`) or normal (`/path`) style paths are supported.

## A Simple Page Renderer

Iterate `blocks_layout.items` and render each block by type. Add `data-block-uid` so Hydra knows which block the user clicked.

### Javascript

```javascript
<!DOCTYPE html>
<html>
<head>
    <script type="module">
    import { initBridge } from './hydra.js';

    if (window.name.startsWith('hydra')) {
        initBridge({
            onEditChange: (formData) => renderPage(formData),
        });
    } else {
        renderPage(await fetchContent(window.location.pathname));
    }

    function renderPage(data) {
        document.getElementById('content').innerHTML =
            data.blocks_layout.items.map(id => {
                const block = data.blocks[id];
                return `<div data-block-uid="${id}">
                    ${renderBlock(block)}
                </div>`;
            }).join('');
    }

    function renderBlock(block) {
        switch (block['@type']) {
            case 'slate':
                return renderSlate(block.value);
            case 'image':
                return `<img src="${block.url}/@@images/image" />`;
            default:
                return `<pre>${JSON.stringify(block, null, 2)}</pre>`;
        }
    }
    </script>
</head>
<body>
    <div id="content"></div>
</body>
</html>
```

## Allowed Blocks and Page Regions

When initialising the bridge, you can configure rules for what blocks can be added to the page and where. Pages can have multiple blocks fields for different regions (e.g., header, content, footer), each with its own allowed block types and limits. These show as separate sections in the sidebar when no block is selected:

### Javascript

```javascript
bridge = initBridge({
    page: {
        schema: {
            properties: {
                items: {
                    widget: 'blocks_layout',
                    title: 'Content',
                    allowedBlocks: ['slate', 'image', 'hero', 'columns'],
                },
                header: {
                    widget: 'blocks_layout',
                    title: 'Header',
                    allowedBlocks: ['slate', 'image'],
                    maxLength: 3,
                },
                footer: {
                    widget: 'blocks_layout',
                    title: 'Footer',
                    allowedBlocks: ['slate', 'link'],
                },
            },
        },
    },
});
```
