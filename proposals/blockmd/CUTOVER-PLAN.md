# blockmd cutover — one format, loader + Sphinx on the same files

## Goal / end state

**Two mount formats, one content model.** The loader reads a mount as either
**JSON** (`data.json`) or **markdown**, and both decode to the same content
shape — so a developer picks per mount (e.g. tests mount JSON fixtures; the
docs/site are authored in markdown). The **one markdown format** is the `<block>`
prototype format (`prototype-mapping.mjs`); **Sphinx** builds the docs from those
same files. One validator checks both formats.

What is **deleted** is *not* JSON support — it's the **old directive markdown
dialect** (`:::block`, `blockmd.mjs`, `content-md`) and **`sync`** (the old
markdown→JSON *build step*). Markdown becomes a loader-read source, not a
generated artifact.

- `inka-site/` — top-level marketing, authored in the markdown format.
- `docs/` — documentation, authored in the markdown format; Sphinx builds it, and
  the loader includes it at `/docs`.
- JSON fixtures (tests, or any content a dev prefers as JSON) stay first-class.
- Deploy builds the distribution from the loader. CI runs sanity on both trees.

## Done (this branch, 2026-09)

- **One validator.** `plone-content-validator.cjs` validates *both* the JSON tree
  and the markdown-decoded tree (same shape). The parallel `content-validator.mjs`
  + `check-content-validate.mjs` are retired; the single-node-slate rule lives in
  the one validator and is enforced on both mounts.
- **Deploy export from memory.** `POST /@export?format=json` emits a deployable
  `.tar.gz` (plone.exportimport) from the in-memory served content of every
  content-source mount, JSON or markdown alike — the `writeDistribution` emitter
  normalises blobs to `<item dir>/<field>/<filename>`. `markdown-mount` ships a
  content item's own image/file blob (leadimage). (`0e3afe67`→`cfef8768`.)
- **Dialect consolidation — steps 1-3.** slate/md helpers live in `lib/slate-md.mjs`;
  the loader's `decodeAuto` reads ONLY the `<block>` prototype format (directive
  arm dropped, `738a355c`); `resolveMarkdownLink` ported into the loader for
  hand-authored `.md` cross-links (`ea985faf`).
- **Step 4 — serving half.** `/` mounts `docs/content-md-proto` (mock default, dev
  script, playwright) — markdown is the served source of truth (`0fa96e39`).
  Parity proven first: check-proto-parity 64/0-diff, check-proto-mount
  63/0-block-diff/0-state-diff/45-of-45 blobs, paths 115=115; green on markdown
  across node:test 25/25 + vitest 568 + playwright api-contract/mock.

## Remaining for step 4/5 (the JSON-tree deletion)

The generated JSON docs tree (`docs/content/content/content`) is still read by:
the deploy build (`build-distribution-content.mjs`, `api/scripts/validate-content.py`),
`start:mock-api`'s `--watch-path` (harmless), tests (`doc-examples.spec.ts`,
`mock-api-server.test.cjs`), and the proto parity tooling (`check-proto-*` need
both trees to compare). So deletion waits on: (a) step 5 deploy emitter sourcing
docs from markdown; (b) repointing those tests; (c) retiring the parity tooling
once markdown is frozen (step 3/7). Until then markdown (served) and the JSON
tree (deployed) are proven-equivalent and both committed.

## Containers: schema-free model-alignment (DONE — blockPath import REJECTED)

The engine had its own container walk/order/nest (`unkeyBlocks`/`keyBlocks`/
`decodeRegion`/`emitContainer`) that diverged from the schema's model and was
buggy — a `columns` block (a blocks_layout container ordered under
`blocks_layout.columns`) tier-3'd when nested, because `unkeyBlocks` hardcoded
`blocks_layout.items`.

**Decision (shipped `ca8276f4`): align the engine to the same container MODEL the
schema / `blockPath` use, but keep the engine's own lean, SCHEMA-FREE code —
do NOT import `blockPath`.**

Why not import `blockPath` (this reverses an earlier draft of this section):
- Decode is **schema-free** today, and that is the property we want: the
  prototype's `<region widget=…>` declaration is self-describing, so a document
  decodes with no external schema.
- `blockPath`/`buildBlockPathMap` is **schema-driven** (reads `blocksConfig`).
  Reusing it would force decode to require an external schema — **strictly
  worse.** Synthesizing a config from the prototypes to feed it is *possible* but
  pointless: it bolts ~985 lines of admin-shaped code (allowedBlocks, sibling
  types, template instances, `intl`) onto a converter that only needs
  "traverse + order".
- The real fix was the **model, not the code**. A blocks_layout region's NAME is
  its layout key (`gridBlock→items`, `columns→columns`); children live in the
  shared `blocks` dict. `keyBlocks`/`unkeyBlocks` now key/order by that;
  `collectProtos` finds nested item protos; a tier-3 block keeps its own
  `blocks_layout` (guarded delete).

**Result:** `columns` + arbitrary nesting emit as clean markdown, schema-free.
Engine 76, site proto-parity 8/0, site clean 69→89%. The ~50 lines of engine
container code is a correct, schema-free implementation — acceptable, and NOT
duplication worth trading schema-freedom away to remove.

## Consolidate the two markdown dialects (the remaining duplication)

The branch still carries **two markdown dialects** for the same blocks — the old
`:::block` directive (`blockmd.mjs`, `content-md`, `export-tree`/`import-tree`/
`convert`) and the new `<block>` prototype format (`prototype-mapping.mjs`,
`content-md-proto`, `export-proto`). Keep the new; delete the old:

1. **Extract shared slate/md helpers.** `prototype-mapping.mjs` imports
   `{ tagOf, mdParser, blockToSlate, slateToMd, fmtTagAttrs, renderTable }` from
   `blockmd.mjs` (format-agnostic primitives). Move them to `lib/slate-md.mjs`;
   repoint the new engine — so `blockmd.mjs` can be deleted without losing them.
2. **Drop the directive branch in the loader.** `markdown-mount.mjs`'s
   `decodeAuto` is `… ? decodePage : mdToPage`; remove the `mdToPage` arm so the
   loader only reads the `<block>` format, and drop the `blockmd.mjs` import.
3. **Port `sync`'s behavior into the loader FIRST** (prerequisite for deleting
   `sync`): `sync.mjs` holds `resolveMarkdownLink` (`.md`→`/docs/…` dead-link
   fix). Move it into the loader/decode path, or those links 404 post-delete.
4. **Decide how the docs `data.json` is produced without `sync`.** Today `sync`
   generates it from `.md` and `sync:docs:check` (a CI step) guards it. Once
   `sync` is gone, either the docs are served through the loader (markdown mount,
   no committed docs JSON) or the docs JSON is generated by the loader's
   distribution emitter — and the `sync:docs:check` CI step is replaced by a
   loader round-trip check. This is the real decision behind the deletion.
5. **Delete the old pipeline:** `sync.mjs`, `blockmd.mjs`, `docs/content-md/`,
   `export-tree.mjs`/`import-tree.mjs`/`convert.mjs`/`diag.mjs`/`check-parity.mjs`.
   - check: JSON mounts and markdown mounts both load + validate; the docs render;
     no `:::` directive references remain.

## Key finding (tested 2026-08-17, not assumed)

Sphinx 9.1 + myst 5.1 build the current blockmd format **as-is**:
- heavy frontmatter (`@type`, `UID`, `prototypes`, `assignments`) → dropped as
  metadata, invisible.
- markdown inside `<block …>` tags → fully parsed (Pygments-highlighted code,
  section anchors).
- `<block>` wrappers and `data='{…}'` fallbacks → inert unknown tags, invisible,
  no junk.

So there is **one format**, not a clean-docs/heavy-marketing split. "Make it
Sphinx-clean" is not a prerequisite — only optional cosmetics.

## The format (two readability leans, both mechanical)

1. **Lean frontmatter** — emit only fields that differ from the Plone default or
   can't be derived (drop `expires: null`, `language: "##DEFAULT##"`, empty
   arrays, `is_folderish` when derivable, …).
2. **Hoist prototypes** — one shared prototype set, referenced by pages, instead
   of re-declared in every page's frontmatter.

Neither changes what Sphinx or the loader do; they just make the one file
readable enough to hand/AI-author.

## Cutover steps (each with its check)

1. **Validate Sphinx at scale.** Build *all* `docs/**` new-format pages under
   Sphinx, not one. Fix any real (non-search-index) errors. Optionally add a
   ~10-line extension mapping `<block>`/`<fields>` → passthrough so the inert
   tags disappear from the DOM.
   - check: `sphinx-build` of the full docs tree is clean.
2. **Block uids: derive, don't store; object UIDs: keep stable.** A block uid
   (`p-7`, `ul-6`) is a runtime/internal identity — *not* an identity or match
   key for either deploy path (see step 5), and tests key on block **type**, not
   uid. So stop emitting block uids: the loader derives them deterministically at
   read time (path + type + heading-slug, else position-within-parent). What
   *does* need to be stable is the **content-object UID** (page/folder/blob) — the
   incremental sync uses it for move detection and `resolveuid` links point at it
   — so those stay authored/stable in frontmatter / `subitem-assignments` (largely
   already true; the site tree uses semantic slugs). This **inverts** the old
   "stabilize block uids" step and folds into the freeze (step 3): until we stop
   matching legacy JSON, parity still needs the old uids, so the drop lands *with*
   the freeze, not before it.
   - check: an unrelated prose edit produces no block-uid diff (there are none in
     source) and leaves object UIDs unchanged.
3. **Freeze markdown as source.** The format files become canonical; stop
   generating them from JSON. One committed markdown tree per side.
   - check: no script writes the markdown tree from JSON anymore.
4. **Loader is the one content path; retire `sync`.** The loader reads the
   format files directly (superseding `sync.mjs`). Route the mock API mounts and
   the docs `/docs` mount through it.
   - check: mock API serves both trees from the markdown; `sync.mjs` deleted.
5. **Deploy from the loader — two emitters over one content model.** The loader
   yields a canonical content model (objects: path / `@type` / blocks /
   `blocks_layout`; blobs; order; derived metadata). Deploy is a **pluggable
   emitter** over that model, *not* baked into the loader — so both of pretagov's
   existing deploy paths are consumers of the same output:
   - **Distribution build** — replaces `build-distribution-content.mjs`; emits
     `__metadata__.json` (`_data_files_`, `_blob_files_`, `ordering`,
     `local_roles`). Creates a fresh site (content resets on deploy via
     `plone.distribution`), so nothing to match — block uids are freely derived.
     - check: built distribution imports and matches today's served JSON.
   - **Incremental sync** (`scripts/classify_content_delta.py`) — compares three
     path-keyed `data.json` trees (BASE = last deploy, DISK = HEAD, LIVE = live
     export). Change is a **per-page content hash** (`content_key`, canonical JSON
     minus `VOLATILE`); identity is **path**; object **UID** drives move
     detection. Block uids are not a key here — so to stop derived-uid churn from
     registering as false "changed" (and false clobbers of live editor edits),
     **normalize block uids out of `content_key`** (alongside the existing
     `VOLATILE` stripping) and in `convert-export-to-local.py`'s LIVE
     normalization.
     - task: extend the classifier's normalization to strip block uids.
     - check: an unrelated prose edit classifies **NOOP** for that page (no false
       UPDATE / clobber warning).
6. **Bring marketing to sanity-clean.** Run the normalizer + discovery/sanity on
   `inka-site/content` (14 multi-node slates + any shape issues), so the deployed
   content — not just docs — is covered.
   - check: discovery on the marketing tree is slate/shape 0.
7. **Retire scaffolding.** Delete the old directive dialect + `sync` per
   "Consolidate the two markdown dialects" and "Deleted at the end — and what
   STAYS" above. Keep JSON-as-a-mount-format, the one `<block>` markdown source
   tree, the one loader, and the one validator (validator already unified). The
   new exporter (`export-proto`) and proto checks stay as long as markdown is
   generated for review; they retire only once markdown is frozen as the source.

## Example-code path (removes the last sync step)

`docs/examples/examples/{react,vue,svelte,astro}/` are the renderer files — one
per block × framework, which the test frontends COMPILE and check-examples
VALIDATES. So they must stay real files (a frontend can't `import` a fence, and
the md documents only a SELECTION, never the full renderer set). Today `sync`
COPIES their code into the codeExample blocks — the duplication to remove.

Fix: the files stay the source; the markdown **references** them, so nothing is
copied. Use Sphinx's native `{literalinclude}`:

```markdown
### React

```{literalinclude} ../../examples/react/ButtonBlock.jsx
:language: jsx
```
```

- **Reference, not copy.** The tab points at the file. Sphinx renders
  `{literalinclude}` (shows the file's code) and the loader resolves the same
  directive into the tab's `code`. **What's shown IS what's compiled and
  tested** — no duplication, never stale, never a stub.
- **check-examples reads the docs.** Decode the codeExample tabs (loader inlines
  each `{literalinclude}`) and run the SAME parsers (acorn+jsx,
  `@vue/compiler-sfc`, `@astrojs/compiler`) per tab.
- **Coverage — every tested renderer must be shown**, one tab per block ×
  framework. Gap today: astro **0/26**, react 10, vue/svelte 4 each. Close it by
  adding the reference tabs.

Rules for the referenced files (they ARE the doc examples):
- **Exhibit the technique** — real field access + `data-block-uid`/`data-edit-*`
  annotations + `slate`/`getImageUrl` usage. Simple != stubbed.
- **Self-contained except three shared primitives**, referenced not shown:
  `getImageUrl` (image), `slate` (SlateNode), `BlockRenderer` (containers only).
  Direct sibling imports route through `BlockRenderer`.

So `sync`'s code-copy is replaced by `{literalinclude}` references — `sync`
retires, the renderer files remain the source, and nothing is duplicated.

Loader change: when a codeExample tab's body is a `{literalinclude}` directive,
read the referenced file for the code (else use the inline fence, for hand-
written doc-only snippets). Sphinx needs no change.

## Deleted at the end — and what STAYS

**Deleted:** `sync.mjs`; the old directive dialect (`blockmd.mjs`, `content-md`,
`export-tree`/`import-tree`/`convert`/`diag`/`check-parity`);
`build-distribution-content.mjs`; the redundant one-off scripts (`normalize-*`
once folded); and the committed docs/site **JSON-as-source** trees *iff* step-4
decides the docs are loader-served from markdown (else they're generated by the
distribution emitter, not hand-committed).

**Stays (not deleted):**
- **JSON as a mount format** — test fixtures and any dev-authored JSON content;
  the loader + the one validator handle JSON and markdown identically.
- **One markdown tree** — the `<block>` prototype source (`content-md-proto`
  becomes *the* source, not a generated copy). Only the old `content-md`
  directive tree goes.
- **`docs/examples/examples/**` renderer files** — the source, referenced by
  `{literalinclude}` instead of copied.
- **One loader + one validator** (validator already unified — see Done).

## Risks

- **Object-UID stability** (page/folder/blob — *not* block uids) is what the
  incremental sync's move detection and `resolveuid` links depend on; keep those
  authored/stable. Block uids are loader-derived and normalized out of change
  detection, so they no longer gate anything — the old "stabilize block uids"
  risk is retired.
- **Deploy metadata** (step 5) must generate `__metadata__.json` exactly; the
  agreement check (built distribution == served JSON) is the guard.
- **Marketing coverage** (step 6) — deploy currently ships unchecked site content.
