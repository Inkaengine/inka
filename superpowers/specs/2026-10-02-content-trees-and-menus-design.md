# Content trees and menus — options

Status: **partly decided.** The public-reading constraint below is settled and
tested; the view model above is still open. Written down mid-discussion so the options survive
the conversation. Nothing here is implemented.

## The problem

WordPress and Drupal both have more than one menu, and a menu is not the content
hierarchy — it is a separate, curated ordering that may leave content out and may
contain entries that are not content at all. Plone is the outlier: its navigation
is derived from the content tree plus `exclude_from_nav`.

Today the admin has exactly one notion of "the tree": content hierarchy. The
contents view and the content picker both browse that and nothing else.

What is wrong with each adapter today:

- **WordPress** derives navigation from the page tree
  (`GET /wp/v2/pages?parent=0`, sorted by `menu_order`) and never reads
  `/wp/v2/menus` or `/wp/v2/menu-items`. On a site with a curated primary menu,
  Inka's navigation and the site's own navigation disagree. There is also
  nowhere to record "hide from nav", because core WordPress has no such field on
  a page — which is why `navigation.setExcluded`/`setTitle` are unimplemented
  there.
- **Drupal** writes `menu_link_content`, so exclusion and title live on the LINK.
  `linkIdForPath` takes the FIRST link for a path, so a node in two menus is
  silently one of them.
- **Plone** has no navigation title at all.

## The model under discussion

Content can be presented through several **views**, each a different organisation
of the same material:

- **hierarchy** — total, unique, nodes are documents. What we have now.
- **menu** — one per site menu. Partial over content, and may contain entries
  with no content behind them.
- **collection** — a filter rather than a tree: all posts, by type, by taxonomy,
  by language. WordPress posts have no parent at all, so this shape is flat.

Two ideas make it tractable:

1. **A virtual folder for everything not in the menu**, so each view is TOTAL.
   Menu membership then stops being a verb: adding and removing are moves, which
   the contents view can already do. No `setExcluded`, no `setTitle` — a menu
   entry's title is just that node's title in that view.

2. **Entries that are not content are presented AS content.** This is Plone's
   own answer: a `Link` is a real content type with a URL, so a menu containing
   an external link is just a Link document in the folder — which is why Plone
   never needed menu-entry objects. An adapter can do the same without the thing
   being stored as a post: a WordPress `nav_menu_item` of type `custom` presents
   as a document of type `link`, keyed by the menu item's id; creating one in a
   menu view creates a menu item, deleting one removes it. `types.list` already
   varies by path, so a menu view can offer `link` where the content tree does
   not.

Together these mean the contents view and the picker need **no new verbs**.

## Open question: one tree, or several views?

**Virtual roots of one tree** — menus appear as folders you can navigate into.

**Separate views with a selector** — the browser takes a view parameter.

Leaning towards separate views, for three reasons:

- *Destructive ambiguity.* "Remove" means delete in the content tree and unlink
  in a menu. One tree makes the same gesture mean different things depending on
  where you navigated from.
- *The picker.* You pick a document. One merged tree shows the same page several
  times, and you cannot tell whether you picked the page or an entry pointing at
  it.
- *Breadcrumbs.* In a merged tree "where am I" depends on the route taken.

But keep what made roots attractive: the view must be **addressable**, so a
refresh or a shared link lands in the same place. Concretely that is
`tree.list({tree, parent})` — the view is a parameter of the browser's state,
not a folder inside the content tree. Note `parent` then has to be a node in the
named view, NOT a content path: the Plone adapter currently implements
`tree.list` as a context-scoped `@search`, which bakes in the assumption that
the URL you are on IS the tree you are browsing.

## Consequences worth having

- A view descriptor has to declare its **cardinality and verbs**: is it ordered,
  is it total, may it hold non-content nodes, does "remove" unlink or delete.
- If menu entries are content with a reference to their target, then
  `reference.dependents` reports *"this page is in the main menu"* when someone
  tries to delete it. Menu membership joins the delete warning for free.
- **The surfaces differ.** The contents view is a manager and should offer every
  view; the picker is a chooser and should only offer views whose nodes are
  documents, or resolve an entry to its target before returning.
- **Plone collapses cleanly.** Its main menu IS the content hierarchy, so it
  legitimately has one view. The model must allow that rather than inventing a
  second view that mirrors the first.

## Decisions still needed

1. Views or virtual roots (leaning: views).
2. When a menu entry points at an existing page, is the node the page (per-view
   position and title as view-scoped metadata, no duplicates) or the entry (can
   represent the same page twice in one menu, at the cost of an ambiguous
   picker)? Leaning: the page.
3. Whether WordPress navigation moves off the page tree onto real WP menus —
   with a fallback, since the menu endpoints need `edit_theme_options` and a
   fresh site has no menus at all.


## The public-reading constraint (settled 2026-10-02)

The frontend renders the published site by reading the CMS **directly** — no
adapter, no session. That turns out to constrain this whole design, because a
curated menu is not publicly readable on either CMS that has one:

| | public navigation source | needs an addition? |
| --- | --- | --- |
| Plone | `@navigation`, derived from content | no |
| WordPress | page tree (`/wp/v2/pages?parent=0`) | no today — **yes** if we move to real menus |
| Drupal | `menu_link_content` is permissioned | **yes** — `jsonapi_menu_items` |

So WordPress passes today *because* it derives navigation from content. Moving
it onto real menus — the thing that makes exclusion and nav-title possible —
costs public readability unless something is installed. **Curated membership
and public readability are in tension on both CMSes.** Plone escapes it only
because its menu IS the content tree.

Bigger than menus on Drupal: `allMenuLinks()` has SEVEN call sites —
`tree.list`, ordering and path lookup as well as navigation. The whole content
hierarchy comes from menu links, so "menus are not public" is really "the
hierarchy is not public".

### Decision: declare the dependency

Requiring a plugin is normal for a headless site and reasonable to expect from a
PaaS, so the adapters assume one rather than engineering around it:

- **WordPress** — WPGraphQL for public reads. It also brings `nodeByUri`, a real
  "what is at this path?" primitive, replacing the segment-by-segment slug walk
  `resolvePath` does today.
- **Drupal** — `jsonapi_menu_items` for public menu reads.

### The split is READS vs WRITES, not public vs admin

Editing is read-heavy, and the measured cost is in reads: the same editing work
took 413 requests over the bridge against 220 direct, much of it N+1
(`resolvePath` walking, `ancestryOf` per document, `pathOfPost` per row). So
GraphQL is worth it for the admin's reads too, not only the frontend's — and if
both use the same queries, what a visitor sees and what an editor sees cannot
drift apart. That drift is exactly the bug we hit with blocks in an HTML
comment: the authenticated read worked and the public one returned nothing.

Writes stay on the core APIs, because the public/read-only surfaces cannot do
them: media upload (no multipart over GraphQL) and menu mutations.

### Tested

`tests-adapters/contract/public-read.spec.ts` asserts, with NO credentials: a
published document's blocks are readable, the navigation is readable, and an
unpublished document is NOT. All three targets pass.

What it does NOT assert, and should: that the public source and the adapter's
source AGREE. The adapter may legitimately read a private API while the visitor
reads a public one; nothing yet catches them diverging.

### Unverified assumptions

Each would change the design if wrong, and none has been measured:

- that core `/wp/v2/menus` and `/wp/v2/menu-items` require `edit_theme_options`
- that WPGraphQL's `menuItems` is anonymous-readable for a location-assigned menu
- that WPGraphQL runs under PHP-WASM in Playground
- the response shape of `jsonapi_menu_items`, which the Drupal mock now models
  **from documentation, not from running it** — a fiction of a contrib module on
  top of a fiction of Drupal

The last is the third time the Drupal mock has been the limiting factor (after
multilingual and anonymous access). A real `drupal:11` in CI would retire that
whole class of doubt.


## The model (2026-10-03)

**Views.** The adapter advertises the ways its CMS organises content. The
contents view and the picker both browse a named view; the view is a parameter
of the browser, not a folder inside the content tree.

**There is no single hierarchy.** Counting them:

- **Drupal** — ZERO intrinsic content hierarchies (nodes are flat); five menus
  by default, each a tree; one tree per hierarchical vocabulary.
- **WordPress** — one page tree; one tree per nav menu; categories are a
  hierarchical taxonomy (tags are flat); posts have no tree at all.
- **Plone** — one content tree, and everything lives in it.

So: **one MAIN hierarchy, plus whatever else the adapter defines.** The adapter
declares which view is the main one rather than the admin assuming a content
tree exists — which matters because Drupal has none to assume. Our Drupal
adapter already picks one implicitly: `allMenuLinks()` backs `tree.list`,
ordering and path lookup, so a menu is already wearing that hat.

Shapes:

| shape | example | total? | ordered? |
| --- | --- | --- | --- |
| hierarchy | Plone's tree, WP pages, a menu, a Drupal Book | yes within the view | manual |
| taxonomy | WP categories, Drupal vocabularies | no — content may be in several | by term |
| collection | WP posts by date, "recently modified" | yes | by field |

Taxonomy is a hierarchy too, and it is where content is routinely in several
places at once — a page sits in one spot in the page tree but in three
categories, and that is normal rather than an edge case. Plone can offer extra
views cheaply, since they are all catalog queries.

The CMSes differ on whether content has intrinsic hierarchy, which is the axis
everything else follows from:

- **Plone** — everything hierarchical; a news listing is a QUERY over a folder.
- **WordPress** — pages hierarchical, posts flat, menus separate.
- **Drupal** — nodes FLAT; hierarchy comes entirely from menu links.

Worth stating plainly: **the contract is Plone-shaped.** It addresses by path and
assumes a tree. Drupal satisfies that only because menu links supply the paths,
and WordPress posts do not satisfy it at all — which is why they are excluded
today rather than handled. Supporting the collection shape is the same work as
supporting posts.

**A node is a PLACEMENT that may reference content.** Node identity is the
placement, not the content — which is what makes "the same page twice" a
non-question: two placements referencing one page are simply two nodes, and
nothing has to arbitrate which is canonical. An earlier draft had two node
KINDS (content vs link) and an exception for duplicates; that was an artefact of
keying nodes by content.

One shape, with an optional reference:

- has a reference -> the browser shows and opens that page
- no reference, has a URL -> an external or custom link
- no reference, no URL -> a heading or separator

So "link" is not a type, it is the ABSENCE of a reference. Plone modelling it as
a real `Link` content type is consistent rather than contradictory: in Plone
everything in a tree is content, so its Link is a node referencing itself whose
URL field is the payload.

The hierarchy view keeps uniqueness for free rather than by rule — a page has
one parent, so it appears once. Duplicates arise only in menu and taxonomy
views, where nodes were placements all along.

Per-placement properties (position, parent, nav-title override) live on the
node, which is where WordPress and Drupal already store them — two placements of
one page can carry two different labels, which a single content node could not.

Two places this still matters:

- **the picker** returns content, so it resolves through the reference, and a
  node without one is not selectable
- **the agreement test** compares sorted SETS of paths, so it would tolerate a
  page appearing twice on one side and once on the other. A real hole now
  rather than a hypothetical, same reason ordering is still missing.

**Content-backed or not** is recorded by the CMS, not inferred: Drupal holds
`entity:node/123` vs a plain `internal:/about`; WordPress holds
`type: post_type` + `object_id` vs `type: custom`. The rule is that the CMS
holds a REFERENCE — not that a URL string currently resolves, because
`internal:/about` breaks on rename while `entity:node/123` survives. That is the
same promise `reference.resolve` already makes. Both CMSes expose the choice in
their authoring UI — pick from a list, or type a URL — so the picker must
preserve it rather than flattening everything to a URL.

A reference whose target was deleted should show as BROKEN, not vanish: a
disappearing menu item is harder to diagnose than a visibly broken one.

**Moving means different things per view, and some moves are refused.**

| view | move within | remove | add |
| --- | --- | --- | --- |
| hierarchy | moves the CONTENT — path and URL change, links must follow | delete | create |
| menu | reparents/reorders the LINK — no URL change | delete the link | create a link |
| collection | usually REFUSED — order comes from a field; "moving" would mean editing the date | delete | create |

So a view descriptor declares: what its nodes are, whether it is ordered, whether
it is total, whether non-content entries are allowed, and what remove means. The
contents view offers views that can hold content; the picker offers only views
whose nodes resolve to content, or resolves a link to its target before
returning.

**Which menus to offer** is CMS knowledge and belongs in the adapter. Drupal
ships system menus (Administration, Tools, User account) whose links are
module-provided plugin definitions, not `menu_link_content` entities, and which
point at routes rather than content — an editor must never be shown those. But
membership cannot be the test, because an EMPTY footer menu should still be
offerable; existence and editability is the test.

### Prerequisites, in build order

1. **`menu_name`.** It appears ZERO times in the Drupal adapter and mock, and the
   WordPress adapter's only mention of `nav_menu` excludes it as a content type.
   We currently model exactly one implicit menu and cannot say which menu a link
   belongs to. Teach the adapters this first, still advertising a single view, so
   nothing user-facing changes.
2. A view list on the adapter, with the descriptor above.
3. `tree.list({tree, parent})`, where `parent` is a node in the named view — not
   a content path. Plone's `tree.list` is a context-scoped `@search` today, which
   bakes in "the URL you are on IS the tree you are browsing".
4. The selector in the contents view and picker.

### Smaller things found on the way

- WordPress has a purpose-built picker endpoint, `/wp/v2/search`, returning id,
  title, url, type and subtype across post types. Our adapter does not use it
  (`search` goes to `/wp/v2/{postType}?search=`, single-type, full payloads).
  Drupal has no equivalent, so its CONTAINS filter is already right.


## Addressing, advertising, and the selector (2026-10-03)

### The adapter returns a view's nodes AS CONTENT

A placement is returned as a content object at a path the adapter owns. Then
**no contract change is needed**: `content.get` reads a node, `content.move`
reparents it (the adapter turns that into menu reparenting), `content.create`
with type `link` adds an entry, `content.delete` unlinks. The contents view,
breadcrumbs and ordering need no new concepts — it is Plone's `Link` trick
generalised.

URLs follow from that. The main hierarchy keeps today's `/some/folder/contents`,
since node path IS content path there. Other views live under a reserved
namespace, `/@@menu/main/...`, because a reserved PREFIX costs one token content
could never contain, where a reserved SUFFIX costs a word authors cannot use —
and `nonContentRoutes` already carries the scar: a page at
`/docs/examples/search` resolved to its parent because `/search` was reserved,
and "the admin edits the wrong object".

Nodes in non-hierarchy views are addressed by PLACEMENT ID. A heading has no
slug and a page can appear twice; slugs that silently resolve to the wrong node
after a retitle are worse than ugly ids.

### Synthetic paths must never escape

They are an addressing convenience for browsing. They resolve to real content
wherever a path is written down, rendered, or handed outside:

- **the preview iframe** — `getUrlWithAdminParams` builds the frontend URL from
  `window.location.pathname`, stripping only `/edit`. It is not view-aware. A
  menu placement must preview its REFERENCED page.
- **the picker's return value** — must come structurally from the node's
  reference, never from the browse location. Reusing the "current location"
  variable as the return value is the most likely bug in this whole design: it
  would look right in the editor, because the adapter resolves the address
  happily, and break only on the public site. Worth a test that picks from a
  menu view and asserts the stored value is the content path.
- **search results and stored references** generally.

Browse address and picked value are different KINDS of thing — ephemeral UI
state versus durable data — which is why they can differ safely. The cost is
that "where does this value live?" becomes a reverse lookup that may answer with
SEVERAL placements (the same question `reference.dependents` answers), and
"open where I left off" is per-user UI state, not part of the value.

A placement with a URL but no reference can return that URL. One with neither —
a heading — is not selectable.

### Advertising: `views` on `site.get`

It already carries `languages` and `features.translations: 'grouped'`, it is
fetched once per session, and it needs no new intent.

```
views: [
  { id: 'content', title: 'Pages', shape: 'hierarchy', main: true,
    prefix: '', ordered: true, holdsContent: true, remove: 'delete' },
  { id: 'menu:main', title: 'Main menu', shape: 'hierarchy',
    prefix: '@@menu/main', ordered: true, holdsContent: true,
    allowsLinks: true, remove: 'unlink' },
  { id: 'tax:category', title: 'Categories', shape: 'taxonomy',
    prefix: '@@tax/category', ordered: false, holdsContent: true,
    remove: 'unlink' },
]
```

The fields that change behaviour: `main` (which opens by default — Drupal has no
content tree, so it must be able to name a menu), `prefix` (empty for the main
hierarchy, so today's URLs are untouched), `remove` (delete vs unlink — the
difference between losing a page and tidying a menu), `allowsLinks` (whether
"add a link" is offered).

Caveat: `site.get` is session-cached, so a menu created in the CMS will not
appear until reload.

### The selector sits at the ROOT OF THE BREADCRUMB

`[Main menu v] / Products / Widgets`. Not decoration: it says the trail is
RELATIVE TO THE VIEW, which is literally true, and keeps "where am I" in one
place instead of splitting it between a dropdown and a path. With one view it
renders as today's Home crumb with no dropdown, so Plone sees no change.

The picker gets the identical control, filtered to views whose nodes resolve to
content.

Rejected: a left rail of "places" (spends real estate on something most sites
have one of) and tabs (imply peers, when the main hierarchy is privileged).

This lands on the crumb an upstream commit just changed — the mock no longer
injects a synthetic `Home`, because Plone's `items` are ancestors and the root
comes from `root`. Same crumb; look at them together.
