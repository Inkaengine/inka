# Plone backend — the templates addon

The Plone side of the templates feature: a `@templates` endpoint that resolves, in one
request, every template a page needs to render.

## Why

Without it a frontend fetches each template itself, discovers nested references only after
the parent arrives, and serialises the walk. The Nuxt example used to do exactly that, and
needed a cross-render cache, an in-flight-promise dedupe map and a 5s abort, because the
SSG prerender hit the API ~179x for the same forced footer layout and cold-hung. It now
asks for the page and its templates in one request (`?expand=templates`), and that code is
gone.

## The contract

Settled against the mock API first, then implemented here and diffed against it:

| What | Where |
| --- | --- |
| Response shape | `tests-playwright/fixtures/templates-component.test.cjs` |
| The merge actually consuming it | `tests-playwright/fixtures/templates-component-merge.test.cjs` |
| Reference implementation | `@templates` in `tests-playwright/fixtures/mock-plone-api.cjs` |
| Diff against real Plone | `tests-playwright/conformance/rest-api.spec.ts` |

```json
{
  "@id": "http://localhost:8080/Plone/my-page/@templates",
  "templates": { "<the templateId the block carries>": { "blocks": {}, "blocks_layout": {} } },
  "idFieldMap": { "form": { "subblocks": "field_id" } }
}
```

Three rules the mock encodes, each of which the addon must reproduce:

1. **Key templates by every spelling that reached them.** The merge looks a template up by
   the literal string on the block, so a block carrying `resolveuid/abc` must find an entry
   at `resolveuid/abc` — not at the path it resolved to. One template reached both ways
   appears under both keys, or the merge misses it and the page renders empty.
2. **Resolve `?expand.templates.extra=/a,/b` as well as what the page references.** A
   forced layout is never referenced from page content, which is exactly why frontends had
   to pre-load it by hand. The **frontend** owns the layout rules and names the layouts;
   the backend answers only "resolve these and everything they reference". No
   `allowedTemplates` / `allowedLayouts` policy crosses the wire — layouts are a design
   system's artifacts, and a second frontend against the same content would use entirely
   different template paths.
3. **Name a missing template, don't throw.** One unresolvable id must not fail the page
   read; it appears in an `errors` array and the rest still arrive.

`idFieldMap` covers object_list fields keyed by anything but `@id` (a form's `subblocks` on
`field_id`). The merge falls back to `@id` when not told, which mints a bogus id and the
item is silently dropped on the next merge. Nested object_lists are excluded — the merge
only enumerates a block's top-level array fields, so a nested entry could never be looked up.

## Running the backend

```bash
make backend-start    # Plone 6 + this addon on http://localhost:8080/Plone (foreground)
make backend-seed     # in a second terminal: load the shared templates + docs
```

Admin is `admin` / `admin`; the API root is <http://localhost:8080/Plone/++api++/>.

The addon is mounted into the container and installed editable (the image's `DEVELOP`),
and its profile is applied when the site is created (`PROFILES`). Edit Python locally and
restart the container to pick changes up.

| Target | What it does |
| --- | --- |
| `make backend-start` | Starts Plone with the addon. The database survives restarts. |
| `make backend-seed` | Loads the content below. Run it on a fresh site: it refuses if the site already has `/templates/site-footer`. |
| `make backend-stop` | Stops it; content is kept. |
| `make backend-clean` | Stops it and **deletes the database**: the next start creates a fresh site. |

**What the seed loads.** The templates the example frontends force on every page
(`/templates/site-footer`, `event-view`, `newsitem-view`, `context-navigation-layout`) and
the docs site. They're stored in the repo as markdown (`tests-playwright/fixtures/site-root`,
`docs/`), which Plone can't import, so `backend/seed.sh` has the mock API `@export` them as a
`plone.exportimport` distribution and hands that to Plone's `@import`. The result: the
same templates the test suites use, in a real Plone.

For vanilla Plone **without** the addon, use `make backend-docker-start` instead. It uses
the same port, so stop the other first.

## Trying it with the Nuxt example

### 1. Start and seed the backend

```bash
make backend-clean && make backend-start    # terminal 1: a fresh site
make backend-seed                           # terminal 2
```

Check the endpoint answers. It should list `/templates/site-footer` with no `errors`:

```bash
curl -s -H 'Accept: application/json' \
  'http://localhost:8080/Plone/++api++/@templates?expand.templates.extra=/templates/site-footer'
```

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
  if `expand.templates.extra` resolved it.
- **A two-level page** such as <http://localhost:3000/docs/frontend-guide/templates> **shows the
  context navigation**, another forced layout.
- **One request per page for the page and its templates.** Watch the backend log:

  ```bash
  docker compose -f backend/docker-compose.yml logs -f backend | grep 'GET /Plone'
  ```

  (The log URL-encodes `++api++` as `%2B%2Bapi%2B%2B`, so grep for the path instead.)
  Loading a page sends a single `GET …?expand=…,templates&expand.templates.extra=…`. There
  are **no** separate `GET …/templates/…` requests. (You'll also see `@querystring` and the
  site navigation, which listings and the header fetch.) Before this change, every
  template was a separate request.

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

Query the endpoint directly:

```bash
API=http://localhost:8080/Plone/++api++
# A missing template is listed in `errors`; the page still returns 200.
curl -s -H 'Accept: application/json' "$API/@templates?expand.templates.extra=/templates/nope"
# The inline form, as the frontend asks for it.
curl -s -H 'Accept: application/json' "$API/?expand=templates&expand.templates.extra=/templates/site-footer"
```

In the example, any template failure in view mode or during the SSG build is a 500 with the
real message. Point it at a Plone **without** the addon and every page fails with "The backend
did not return the @templates component. Install the inkaengine.inka addon…". Without this
change it would fail later with a misleading "not found in pre-loaded templates". In edit
mode a template failure is logged and ignored instead, because the admin does the merging
there.

### Without Plone: against the mock API

The example also runs against the mock, which implements the same endpoint:

```bash
HYDRA_MOCK_API_PORT=8888 pnpm start:mock-api                       # from the repo root
cd examples/nuxt-blog-starter
NUXT_PUBLIC_BACKEND_BASE_URL=http://localhost:8888 pnpm dev
```

Besides the checks above, <http://localhost:3000/_test_data/template-test-page> shows a
template referenced *from page content*: its fixed header and footer come from the template,
and the page's own text sits in the slot between them.

### Local quirks (not caused by the addon)

- **Listing pagination links start with `/Plone/`.** The example builds them from the
  page's URL path, and locally the site lives under `/Plone`. Production serves the site at
  the domain root, so this only happens locally.
- **`python3` fails inside `backend/inkaengine.inka`** under asdf: the folder's
  `.python-version` pins 3.12, which asdf wants configured. Use `.venv/bin/python` there,
  or run from another folder.

## Tests

| Command | What it checks |
| --- | --- |
| `cd backend/inkaengine.inka && make test` | The addon against the contract, including permissions (private templates are reported, not served). Needs `node` and this repo: its fixtures are exported from the mock at test time. |
| `node --test tests-playwright/fixtures/templates-component*.test.cjs` | The mock's `@templates`, and the real merge consuming it. |
| `make test-conformance` | The mock diffed against this addon on a real Plone. Needs `make backend-start`; it creates and deletes its own content. |
| `make hydra-test ARGS="tests-playwright/integration/template*.spec.ts --project=admin-nuxt"` | Template editing through the Nuxt frontend. Two BlockChooser tests are flaky on Nuxt; they were before this change too. |
