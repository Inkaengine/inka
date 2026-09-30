/**
 * Inka's own block prototypes: the default set export-proto.mjs emits with.
 *
 * A site brings its own set with `--protos <file>`: a module whose default
 * export has this shape. `matched` prototypes are auto-matched from bare
 * markdown (source order is the cascade, so a more specific one comes after the
 * one it refines); `tagged` ones need their `<block>` tag. A type in neither
 * falls to a tier-3 data tag, never lost.
 */
const PROTO_TEXT = {
  // slate is the catch-all; more specific same-specificity prototypes (title on an
  // h1) are declared AFTER it so they win the CSS cascade tie.
  slate: '<block type="slate" value="${p,h*,ul,ol,blockquote,strong,em,a/slate}" plaintext="${p,h*,ul,ol,blockquote,strong,em,a/text}" />',
  title: '<block type="title" _="${h1}" />',
  // `align: full` is the default separator style (34 of 56); declaring it here
  // makes those emit as a bare `---` and be restored on decode, while left/center
  // /background variants keep their explicit `<fields>`.
  separator: '<block type="separator" _="${hr}" styles={"align":"full"} />',
  button: '<block type="button" title="${a/text}" href="${a/link}" />',
  // href is @id-only (the heading's link); the teaser's rendered title/
  // description/hasPreviewImage are RESOLVED from the target by the mount, not
  // stored redundantly here. block.title (the heading text) is the teaser's own
  // override, shown only when overwrite is on.
  teaser: '<block type="teaser" title="${h/text}" href="${h/link}" description="${p/text}" />',
  // title comes from the markdown image's title-string (`![alt](url "title")`),
  // not a fixed default -- real image titles vary. align/size keep their
  // defaults; image_field (when present) spills to <fields>.
  image: [
    '<block type="image" description="${p?/text}" url="${img/src}" alt="${img?/alt}" title="${img?/title}" align="center" size="l" />',
    '<block type="image" url="${img/src}" alt="${img?/alt}" title="${img?/title}" align="center" size="l" />',
  ].join('\n'),
  slateTable: [
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
  codeExample: [
    '<block type="codeExample">',
    '  <region name="tabs" widget="object_list" idField="@id" typeField="@type">',
    '    <block type="tab" label="${h3/text}" language="${pre/lang}" code="${pre/text}" />',
    '  </region>',
    '</block>',
  ].join('\n'),
  gridBlock: [
    '<block type="gridBlock" headline="${h/text}">',
    '  <region name="items" widget="blocks_layout">',
    '    <block type="teaser" title="${h/text}" description="${p/text}" />',
    '  </region>',
    '</block>',
  ].join('\n'),
  accordion: [
    '<block type="accordion" right_arrows=true>',
    '  <region name="panels" widget="object_list" idField="@id" typeField="@type">',
    '    <block type="panel" title="${h/text}" />',
    '  </region>',
    '</block>',
  ].join('\n'),
  // A slide is a teaser-shaped card: heading (title) + paragraph (description) +
  // image (preview_image, object-browser @id) + a button link (buttonText/href);
  // head_title/flagAlign the card can't carry spill into a per-slide <fields>.
  slider: [
    '<block type="slider">',
    '  <region name="slides" widget="object_list" idField="@id" typeField="@type">',
    '    <block type="slide" title="${h/text}" head_title="${strong?/text}" description="${p/text}" buttonText="${p[2]/text}" href="${p[2]/link}" preview_image="${img/link}" />',
    '  </region>',
    '</block>',
  ].join('\n'),
  // A hero: h1 heading, a bold subheading, an italic (slate) description, and a
  // button link — captured positionally, the italic description only in this run.
  hero: '<block type="hero" heading="${h1/text}" subheading="${strong/text}" description="${em/richtext}" buttonText="${p/text}" buttonLink="${p/link}" />',
  // A columns block: a blocks_layout container whose region key is `columns`
  // (region name = layout key), each column a nested blocks_layout container
  // ordered under `items`. Its children are whatever bare markdown matches
  // (slates), so the region item proto is empty. Doubly nested — proves the
  // container path handles container-in-container.
  columns: [
    '<block type="columns">',
    '  <region name="columns" widget="blocks_layout">',
    '    <block type="column">',
    '      <region name="items" widget="blocks_layout" />',
    '    </block>',
    '  </region>',
    '</block>',
  ].join('\n'),
};
// Only these leaves auto-match; button/teaser overlap common patterns and
// containers need their tag (until greedy container matching lands).
const MATCHED = ['slate', 'title', 'separator', 'image', 'codeExample'];

const pick = (keep) => Object.fromEntries(
  Object.entries(PROTO_TEXT).filter(([t]) => MATCHED.includes(t) === keep),
);

export default { matched: pick(true), tagged: pick(false) };
