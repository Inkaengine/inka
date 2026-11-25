/**
 * The information in a slate value, and a block copy without one piece of it.
 *
 * Every piece of a slate value has to change what the frontend draws: a key the
 * frontend never reads is information an author (or a conversion) stored that
 * nobody sees — `bold: true` on text, for a frontend that draws bold only from a
 * `strong` element. Block sanity draws a copy of the block with the piece removed
 * beside the original; if the two draw the same, the piece is unused.
 *
 * Pure, so discovery (which picks an example of each kind) and the sanity suite
 * (which draws the copies) read content the same way.
 */

// Not information for this check: the tree itself, the words, the element's
// style (the text-style check measures `type`, `styleName` and `style-*` by how
// they look), and the bridge's own bookkeeping, added while editing.
const ELEMENT_KEYS = new Set(['type', 'children', 'styleName', 'nodeId']);
const TEXT_KEYS = new Set(['text', 'nodeId']);

const isElement = (n) => !!n && typeof n === 'object' && typeof n.type === 'string' && Array.isArray(n.children);
const isText = (n) => !!n && typeof n === 'object' && typeof n.text === 'string' && !('type' in n);
const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** Every value inside `value`, as a key path to it: objects are opened, anything else is one value. */
function valuePaths(value, prefix) {
  if (!isPlainObject(value) || Object.keys(value).length === 0) return [prefix];
  return Object.entries(value).flatMap(([k, v]) => valuePaths(v, [...prefix, k]));
}

function plainText(node) {
  if (isText(node)) return node.text;
  return isElement(node) ? node.children.map(plainText).join('') : '';
}

/**
 * Each kind of information in a slate value, with the first place it appears.
 * A kind is named like a CSS attribute selector: `[bold]` on text,
 * `link[data.url]` on an element. A value that isn't slate (a list of items, of
 * words) holds none.
 *
 * @returns {Map<string, { nodePath: number[], keyPath: string[], text: string }>}
 */
export function slateInformation(value) {
  const out = new Map();
  if (!Array.isArray(value) || !value.length || !value.every(isElement)) return out;
  const walk = (node, nodePath) => {
    const own = isText(node) ? TEXT_KEYS : ELEMENT_KEYS;
    const owner = isText(node) ? '' : node.type;
    for (const [key, v] of Object.entries(node)) {
      if (own.has(key) || key.startsWith('style-')) continue;
      for (const keyPath of valuePaths(v, [key])) {
        const kind = `${owner}[${keyPath.join('.')}]`;
        if (!out.has(kind)) out.set(kind, { nodePath, keyPath, text: plainText(node) });
      }
    }
    if (isElement(node)) node.children.forEach((child, i) => walk(child, [...nodePath, i]));
  };
  value.forEach((node, i) => walk(node, [i]));
  return out;
}

const getAt = (obj, path) => path.reduce((o, k) => o?.[k], obj);

/**
 * The page with a copy of block `blockId` right after it, the copy missing one
 * piece of its slate information (`piece`: the field, the node and the key
 * path; null copies it whole). The copy and every block or item inside it get
 * new ids (`<id>~<suffix>`), so no id is on the page twice.
 *
 * @param formData - the page as the editor holds it
 * @param pathMap - the editor's block map (buildBlockPathMap): where each block and item is stored
 * @returns {{ formData: object, copyId: string }}
 */
export function probeCopy(formData, pathMap, blockId, piece, suffix) {
  const entry = pathMap[blockId];
  if (!entry?.path) throw new Error(`probeCopy: ${blockId} is not a stored block`);
  const out = structuredClone(formData);
  const original = getAt(out, entry.path);

  // The copy's ids: the block's own and those of everything stored inside it.
  const inside = Object.entries(pathMap)
    .filter(([id, e]) => e?.path && e.path.length >= entry.path.length && entry.path.every((k, i) => e.path[i] === k))
    .map(([id]) => id);
  let json = JSON.stringify(original);
  for (const id of inside) json = json.split(JSON.stringify(id)).join(JSON.stringify(`${id}~${suffix}`));
  const copy = JSON.parse(json);
  const copyId = `${blockId}~${suffix}`;

  if (piece) {
    const [top, ...rest] = piece.nodePath;
    const node = rest.reduce((n, i) => n?.children?.[i], copy[piece.field]?.[top]);
    if (!node) throw new Error(`probeCopy: ${blockId} has no node ${piece.nodePath.join('.')} in ${piece.field}`);
    const holder = getAt(node, piece.keyPath.slice(0, -1));
    const key = piece.keyPath[piece.keyPath.length - 1];
    if (!holder || !(key in holder)) throw new Error(`probeCopy: ${blockId} has no ${piece.keyPath.join('.')} there`);
    delete holder[key];
  }

  const container = getAt(out, entry.path.slice(0, -1));
  if (entry.isObjectListItem) {
    container.splice(entry.path[entry.path.length - 1] + 1, 0, copy);
  } else {
    // A block lives in its container's `blocks`, in the order of the layout
    // beside it (`blocks_layout[region]`).
    const holder = getAt(out, entry.path.slice(0, -2));
    const order = holder.blocks_layout?.[entry.region];
    if (!Array.isArray(order)) throw new Error(`probeCopy: ${blockId}'s container has no ${entry.region} order`);
    container[copyId] = copy;
    order.splice(order.indexOf(blockId) + 1, 0, copyId);
  }
  return { formData: out, copyId };
}

// This test's records, drained (and cleared) by the spec's afterEach, which
// attaches them; the coverage reporter merges every worker's.
const pending = [];

/** Record whether one example drew differently without a kind of information. */
export function recordInformationUse(kind, { blockType, pagePath }, used) {
  pending.push({ kind, blockType, pagePath, used });
}

/** Return this test's records and clear them, for the spec to attach. */
export function drainInformationCoverage() {
  return pending.splice(0, pending.length);
}

/**
 * The kinds of slate information no example drew differently without: stored,
 * and never seen. One example that uses a kind is enough; a kind can matter in
 * one place and not another (a link's file size, drawn only for files).
 */
export function informationNeverUsed(records) {
  const used = new Set(records.filter((r) => r.used).map((r) => r.kind));
  const firstSeen = new Map();
  for (const r of records) if (!firstSeen.has(r.kind)) firstSeen.set(r.kind, r);
  return [...firstSeen.values()]
    .filter((r) => !used.has(r.kind))
    .map(({ kind, blockType, pagePath }) => ({ kind, blockType, pagePath }));
}
