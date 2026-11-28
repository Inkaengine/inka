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
  '<block is="slate" value="${p,h*,ul,ol,blockquote,strong,em,a/slate}" />',
  '<block is="title" _="${h1}" />',
  '<block is="separator" _="${hr}" :styles=\'{"align":"full"}\' />',
  // One image form: the caption paragraph is an optional NODE (`${p?/textarea}`), so
  // this matches an image with OR without a caption -- no second prototype needed.
  '<block is="image" description="${p?/textarea}" url="${img/src}" alt="${img?/alt}" title="${img?/title}" align="center" size="l" />',
  [
    '<block is="codeExample">',
    '  <region name="tabs" widget="object_list" idField="@id" typeField="@type">',
    '    <block is="tab" label="${h3/text}" language="${pre/lang}" code="${pre/textarea}" />',
    '  </region>',
    '</block>',
  ].join('\n'),
];

const TAGGED = [
  '<block is="button" title="${a/text}" href="${a/link}" />',
  // Maps: fundamentally a link (an embed URL). Emitting it as `[title](url)`
  // keeps the (long) URL in link syntax — no data-json blob, no attr-length
  // limit — with `align` etc. as tag attributes.
  '<block is="maps" title="${a/text}" url="${a/link}" />',
  // Video: also a link, its preview an image -- each a link list, `[{'@id'}]`.
  '<block is="video" url="${a/link}" preview_image="${img?/link}" />',
  // Callout (admonition): a `variation` attr + a body region of child blocks —
  // so it emits `<block is="callout" variation="note"> …markdown… </block>`
  // instead of a data-json blob.
  [
    '<block is="callout">',
    '  <region name="items" widget="blocks_layout">',
    '    <block is="slate" value="${p,h*,ul,ol,blockquote,strong,em,a/slate}" />',
    '  </region>',
    '</block>',
  ].join('\n'),
  // Standalone (always tagged): a teaser needn't have a title or link, so the
  // linked heading is optional too. Not in the grid below, where cards are bare
  // and an optional heading would let any paragraph read as a teaser.
  '<block is="teaser" title="${h?/text}" head_title="${strong?/text}" href="${h?/link}" description="${p?/textarea}" />',
  '<block is="introduction" value="${p,h*/slate}" />',
  [
    '<block is="slateTable">',
    '  <region name="table.rows" idField="key">',
    '    <block is="row" _="${tr}">',
    '      <region name="cells" idField="key" typeField="type">',
    '        <block is="header" value="${th/slate}" />',
    '        <block is="data" value="${td/slate}" />',
    '      </region>',
    '    </block>',
    '  </region>',
    '</block>',
  ].join('\n'),
  [
    '<block is="gridBlock" headline="${h/text}">',
    '  <region name="items" widget="blocks_layout">',
    '    <block is="teaser" title="${h/text}" head_title="${strong?/text}" href="${h/link}" description="${p?/textarea}" />',
    '  </region>',
    '</block>',
  ].join('\n'),
  [
    '<block is="accordion" right_arrows>',
    '  <region name="panels" widget="object_list" idField="@id" typeField="@type">',
    '    <block is="panel" title="${h/text}" />',
    '  </region>',
    '</block>',
  ].join('\n'),
  [
    '<block is="slider">',
    '  <region name="slides" widget="object_list" idField="@id" typeField="@type">',
    '    <block is="slide" title="${h/text}" head_title="${strong?/text}" description="${p/textarea}" buttonText="${a?/text}" href="${a?/link}" preview_image="${img/link}" />',
    '  </region>',
    '</block>',
  ].join('\n'),
  // A highlight: its rich description, then a paragraph holding the call-to-action link.
  '<block is="highlight" description="${p/slate}" cta_link="${a?/link}" />',
  '<block is="cookieConsent" message="${p,ul,ol/slate}" />',
  // A section nav: each item a `[label](url)` paragraph.
  [
    '<block is="contextNavigation">',
    '  <region name="items" widget="blocks_layout">',
    '    <block is="navItem" label="${a/text}" href="${a/link}" />',
    '  </region>',
    '</block>',
  ].join('\n'),
  '<block is="hero" heading="${h1/text}" subheading="${strong?/textarea}" description="${p?/slate}" buttonText="${a?/text}" buttonLink="${a?/link}" image="${img?/src}" />',
  [
    '<block is="columns">',
    '  <region name="columns" widget="blocks_layout">',
    '    <block is="column">',
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
