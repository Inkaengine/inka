# Volto Hydra (volto-hydra)

A **Visual Headless CMS** using Plone as a server, with an Administration interface based on Volto. Hydra provides a true visual editor with drag-and-drop blocks and editable text — with **any frontend stack you choose**. No assumptions. No learning curve.

## Why Hydra?

- **Visual + true Headless + Open Source** — a unique combination in the CMS space
- **Framework agnostic** — Next.js, Nuxt.js, Astro, or any stack you want
- **Quick to enable** — visual editing comes from simple HTML data attributes; no React or Vue required in your frontend
- **Omni-channel** — switch between multiple frontends mid-edit
- **Enterprise features** — versioning, i18n, workflow, automated content rules
- **Customisable** — both the admin interface and block definitions
- **Choice of backend** — Python (Plone) or JavaScript (Nick) for the server
- **Battle-hardened** — Plone is used by both the CIA and FBI

## Try the online demo

Log in to <https://hydra.pretagov.com>, open user preferences (bottom left), and either pick a preset frontend or paste in your own URL. The default frontend is the [Nuxt.js demo](https://hydra-nuxt-flowbrite.netlify.app/) — deployed as SSG to demonstrate scale-to-zero editing on free hosting.

## Documentation

Full documentation is in the [`docs/`](./docs/) directory (built with Sphinx).

| Topic | Where |
| ----- | ----- |
| What it is, quick start, run locally | [`docs/getting-started/`](./docs/getting-started/index.md) |
| What your editors will experience | [`docs/what-editors-will-experience/`](./docs/what-editors-will-experience/index.md) |
| How to build (architecture, blocks, listings, templates, deployment, step-by-step) | [`docs/how-to-build/`](./docs/how-to-build/index.md) |
| Block examples (slate, image, teaser, listing, search, hero, columns, accordion, slider, form, …) | [`docs/examples/`](./docs/examples/README.md) |

## Run locally for development

Clone the repository:

```bash
git clone https://github.com/collective/volto-hydra.git
cd volto-hydra
```

Start the Plone REST API:

```bash
docker run -it -d --rm --name=api -p 8080:8080 -e SITE=Plone -e CORS_ALLOW_ORIGIN='*' plone/server-dev:6
```

Start an example frontend (Nuxt.js):

```bash
cd examples/nuxt-blog-starter
pnpm install
NUXT_PUBLIC_BACKEND_BASE_URL=http://localhost:8080/Plone pnpm run dev
```

Frontend at <http://localhost:3000>. To edit, start the Hydra admin:

```bash
cd ../..
make install
RAZZLE_API_PATH="http://localhost:8080/Plone" RAZZLE_DEFAULT_IFRAME_URL=http://localhost:3000 pnpm start
```

Log in at <http://localhost:3001>.

### Run only your frontend, against the deployed CMS

If you don't want to run Plone + Hydra locally and just want to develop your frontend against the deployed admin:

```bash
cd examples/nuxt-blog-starter
pnpm install
NUXT_PUBLIC_BACKEND_BASE_URL=https://hydra-api.pretagov.com pnpm run dev
```

Then log in at <https://hydra.pretagov.com/> and add your local frontend URL (`http://localhost:3000`) in personal preferences.

## Example frontends

- [Nuxt.js](./examples/nuxt-blog-starter)
- [Next.js](./examples/hydra-nextjs)
- [F7-Vue](./examples/hydra-vue-f7)

## How Hydra works (in one diagram)

Editing and rendering are separated. During editing the frontend runs inside an iframe owned by Hydra's admin UI; a small `hydra.js` bridge handles two-way `postMessage` communication. When not editing, the frontend just renders content from the REST API — no admin code involved.

```text
                  Browser            REST API           Server

              ┌──────────────┐                       ┌─────────────┐
 Anon/Editing │    Volto     │◄─────────────────────►│    Plone    │
              └──────────────┘                       └─────────────┘

──────────────────────────────────────────────────────────────────────

          │   ┌──────────────┐                       ┌─────────────┐
          │   │   Frontend   │◄──────────────────────┤    Plone    │
          │   └──hydra.js────┘                       └─────────────┘
          │          ▲                                  ▲
 Editing UI          │ iframe bridge                    │
          │          ▼                                  │
          │   ┌──────────────┐                          │
          │   │    Hydra     │◄─────────────────────────┘
          │   └──────────────┘

              ┌──────────────┐                       ┌─────────────┐
 Anon         │   Frontend   │◄──────────────────────┤    Plone    │
              └──────────────┘                       └─────────────┘
```

For the full architecture (chrome pattern, slate transforms, frontend integration steps), see [`docs/how-to-build/architecture.md`](./docs/how-to-build/architecture.md).

## Project status & roadmap

[Hydra project board](https://github.com/orgs/collective/projects/3/views/4).
