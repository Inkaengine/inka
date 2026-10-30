---
"@type": Document
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
language: "##DEFAULT##"
layout: document_view
preview_caption: null
preview_image: null
review_state: published
rights: ""
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
      <block type="tab" label="${h3/text}" language="${pre/lang}" code="${pre/textarea}" />
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

An adapter serves **editing**. It is not a CMS proxy, and it is not a layer every request goes through.

Its job is to tell the admin what this CMS can do and to carry out the editor's changes: what content types exist and what fields they have, what a listing can be queried on and ordered by, what a column holds, what a picked image or link should leave behind in a block. The admin is generic and is not customised per CMS, so everything it offers an editor comes from the adapter's answers. Where the admin guessed instead, it guessed in Plone's vocabulary and was wrong everywhere else.

Two things follow, and they are easy to get the wrong way round.

**A visitor's page does not go through the adapter.** The public site reads the CMS directly, the way any headless frontend does — Plone has never needed a bridge to serve a page, and neither does anything else. There is no adapter mounted in view mode at all: the editing bridge is in the editor's build, and a visitor's bundle has none of it. A frontend reading a CMS as a visitor uses that CMS's own public read, which is a separate, smaller thing (`publicRead`).

**The adapter is not a translation layer.** It does not restate one CMS in another's terms. It answers in its own: WordPress says `parent` where Plone says `path`, and a listing block stores whichever name its adapter advertised. Each CMS then builds its own query from what it stored. The adapters that once carried tables mapping Plone's index names onto their own fields were papering over the admin's guessing, and those tables are gone.

<block type="callout" variation="note">

The frontend and its adapter are built and deployed together, so the frontend may rely on what its adapter stores. That is why a picker's result matters: what the adapter hands back when an editor chooses an image or a link is what ends up in the block, and what the public site later renders from.

</block>

## What a picker leaves behind

When an editor picks an image or a link, what the adapter hands back is what ends up in the block — and what the public site renders from later. The admin stores it and round-trips it; it does not interpret it.

So this is **your CMS's own metadata, in your CMS's own terms**, the same way index names are. There is no shape to convert to. Volto's image widget wants one thing, an `@id` to identify what was picked, and the only other handling anywhere in the admin is resolving a RELATIVE url against the content — which Plone needs, because Plone's scales are relative. An absolute url passes through untouched.

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

Your frontend reads that, because it ships with the adapter. A frontend written for Plone reads Plone's `download` (relative, joined to the content path); one serving WordPress reads `source_url` (absolute, used as it stands). The same file can read both — what it must not do is assume one CMS's convention and apply it to another's data.

<block type="callout" variation="warning">

That assumption is worth naming, because it hides. A resolver that joins a scale's url to the content path is correct for Plone and silently wrong for a CMS whose urls are absolute: it produces `…/logo.png/http://…/logo.png`, which renders as a broken image rather than an error. It stays hidden for as long as the sizes are missing — with no scales there is no url to join, so the picture works — and appears the moment the adapter starts supplying them.

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

The adapter is only for editing. Your frontend renders straight from its CMS, as any headless frontend does, and a visitor's page never goes near the adapter — the admin sends a page over the bridge only while that page is being edited.

So each adapter package ships a second, much smaller thing: a **public read**, for a client with no credentials and no bridge.

### Js

```js
import { createPublicReader } from '@volto-hydra/hydra-adapters-wordpress/public';

const cms = createPublicReader({ cmsBaseUrl });

const page = await cms.document('/news/first-post'); // title and blocks
const nav = await cms.navigation();                  // the main hierarchy
const trail = await cms.breadcrumbs('/news/first-post');
const site = await cms.site();                       // the site's own name

// A curated menu is a separate VIEW over the same content. WordPress needs
// WPGraphQL for it (core answers a visitor's menu read with 401), and a menu is
// published by being assigned to a theme LOCATION, so that is what selects one.
const menu = await cms.menu({ location: 'primary' });
```

It answers only what a published page needs, and it asks the CMS only for what a visitor may see: WordPress's reader sends `status=publish` and never `context=edit`, because asking for either of the editor's parameters is what would demand a session.

A visitor's SEARCH block needs one more thing, and the rule for it is tighter than the editor's. "Advertise only what you can serve" says a selection index must offer either `values` or a `vocabulary` to look up. A visitor has no adapter, so there is nothing to look a vocabulary up THROUGH: for a public search block the index must carry `values`. Naming a vocabulary and stopping there renders a filter with nothing to tick while the query behind it works perfectly, which is the failure that looks like a styling bug.

It does not need the adapter, though. The registries the adapter reads to build those indexes are themselves public: WordPress answers `/wp/v2/types` and `/wp/v2/taxonomies` to anyone, and a taxonomy's terms come back from its own `rest_base`. Note which terms, and in which form — a criterion carries a term's SLUG, because that is what survives being written into a block and what the query resolves back to an id.

And a visitor's facets inherit "only where it applies" unchanged. WordPress registers `category` and `post_tag` for `post` ALONE, so a site of pages has no taxonomy to filter by at all and its visitor vocabulary is the post type and nothing else. A site whose pages must be filterable registers a taxonomy of its own for them, which is ordinary WordPress and is the site's design, not something an adapter should invent on its behalf.

Listings are the same story, and this is where a frontend stops being generic. A listing block stores its criteria in the index names and operation ids **its own** adapter advertised, so building the request is that CMS's own work. Each package ships the fetcher for its CMS, and a frontend imports the one for the CMS it reads:

### Js

```js
// A WordPress frontend.
import { wpFetchItems } from '@volto-hydra/hydra-adapters-wordpress/public';
const fetchItems = wpFetchItems({ cmsBaseUrl, contextPath, extraCriteria });

// A Plone frontend.
import { ploneFetchItems } from '@volto-hydra/helpers';
const fetchItems = ploneFetchItems({ apiUrl, contextPath, extraCriteria });
```

Both answer the same `fetchItems(block, { start, size })` that `expandListingBlocks` calls, and nothing sits between them. There used to be a generic `publicFetchItems({ reader })` here, programmed against whatever every CMS had in common, and every one of its limits came from that: it threw on facets, dropped every field but the title, ignored the OPERATION in a criterion so "none of" filtered as "any of", and carried a leftover Plone sort name. A frontend is written for a CMS; the fetcher it imports can answer all of those, because there is only one CMS in it.

What a VISITOR asked for goes in as `extraCriteria` — `SearchableText`, `facet.<index>`, `facet.<index>.after|before`, `sort_on` — and the fetcher turns it into its own CMS's parameters.

<block type="callout" variation="note">

`adapterGetContent` and `adapterFetchItems` read through an adapter you already hold and return Plone's REST shape. They are for a build that HAS an adapter — the editor's build, where the admin's view mode shows a draft — not for a visitor's page. A public bundle that carried an adapter would carry the editing bridge and a CMS credential with it.

</block>

The credential is the frontend's own. A published page needs none; showing a draft in the preview needs one for your CMS, because the admin's session is not something WordPress or Drupal would accept.

A Plone frontend needs none of this and can keep fetching Plone directly.

## What editors notice

**Signing in happens in your frontend, not the admin.** The adapter owns the session, so the admin has no login form of its own to offer. If the adapter has no credential it raises an `auth-required` event and your frontend decides what to show — its own login screen, an OAuth popup, whatever you already use.

**Logging out ends the real session.** The admin's logout button reaches the adapter as `auth.logout`. Clearing only the admin's own state would be the dangerous half of a logout: the editor sees an empty toolbar while the credential that reaches the CMS is still live.

**The ways in are your CMS's to list.** A site may offer a password form and nothing else, an SSO provider, or a sign-in that needs no password at all — a demo editor, say. Which of those exist is your CMS's business, so the admin asks the adapter: `auth.loginOptions` returns the options, each with an `id`, a `title` to show, and `passwordFree` saying whether it can be pressed directly. `auth.loginWithOption` presses one. An empty list is a real answer, and the admin renders no extra buttons.

Answer it even where there is nothing to offer. The admin asks every adapter the same question, and one that cannot be asked sends it back to guessing — which is how this started: the question reached a Plone backend through the HTTP passthrough and was simply unroutable anywhere else.

**Say so if you run the sign-in yourself.** An adapter that opens the CMS's own login page — `auth.begin` hands back a URL, `auth.complete` takes the credential straight from the popup, so it never passes through the admin — declares `adapter-sign-in`, and the admin gives your proxy frame the screen while nobody is signed in. Without it the admin keeps its own login screen, which is where a CMS's password form and its `auth.loginOptions` buttons belong.

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

## What a listing can be queried on

The query builder in the sidebar is built entirely from one answer, and the search block's facets come from the same one. `querystring.getIndexes` returns two maps: `indexes`, the fields that can be queried, and `sortable_indexes`, the keys that can be sorted on. They are separate vocabularies on purpose — Plone's queryable index is `Title` while its sort key is `sortable_title` — so neither is derived from the other.

Index names, operation ids and sort keys are all the CMS's own. Nothing translates them: a criterion is stored as `{i, o, v}` in the spelling the adapter advertised, and comes back to the adapter unchanged. Plone's are `plone.app.querystring`'s long ids, because that is what Plone's content holds.

Each index says what may be done with it, and for each operation, what it is called and **which widget collects its value**:

### Js

```js
case 'querystring.getIndexes':
  return {
    indexes: {
      post_type: {
        title: 'Type',              // shown in the index dropdown
        group: 'Metadata',
        enabled: true,
        sortable: false,
        type: 'string',             // what KIND of value it holds, for a column
        column: true,               // offered as a contents column by default
        operations: ['selection.any'],
        operators: {
          'selection.any': {
            title: 'Matches any of',
            widget: 'MultipleSelectionWidget',
          },
        },
        values: { post: { title: 'Post' }, page: { title: 'Page' } },
      },
      modified: {
        title: 'Last modified',
        enabled: true,
        sortable: true,
        type: 'date',
        operations: ['date.after', 'date.before'],
        operators: {
          'date.after': { title: 'After', widget: 'DateWidget' },
          'date.before': { title: 'Before', widget: 'DateWidget' },
        },
      },
    },
    sortable_indexes: {
      modified: { title: 'Last modified' },
      menu_order: { title: 'Position in parent' },
    },
  };
```

`sortable_indexes` is also what the admin's sort menus offer, and `BaseAdapter.assertSortable()` refuses a `sortOn` that is not in it — so an adapter never has to translate someone else's sort key into its own.

Plone needs none of this written by hand: `/@querystring` already answers with exactly these fields, so the adapter forwards them.

## The widgets are the shared half

`widget` names an input the admin can draw. This list is the contract:

<block type="slateTable" table.fixed table.celled>

| widget | the input |
| --- | --- |
| `null` | none — the operation takes no value ("today", "current logged-in user") |
| `StringWidget` | a text field |
| `DateWidget` | one date |
| `DateRangeWidget` | a from and a to |
| `RelativeDateWidget` | a number of days |
| `MultipleSelectionWidget` | a multi-select of the index's `values` |
| `autocomplete` | a lookup against the index's `vocabulary` |
| `ReferenceWidget` | a content picker |
| `RelativePathWidget` | this page / the parent page |

</block>

Everything else is the CMS's own. A new operation needs nothing from the admin — declare it, title it, and name the widget that collects its value. Needing an input that is NOT on this list is the one case that cannot be declared: that is a change to the admin.

### Advertise only what you can serve

Advertise an operation and it will be used. An index that offers "matches none of" when the backend has no exclusion query returns everything that matched instead — a filter that reads as working and quietly does the opposite. WordPress is the worked example: `?author_exclude` exists, so `author` offers an exclusion; `?status=` has no counterpart, so `status` offers "any of" alone.

Three more of the same rule, each of which the contract suite checks:

- **Offer something to choose.** An operation whose widget is a selection draws a picker, so the index has to say what goes in it: `values` when the list is short enough to send, a `vocabulary` to look up when it is not. Neither, and the editor opens the facet to find nothing to tick, unable to tell whether the site has no categories or the adapter forgot to say.
- **Only where it applies.** A WordPress taxonomy is registered for particular post types; `?categories=` on `/wp/v2/pages` is a 400, so the adapter declares a taxonomy index only for the type it reads. A facet that cannot be applied is worse than a missing one.
- **Take the value the widget produces.** A `DateWidget` yields `2026-01-01`. WordPress's `?after=` wants ISO 8601 and refuses anything else, so the adapter converts it. The sidebar writes what its widget writes; making it fit is the adapter's job.

For the same reason, state what the operation really does rather than borrowing a name that promises more. Plone's `string.absolutePath` matches a whole subtree; WordPress's `?parent=` is the pages directly under one page, so the WordPress adapter calls its own operation `parent.is` and titles it "Directly under". The editor then reads what they will get.

### What a visitor asks for

A listing's stored criteria are only half of a search block. The other half has no stored form at all: a visitor typing in the search box or ticking two facets has to become a query at request time, and no frontend can know which operation means "contains" on this CMS. So `querystringSearch` also takes the input NAMED, and the adapter turns it into its own operations:

### Js

```js
dispatch('querystringSearch', {
  query: [],                                  // the block's stored criteria
  text: 'rain',                               // the search box
  filters: [{ i: 'categories', values: ['weather'] }],
  ranges: [{ i: 'modified', from: '2026-01-01', to: '2026-06-30' }],
  under: { path: '/news', depth: 1 },          // "what is in this page"
});
```

Four basic kinds, which is what a search block collects. Each adapter maps them onto its own operations — and refuses what it cannot do: asked for more than one level under a page, the WordPress adapter says so rather than returning the children and calling it a subtree.

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

Register a target that boots your CMS, seeds it and exposes your adapter, then run the suite against it. A capability you do not declare must be *rejected*, and the suite checks that too.

### Bash

```bash
ADAPTER_TARGET=my-cms npx vitest run --config vitest.adapters.config.mjs
```

The suite covers content CRUD, listings, search, navigation, breadcrumbs, schemas, vocabularies, references, assets, workflow, moves, auth and expansion. Getting it green is what "supports this CMS" means here.

## A menu is a view, not a flag on content

A CMS organises the same content in more than one way. The page tree is one; a curated menu is another; a taxonomy is another again. Each is a **view**, and a view is a place you can browse, not a property stored on a page.

So a view's nodes come back **as content**, at paths the adapter owns, and no new intent is needed for them. `tree.list` browses a view, `content.create` adds to one, `content.move` relocates within one, `content.delete` removes one. The reserved prefix is `@@menu`:

- `/@@menu/primary` is the view
- `/@@menu/primary/17` is a node in it
- `/@@menu/primary/@@excluded` is the bucket holding what has been taken out
- `/@@menu/primary/@@excluded/17` is a node in that bucket

A prefix rather than a suffix costs one token content could never contain, where a reserved suffix would cost a word authors cannot use. These paths are an addressing convenience for browsing and must never escape into stored data: anything written down, rendered, or handed outside resolves to the referenced content first.

**What identifies a node differs per CMS, deliberately.** WordPress and Drupal address a PLACEMENT, which has an id of its own because a page can appear in a menu twice and a heading has no slug at all. In Plone the menu view IS the content tree, so a node's path mirrors the content path. A node is a `placement` when it references content, a `link` when it does not — a link is the absence of a reference, not a type of its own — and the bucket itself is a `bucket`, offered at the view's root so what was taken out is discoverable in the menu rather than only through the picker.

**Removing a page from a menu is a MOVE into `@@excluded`, never a delete.** That is what lets `content.delete` mean "destroy this" in every view and `content.move` mean "relocate it" in every view — no verb whose blast radius depends on the path it was handed. It matters less for the button an editor sees than for every other caller: a retry, a bulk action, or a bug that loses view context would otherwise delete a page where it meant to tidy a menu.

The bucket holds DISABLED PLACEMENTS, not everything absent from the menu. Each CMS has a native one — an unpublished `nav_menu_item`, a Drupal link with `enabled` false, a Plone page with `exclude_from_nav` — so the set is bounded by the menu's own definition. "Everything not in the menu" would be nearly the whole site in WordPress, where a menu is a curated subset, and a handful in Plone, where it is the tree minus exceptions; the view would stop meaning the same thing per CMS. Adding something that was never in the menu is therefore not a move from the bucket: it comes from the picker, as a new placement.

### navigation.get is the main hierarchy, not a menu

`navigation.get` answers the hierarchy a site's navigation is built from, and which one that is depends on the CMS. WordPress pages form a tree, and that tree is what `wp_list_pages`, the page-list block and a theme with no menu assigned all render — so that is what it answers. Drupal's reads menu links instead, because its nodes are flat and a menu is its only hierarchy.

A curated menu is the separate view above. Do not let a site reconfigure which one `navigation.get` returns: it would then mean something different per deployment, and a caller could not know what it was asking for.

## References, and what a delete would break

Two different questions, and only one of them every CMS can answer.

`reference.resolve` turns a stored reference into something renderable, and the contract is an OUTCOME: a reference stored today still resolves after the target is renamed or moved. It does not say how. Plone stores `resolveuid`, which is an encoding its own REST layer produces and consumes; WordPress stores the post id, stable across renames where the permalink is not, and resolves it on every render; Drupal has `/node/<id>`, which is rename-proof already. Do not copy Plone's encoding into your adapter — copy the promise.

`reference.dependents` asks the other way round: what links TO this document. That needs an index of incoming links, and it is where CMSes genuinely differ rather than differing in spelling. Plone has one, so it answers; WordPress indexes nothing of the kind, so it does not claim `link-integrity` and the intent refuses. The admin then withholds its delete warning there, which is better than a confirmation dialog that quietly means nothing.

Containment — "and it holds twelve things" — is not part of either: `tree.list` answers that already.

## Several operations at once

`batch` takes a list of operations and applies them as one intention:

<block type="slateTable" table.fixed table.celled>

| You send | What happens |
| --- | --- |
| `batch` with `operations: [{intent, args}, …]` | applied in the order given; the answer is `results`, one per operation, in that order |
| a failure part-way | the error carries `failedIndex` and `applied`, so a caller can resume rather than start again |
| `atomic: true` | honoured by a CMS that can promise it, refused with `NOT_IMPLEMENTED` by one that cannot |

</block>

You do not implement this. `BaseAdapter` applies the operations one at a time, so your adapter answers `batch` the day you write it. Override it only if your CMS can genuinely group writes — WordPress core takes 25 requests per `/batch/v1` call, Plone can take a whole subtree through `@import` — and then declare `batch-native`, which tells callers that grouping is worth doing here. Drupal's JSON:API has neither a batch route nor the atomic-operations extension, so it keeps the floor and never claims the capability.

This is the same layering as expansion, with one deliberate difference: expansion is reads, so it runs concurrently and omits what a CMS cannot serve. A batch is writes. Order carries meaning — a parent before its child, an ordering after the documents it orders — so operations are never reordered, a failure stops the run rather than being skipped, and atomicity is asked for explicitly because it cannot be emulated from outside the CMS.

## Reference

### Intents

<block type="slateTable" table.fixed table.celled>

| Group | Intents |
| --- | --- |
| Content | `content.get`, `content.create`, `content.update`, `content.delete`, `content.order`, `content.sort`, `content.move`, `content.copy`, `content.lock`, `content.unlock` |
| Types | `types.list`, `types.getSchema` |
| Reading | `search`, `querystringSearch`, `querystring.getIndexes`, `tree.list`, `navigation.get`, `breadcrumbs.get`, `reference.resolve`, `reference.dependents`, `vocabulary.get` |
| Assets | `asset.upload`, `asset.imageUrl` |
| Session | `auth.whoami`, `auth.logout`, `auth.loginOptions`, `auth.loginWithOption` |
| Workflow | `state.get`, `state.getForms`, `state.transition` |
| The site | `site.get` |
| Translations | `translations.get`, `translations.create`, `translations.link`, `translations.unlink`, `translations.locate` |
| Several at once | `batch` |
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
| `comments` | Reader comments and moderation |
| `multilingual` | Manage Translations, and the translate/link controls |
| `http-passthrough` | Forwarding Plone-dialect requests unchanged |
| `expand-native` | The admin asks for its expander bundle inside the content response |
| `batch-native` | Grouping writes into one request saves round trips, so callers may batch freely |
| `link-integrity` | The CMS can say what links TO a document, so a delete can be warned about |
| `locking` | The CMS can say who is editing a document now, so a second editor is warned |

</block>
