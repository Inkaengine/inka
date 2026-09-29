/**
 * The canonical readability rules for the markdown export — one place, so a
 * whole-site simplification is a single source of truth. The caller
 * (`export-distribution.mjs --markdown`) passes these to
 * `/@export?format=markdown`; the endpoint owns the whole-file assembly.
 *
 * `matched` prototypes auto-match from bare markdown (source order is the
 * cascade — the catch-all `slate` first, more specific same-specificity rules
 * after). `tagged` prototypes only match inside their own `<block type>` tag
 * (button/teaser overlap common patterns; containers need their tag).
 */
const MATCHED = [
  '<block type="slate" value="${p,h*,ul,ol,blockquote,strong,em,a/slate}" plaintext="${p,h*,ul,ol,blockquote,strong,em,a/text}" />',
  '<block type="title" _="${h1}" />',
  '<block type="separator" _="${hr}" styles={"align":"full"} />',
  // One image form: the caption paragraph is an optional NODE (`${p?/text}`), so
  // this matches an image with OR without a caption -- no second prototype needed.
  '<block type="image" description="${p?/text}" url="${img/src}" alt="${img?/alt}" title="${img?/title}" align="center" size="l" />',
  [
    '<block type="codeExample">',
    '  <region name="tabs" widget="object_list" idField="@id" typeField="@type">',
    '    <block type="tab" label="${h3/text}" language="${pre/lang}" code="${pre/text}" />',
    '  </region>',
    '</block>',
  ].join('\n'),
];

const TAGGED = [
  '<block type="button" title="${a/text}" href="${a/link}" />',
  // Maps: fundamentally a link (an embed URL). Emitting it as `[title](url)`
  // keeps the (long) URL in link syntax — no data-json blob, no attr-length
  // limit — with `align` etc. as tag attributes.
  '<block type="maps" title="${a/text}" url="${a/href}" />',
  // Callout (admonition): a `variation` attr + a body region of child blocks —
  // so it emits `<block type="callout" variation="note"> …markdown… </block>`
  // instead of a data-json blob.
  [
    '<block type="callout">',
    '  <region name="items" widget="blocks_layout">',
    '    <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em,a/slate}" plaintext="${p,h*,ul,ol,blockquote,strong,em,a/text}" />',
    '  </region>',
    '</block>',
  ].join('\n'),
  // Standalone (always tagged): a teaser needn't have a title or link, so the
  // linked heading is optional too. Not in the grid below, where cards are bare
  // and an optional heading would let any paragraph read as a teaser.
  '<block type="teaser" title="${h?/text}" head_title="${strong?/text}" href="${h?/link}" description="${p?/text}" />',
  '<block type="introduction" value="${p,h*/slate}" />',
  [
    '<block type="slateTable">',
    '  <region name="table.rows" idField="key">',
    '    <block type="row" _="${tr}">',
    '      <region name="cells" idField="key" typeField="type">',
    '        <block type="header" value="${th/slate}" />',
    '        <block type="data" value="${td/slate}" />',
    '      </region>',
    '    </block>',
    '  </region>',
    '</block>',
  ].join('\n'),
  [
    '<block type="gridBlock" headline="${h/text}">',
    '  <region name="items" widget="blocks_layout">',
    '    <block type="teaser" title="${h/text}" head_title="${strong?/text}" href="${h/link}" description="${p?/text}" />',
    '  </region>',
    '</block>',
  ].join('\n'),
  [
    '<block type="accordion" right_arrows=true>',
    '  <region name="panels" widget="object_list" idField="@id" typeField="@type">',
    '    <block type="panel" title="${h/text}" />',
    '  </region>',
    '</block>',
  ].join('\n'),
  [
    '<block type="slider">',
    '  <region name="slides" widget="object_list" idField="@id" typeField="@type">',
    '    <block type="slide" title="${h/text}" head_title="${strong?/text}" description="${p/text}" buttonText="${a?/text}" href="${a?/link}" preview_image="${img/link}" />',
    '  </region>',
    '</block>',
  ].join('\n'),
  // A highlight: its rich description, then a paragraph holding the call-to-action link.
  '<block type="highlight" description="${p/slate}" cta_link="${a?/link}" />',
  '<block type="cookieConsent" message="${p,ul,ol/slate}" />',
  // A section nav: each item a `[label](url)` paragraph.
  [
    '<block type="contextNavigation">',
    '  <region name="items" widget="blocks_layout">',
    '    <block type="navItem" label="${a/text}" href="${a/link}" />',
    '  </region>',
    '</block>',
  ].join('\n'),
  '<block type="hero" heading="${h1/text}" subheading="${strong?/text}" description="${p?/slate}" buttonText="${a?/text}" buttonLink="${a?/link}" image="${img?/src}" />',
  [
    '<block type="columns">',
    '  <region name="columns" widget="blocks_layout">',
    '    <block type="column">',
    '      <region name="items" widget="blocks_layout" />',
    '    </block>',
    '  </region>',
    '</block>',
  ].join('\n'),
];

export const DEFAULT_PROTOTYPES = {
  matched: MATCHED.join('\n'),
  tagged: TAGGED.join('\n'),
};
