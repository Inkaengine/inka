# Inka

Inka is a design-system-first page builder for any CMS. It is open source under the [MIT licence](./LICENSE).

Your components are your blocks, and your design system's rules are applied while people edit, so editors can build pages people want to read without breaking the design system. Inka is the editing and governance layer, not a CMS: content stays in your CMS, and your front ends, in any framework, render it.

Inka is ready for production and in use on NSW Government sites. See the [case studies](https://inka.sh/case-studies).

- Website: <https://inka.sh>
- Documentation: <https://inka.sh/docs>
- Security: see [SECURITY.md](./SECURITY.md)

## How it works

- **The CMS** keeps content, workflow, users and permissions. It connects to Inka through an [adapter](./docs/adapters/index.md).
- **Inka** does the page building and applies the rules each front end declares.
- **Front ends** render the pages. During editing, Inka opens the front end in an iframe and a small bridge script, `hydra.js`, talks to it over `postMessage`. The public site never loads Inka or the bridge.

The `hydra` name in the bridge script, attributes and package names is the project's former name, kept for compatibility.

## Try the online demo

Open [admin.inka.sh](https://admin.inka.sh) and log in as **admin** / **admin**. Open user preferences (bottom left), and either pick a preset front end or paste in your own URL. The demo resets overnight.

## Documentation

The docs live in [`docs/`](./docs/) and are published at <https://inka.sh/docs>.

| Topic | Where |
| ----- | ----- |
| How Inka works | [`docs/architecture.md`](./docs/architecture.md) |
| Deploy and secure Inka | [`docs/deploy-and-secure.md`](./docs/deploy-and-secure.md) |
| Build a front end | [`docs/frontend-guide/`](./docs/frontend-guide/index.md) |
| What editors will experience | [`docs/editor-guide/`](./docs/editor-guide/index.md) |
| Rules and checks | [`docs/compliance/`](./docs/compliance/index.md) |
| Connect a CMS | [`docs/adapters/`](./docs/adapters/index.md) |
| Testing and the mock API | [`docs/testing/`](./docs/testing/index.md) |
| Block examples | [`docs/examples/`](./docs/examples/index.md) |

## Run locally for development

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

### Run only your front end, against the demo

If you don't want to run Plone and Inka locally, develop your front end against the demo:

```bash
cd examples/nuxt-blog-starter
pnpm install
NUXT_PUBLIC_BACKEND_BASE_URL=https://api.inka.sh pnpm run dev
```

Then log in at <https://admin.inka.sh> and add your local front end (`http://localhost:3000`) in personal preferences.

### Tests

Run the unit tests with `pnpm test` (after `pnpm build:deps`) and `cd packages/hydra-js && pnpm test`. For the Playwright suite, see the [test suite README](./tests-playwright/README.md). To run the checks against your own front end, see [Testing and the mock API](./docs/testing/index.md).

## Example front ends

- [Nuxt.js](./examples/nuxt-blog-starter)
- [Next.js](./examples/hydra-nextjs)
- [F7-Vue](./examples/hydra-vue-f7)

## Issues and contributions

Report bugs and ideas in [GitHub issues](https://github.com/Inkaengine/inka/issues). Report security problems privately, as described in [SECURITY.md](./SECURITY.md).
