/**
 * What the MCP would tell an agent: one description per format (how to write a
 * page) and one block catalogue generated from the registered schemas (what
 * blocks exist and their fields). The catalogue is the same for every format,
 * so only the format varies between arms.
 */

/** Compact field description from a schema property. */
function fieldLine(name, f) {
  const bits = [];
  if (f.widget) bits.push(`widget ${f.widget}`);
  else if (f.type) bits.push(f.type);
  if (f.choices) bits.push(`one of ${f.choices.map((c) => JSON.stringify(c[0])).join(', ')}`);
  if (f.default !== undefined) bits.push(`default ${JSON.stringify(f.default)}`);
  if (f.allowedBlocks) bits.push(`children: ${f.allowedBlocks.join(', ')}`);
  return `${name}${f.title ? ` (${f.title})` : ''}: ${bits.join('; ') || 'string'}`;
}

export function catalogue(blocksConfig, types) {
  const out = [];
  for (const type of types) {
    const c = blocksConfig[type];
    if (!c) continue;
    const props = c.blockSchema?.properties ?? {};
    const lines = [`### ${type} — ${c.title ?? type}`];
    if (c.variations?.length) lines.push(`variation: one of ${c.variations.map((v) => JSON.stringify(v.id)).join(', ')}`);
    for (const [k, f] of Object.entries(props)) {
      lines.push(`- ${fieldLine(k, f)}`);
      for (const [sk, sf] of Object.entries(f?.schema?.properties ?? {})) lines.push(`  - item.${fieldLine(sk, sf)}`);
    }
    out.push(lines.join('\n'));
  }
  return out.join('\n\n');
}

const LINK = 'A link field (widget object_browser / url) holds `[{"@id": "/path"}]`.';

export const FORMATS = {
  blockmd: (ctx) => `## Page format: blockmd

The page is markdown. Plain markdown (paragraphs, headings, lists, tables, images)
becomes text blocks. Other blocks are written as tags:

    <block type="TYPE" field="value" other=true />

Which markdown maps to which block, and which attributes a tag takes, is defined
by the page's prototype rules below. In a rule, \`\${p,h*/slate}\` means "this field
is rich text taken from these markdown elements", \`\${/text}\` plain text,
\`\${/link}\` a link, and \`<region name="…">\` holds child blocks written inside the
tag. Any block can instead be written with all its fields as JSON:

    <block type="TYPE" data-json='{"field": "value"}' />

${ctx.prototypes ? `### This page's prototype rules\n\n${ctx.prototypes}` : '(This page has no prototype rules; use data-json for every non-text block.)'}`,

  tagged: () => `## Page format: markdown with JSON blocks

Text is plain markdown; each paragraph, heading or list becomes a text block.
Every other block is a tag holding its fields as one JSON object:

    <block type="teaser">{"title": "About us", "href": [{"@id": "/about"}]}</block>

- Fields the schema marks \`widget slate\` (rich text) are markdown strings.
  Rich text elsewhere (e.g. table cells) is written {"md": "markdown"}.
- A block's child blocks go inside the tag after the JSON, written the same way
  (markdown or nested tags). If the children live in a field other than
  \`blocks\`, wrap them: <region name="FIELD">…</region>.
- A list field whose items hold blocks (e.g. accordion panels) is a region of
  items: <region name="panels"><item>{"title": "…"}…child blocks…</item></region>
- ${LINK}
- Don't indent nested content.`,

  simple: () => `## Page format: JSON block list

The page is a JSON array of blocks, in order:

    [{"@type": "slate", "value": {"md": "Some **markdown**"}},
     {"@type": "teaser", "title": "About us", "href": [{"@id": "/about"}]}]

- Every block has "@type" plus its fields.
- Rich text (fields with widget slate, and rich text anywhere else) is {"md": "markdown"}.
- A block's child blocks are an array under "blocks" (or under the field named by
  its schema); list items that hold blocks have their own "blocks" array.
- ${LINK}`,

  stored: () => `## Page format: Volto block JSON

The page is {"blocks": {UID: block, …}, "blocks_layout": {"items": [UID, …]}}.
- "blocks" maps a unique id to each block; "blocks_layout.items" is their order.
  New blocks need a new unique id in both.
- Text blocks are {"@type": "slate", "value": SLATE, "plaintext": "…"} where SLATE is
  a list of nodes like {"type": "p", "children": [{"text": "Hi "}, {"text": "bold", "bold": true}]}
  (types p, h2, h3, ul/ol with li, link nodes {"type": "link", "data": {"url": …}}).
- Rich-text fields elsewhere are SLATE values too.
- Container blocks hold children the same way: their own "blocks" and "blocks_layout".
- ${LINK}`,

  ops: () => `## Page format: JSON block list with ids, edited by operations

The page is a JSON array of blocks, in order. Every block has an "@uid".
- Rich text (fields with widget slate, and rich text anywhere else) is {"md": "markdown"};
  for a field the schema marks widget slate you may also give a plain markdown string.
- A block's child blocks are an array under "blocks" (or under the field named by
  its schema); list items that hold blocks have their own "blocks" array.
- ${LINK}

Do NOT return the page. Return a JSON array of operations, applied in order:

    {"op": "update", "id": "b3", "set": {"field": value}}       // replaces those fields
    {"op": "add", "after": "b3", "blocks": [{"@type": "…", …}, …]}   // or "before": "b3"; inserted in the order given
    {"op": "add", "into": {"id": "b5", "field": "blocks"}, "blocks": [{…}]}  // appends to a list field
    {"op": "move", "id": "b7", "after": "b2"}                    // or "before" / "into"
    {"op": "delete", "id": "b7"}

New blocks don't need an "@uid"; give one (e.g. "new1") only if a later operation
refers to the new block. "into" a list of items (e.g. accordion "panels") appends
the given objects as items.`,
};
