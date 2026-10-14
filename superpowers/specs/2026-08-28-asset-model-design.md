# Assets across CMSes — design

Companion to `2026-08-26-universal-cms-adapters-design.md`. That spec covers
documents; this one covers the things documents point at: images, videos, PDFs
and files.

## The problem

The editor uploads an image and stores a reference to it in a block. Three
CMSes model that reference in three different ways, and the differences are not
cosmetic:

| | what an asset is | addressing | placement | derivatives |
|---|---|---|---|---|
| Plone | content object in the tree | path + UID | real parent folder; **can live inside a page** | scales (`@@images/image/preview`) |
| WordPress | attachment — a row in `wp_posts` with `post_type='attachment'` | attachment id | `post_parent` exists, library is flat | sizes (thumbnail/medium/large) |
| Drupal | media entity wrapping a file entity | uuid | flat file system | image styles |

Two of those differences are load-bearing.

**Containment.** In Plone an image can be a child of the page, so moving the
page moves the image and its URL. Nowhere else works that way. It also creates
cross-page dependencies: page B referencing an image stored inside page A
breaks when page A moves or is deleted.

**Two URLs, not one.** WordPress and Drupal both distinguish the asset's
*record* from its *bytes*, and only the record is addressable in user space:

- WordPress: an attachment page (`post_name` + `post_parent`) versus
  `wp-content/uploads/YYYY/MM/file.pdf`. The page URL follows the slug; the file
  URL never does.
- Drupal: a media entity (canonical path, optional alias) versus
  `/sites/default/files/…`. Same split.
- Plone collapses them — the object path IS the download path, which is exactly
  why its URLs move.

## The model

**The asset is the record.** The thing a user creates, browses, renames and
relocates: a Plone Image object, a WordPress attachment, a Drupal media entity.
The download URL is a *property* of that record, never its identity.

This is what makes videos and PDFs ordinary rather than special cases. They are
the same record with a different kind — a Drupal media bundle
(image/document/video/remote_video), a WordPress `post_mime_type`, a Plone
Image-vs-File type.

## Reference format

A reference is **always an object**. Never a bare string.

```json
{
  "@id": "/news/hero.png",
  "UID": "a7f3c1…",
  "@type": "Image",
  "title": "Hero",
  "image_field": "image",
  "image_scales": { "image": [{ "download": "…", "width": 1200, "height": 900 }] }
}
```

`@id` and `UID` are both required because they degrade in opposite directions:

- **`@id` — location.** What the client displays, links and reasons about.
  Portable: still meaningful if content is imported into a different CMS, where
  the UID would be meaningless.
- **`UID` — identity.** What the adapter writes with. Durable within a CMS:
  survives moves and renames, and removes any need for a path→id lookup on save.

**Resolution order on write:** `UID` first; fall back to `@id` if it does not
resolve; fail loudly if neither does. Never store a dangling reference.

A bare string arriving from the client is a bug, not an input — a widget has
dropped the identity — and the adapter says so rather than papering over it
with a lookup.

## Layering: path-based contract, identity-based storage

`resolveuid` is invisible at the API level. It is Plone's internal adaptation
between slug and uid, and the contract Volto actually relies on is narrower:
**the `@id` I was given will not change while I am editing**, so it can be
round-tripped unchanged. Plone honours that by translating on read and on
write.

| layer | form | owner |
|---|---|---|
| API / bridge contract | path-based — `@id` plus enrichment | the contract |
| storage | identity-based — uid, attachment id, media uuid | the adapter, internally |
| translation | path ↔ id, on read and write | the adapter, invisibly |

The client never handles identities in order to make a reference. Requiring it
to would be a change to Volto for no benefit.

## Enrichment: read-only, and only where it is needed

Enrichment resolves a reference into the object above. It happens **on read**.

**View mode needs none.** The stored reference already carries a usable URL, so
a frontend can fetch its CMS natively and render. That holds because of a
property worth stating explicitly:

> The CMS whose URLs are volatile is the one that regenerates them.

Plone's URLs move — and Plone re-enriches on every read. WordPress and Drupal
do not re-enrich, and do not need to: their file URLs are flat and stable.

This is why a Drupal module or WordPress plugin serving the canonical shape is
an optimisation, not a prerequisite. The enrichment travels in the content.

**Edit mode does enrich**, so the editor can show where an asset lives and let
the user change it. That is the only reason enrichment is needed at all.

The reference walk should be **schema-driven**: the block schema says which
fields are references and what kind (`widget: 'image'` → media reference,
enrich with scales; `widget: 'url'` → content reference). Scanning for
`resolveuid/` only finds Plone-shaped markers and misses translated ones. This
requires passing block schemas into `AdapterContext`, which today carries only
`cmsBaseUrl` and `emit`.

Precedent: `hydra.js`'s `addNodeIdsToAllSlateFields` already discovers slate
fields via `pathMap._schemas` rather than guessing at structure.

## Staleness

A stored URL can go stale in four ways. The rule in each case is the same: the
identity is authoritative, and a failed URL is a cue to re-resolve.

1. **Move** — Plone only. Corrected on read, because Plone re-enriches.
2. **Domain change / migration** — store relative URLs where the CMS allows.
3. **Replacement** — a replace-media flow keeps the id and changes the file.
4. **Drupal image styles** — style URLs can carry an `itok` token derived from
   the site hash salt, so they break on salt rotation or style reconfiguration.
   Store the canonical file URL; let styles be derived.

## Drupal requires Media

*Implemented — `97c16cfb`.*

`asset.upload` previously created a bare file entity by posting to a node's
field. A file entity has a uuid and a URI and nothing else: no name, no
published state, no bundle, no listing. There was no record to browse, rename
or relocate.

Upload is now two steps — post the binary to the media bundle's file field,
then create the media entity that wraps it. The media uuid is the identity; the
file URL is a property.

Media has been in core since 8.4 and the standard profile enables it, so
requiring it is reasonable. A site without it is told at init. An auth failure
is deliberately not treated as a missing module: 401 and 403 fall through to
the normal auth path, because telling an integrator to install Media on a site
that has it is worse than saying nothing.

## Permissions

"Private attachment" means three different things, and only one of them is
enforced on the bytes:

| | is the binary access-controlled? |
|---|---|
| Plone | **yes, natively** — blobs are served through the application, so a private image 403s, and so do its scales |
| Drupal | **only if the field uses `private://`** — `public://` files are served off disk with no check. A per-field storage setting, not a per-upload choice |
| WordPress | **no** — `post_status` governs the record, REST and the attachment page, but `wp-content/uploads/` is served by the webserver, which never consults WordPress |

So asset privacy cannot be promised by the canonical model. It is a capability,
and the admin must not offer a "make this private" affordance where it is not
enforced — a lock icon that means nothing on WordPress is worse than no lock
icon.

## Open items

- **Native reference mirror.** Blocks are stored as one opaque blob
  (`field_hydra_blocks` on Drupal, a block comment on WordPress), so those
  CMSes cannot see references inside them: no delete warnings, no usage counts,
  no dependency tracking. Plone can, because `plone.app.linkintegrity` parses
  blocks. Closing the gap means the adapter also mirroring extracted references
  into a native field — derived data, rebuilt on every save, never read to
  render.
- **Block schemas in `AdapterContext`**, to make the reference walk
  schema-driven.
- **The admin does not call `asset.upload`.** The inline image widget dispatches
  `createContent(uploadUrl, { '@type': 'Image', … })`, which the intent router
  maps to `content.create`. So `asset.upload` — implemented by all three
  adapters and covered by the contract suite — is never exercised by the editor,
  and `'@type': 'Image'` is a Plone type name. Uploads should route to
  `asset.upload`.
- **Enrichment lives in two places.** Summaries and catalog brains carry
  `image_field`/`image_scales` *inside* the value, which is what the frontend's
  `getImageUrl` branches on; the image block carries them as *sibling keys on
  the block*. Both are live. Pick one, or state explicitly which applies where.
- **Contract gaps**: uploading the same filename twice (two distinct ids,
  neither clobbering the other); fetching an asset URL anonymously to assert
  what the access-control capability claims. `asset.spec.ts` currently fetches
  as an authenticated session, which cannot distinguish public from protected.
