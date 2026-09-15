# blockmd prototype — what the block JSON actually contains, and how it maps

Prototype for the markdown/directive format in `../mcp-content-authoring.md`.
Measured against all real content: **74 pages, 1546 blocks, 30 block types**
(inka-site's site tree plus the docs tree).

Run it:

```
python3 survey_blocks.py     # what's in the JSON
python3 roundtrip.py         # JSON -> markdown -> JSON, fidelity report
```

## Result

`blockmd2.py` — whole page, schema-aware:

| | |
|---|---|
| page metadata | **74 / 74 — 100%** |
| block order | 72 / 74 — 97% |
| blocks (semantic) | **1490 / 1546 — 96%** |

`blockmd.py` (v1, blocks only, no schema) reached 95% on blocks. Semantic means
ignoring empty text leaves and the derived `plaintext` — see "stored slate is
inconsistently normalised".

The 56 blocks that still differ are almost entirely the data inconsistencies
listed below (`a` vs `link`, the two inline-code forms), not gaps in the format.

## The mapping

| JSON | markdown | notes |
|---|---|---|
| `blocks_layout.items` order | document order | free — ordering needs no syntax |
| block uid | `{uid="…"}` attr | needed so edits can be id-addressed |
| `slate` (999 blocks, 65%) | markdown prose | p, h1–h6, ul/ol, strong, em, code, del, link |
| scalar fields | `{key="value"}` attrs | strings, numbers, bools |
| nested `blocks` | nested `:::` directives | gridBlock, search, contextNavigation |
| non-scalar fields | ` ```fields ` JSON block | the escape hatch — `querystring`, `styles`, `tabs`, refs |
| `plaintext` | *(derived)* | recomputed on parse, never authored |

A directive maps 1:1 onto a block, as the proposal specifies: `name` → `@type`,
`{attrs}` → scalar fields, body → children parsed recursively.

**The escape hatch is what makes this viable.** 65% of blocks are prose and map
to plain markdown; the rest carry structure markdown has no syntax for
(`querystring` filters, `fieldMapping`, `tabs` arrays, `styles` objects). Rather
than invent syntax for each, they ride a fenced JSON block. Nothing is
unrepresentable, and an agent only meets JSON when it genuinely needs to.

## What the survey turned up

**Regions are effectively one key.** `blocks_layout` uses `items` 113 times and
`listing` 4 times. The multi-region machinery exists but is barely used, so
document order covers almost everything.

**Template bookkeeping is pervasive**: `templateId`, `templateInstanceId`,
`slotId`, `fixed`, `readOnly` appear on most block types. They are storage
concerns an author should never type. They survive as attrs so round-trips are
lossless, but a writing agent can ignore them entirely.

**Inline code has two representations.** `{"type":"code", …}` as a node (859
occurrences) and `{"code": true}` as a mark. Both mean the same thing. The
prototype emits the node form since that dominates, but a converter has to pick
one and the choice is arbitrary — worth normalising in the content instead.

**`link` vs `a`.** 110 `link` nodes and 2 `a` nodes for the same concept. The
two `a`s look like drift.

## Two facts that contradict the documentation

**`docs/visual-editing.md` says a slate value always holds exactly one
top-level node.** Stored content disagrees: 43 of 997 slate blocks hold more
(grid cards are typically a bold lead-in paragraph plus a body paragraph).
Either the invariant is wrong or the content is, and hydra's normalisation would
split these into separate blocks on edit — which would surprise whoever edits a
card.

**Stored slate is inconsistently normalised.** Slate requires text leaves either
side of an inline element, and some blocks have them (`[{"text":""},{link}]`)
while others start straight with the inline. Adding the normalisation to the
parser moved byte-exact fidelity *down* from 68% to 52%, because it then
disagreed with the blocks that omit them. No parser can guess which convention a
given block used. This is why the honest measure is semantic, not byte-exact.

## What production would need

1. **A real parser.** This prototype uses regex for markdown and directives.
   Use `remark` + `remark-directive` (mdast), which is what the proposal
   assumes, rather than growing this.
2. **Normalise the content first**, or accept semantic-only round-trips: pick
   one inline-code form, one link node type, and decide the text-leaf rule.
3. **Decide what a mock-API markdown mount is for.** Read-only (serve markdown
   as blocks) is straightforward today. Write-back — editing in the CMS and
   getting sensible markdown out — needs 2 settled first.

## On replacing sync.mjs

A markdown mount would remove the generated JSON from the dev loop, along with
the drift and the "out of sync" warnings. It would **not** remove the build
step: production imports a Plone distribution, so a markdown→JSON pass still has
to run at deploy. The win is real but it is a dev-loop win, not the deletion of
sync.


## v2: page metadata and object_list

**Frontmatter carries authored fields only** — `title`, `description`,
`review_state`, `exclude_from_nav`, `subjects`, `language`, `rights`,
`effective`, `expires`, `id`, plus `UID`/`@type` for identity. The other 13
page-level fields (`created`, `modified`, `workflow_history`, `lock`,
`is_folderish`, `parent`, `type_title`, …) are server state. Putting them in a
markdown file would produce spurious diffs on every export and invite someone to
hand-edit an audit trail.

**The blockMap keeps prose clean.** Frontmatter carries an ordered
`uid: type` list for top-level blocks, so a single-node slate block renders as a
bare markdown paragraph instead of `:::slate{uid="…"}…:::`. On a page like
About that is the difference between readable markdown and a wall of
directives. It is the proposal's own §3 design: "read returns markdown plus a
blockMap".

**object_list needs the schema, and only the schema.** Confirmed empirically:

```
object_list      slider.slides  accordion.panels  codeExample.tabs  form.subblocks
object_browser   button.href    hero.buttonLink   navItem.href      highlight.cta_link
```

Both are `[{"@id": …}]` in storage. `accordion.panels[0]` and `button.href[0]`
are structurally indistinguishable; one is a child block, the other is a link to
a page. No heuristic on shape survives real content — `codeExample.tabs` uses a
slug-like id and `button.href` uses `/`. `dump_schema.sh` extracts the widget
map from `shared-block-schemas.js`.

Without the schema you can still round-trip (those fields ride the escape
hatch). What you lose is *ergonomics*: an agent cannot author `:::accordion`
with `:::panel` children, which is the point of the format.

Note the schema is not complete — `teaser.href`, `search.facets` and
`socialLinks.links` are not in `shared-block-schemas.js`, so they fall back to
the escape hatch.

## Bugs worth remembering

**Multi-line strings cannot be attributes.** `codeExample.tabs[].code` is source
code. Anything with a newline, a quote, or over ~200 chars has to use the
escape hatch.

**Appending a copy loses later updates.** object_list items were appended to the
parent list as a copy while ` ```fields ` updates mutated the stack entry — so
every `codeExample` silently lost its `code` and nothing errored. Silent partial
loss is the worst failure mode for a content format; it was only caught because
the harness compares against all real content rather than a fixture.

**A leading `@` gets eaten by an attr regex.** `@id="x"` parsed back as `id`,
because `(\w+)=` starts matching after the `@`.
