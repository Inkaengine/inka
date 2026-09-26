/**
 * Harvest deep-link anchors from a rendered DOM subtree.
 *
 * Each element carrying a linkable-anchor attribute contributes an anchor to its
 * NEAREST `[data-block-uid]` ancestor (so a container never absorbs a child
 * block's anchors). Elements without an `id` are skipped — there is no fragment
 * to link.
 *
 * Two ways to mark an element linkable, so the anchor list can carry HIERARCHY
 * (a heading level) without the frontend having to store it separately:
 *
 *   - `data-linkable-h1` … `data-linkable-h6="Label"` — a heading anchor AT that
 *     level. The suffix is the level; the value is the label.
 *   - `data-linkable-id="Label"` — a level-less anchor (a leaf: a figure, a
 *     defined term, an arbitrary target). `level` is `null`.
 *
 * Automatic fallback: a bare `data-linkable-id` on an element that is ITSELF an
 * `h1`–`h6` gets its level inferred from the tag — so a frontend that just tags
 * headings with `data-linkable-id` still yields a hierarchy for free. Precedence
 * is: explicit `data-linkable-h{n}` > element tag > none.
 *
 * @param {ParentNode} rootEl - element/document to scan
 * @returns {{ [blockUid: string]: Array<{id: string, name: string, level: (number|null)}> }}
 */
export function collectLinkableAnchors(rootEl) {
  const out = {};
  const els = rootEl.querySelectorAll(LINKABLE_SELECTOR);
  for (const el of els) {
    const id = el.getAttribute('id');
    if (!id) continue;
    // Skip anchors inside readonly/forced-template blocks: that content is owned
    // by the template (which carries its own anchors), and persisting
    // _linkableAnchors onto a template-fixed block corrupts slot-collapse on save.
    if (el.closest('[data-block-readonly]')) continue;
    const owner = el.closest('[data-block-uid]');
    if (!owner) continue;
    const anchor = readAnchor(el);
    if (!anchor) continue;
    const uid = owner.getAttribute('data-block-uid');
    (out[uid] ||= []).push({ id, name: anchor.name, level: anchor.level });
  }
  return out;
}

const HEADING_LEVEL = { H1: 1, H2: 2, H3: 3, H4: 4, H5: 5, H6: 6 };
const LINKABLE_SELECTOR =
  '[data-linkable-id],[data-linkable-h1],[data-linkable-h2],[data-linkable-h3],[data-linkable-h4],[data-linkable-h5],[data-linkable-h6]';

/**
 * Resolve an element's linkable label + level, or null if it carries no
 * linkable-anchor attribute. Explicit `data-linkable-h{n}` wins; otherwise the
 * label comes from `data-linkable-id` and the level is inferred from a heading
 * tag (null for a non-heading leaf).
 */
function readAnchor(el) {
  for (let level = 1; level <= 6; level += 1) {
    const name = el.getAttribute(`data-linkable-h${level}`);
    if (name !== null) return { name: withoutZeroWidth(name), level };
  }
  const name = el.getAttribute('data-linkable-id');
  if (name === null) return null;
  return { name: withoutZeroWidth(name), level: HEADING_LEVEL[el.tagName] ?? null };
}

/**
 * A label read from text can carry the zero-width spaces hydra gives an empty
 * leaf (\u200B, the caret target in the render data) and the caret keeps while
 * typing (\uFEFF). They are hydra's, not the author's, so not part of a name.
 */
function withoutZeroWidth(name) {
  return name.replace(/[\u200B\uFEFF]/g, '');
}

/**
 * Build a nested tree from a flat, document-ordered anchor list using each
 * anchor's `level`. A deeper-level anchor nests under the nearest preceding
 * shallower one (an `h3` after an `h2` becomes its child; a following `h2` pops
 * back up). Level-less anchors (`level == null`, the leaves) attach to the
 * current parent without opening a new depth. Anchors with no levels at all
 * therefore produce a flat list — the "hierarchy if specified, flat if not"
 * behaviour, worked out from the levels alone (no authored nesting).
 *
 * @param {Array<{id: string, name: string, level: (number|null)}>} anchors
 * @returns {Array<{id: string, name: string, level: (number|null), children: Array}>}
 */
export function buildAnchorTree(anchors) {
  const root = { children: [] };
  const stack = [{ level: 0, node: root }];
  for (const anchor of anchors || []) {
    const node = { ...anchor, children: [] };
    if (anchor.level == null) {
      // Leaf: attach to the current parent, don't open a new depth.
      stack[stack.length - 1].node.children.push(node);
      continue;
    }
    while (stack.length > 1 && stack[stack.length - 1].level >= anchor.level) {
      stack.pop();
    }
    stack[stack.length - 1].node.children.push(node);
    stack.push({ level: anchor.level, node });
  }
  return root.children;
}
