# Plone backend for the examples

A real Plone to try the example frontends against, seeded with the same templates and docs
the test suites use. It installs
[collective.restapi.searchexpansion](https://github.com/collective/collective.restapi.searchexpansion),
which the examples use to bring their forced layouts with the page (`expand=search`, see
`templateSearchParams` and [the templates guide](../docs/frontend-guide/templates.md)).

## Running the backend

```bash
make backend-start    # Plone 6 on http://localhost:8080/Plone (foreground)
make backend-seed     # in a second terminal: load the shared templates + docs
```

Admin is `admin` / `admin`; the API root is <http://localhost:8080/Plone/++api++/>.

| Target | What it does |
| --- | --- |
| `make backend-start` | Starts Plone. The database survives restarts. |
| `make backend-seed` | Loads the content below. Run it on a fresh site: it refuses if the site already has `/inka-templates/site-footer`. |
| `make backend-stop` | Stops it; content is kept. |
| `make backend-clean` | Stops it and **deletes the database**: the next start creates a fresh site. |

**What the seed loads.** The templates the example frontends force on every page
(`/inka-templates/site-footer`, `event-view`, `newsitem-view`, `context-navigation-layout`) and
the docs site. They're stored in the repo as markdown (`tests-playwright/fixtures/site-root`,
`docs/`), which Plone can't import, so `backend/seed.sh` has the mock API `@export` them as a
`plone.exportimport` distribution and hands that to Plone's `@import`. The result: the
same templates the test suites use, in a real Plone.

A markdown site's redirects live in its own folder (`redirects.json` beside `index.md`,
site-relative: `{"/old": "/new"}`). Plone stores redirects by physical path, so `@export`
needs the site's path to write them (`"sitePath": "/Plone"` in the request body; the seed
takes it from `PLONE_URL`) and refuses to export redirects without one.

For vanilla Plone **without** the add-on, use `make backend-docker-start` instead. It uses
the same port, so stop the other first.

## Trying it with the Nuxt example

### 1. Start and seed the backend

```bash
make backend-clean && make backend-start    # terminal 1: a fresh site
make backend-seed                           # terminal 2
```

Check the search expansion answers. `@components.search.items` should hold
`/inka-templates/site-footer`:

```bash
curl -s -H 'Accept: application/json' \
  'http://localhost:8080/Plone/++api++/?expand=search&expand.search.path.query=/inka-templates/site-footer&expand.search.path.depth=0&expand.search.fullobjects=1'
```

(Plone completes a site-relative `path.query` only behind a virtual host. Locally the site
lives under `/Plone`, so if that comes back empty, query `/Plone/inka-templates/site-footer`.)

### 2. Run the example against it

```bash
cd examples/nuxt-blog-starter
pnpm install --ignore-workspace       # first time only
NUXT_PUBLIC_BACKEND_BASE_URL=http://localhost:8080/Plone pnpm dev
```

Open <http://localhost:3000>. This is the server-rendered view mode, the same code path the
SSG build uses.

**What to check:**

- **Every page ends with the site footer** ("Inka — design-system-first page
  building…"). That's a forced layout: the page never references it, so it only appears
  if the search brought it, or `loadTemplates` fetched it.
- **A two-level page** such as <http://localhost:3000/docs/frontend-guide/templates> **shows the
  context navigation**, another forced layout.
- **The forced layouts come with the page.** Watch the backend log:

  ```bash
  docker compose -f backend/docker-compose.yml logs -f backend | grep 'GET /Plone'
  ```

  Loading a page sends one `GET …?expand=…,search&expand.search.path.query=…`, and no
  separate request for the site footer. Templates the page references in its own data are
  fetched once the page has arrived.

### 3. Build it the way production does

```bash
cd examples/nuxt-blog-starter
NUXT_TEST_BACKEND=http://localhost:8080/Plone pnpm generate
grep -rlF 'not found in pre-loaded templates. Available:' .output/public   # expect: no output
```

About 330 routes prerender. The `grep` is the check `scripts/netlify-build.sh` uses to refuse
a broken deploy. With `NUXT_PRERENDER_STRICT=1` (as the deploy runs it) the build currently
exits 1 on two **image** errors, `ENOTDIR … images/penguin1.jpg/@@images`. That's a known
image write collision described in `netlify-build.sh`, and unrelated to templates.

### Checking the error handling

- **A page the backend doesn't have is a 404.**
- **A template that fails to load** (missing, or private to an anonymous visitor) is a 500
  with the real message in view mode and during the SSG build. In edit mode it's logged and
  ignored, because the admin does the merging there.

### Without Plone: against the mock API

The example also runs against the mock, which answers the same search:

```bash
HYDRA_MOCK_API_PORT=8888 pnpm start:mock-api                       # from the repo root
cd examples/nuxt-blog-starter
NUXT_PUBLIC_BACKEND_BASE_URL=http://localhost:8888 pnpm dev
```

Besides the checks above, <http://localhost:3000/_test_data/template-test-page> shows a
template referenced *from page content*: its fixed header and footer come from the template,
and the page's own text sits in the slot between them.

### Local quirks

- **Listing pagination links start with `/Plone/`.** The example builds them from the
  page's URL path, and locally the site lives under `/Plone`. Production serves the site at
  the domain root, so this only happens locally.

## Tests

| Command | What it checks |
| --- | --- |
| `node --test packages/mock-api/mock-serves-no-invented-endpoints.test.js` | The mock answers only endpoints Plone or a listed add-on has. |
| `make hydra-test ARGS="tests-playwright/integration/template*.spec.ts --project=admin-nuxt"` | Template editing through the Nuxt frontend. Two BlockChooser tests are flaky on Nuxt; they were before this change too. |
