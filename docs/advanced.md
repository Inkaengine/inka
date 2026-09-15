---
"@type": Document
UID: docs-advanced-001
allow_discussion: false
contributors: []
creators:
  - admin
description: "Advanced topics for optimising your Inka integration: lazy loading
  the bridge, authentication, and preventing reloads."
effective: 2025-01-01T00:00:00
exclude_from_nav: false
expires: null
id: advanced
is_folderish: false
language: "##DEFAULT##"
layout: document_view
preview_caption: null
preview_image: null
review_state: published
rights: ""
subjects:
  - frontend
title: Advanced
blocks-matched: |
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
  <block type="callout">
    <region name="items" widget="blocks_layout">
      <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
    </region>
  </block>
  <block type="title" _="${h1}" />
  <block type="separator" _="${hr}" styles={"align":"full"} />
  <block type="codeExample">
    <region name="tabs" widget="object_list">
      <block type="tab" label="${h3/text}" language="${pre/lang}" code="${pre/text}" />
    </region>
  </block>
---

# Advanced

Advanced topics for optimising your Inka integration: lazy loading the bridge, authentication, and preventing reloads.

<block type="separator" />

<block type="callout" variation="note">

Volto is built as a monolith CMS framework, so ignore the parts of the documentation that apply to its presentation layer — Inka replaces that piece.

</block>

## Lazy Load the Bridge

Detect the admin iframe and load the bridge only when needed. `window.name` is set by Inka to indicate mode:

- **\`hydra-edit:\<origin>\`** — edit mode (e.g., `hydra-edit:http://localhost:3001`)
- **\`hydra-view:\<origin>\`** — view mode (e.g., `hydra-view:http://localhost:3001`)

This persists across SPA navigation within the iframe, allowing your frontend to detect it's in the admin even after client-side route changes. In view mode, render from your API immediately but still load the bridge for navigation tracking. In edit mode, wait for `onEditChange` before rendering.

### Javascript

```javascript
function loadBridge(callback) {
    const existingScript = document.getElementById("hydraBridge");
    if (!existingScript) {
      const script = document.createElement("script");
      script.src = "your-hydra-js-path";
      script.id = "hydraBridge";
      document.body.appendChild(script);
      script.onload = () => callback();
    } else {
      callback();
    }
}

const isHydraEdit = window.name.startsWith('hydra-edit:');
const isHydraView = window.name.startsWith('hydra-view:');
const inAdminIframe = isHydraEdit || isHydraView;

// View mode or not in admin: render from API
if (!isHydraEdit) {
    renderPage(await fetchContent(path));
}

// Load bridge only in admin iframe
if (inAdminIframe) {
    loadBridge(() => {
        initBridge({
            onEditChange: (formData) => renderPage(formData),
        });
    });
}
```

## Authentication

As soon as the editor logs into the hydra editor, your frontend should use the same auth token to access the REST API with the same privileges and render private content.

The `access_token` is passed as a URL parameter on initial load and automatically stored in `sessionStorage` by hydra.js. On SPA navigation, the URL param is gone but the token persists in `sessionStorage`. Use the `getAccessToken()` helper:

### Javascript

```javascript
import { getAccessToken } from '@hydra-js/hydra.js';

const token = getAccessToken();
// Returns token from URL param (if present)
// or sessionStorage (for SPA navigation)
```

Example using Next.js 14 and ploneClient:

### Javascript

```javascript
import ploneClient from "@plone/client";
import { useQuery } from "@tanstack/react-query";
import { getAccessToken } from '@hydra-js/hydra.js';

export default function Blog({ params }) {
  const token = getAccessToken();

  const client = ploneClient.initialize({
    apiPath: "http://localhost:8080/Plone/",
    token: token,
  });

  const { getContentQuery } = client;
  const { data, isLoading } = useQuery(
    getContentQuery({ path: '/blogs' })
  );

  if (isLoading) return <div>Loading...</div>;
  return <div>{data.title}</div>;
}
```

## Preventing Reloads

If you wish to make the editing experience smoother you can register for `onRoute` callbacks to prevent the frontend being forced to reload at certain times using the hydra editor. (TODO)

## Custom Sidebar and CMS UI

If the auto-generated sidebar UI from your block or content schemas isn't suitable, the React Volto framework has an addon system that lets you override CMS components — at widget level, block-settings level, or even whole views like Contents or Site Settings. For example, you might want to replace the image picker with a custom map editor.

- [Volto Block Edit Component documentation](https://6.docs.plone.org/volto/blocks/editcomponent.html)

## Custom Visual Editing (TODO)

In some cases you might want to provide editors with more visual editing inside the preview than Inka currently supports out of the box. For example, a newly created table block might display a form to set the initial number of columns and rows. The bridge exposes the following hooks to make this possible:

- **\`sendBlockUpdate\`** — send an updated version of the block back to the admin after frontend-side changes (TODO).
- **\`sendBlockAction\`** — perform actions like select, add, move, copy or remove blocks, or invoke custom actions on the Volto block edit component.
- You can disable Inka's default handling of selection, DnD, or other interactions if you want to replace some parts of Inka and not others (TODO).

## Custom API Endpoints

With an open-source headless CMS you have a choice between creating custom server-side functionality as:

- A separately deployed microservice, or
- An [API endpoint addon](https://2022.training.plone.org/mastering-plone/endpoints.html) attached to the backend API server.
