---
'@type': Document
UID: docs-adapters-000000000000001
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
is_folderish: true
language: '##DEFAULT##'
layout: document_view
preview_caption: null
preview_image: null
review_state: published
rights: ''
subjects:
  - adapters
  - frontend
title: CMS adapter guide
id: adapters
blocks-matched: |
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em,a/slate}" plaintext="${p,h*,ul,ol,blockquote,strong,em,a/text}" />
  <block type="title" _="${h1}" />
  <block type="codeExample">
    <region name="tabs" widget="object_list" idField="@id" typeField="@type">
      <block type="tab" label="${h3/text}" language="${pre/lang}" code="${pre/text}" />
    </region>
  </block>
blocks-tagged: |
  <block type="callout">
    <region name="items" widget="blocks_layout">
      <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em,a/slate}" plaintext="${p,h*,ul,ol,blockquote,strong,em,a/text}" />
    </region>
  </block>
  <block type="slateTable">
    <region name="table.rows" idField="key">
      <block type="row" _="${tr}">
        <region name="cells" idField="key" typeField="type">
          <block type="header" value="${th/slate}" />
          <block type="data" value="${td/slate}" />
        </region>
      </block>
    </region>
  </block>
---

# CMS adapter guide

The admin you edit in never talks to your CMS. Your frontend does.

An **adapter** is a small class, living in your frontend, that answers the admin's requests against whatever CMS you actually run. The admin sends intents like `content.get` and `content.update`; the adapter turns them into that CMS's own API calls. Nothing in the admin knows which CMS answered.

That inversion buys two things. The admin holds no CMS credentials — the session lives in your frontend's origin, where your users already sign in. And support for a new CMS is one class you write, not a fork of the editor.

<block type="callout" variation="note">

Adapters ship for Plone, WordPress and Drupal. The admin is byte-identical across all three: what changes is which adapter your frontend hands the bridge.

</block>

## What an adapter is for

An adapter serves **editing**. It is not a CMS proxy, and it is not a layer every
request goes through.

Its job is to tell the admin what this CMS can do and to carry out the editor's
changes: what content types exist and what fields they have, what a listing can
be queried on and ordered by, what a column holds, what a picked image or link
should leave behind in a block. The admin is generic and is not customised per
CMS, so everything it offers an editor comes from the adapter's answers. Where
the admin guessed instead, it guessed in Plone's vocabulary and was wrong
everywhere else.

Two things follow, and they are easy to get the wrong way round.

**A visitor's page does not go through the adapter.** The public site reads the
CMS directly, the way any headless frontend does — Plone has never needed a
bridge to serve a page, and neither does anything else. There is no adapter
mounted in view mode at all: the editing bridge is in the editor's build, and a
visitor's bundle has none of it. A frontend reading a CMS as a visitor uses that
CMS's own public read, which is a separate, smaller thing (`publicRead`).

**The adapter is not a translation layer.** It does not restate one CMS in
another's terms. It answers in its own: WordPress says `parent` where Plone says
`path`, and a listing block stores whichever name its adapter advertised. Each
CMS then builds its own query from what it stored. The adapters that once
carried tables mapping Plone's index names onto their own fields were papering
over the admin's guessing, and those tables are gone.

<block type="callout" variation="note">

The frontend and its adapter are built and deployed together, so the frontend
may rely on what its adapter stores. That is why a picker's result matters: what
the adapter hands back when an editor chooses an image or a link is what ends up
in the block, and what the public site later renders from.

</block>

## What a picker leaves behind

When an editor picks an image or a link, what the adapter hands back is what
ends up in the block — and what the public site renders from later. The admin
stores it and round-trips it; it does not interpret it.

So this is **your CMS's own metadata, in your CMS's own terms**, the same way
index names are. There is no shape to convert to. Volto's image widget wants
one thing, an `@id` to identify what was picked, and the only other handling
anywhere in the admin is resolving a RELATIVE url against the content — which
Plone needs, because Plone's scales are relative. An absolute url passes
through untouched.

### Js

```js
// WordPress's asset result: its own size names, each with the absolute url
// WordPress gave for it. Nothing restates these as Plone's scales.
return {
  id: String(media.id),
  path: `/${media.slug}`,
  fields: {
    url: media.source_url,
    filename: args.filename,
    scales: {
      thumbnail: { source_url: '…-150x150.png', width: 150, height: 150 },
      medium: { source_url: '…-300x200.png', width: 300, height: 200 },
    },
  },
};
```

Your frontend reads that, because it ships with the adapter. A frontend written
for Plone reads Plone's `download` (relative, joined to the content path); one
serving WordPress reads `source_url` (absolute, used as it stands). The same
file can read both — what it must not do is assume one CMS's convention and
apply it to another's data.

<block type="callout" variation="warning">

That assumption is worth naming, because it hides. A resolver that joins a
scale's url to the content path is correct for Plone and silently wrong for a
CMS whose urls are absolute: it produces `…/logo.png/http://…/logo.png`, which
renders as a broken image rather than an error. It stays hidden for as long as
the sizes are missing — with no scales there is no url to join, so the picture
works — and appears the moment the adapter starts supplying them.

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

connectProxy(new PloneAdapter({ cmsBaseUrl, getAuthToken: () => token }), {
  cmsBaseUrl,
});
```

The admin loads this page once, in a hidden iframe, and sends every CMS request to it for the whole editing session. It is a page of its own, rather than part of the page being edited, so that it survives whatever the editor navigates to: the preview is replaced as the editor moves around, and an adapter living there would take its in-flight requests with it. Keep it minimal: it should render nothing and navigate nowhere.

Point it at the same CMS your site renders from, or the admin will edit one site while the preview shows another. Your pages still call `initBridge` exactly as in [Build a frontend](../frontend-guide/build-a-frontend.md); the adapter is not passed there.

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

## Rendering a site that is not on Plone

The adapter is only for editing. Your frontend renders straight from its CMS,
as any headless frontend does, and a visitor's page never goes near the adapter
— the admin sends a page over the bridge only while that page is being edited.

So each adapter package ships a second, much smaller thing: a **public read**,
for a client with no credentials and no bridge.

### Js

```js
import { createPublicReader } from '@volto-hydra/hydra-adapters-wordpress/public';

const cms = createPublicReader({ cmsBaseUrl });

const page = await cms.document('/news/first-post'); // title and blocks
const menu = await cms.navigation();                 // the page tree
const trail = await cms.breadcrumbs('/news/first-post');
const site = await cms.site();                       // the site's own name
```

It answers only what a published page needs, and it asks the CMS only for what
a visitor may see: WordPress's reader sends `status=publish` and never
`context=edit`, because asking for either of the editor's parameters is what
would demand a session.

Listings are the same story. A listing block stores the criteria in the index
names **its own** adapter advertised, and that CMS's reader builds its own
request from them — nothing is translated on the way in:

### Js

```js
import { publicFetchItems } from '@volto-hydra/helpers';

// Plone's query builder is ploneFetchItems, which is already a direct read.
// Every other CMS uses its own reader.
const fetchItems = publicFetchItems({ reader: cms, contextPath });
```

<block type="callout" variation="note">

`adapterGetContent` and `adapterFetchItems` read through an adapter you already
hold and return Plone's REST shape. They are for a build that HAS an adapter —
the editor's build, where the admin's view mode shows a draft — not for a
visitor's page. A public bundle that carried an adapter would carry the editing
bridge and a CMS credential with it.

</block>

The credential is the frontend's own. A published page needs none; showing a
draft in the preview needs one for your CMS, because the admin's session is not
something WordPress or Drupal would accept.

A Plone frontend needs none of this and can keep fetching Plone directly.

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
  code: 'UNAUTHORIZED', // NOT_IMPLEMENTED, BAD_REQUEST, UNKNOWN_EXPANSION, …
  status: 401,
});
```

## Prove it with the contract suite

Adapters are held to one shared suite rather than per-CMS tests. Every target seeds itself from the same fixture and the assertions refer to that seed, so a test that needs a CMS-specific value to pass has found a leak in the abstraction.

Register a target that boots your CMS, seeds it and exposes your adapter, then run the suite against it. A capability you do not declare must be _rejected_, and the suite checks that too.

### Bash

```bash
ADAPTER_TARGET=my-cms npx vitest run --config vitest.adapters.config.mjs
```

The suite covers content CRUD, listings, search, navigation, breadcrumbs, schemas, vocabularies, references, assets, workflow, moves, auth and expansion. Getting it green is what "supports this CMS" means here.

## References, and what a delete would break

Two different questions, and only one of them every CMS can answer.

`reference.resolve` turns a stored reference into something renderable, and the
contract is an OUTCOME: a reference stored today still resolves after the target
is renamed or moved. It does not say how. Plone stores `resolveuid`, which is an
encoding its own REST layer produces and consumes; WordPress stores the post id,
stable across renames where the permalink is not, and resolves it on every render;
Drupal has `/node/<id>`, which is rename-proof already. Do not copy Plone's
encoding into your adapter — copy the promise.

`reference.dependents` asks the other way round: what links TO this document. That
needs an index of incoming links, and it is where CMSes genuinely differ rather
than differing in spelling. Plone has one, so it answers; WordPress indexes
nothing of the kind, so it does not claim `link-integrity` and the intent refuses.
The admin then withholds its delete warning there, which is better than a
confirmation dialog that quietly means nothing.

Containment — "and it holds twelve things" — is not part of either: `tree.list`
answers that already.

## Several operations at once

`batch` takes a list of operations and applies them as one intention:

<block type="slateTable" table.fixed table.celled>

| You send                                       | What happens                                                                                  |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `batch` with `operations: [{intent, args}, …]` | applied in the order given; the answer is `results`, one per operation, in that order         |
| a failure part-way                             | the error carries `failedIndex` and `applied`, so a caller can resume rather than start again |
| `atomic: true`                                 | honoured by a CMS that can promise it, refused with `NOT_IMPLEMENTED` by one that cannot      |

</block>

You do not implement this. `BaseAdapter` applies the operations one at a time, so
your adapter answers `batch` the day you write it. Override it only if your CMS
can genuinely group writes — WordPress core takes 25 requests per `/batch/v1`
call, Plone can take a whole subtree through `@import` — and then declare
`batch-native`, which tells callers that grouping is worth doing here. Drupal's
JSON:API has neither a batch route nor the atomic-operations extension, so it
keeps the floor and never claims the capability.

This is the same layering as expansion, with one deliberate difference: expansion
is reads, so it runs concurrently and omits what a CMS cannot serve. A batch is
writes. Order carries meaning — a parent before its child, an ordering after the
documents it orders — so operations are never reordered, a failure stops the run
rather than being skipped, and atomicity is asked for explicitly because it
cannot be emulated from outside the CMS.

## Reference

### Intents

<block type="slateTable" table.fixed table.celled>

| Group           | Intents                                                                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Content         | `content.get`, `content.create`, `content.update`, `content.delete`, `content.order`, `content.sort`, `content.move`, `content.copy`, `content.lock`, `content.unlock` |
| Types           | `types.list`, `types.getSchema`                                                                                                                                          |
| Reading         | `search`, `querystringSearch`, `querystring.getIndexes`, `tree.list`, `navigation.get`, `breadcrumbs.get`, `reference.resolve`, `reference.dependents`, `vocabulary.get` |
| Assets          | `asset.upload`, `asset.imageUrl`                                                                                                                                         |
| Session         | `auth.whoami`, `auth.logout`                                                                                                                                             |
| Workflow        | `state.get`, `state.getForms`, `state.transition`                                                                                                                        |
| The site        | `site.get`                                                                                                                                                               |
| Translations    | `translations.get`, `translations.create`, `translations.link`, `translations.unlink`, `translations.locate`                                                             |
| Several at once | `batch`                                                                                                                                                                  |
| Escape hatch    | `http`                                                                                                                                                                   |

</block>

### Capabilities

<block type="slateTable" table.fixed table.celled>

| Capability                                                       | The admin turns on                                                              |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `content`                                                        | Editing at all — every adapter needs it                                         |
| `search-fulltext`, `search-filter`                               | Text search, and server-side filtering                                          |
| `schema`                                                         | Type-driven edit forms                                                          |
| `vocabulary`                                                     | Choice widgets backed by CMS vocabularies                                       |
| `asset`                                                          | Image and file upload                                                           |
| `state`                                                          | The workflow menu                                                               |
| `sharing`, `per-content-permissions`, `hierarchical-permissions` | The access dialog                                                               |
| `versioning`                                                     | History and revisions                                                           |
| `comments`                                                       | Reader comments and moderation                                                  |
| `multilingual`                                                   | Manage Translations, and the translate/link controls                            |
| `http-passthrough`                                               | Forwarding Plone-dialect requests unchanged                                     |
| `expand-native`                                                  | The admin asks for its expander bundle inside the content response              |
| `batch-native`                                                   | Grouping writes into one request saves round trips, so callers may batch freely |
| `link-integrity`                                                 | The CMS can say what links TO a document, so a delete can be warned about       |
| `locking`                                                        | The CMS can say who is editing a document now, so a second editor is warned     |

</block>
