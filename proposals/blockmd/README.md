# blockmd — two-way markdown ⇄ block documents

The readable format that is the single source of truth for Plone block content:
the **loader** turns it into the block JSON the mock API serves (and deploy
builds from), and **Sphinx** renders the same files as docs. Engine:
`../../lib/prototype-mapping.mjs`; exporter: `export-proto.mjs`; loader:
`../../lib/markdown-mount.mjs`.

```
node export-proto.mjs              # JSON tree -> docs/content-md-proto/**.md
node check-proto-parity.mjs        # decode every page, diff vs the original JSON
```

Round-trip is verified by decoding each written file back and diffing the blocks
against the source JSON (`check-proto-parity`), currently **61 / 0**. The
comparison is *semantic* — it ignores the derived `plaintext`, empty text
leaves, empty `styles`, and (once uids are loader-minted) block uids — because
byte-equality is the wrong bar for inconsistently-normalised stored slate.

## The document

```markdown
---
"@type": Document
UID: aboutinka0000000000000000000001
title: About
description: Why Inka exists…
review_state: published
blocks-matched: |
  <block type="slate" value="${p,h*,ul,ol,blockquote/slate}" />
  <block type="title" _="${h1}" />
  <block type="separator" _="${hr}" />
blocks-tagged: |
  <block type="accordion">
    <region name="panels" widget="object_list">
      <block type="panel" title="${h2/text}" />
    </region>
  </block>
---

Plain prose is a slate block. No wrapper.

## Headings are slate too

<block type="accordion">

## First panel

Body of the first panel.

</block>
```

The body is **content**; the two frontmatter sections are the **mapping** that
makes it decodable without a schema, so the mock API can serve markdown
directly.

## Prototypes: matched vs tagged

A prototype maps a markdown shape to a block type. There are two sections, and
**section membership is the flag** — no `explicit` attribute:

- **`blocks-matched`** — matched *implicitly* from bare markdown. Source order is
  a **CSS cascade**: the most *specific* prototype wins (specificity = count of
  non-`*` type slots; a multi-node run is a compound and sums), ties broken by
  source order, **later wins**. This is why `slate` is declared before `title`,
  so an `h1` ties on specificity and `title` (declared later) takes it.
- **`blocks-tagged`** — matched *only* via an explicit `<block type=…>` tag. For
  shapes too ambiguous to match from bare markdown (a variable-remainder
  container like `accordion`).

A fixed-shape repeating container (e.g. `codeExample` = `(### h3, fenced code)+`)
can be matched **bare** from `blocks-matched` with no wrapper — the pattern break
is the boundary (greedy / maximal-munch).

### References

An attribute value is a JSON scalar *or* a `${…}` reference — they can't overlap
because `${` is not a JSON token:

| form | meaning |
|---|---|
| `title="${1/text}"` | construct 1's `text` part — whole value, type preserved |
| `tag="h${1/level}"` | interpolation: composes a string (`"h2"`) |
| `value="${p,h*,ul/slate}"` | a node **set** — any of these node kinds → slate |
| `_="${hr}"` | match-only: consumes a node, captures nothing (separator) |

A ref has three slots — **`${ type [sel]… /part }`** — the type, a chainable
"which one" selector, and the accessor. The selector is keyed *or* positional
(like `sections["Contents"].paragraphs[2]`, **not** a CSS attribute selector —
CSS can't match text):

| selector | meaning |
|---|---|
| *(none)* | the first of that kind |
| `[2]` | the 2nd — **position** (a number) |
| `[Contents]` | within the section under `## Contents` (or a def-list term) — **label** (an identifier, matched by text) |
| `[Contents][2]` | chained: the 2nd, scoped to that label |

So `${p[Summary]/text}` is "the paragraph under the *Summary* heading", by name
rather than position. (Matching by literal text is intentional but brittle — use
it for stable structural labels, not prose.)

A def-list carries named values, read by term with the label selector:
```
Start
: 2024-01-01
Location
: Berlin
```
`start="${dd[Start]/text}"` → `2024-01-01`. (`remark-definition-list` parses it;
MyST renders it as a `<dl>` with `deflist` enabled.)

The **node kinds** a ref can target: `p`, `h1`–`h6` / `h` (relative) / `h*` (any),
`img`, `a`, `ul`, `ol`, `li`, `blockquote`, `pre` (code fence), `hr`, `table`,
`strong` / `em` (a lone-bold / lone-italic paragraph), and `dl` / `dt` / `dd`
(a definition list). A trailing `?` marks the ref **optional** — matched when
present, skipped when absent — for an optional node (a subtitle) *or* an optional
part (`${img?/title}`, an image with no title-string). A trailing `?`
(`${strong?/text}`) makes the slot **optional**. The **parts** a ref can read:

| part | from | yields |
|---|---|---|
| `text` | any | the node's text |
| `slate` | any | the node as a slate value (rich prose) |
| `src` / `alt` | `img` | the image url / alt |
| `title` | `img` / `a` | the title-string `![a](u "title")` / `[t](u "title")` |
| `link` | `a` / `img` | the object-browser widget `[{'@id': url}]` |
| `lang` / `text` | `pre` | the fence language / code |
| `meta` | `pre` | the fence info-string after the lang |
| `level` | `h1`–`h6` | the heading depth (for `tag="h${1/level}"`) |

Interpolation isn't invertible, so only the **emitter** runs it backwards and
checks the result reproduces the stored value (verify-on-emit); a value the
construct can't carry keeps a literal attribute instead of being silently
rewritten.

## Tags

| tag | meaning |
|---|---|
| bare prose / heading / list | a `blocks-matched` block (usually `slate`) — no wrapper |
| `<block type="X" …>` … `</block>` | an explicit block, or one carrying field overrides / a region |
| `<block type="X" … />` | tier-3 escape hatch: a raw block from its attributes (`data='{…}'` carries object fields) |
| `<region name="X" widget="blocks_layout\|object_list">` | an explicit region inside a container |
| `<fields … />` / `<fields …> … </fields>` | attach field values — see below |
| ` ```{literalinclude} path ` | reference a renderer file; the loader inlines its code, Sphinx renders it (one source, three consumers) |

## `<fields>` — attach field values to a scope

One tag, one rule: **`<fields>` sets field values on the blocks in its scope.**
The scope is chosen by form:

- **self-closing** `<fields align="left" />` — sets the fields on the **block it
  sits in** (the escape hatch for fields a block's clean markdown can't carry,
  e.g. `styles`, `data='{…}'`).
- **enclosing** `<fields slotId="rendering"> … blocks … </fields>` — sets the
  fields on **every block it wraps**, as *defaults*: a wrapped block's own field
  wins, and nested wrappers merge (outer fills whatever inner left unset).

The enclosing form is how repeated fields are **hoisted**. The exporter factors
fields shared across a run of blocks into nested wrappers automatically — fields
shared by *all* blocks become an outer wrapper, contiguous runs sharing a field
become inner wrappers — so this:

```markdown
<block type="codeExample" templateId="/templates/block-reference-layout" templateInstanceId="tpl-inst-x" slotId="schema"> … </block>
<block type="codeExample" templateId="/templates/block-reference-layout" templateInstanceId="tpl-inst-x" slotId="rendering"> … </block>
<block type="codeExample" templateId="/templates/block-reference-layout" templateInstanceId="tpl-inst-x" slotId="rendering"> … </block>
```

becomes:

```markdown
<fields templateId="/templates/block-reference-layout" templateInstanceId="tpl-inst-x">

<block type="codeExample" slotId="schema"> … </block>

<fields slotId="rendering">

<block type="codeExample"> … </block>
<block type="codeExample"> … </block>

</fields>

</fields>
```

Hoisting is verify-on-emit'd: the exporter only emits a wrapper when the whole
page still decodes back to the same blocks, else it keeps the flat form.

## Block uids

Block uids are a per-load internal identity — not a match key for tests (which
key on `@type` + page-UID) or for either deploy path (the distribution creates a
fresh site; the incremental sync matches pages by path and normalises block uids
out of its change hash). So the loader **mints** them on read
(`keyBlocks` with no `blocks-assignments`); only **content-object UIDs**
(page/folder/blob) must stay authored/stable.

## Why a schema-free document still needs the prototypes

`object_list` and `object_browser` are the same storage shape (`[{"@id": …}]`) —
`accordion.panels[0]` is a child block, `button.href[0]` is a link. No heuristic
tells them apart on real content, so the prototype (the `<region widget=…>`
declaration) carries that distinction in the document itself.

## Not all valid slate is expressible in markdown

Slate is the larger language: two adjacent `em` nodes with no gap, an emphasis
boundary mid-word — structures with no markdown spelling. The format does not
enumerate these (the list is unbounded; any omission is silent data loss).
Instead the **emitter checks its own work** — `slateToMd → mdToSlate → compare`;
prose that survives is written as markdown, prose that doesn't falls back to a
`data='{…}'` blob carrying the slate verbatim. Losslessness is a property of the
design, not a measured number.

## Content normalised to get here

`normalise-content.mjs` fixed genuine editing debris (worth fixing at source
regardless): `{"type":"a"}` link nodes where others use `"link"`, empty inline
`<em>`/`<strong>` nodes that serialise to stray asterisks, a trailing newline
inside a text leaf. These are data quirks, not format limits.

## Living format — not yet finalised

- **uid drop** — `keyBlocks` mints uids when `blocks-assignments` is absent; the
  exporter still emits the map until markdown is frozen as source (parity needs
  the old uids until we stop matching legacy JSON). See `CUTOVER-PLAN.md`.
- **one tree, two emitters** — the loader yields a content model; the
  distribution build and the incremental sync are two consumers of it.
