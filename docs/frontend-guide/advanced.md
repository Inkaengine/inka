---
"@type": Document
UID: docs-advanced-001
allow_discussion: false
contributors: []
creators:
  - admin
description: "Advanced topics for optimising your Inka integration: lazy loading
  the bridge, authentication, and customising the editor."
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
  <block type="title" _="${h1}" />
  <block type="separator" _="${hr}" styles={"align":"full"} />
  <block type="codeExample">
    <region name="tabs" widget="object_list">
      <block type="tab" label="${h3/text}" language="${pre/lang}" code="${pre/text}" />
    </region>
  </block>
blocks-tagged: |
  <block type="callout">
    <region name="items" widget="blocks_layout">
      <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
    </region>
  </block>
---

# Advanced

Advanced topics for optimising your Inka integration: lazy loading the bridge, authentication, and customising the editor.

<block type="separator" />

<block type="callout" variation="note">

Inka's editor builds on Volto, Plone's React editor. Volto's own documentation also covers its presentation layer; ignore those parts, because your front end replaces it.

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

As soon as an editor signs in to Inka, your frontend should use the same auth token to access the CMS API with the same privileges and render private content.

The `access_token` is passed as a URL parameter on initial load and automatically stored in `sessionStorage` by hydra.js. On SPA navigation, the URL param is gone but the token persists in `sessionStorage`. Use the `getAccessToken()` helper. For what this means for security, and how to limit it, see [Deploy and secure Inka](../deploy-and-secure.md#how-an-editors-login-reaches-the-front-end).

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

## Custom Sidebar and CMS UI

If the auto-generated sidebar UI from your block or content schemas isn't suitable, Volto's add-on system lets you override the editor's components — at widget level, block-settings level, or even whole views like Contents or Site Settings. For example, you might want to replace the image picker with a custom map editor.

- [Volto Block Edit Component documentation](https://6.docs.plone.org/volto/blocks/editcomponent.html)

## Custom Visual Editing

Some editing needs a UI that a schema can't describe, such as a map picker, or a form to choose the rows and columns of a new table. Build that UI as the block's edit component in the editor, as above, and send `disableCustomSidebarEditForm: false` for that block (see [Custom Blocks](./custom-blocks.md)). Your front end then only renders the result.

## Custom API Endpoints

With an open-source headless CMS you have a choice between creating custom server-side functionality as:

- A separately deployed microservice, or
- An [API endpoint addon](https://2022.training.plone.org/mastering-plone/endpoints.html) attached to the backend API server.
