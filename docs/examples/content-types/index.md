---
"@type": Document
UID: e8178744e30a418b9a5768997bb29a19
allow_discussion: false
contributors: []
creators:
  - admin
description: This section has a sample of content types available in this site.
effective: 2023-09-22T16:09:00
exclude_from_nav: false
expires: null
id: content-types
is_folderish: true
language: "##DEFAULT##"
layout: document_view
preview_caption: null
preview_image: null
review_state: published
rights: ""
subjects: []
title: Content Types
order:
  - copy_of_event
  - copy_of_news-item
  - copy_of_page
  - event
  - external-link
  - internal-link
  - link
  - news-item
  - page
  - typography
blobs:
  - file: danielle-barnes-kGNaS3lYCso-unsplash.jpg
    uid: 6cca02c5580d4f7c865af74835ceab9d
    id: example-image.jpg
    title: Image
    exclude_from_nav: false
    effective: 2024-03-08T12:40:00
  - file: black-starry-night.jpg
    uid: 970ec24c76784c66a06d8c8d8b6522b2
    id: image-dark
    title: Image
    description: >-
      
      The Image content type can be used to upload an image in various formats
      (JPG, GIF, PNG, SVG). The uploaded image should always have a high
      resolution so that it can be used flexibly, for example as a banner image.
      Plone automatically delivers the images in the best scaling, so there is
      no need to scale images down manually.
    rights: "Credits: ipsum dolor sit amet."
    exclude_from_nav: false
  - file: image-light.jpg
    uid: eec82559bf3242a6be4d43bc2096f399
    id: image-light.jpg
    title: Image - Light
    description: >-
      
      The Image content type can be used to upload an image in various formats
      (JPG, GIF, PNG, SVG). The uploaded image should always have a high
      resolution so that it can be used flexibly, for example as a banner image.
      Plone automatically delivers the images in the best scaling, so there is
      no need to scale images down manually.
    exclude_from_nav: false
blocks-matched: |
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
  <block type="title" _="${h1}" />
---

# Content Types

Every page is a content type — a Document, News Item, Event, Image or Link. The type decides which metadata a page carries and, if you choose, the layout it renders with. The samples below are live instances you can open and copy.

<block type="listing" headlineTag="h2" variation="default" />

## Page metadata

A page's frontmatter is its metadata — the fields stored alongside the blocks, and what the rest of the site reads instead of the page body. You edit them in the sidebar's metadata panel; in the markdown source they are the frontmatter at the top of each file, exactly like this page's own.

- **`title`** and **`description`** — shown in navigation, in listing and teaser cards, and as the page's title and summary for search and social sharing.
- **`review_state`** — `published`, `private`, and so on; it decides who can see the page.
- **`effective`** — the publication date a listing sorts and filters on.
- **`preview_image`** — the image a teaser or listing card shows for this page.
- **`exclude_from_nav`** — hide the page from navigation while keeping it reachable by its URL.
- **`subjects`** — tags, which faceted search and listings filter on.
- **`layout`** — the default view the page renders with.
- **`order`** — on a folder, the order its children appear in navigation and in a relative-path listing.

## Forcing a layout per type

A **forced layout** applies a shared template across a page's whole blocks field — see [Templates & Layouts](../../frontend-guide/templates.md) for the mechanism. Forcing is your frontend's call: you pass `allowedLayouts`, so you decide **which** layout and **when**, on whatever logic you want. Keying that on the content type is the common case — force every News Item onto a news layout, every Event onto an event layout — so a whole class of pages stays consistent without an editor choosing per page. The same hook forces on anything else just as well: a section of the site, a flag in the page's metadata, or the current user.
