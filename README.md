# Inka

**A headless page builder that keeps your CMS and your design system.**

Editors build pages visually, on the real page of your front end, from your design system's components. Developers write the design system's rules into the block schemas: which blocks go in each region and how many, which text styles are allowed, which template parts are locked, which values stop a save and which only warn. Editors, and AI agents working over MCP, can then only build pages that follow the design system.

Inka is not a CMS. Content, users and workflow stay in your CMS, which connects through an adapter, and the CMS itself stays standard. Your front end stays yours: Next.js, Nuxt, SvelteKit, Astro, plain HTML, or server-rendered PHP, Django or Rails. The public site never loads Inka.

Open source under the [MIT licence](./LICENSE). In production on NSW Government sites ([case studies](https://inka.sh/case-studies)), with front ends built for the GOV.UK and [NSW](https://digitalnsw.pretagov.com.au) design systems.

- Website: <https://inka.sh>
- Documentation: <https://inka.sh/docs>
- Security: see [SECURITY.md](./SECURITY.md)

## Try it in one minute

Press **Try editing now** on [inka.sh](https://inka.sh), or open [admin.inka.sh/login?demo](https://admin.inka.sh/login?demo&return_url=/edit). You are signed in as a demo account, in the editor, with nothing to register for. Open user preferences (bottom left) to switch to another front end mid-edit, or paste in the URL of your own. Nothing the demo account changes is kept.

## Make your front end editable

You add one script and a few HTML attributes. Your front end fetches the page as JSON and renders it with its own code; nothing of Inka's sits in your render path.

```jsx
// app/[...slug]/page.jsx (Next.js; Nuxt, SvelteKit, Astro and plain HTML are in the guide)
'use client'
import { useState, useEffect } from 'react'
import { initBridge } from '@hydra-js/hydra.js'

export default function Page({ params }) {
  const [page, setPage] = useState(null)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    if (window.name.startsWith('hydra')) {
      // Inside the editor: declare your blocks and their rules, and re-render on every edit.
      setEditing(true)
      initBridge({
        blocks: {
          card: { title: 'Card', blockSchema: { properties: {
            title: { type: 'string' }, image: { widget: 'image' }, link: { widget: 'url' },
          } } },
        },
        onEditChange: setPage,
      })
    } else {
      // On the live site: fetch the page and render once.
      fetch(`/++api++/${params.slug?.join('/') || ''}`).then((r) => r.json()).then(setPage)
    }
  }, [])

  if (!page) return null
  return page.blocks_layout.items.map((id) => {
    const block = page.blocks[id]
    return (
      <a key={id} href={block.link} data-block-uid={editing ? id : undefined}>
        <img src={block.image} data-edit-media={editing ? 'image' : undefined} />
        <h3 data-edit-text={editing ? 'title' : undefined}>{block.title}</h3>
      </a>
    )
  })
}
```

`data-edit-text` makes text editable in place, `data-edit-media` opens the image picker, and the block schema becomes the sidebar form. How to get `hydra.js` into your project is in [Installation](./docs/frontend-guide/installation.md), and the full walkthrough is the [front-end guide](./docs/frontend-guide/index.md).

### Run an example against the demo

No CMS or Inka install needed:

```bash
git clone https://github.com/Inkaengine/inka.git
cd inka/examples/nuxt-blog-starter
pnpm install
NUXT_PUBLIC_BACKEND_BASE_URL=https://api.inka.sh pnpm run dev
```

Open the [demo editor](https://admin.inka.sh/login?demo&return_url=/edit) and add `http://localhost:3000` as a front end in personal preferences.

## Design-system rules

Rules live in the block schemas and regions your front end passes to `initBridge`:

```javascript
// Only text and images in the header, at most three blocks.
header: { widget: 'blocks_layout', allowedBlocks: ['slate', 'image'], maxLength: 3 },

// A pictogram that isn't an SVG cannot be saved.
fieldRules: {
  image: {
    when: { 'image_scales.image.0.content-type': { isNot: 'image/svg+xml' } },
    error: 'A pictogram must be an SVG.',
  },
},
```

Errors stop a save, warnings advise and let it go ahead, and templates can lock blocks in place while leaving slots for editors. Imported and migrated content is checked against the same rules. See [Rules and checks](./docs/compliance/index.md).

## AI agents

An assistant such as Claude connects over MCP and edits through the same editor, signed in as the person using it, with the same blocks, rules and permissions. See [Working with an AI agent](./docs/editor-guide/ai-agents.md).

## Supported CMSs

| CMS | Status |
| --- | --- |
| Plone | Released, in production |
| WordPress, Drupal, Strapi | Built |

An adapter is one contract: read and write pages as JSON, plus the CMS's fields, permissions, workflow and revisions. Pages stored as JSON move between CMSs without conversion. See [Connect a CMS](./docs/adapters/index.md).

## Documentation

The docs live in [`docs/`](./docs/) and are published at <https://inka.sh/docs>.

| Topic | Where |
| ----- | ----- |
| How Inka works | [`docs/architecture.md`](./docs/architecture.md) |
| Build a front end | [`docs/frontend-guide/`](./docs/frontend-guide/index.md) |
| Rules and checks | [`docs/compliance/`](./docs/compliance/index.md) |
| Connect a CMS | [`docs/adapters/`](./docs/adapters/index.md) |
| Testing and the mock API | [`docs/testing/`](./docs/testing/index.md) |
| What editors will experience | [`docs/editor-guide/`](./docs/editor-guide/index.md) |
| Deploy and secure Inka | [`docs/deploy-and-secure.md`](./docs/deploy-and-secure.md) |
| Block examples | [`docs/examples/`](./docs/examples/index.md) |

The `hydra` name in the bridge script, attributes and package names is the project's former name, kept for compatibility.

## Develop Inka itself

Clone the repository:

```bash
git clone https://github.com/Inkaengine/inka.git
cd inka
```

Start a Plone REST API to edit against:

```bash
docker run -it -d --rm --name=api -p 8080:8080 -e SITE=Plone -e CORS_ALLOW_ORIGIN='*' plone/server-dev:6
```

Start an example front end (Nuxt.js):

```bash
cd examples/nuxt-blog-starter
pnpm install
NUXT_PUBLIC_BACKEND_BASE_URL=http://localhost:8080/Plone pnpm run dev
```

The front end runs at <http://localhost:3000>. To edit, install and start Inka:

```bash
cd ../..
make install
pnpm build:deps
PORT=3001 RAZZLE_API_PATH="http://localhost:8080/Plone" RAZZLE_DEFAULT_IFRAME_URL=http://localhost:3000 pnpm start
```

Log in at <http://localhost:3001> as **admin** / **admin**.

### Tests

Run the unit tests with `pnpm test` (after `pnpm build:deps`) and `cd packages/hydra-js && pnpm test`. For the Playwright suite, see the [test suite README](./tests-playwright/README.md). To run the checks against your own front end, see [Testing and the mock API](./docs/testing/index.md).

## Example front ends

- [Nuxt.js](./examples/nuxt-blog-starter)
- [Next.js](./examples/hydra-nextjs)
- [F7-Vue](./examples/hydra-vue-f7)

## Issues and contributions

Report bugs and ideas in [GitHub issues](https://github.com/Inkaengine/inka/issues). Report security problems privately, as described in [SECURITY.md](./SECURITY.md).

## Support

Inka is built and maintained by [PretaGov](https://www.pretagov.com). For commercial support and hosting, see [inka.sh](https://inka.sh).
