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
  '<block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />',
  '<block type="title" _="${h1}" />',
  '<block type="separator" _="${hr}" styles={"align":"full"} />',
  // Two image forms: with a caption paragraph, and without.
  '<block type="image" description="${p?/text}" url="${img/src}" alt="${img?/alt}" title="${img?/title}" align="center" size="l" />',
  '<block type="image" url="${img/src}" alt="${img?/alt}" title="${img?/title}" align="center" size="l" />',
  [
    '<block type="codeExample">',
    '  <region name="tabs" widget="object_list">',
    '    <block type="tab" label="${h3/text}" language="${pre/lang}" code="${pre/text}" />',
    '  </region>',
    '</block>',
  ].join('\n'),
];

const TAGGED = [
  '<block type="button" title="${p/text}" href="${p/link}" />',
  // Maps: fundamentally a link (an embed URL). Emitting it as `[title](url)`
  // keeps the (long) URL in link syntax — no data-json blob, no attr-length
  // limit — with `align` etc. as tag attributes.
  '<block type="maps" title="${p/text}" url="${p/href}" />',
  // Callout (admonition): a `variation` attr + a body region of child blocks —
  // so it emits `<block type="callout" variation="note"> …markdown… </block>`
  // instead of a data-json blob.
  [
    '<block type="callout">',
    '  <region name="items" widget="blocks_layout">',
    '    <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />',
    '  </region>',
    '</block>',
  ].join('\n'),
  '<block type="teaser" title="${h/text}" href="${h/link}" description="${p/text}" />',
  [
    '<block type="slateTable">',
    '  <region name="table.rows">',
    '    <block type="row">',
    '      <region name="cells">',
    '        <block type="cell" value="${td/slate}" />',
    '      </region>',
    '    </block>',
    '  </region>',
    '</block>',
  ].join('\n'),
  [
    '<block type="gridBlock" headline="${h/text}">',
    '  <region name="items" widget="blocks_layout">',
    '    <block type="teaser" title="${h/text}" description="${p/text}" />',
    '  </region>',
    '</block>',
  ].join('\n'),
  [
    '<block type="accordion" right_arrows=true>',
    '  <region name="panels" widget="object_list">',
    '    <block type="panel" title="${h/text}" />',
    '  </region>',
    '</block>',
  ].join('\n'),
  [
    '<block type="slider">',
    '  <region name="slides" widget="object_list">',
    '    <block type="slide" title="${h/text}" head_title="${strong?/text}" description="${p/text}" buttonText="${p[2]/text}" href="${p[2]/link}" preview_image="${img/link}" />',
    '  </region>',
    '</block>',
  ].join('\n'),
  '<block type="hero" heading="${h1/text}" subheading="${strong/text}" description="${em/richtext}" buttonText="${p/text}" buttonLink="${p/link}" />',
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
