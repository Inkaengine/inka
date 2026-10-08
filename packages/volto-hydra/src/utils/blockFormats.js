/**
 * Block formats declared as DATA: `settings.slate.blockFormats`.
 *
 *   settings.slate.blockFormats = [
 *     { type: 'h2', label: 'Heading 2', icon: { viewBox: '0 0 24 24', paths: ['M…'] } },
 *     { type: 'h3', label: 'Heading 3', icon: { … } },
 *   ];
 *
 * The format dropdown otherwise takes its entries — name, icon, which exist at
 * all — from volto-slate's button components. A frontend's config reaches the
 * admin as data over postMessage, so it can say which formats a region allows
 * (`allowedStyles`) but not what they are called or how they look, and a
 * format with no component (h5, h6) cannot be offered at all. Declared here,
 * each entry is a format in its own right: the dropdown lists exactly these, in
 * this order, filtered by the region's `allowedStyles`.
 *
 * The icon is data — a viewBox and path outlines — drawn by the admin. It is
 * never markup from the frontend: the admin renders an icon's content as HTML,
 * and markup arriving from the iframe would be script running in the admin.
 */
import { Editor, Element, Transforms } from 'slate';

import { isStyleAllowed } from '../../../hydra-js/slateStyles.js';

const HEADING = /^h[1-6]$/;

const escapeAttr = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/** Icon data → the `{ attributes, content }` shape Volto's Icon component draws. */
export function iconOf(icon, type) {
  if (icon === undefined) return undefined;
  if (
    !icon ||
    typeof icon !== 'object' ||
    !Array.isArray(icon.paths) ||
    !icon.paths.length
  ) {
    throw new Error(
      `settings.slate.blockFormats: the icon for "${type}" needs { viewBox, paths: ['M…'] }`,
    );
  }
  return {
    attributes: {
      xmlns: 'http://www.w3.org/2000/svg',
      viewBox: String(icon.viewBox || '0 0 24 24'),
    },
    content: icon.paths.map((d) => `<path d="${escapeAttr(d)}"/>`).join(''),
  };
}

/**
 * The dropdown's entries for the declared formats, as button descriptors:
 * { name, format, title, icon, allowedChildren }. A heading keeps to the
 * headline children (`allowedHeadlineElements`), as volto-slate's own heading
 * buttons do.
 */
export function blockFormatButtons(
  formats,
  { slateRules, allowedHeadlineElements } = {},
) {
  return formats
    .map((f) => {
      if (!f || typeof f.type !== 'string' || !f.type) {
        throw new Error(
          'settings.slate.blockFormats: every entry needs a `type` (a slate element type)',
        );
      }
      if (typeof f.label !== 'string' || !f.label) {
        throw new Error(
          `settings.slate.blockFormats: "${f.type}" needs a \`label\``,
        );
      }
      return f;
    })
    .filter((f) => isStyleAllowed(f.type, slateRules))
    .map((f) => ({
      name: `format-${f.type}`,
      format: f.type,
      title: f.label,
      icon: iconOf(f.icon, f.type),
      allowedChildren: HEADING.test(f.type)
        ? allowedHeadlineElements
        : undefined,
    }));
}

/**
 * The paragraph styles (`styleMenu.blockStyles`) as format-dropdown entries:
 * { name, cssClass, type, title, icon }. A paragraph style is a KIND of
 * paragraph — chosen like a heading, one per block — so it belongs beside the
 * headings, not in the style menu with the text (inline) styles. `type` is the
 * element it makes: `p` unless the style says otherwise (`type: 'div'`).
 *
 * A style for one KIND of block declares the element types it is for instead:
 * `appliesTo: ['ul', 'ol']` for a list style. It keeps the block what it is
 * (a list stays a list) and is offered only where the cursor is in one of those
 * blocks (styleItemsFor).
 */
export function paragraphStyleItems(styleMenu, { slateRules } = {}) {
  return (styleMenu?.blockStyles || [])
    .filter(
      (d) =>
        isStyleAllowed(`.${d.cssClass}`, slateRules) &&
        isStyleAllowed(d.type || 'p', slateRules),
    )
    .map((d) => ({
      name: `style-${d.cssClass}`,
      cssClass: d.cssClass,
      type: d.type || 'p',
      appliesTo: d.appliesTo,
      title: d.label || d.cssClass,
      icon: iconOf(d.icon, d.cssClass),
    }));
}

/**
 * The style entries to offer on a block of type `blockType`: every style that
 * makes its own kind of block, and those declared for this type (`appliesTo`).
 */
export function styleItemsFor(items, blockType) {
  return items.filter((i) => !i.appliesTo || i.appliesTo.includes(blockType));
}

/** The type of the highest block at the cursor, or undefined with no selection. */
export function blockTypeAtCursor(editor) {
  const [first] = [...selectedBlocks(editor)];
  return first?.[0]?.type;
}

/** The highest blocks the selection is in — a cursor is enough. */
function* selectedBlocks(editor) {
  yield* Editor.nodes(editor, {
    mode: 'highest',
    match: (n) => Element.isElement(n) && Editor.isBlock(editor, n),
  });
}

/** Set a block's style classes, removing the key when there are none. */
function setClasses(editor, path, classes) {
  if (classes.length) {
    Transforms.setNodes(editor, { styleName: classes.join(' ') }, { at: path });
  } else {
    Transforms.unsetNodes(editor, 'styleName', { at: path });
  }
}

/**
 * Make the block(s) at the cursor `item.type` with paragraph style
 * `item.cssClass`, replacing any other paragraph style (`allClasses`) and
 * keeping classes that are not paragraph styles.
 */
export function applyParagraphStyle(editor, item, allClasses) {
  for (const [node, path] of [...selectedBlocks(editor)]) {
    // A style for one kind of block styles only those, and leaves them that kind.
    if (item.appliesTo && !item.appliesTo.includes(node.type)) continue;
    const keep = (node.styleName || '')
      .split(/\s+/)
      .filter((c) => c && !allClasses.includes(c));
    if (!item.appliesTo && node.type !== item.type)
      Transforms.setNodes(editor, { type: item.type }, { at: path });
    setClasses(editor, path, [...keep, item.cssClass]);
  }
}

/** Remove paragraph styles from the block(s) at the cursor: a heading or plain paragraph was chosen. */
export function clearParagraphStyles(editor, allClasses) {
  for (const [node, path] of [...selectedBlocks(editor)]) {
    const classes = (node.styleName || '').split(/\s+/).filter(Boolean);
    const keep = classes.filter((c) => !allClasses.includes(c));
    if (keep.length !== classes.length) setClasses(editor, path, keep);
  }
}
