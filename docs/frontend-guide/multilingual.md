---
"@type": Document
UID: docs-frontend-guide-multilingual-001
allow_discussion: false
contributors: []
creators:
  - admin
description: A multilingual site needs very little from a frontend. Render each
  language's tree as it comes, offer the page in the site's other languages, and
  the editor's translation tools work through the frontend you already have.
effective: 2025-01-01T00:00:00
exclude_from_nav: false
expires: null
id: multilingual
is_folderish: false
language: "##DEFAULT##"
layout: document_view
preview_caption: null
preview_image: null
review_state: published
rights: ""
subjects:
  - editing
title: Multilingual sites
blocks-matched: |
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
  <block type="title" _="${h1}" />
  <block type="codeExample">
    <region name="tabs" widget="object_list">
      <block type="tab" label="${h3/text}" language="${pre/lang}" code="${pre/text}" />
    </region>
  </block>
---

# Multilingual sites

A multilingual site needs very little from a frontend. Render each language's tree as it comes, offer the page in the site's other languages, and the editor's translation tools work through the frontend you already have.

## How the content is laid out

The backend (plone.app.multilingual) gives each language a root folder — `/en`, `/de` — and a page's translations live at the matching place in each tree. A language root is the navigation root for everything inside it, so the navigation you already fetch is one language's menu, never the whole site in two languages. Nothing in your routing or navigation code needs to change.

## Offering the page in other languages

Two answers from the API are all a language switcher needs:

- `@site`'s `plone.available_languages` — which languages the site has.
- The page's `@components.translations` (fetch the page with `?expand=translations`) — what this page is called in each of them.

Link each language to the page's translation. For a language the page is not translated into, link that language's root instead — what Volto's own selector does, and better than hiding the language. Take both from the API rather than guessing from the path: which languages exist is the site's business, and what a page is called in each is the translation's.

### Javascript

```javascript
async function renderLanguageSwitcher(content) {
  const site = await fetch(`${apiOrigin}/++api++/@site`).then((r) => r.json());
  const languages = site['plone.available_languages'] || [];
  if (languages.length < 2) return '';

  const current = content.language?.token || content.language;
  const translations = content['@components']?.translations?.items || [];
  return languages
    .map((lang) => {
      if (lang === current) return `<span aria-current="true">${lang}</span>`;
      const translation = translations.find((t) => t.language === lang);
      const href = translation ? new URL(translation['@id']).pathname : `/${lang}`;
      return `<a href="${href}" hreflang="${lang}">${lang}</a>`;
    })
    .join(' ');
}
```

In the editor, following a switcher link is ordinary navigation inside the preview: the bridge reports it, and the admin moves to the other language's page too.

## The editor's translation tools

When an editor reads a page beside its other language, the admin opens that language in a second editing frame, drawn by your frontend like any other page. Every block in it is marked read-only, so the bridge collects no editable field and nothing in it can be typed into — there is nothing extra for your frontend to do. Selecting a block, the side-by-side pairing and the translation markers are all handled by the admin.
