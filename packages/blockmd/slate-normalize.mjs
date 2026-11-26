/**
 * Collapse a multi-node slate value into a single top-level node.
 *
 * The sanity invariant is that a slate field holds exactly ONE top-level node
 * (and no hard newlines inside a text leaf). Content that violates it — a grid
 * cell or table cell that packed a heading + paragraph into one slate — can't be
 * split into sibling blocks (that would add grid/table cells and break layout),
 * so instead we MERGE: every top-level node's inline content is concatenated into
 * a single `p`, heading text kept as a bold lead, list items inlined, and hard
 * newlines turned into spaces. Inline marks (strong/em/link/code) are preserved.
 *
 * Idempotent: a value that is already a single node with no newlines is returned
 * unchanged (deep-equal), so applying this across a tree only rewrites the
 * offenders.
 */

const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const BLOCK_TYPES = new Set(['p', 'blockquote', 'ul', 'ol', 'li', ...HEADINGS]);

const isText = (n) => n && typeof n === 'object' && typeof n.text === 'string';
const isBlock = (n) => n && typeof n === 'object' && typeof n.type === 'string' && BLOCK_TYPES.has(n.type);

/** Deep clone a node, replacing hard newlines in every text leaf with a space. */
function cleanNode(node) {
  if (isText(node)) return { ...node, text: node.text.replace(/\s*\n+\s*/g, ' ') };
  if (Array.isArray(node.children)) return { ...node, children: node.children.map(cleanNode) };
  return { ...node };
}

/** Flatten one node to a list of inline children (text + inline marks). */
function nodeToInline(node) {
  if (isText(node)) return [cleanNode(node)];
  const t = node.type;
  if (HEADINGS.has(t)) return [{ type: 'strong', children: flattenInline(node.children || []) }];
  if (t === 'p' || t === 'li' || t === 'blockquote' || t === 'ul' || t === 'ol') {
    return flattenInline(node.children || []);
  }
  // an inline mark (strong, em, link, code, sub, sup, …) — keep as a unit
  return [cleanNode(node)];
}

/** Flatten a node's children, inserting a single space only between block-level
 *  siblings (list items, nested paragraphs); inline siblings keep their own spacing. */
function flattenInline(children) {
  const out = [];
  for (const child of children) {
    const inline = nodeToInline(child);
    if (isBlock(child) && out.length && inline.length) out.push({ text: ' ' });
    out.push(...inline);
  }
  return out;
}

/** The concatenated text of a node and its descendants. */
function textContent(node) {
  if (isText(node)) return node.text;
  if (Array.isArray(node.children)) return node.children.map(textContent).join('');
  return '';
}

function mergeAdjacentText(nodes) {
  const out = [];
  for (const c of nodes) {
    const last = out[out.length - 1];
    if (isText(c) && last && isText(last)) out[out.length - 1] = { ...last, text: last.text + c.text };
    else out.push(c);
  }
  return out;
}

/** Drop empty leaves and hollow wrappers (e.g. an empty heading became strong("")),
 *  merge adjacent text, collapse space runs, and trim the outer ends. */
function finalizeInline(children) {
  let nodes = children.filter((c) => textContent(c) !== '');
  nodes = mergeAdjacentText(nodes);
  nodes = nodes.map((c) => (isText(c) ? { ...c, text: c.text.replace(/[ \t]{2,}/g, ' ') } : c));
  if (nodes.length && isText(nodes[0])) nodes[0] = { ...nodes[0], text: nodes[0].text.replace(/^ +/, '') };
  const li = nodes.length - 1;
  if (nodes.length && isText(nodes[li])) nodes[li] = { ...nodes[li], text: nodes[li].text.replace(/ +$/, '') };
  nodes = nodes.filter((c) => !(isText(c) && c.text === ''));
  return nodes.length ? nodes : [{ text: '' }];
}

export function normalizeSlateValue(value) {
  if (!Array.isArray(value) || value.length === 0) return value;
  if (value.length === 1) return [cleanNode(value[0])];
  const parts = value.map(nodeToInline);
  const out = [];
  for (const part of parts) {
    if (part.length === 0) continue;
    if (out.length) out.push({ text: ' ' });
    out.push(...part);
  }
  return [{ type: 'p', children: finalizeInline(out) }];
}
