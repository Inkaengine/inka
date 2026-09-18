---
"@type": Document
UID: docs-cms-adapters-001
allow_discussion: false
contributors: []
creators:
  - admin
description: Inka's admin holds no CMS credentials. Your frontend picks the
  adapter, so the same admin edits Plone, WordPress or Drupal — and a CMS with
  no adapter yet needs one class, not a fork.
effective: 2025-01-01T00:00:00
exclude_from_nav: false
expires: null
id: cms-adapters
is_folderish: false
language: "##DEFAULT##"
layout: document_view
preview_caption: null
preview_image: null
review_state: published
rights: ""
subjects:
  - adapters
  - frontend
title: Connect any CMS
blocks-matched: |
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
  <block type="title" _="${h1}" />
  <block type="callout">
    <region name="items" widget="blocks_layout">
      <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
    </region>
  </block>
  <block type="codeExample">
    <region name="tabs" widget="object_list">
      <block type="tab" label="${h3/text}" language="${pre/lang}" code="${pre/text}" />
    </region>
  </block>
blocks-tagged: |
  <block type="slateTable">
    <region name="table.rows">
      <block type="row">
        <region name="cells">
          <block type="cell" value="${td/slate}" />
        </region>
      </block>
    </region>
  </block>
---

# Connect any CMS

The admin you edit in never talks to your CMS. Your frontend does.

An **adapter** is a small class, living in your frontend, that answers the admin's requests against whatever CMS you actually run. The admin sends intents like `content.get` and `content.update`; the adapter turns them into that CMS's own API calls. Nothing in the admin knows which CMS answered.

That inversion buys two things. The admin holds no CMS credentials — the session lives in your frontend's origin, where your users already sign in. And support for a new CMS is one class you write, not a fork of the editor.

<block type="callout" variation="note">

Adapters ship for Plone, WordPress and Drupal. The admin is byte-identical across all three: what changes is which adapter your frontend hands the bridge.

</block>

## Install an adapter

Install the package for your CMS. `@volto-hydra/hydra-types` is optional and carries the TypeScript definitions.

### Bash

```bash
npm install @volto-hydra/hydra-adapters-plone
# or @volto-hydra/hydra-adapters-wordpress
# or @volto-hydra/hydra-adapters-drupal
```

Then give your frontend one more page, served at **`/hydra-proxy.html`**, that constructs the adapter and hands it to `connectProxy`. That page is where the adapter lives.

### Js

```js
import { connectProxy } from '@volto-hydra/hydra-js';
import { PloneAdapter } from '@volto-hydra/hydra-adapters-plone';

const cmsBaseUrl = 'https://cms.example.com';
// The admin passes the session it already has; read it on every request, so
// a renewed token is picked up without rebuilding the adapter.
const token = new URLSearchParams(window.location.search).get('access_token');

connectProxy(new PloneAdapter({ cmsBaseUrl, getAuthToken: () => token }), { cmsBaseUrl });
```

The admin loads this page once, in a hidden iframe, and sends every CMS request to it for the whole editing session. It is a page of its own, rather than part of the page being edited, so that it survives whatever the editor navigates to: the preview is replaced as the editor moves around, and an adapter living there would take its in-flight requests with it. Keep it minimal: it should render nothing and navigate nowhere.

Point it at the same CMS your site renders from, or the admin will edit one site while the preview shows another. Your pages still call `initBridge` exactly as in [Build a frontend](./build-a-frontend.md); the adapter is not passed there.

The example apps each serve one, written the way their framework would: Nuxt as a page (`pages/hydra-proxy.html.vue`), Next.js as an app-router route (`src/app/hydra-proxy.html/page.js`), and Framework7 as a second Vite entry (`src/hydra-proxy.html`).

Each adapter takes the options its CMS needs:

### Js

```js
// Plone — a JWT from @login, or a function returning the current one.
new PloneAdapter({ cmsBaseUrl, getAuthToken });

// WordPress — a REST nonce when you are already logged into wp-admin,
// or application-password credentials. `postType` defaults to 'pages'.
new WordPressAdapter({ cmsBaseUrl, nonce, credentials, postType });

// Drupal — JSON:API with basic-auth credentials. `bundle` is the node
// type to create, defaulting to 'page'.
new DrupalAdapter({ cmsBaseUrl, credentials, bundle });
```

## What editors notice

**Signing in happens in your frontend, not the admin.** The adapter owns the session, so the admin has no login form of its own to offer. If the adapter has no credential it raises an `auth-required` event and your frontend decides what to show — its own login screen, an OAuth popup, whatever you already use.

**Logging out ends the real session.** The admin's logout button reaches the adapter as `auth.logout`. Clearing only the admin's own state would be the dangerous half of a logout: the editor sees an empty toolbar while the credential that reaches the CMS is still live.

**Buttons appear only when the CMS can back them.** The admin gates its UI on what the adapter declares, so a CMS without workflow shows no publish menu rather than a button that fails.

## Write a custom adapter

An adapter is any object with this shape. In TypeScript it is the `HydraAdapter` interface from `@volto-hydra/hydra-types`.

### Js

```js
{
  name: 'my-cms',
  capabilities: ['content', 'search-fulltext'],
  async init(ctx) {},                  // ctx.cmsBaseUrl, ctx.emit(event, payload)
  async whoami() {},                   // the signed-in user, or null
  getAdminUrl(panel) {},               // deep link into the CMS's own admin, or null
  async dispatch(intent, args) {},     // do the work
}
```

Extend `BaseAdapter` rather than starting from the interface. It implements everything except `dispatch`, and what it gives you is the part that is tedious to get right:

- **Read retention and in-flight sharing.** Identical reads are answered once and shared, then held until your next write. On the Drupal journey that took CMS requests from 190 to 83.
- **Invalidation on write.** Writing intents clear the retained reads, so a save is never followed by a stale answer.
- **One retry on 401.** A session refreshed in another tab recovers silently; a second failure raises `auth-required` and rethrows.
- **Context expansion.** The admin may ask for a bundle of related reads along with a document; `BaseAdapter` issues them concurrently.

### Js

```js
import { BaseAdapter, AdapterError } from '@volto-hydra/hydra-adapters-core';

export class MyCmsAdapter extends BaseAdapter {
  constructor({ cmsBaseUrl, credentials }) {
    super({ name: 'my-cms', capabilities: ['content', 'search-fulltext'] });
    this.cmsBaseUrl = cmsBaseUrl;
    this.credentials = credentials;
  }

  async dispatch(intent, args) {
    switch (intent) {
      case 'content.get': {
        const doc = await this.get(`/items${args.path}`);
        // Attach the expansion bundle if one was asked for. Never a new
        // capability: each name is something the admin could request alone.
        return this.withContext(this.toDocument(doc), args.path, args.expand);
      }
      case 'content.update':
        await this.patch(`/items${args.path}`, args.data);
        return null;
      default:
        // Anything you have not implemented must say so rather than return
        // empty — an empty answer reads as "this content has nothing".
        throw new AdapterError(`my-cms does not implement '${intent}'`, {
          code: 'NOT_IMPLEMENTED',
          status: 501,
        });
    }
  }
}
```

### Declare only what you have

`capabilities` is a promise the admin plans its UI around. Claiming one you cannot serve is worse than omitting it: the admin renders the control, the call fails, and the editor sees a dead button. Omit it and the control never appears.

`http-passthrough` is the exception worth understanding. It says "this CMS speaks Plone's REST dialect", and the admin then forwards its requests verbatim instead of translating them to intents. Only claim it if that is true.

### Fail loudly

Throw `AdapterError` with a code. Returning an empty result for something you cannot do is the one failure mode that cannot be diagnosed later: the admin renders "nothing here" and nobody learns why.

### Js

```js
throw new AdapterError('my-cms: no workflow on this content', {
  code: 'UNAUTHORIZED',   // NOT_IMPLEMENTED, BAD_REQUEST, UNKNOWN_EXPANSION, …
  status: 401,
});
```

## Prove it with the contract suite

Adapters are held to one shared suite rather than per-CMS tests. Every target seeds itself from the same fixture and the assertions refer to that seed, so a test that needs a CMS-specific value to pass has found a leak in the abstraction.

Register a target that boots your CMS, seeds it and exposes your adapter, then run the suite against it. A capability you do not declare must be *rejected*, and the suite checks that too.

### Bash

```bash
ADAPTER_TARGET=my-cms npx vitest run --config vitest.adapters.config.mjs
```

The suite covers content CRUD, listings, search, navigation, breadcrumbs, schemas, vocabularies, references, assets, workflow, moves, auth and expansion. Getting it green is what "supports this CMS" means here.

## Reference

### Intents

<block type="slateTable" table.fixed table.celled>

| Group | Intents |
| --- | --- |
| Content | `content.get`, `content.create`, `content.update`, `content.delete`, `content.order`, `content.move` |
| Types | `types.list`, `types.getSchema` |
| Reading | `search`, `querystringSearch`, `querystring.getIndexes`, `tree.list`, `navigation.get`, `breadcrumbs.get`, `reference.resolve`, `vocabulary.get` |
| Assets | `asset.upload`, `asset.imageUrl` |
| Session | `auth.whoami`, `auth.logout` |
| Workflow | `state.get`, `state.getForms`, `state.transition` |
| Navigation | `navigation.setExcluded`, `navigation.setTitle` |
| Escape hatch | `http` |

</block>

### Capabilities

<block type="slateTable" table.fixed table.celled>

| Capability | The admin turns on |
| --- | --- |
| `content` | Editing at all — every adapter needs it |
| `search-fulltext`, `search-filter` | Text search, and server-side filtering |
| `schema` | Type-driven edit forms |
| `vocabulary` | Choice widgets backed by CMS vocabularies |
| `asset` | Image and file upload |
| `state` | The workflow menu |
| `sharing`, `per-content-permissions`, `hierarchical-permissions` | The access dialog |
| `versioning` | History and revisions |
| `navigation-exclusion`, `navigation-title` | Per-item navigation controls |
| `http-passthrough` | Forwarding Plone-dialect requests unchanged |

</block>
