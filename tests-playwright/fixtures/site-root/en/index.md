---
"@type": Folder
UID: lrf-en-0000000000000000001
id: en
title: English
description: The English side of the site
review_state: published
is_folderish: true
# Out of the navigation so the single-language fixture site — every other spec
# in this suite — still lists the children it always did. The language switcher
# finds these through @translations and @site, never through the menu.
exclude_from_nav: true
language: en
effective: 2025-01-01T00:00:00
order:
  - about
  - services
  - team
blobs:
  # Something that is not a page and not a folder, for translating. Out of the
  # navigation: a logo is not a menu entry, and the language-scoping tests read
  # that menu.
  - file: logo.jpg
    uid: ml-en-logo-00000000000000001
    id: logo.jpg
    title: Logo
    exclude_from_nav: true
---
