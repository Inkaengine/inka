/**
 * Slate Transforms Utility
 *
 * This module provides utilities for applying Slate transformations to block content.
 * It replaces the old DOM manipulation approach with proper Slate transforms that
 * understand the document structure and prevent text loss when formatting across nodes.
 *
 * Related: GitHub Issue #147 - formatting can result in removing text in slate
 */

import {
  Editor,
  Transforms,
  Element,
  Text,
  Path,
  Range,
  Node as SlateNode,
} from 'slate';
import { jsx } from 'slate-hyperscript';
import { makeEditor } from '@plone/volto-slate/utils';
import { splitEditorInTwoFragments } from '@plone/volto-slate/utils/ops';
import config from '@plone/volto/registry';
// Pure merge lives in a dep-free module (so blockPath.js can use it without these
// Volto-only imports); re-exported here for back-compat.
import { mergeBlockValues } from './slateMerge.js';
export { mergeBlockValues };

// Inline formatting element types that should be removed when empty
const INLINE_FORMAT_TYPES = ['strong', 'em', 'del', 'sub', 'sup'];

/**
 * Editor extension that removes empty inline formatting elements (strong, em, etc.)
 * Similar to how volto-slate's withSimpleLink removes empty links.
 *
 * @param {Object} editor - Slate editor instance
 * @returns {Object} Extended editor
 */
export function withEmptyInlineRemoval(editor) {
  const { normalizeNode } = editor;

  editor.normalizeNode = (entry) => {
    const [node, path] = entry;

    // Check if this is an empty inline formatting element
    if (Element.isElement(node) && INLINE_FORMAT_TYPES.includes(node.type)) {
      const isEmpty = node.children.every(
        (child) => Text.isText(child) && child.text === ''
      );
      if (isEmpty) {
        Transforms.removeNodes(editor, { at: path });
        return;
      }
    }

    normalizeNode(entry);
  };

  return editor;
}

/**
 * Creates a headless (non-React) Slate editor instance
 * Uses makeEditor from volto-slate to include all plugins and normalizers,
 * plus our custom empty inline removal.
 *
 * @param {Array} value - Slate document value
 * @returns {Object} Slate editor instance
 */
export function createHeadlessEditor(value) {
  const editor = withEmptyInlineRemoval(makeEditor());
  editor.children = JSON.parse(JSON.stringify(value)); // Deep clone to avoid mutations
  return editor;
}

// NOTE: serialize() and serializeNode() functions have been removed.
// The Admin UI should NOT generate HTML - it only manages Slate JSON.
// HTML rendering with data-node-id attributes is handled by hydra.js in the frontend.

/**
 * Deserializes HTML to Slate-compatible JSON
 * (Re-export from existing toggleMark.js logic)
 *
 * @param {HTMLElement} el - DOM element to deserialize
 * @param {Object} markAttributes - Accumulated mark attributes
 * @returns {Object|Array} Slate node(s)
 */
function deserialize(el, markAttributes = {}) {
  if (el.nodeType === Node.TEXT_NODE && !!el.textContent.trim()) {
    return jsx('text', markAttributes, el.textContent);
  } else if (el.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }

  const nodeAttributes = { ...markAttributes };

  // Handle inline formatting marks
  switch (el.nodeName) {
    case 'STRONG':
      nodeAttributes.bold = true;
      break;
    case 'EM':
      nodeAttributes.italic = true;
      break;
    case 'DEL':
      nodeAttributes.del = true;
      break;
  }

  const children = Array.from(el.childNodes)
    .map((node) => deserialize(node, nodeAttributes))
    .flat()
    .filter(Boolean);

  // Ensure formatting elements have at least one child
  if (children.length === 0 && ['STRONG', 'EM', 'DEL'].includes(el.nodeName)) {
    children.push(jsx('text', {}, ' '));
  }

  switch (el.nodeName) {
    case 'BODY':
      return jsx('fragment', {}, children);
    case 'BR': {
      const parent = el.parentNode;
      if (parent && parent.lastChild !== el && isBlockElement(parent)) {
        return '\n';
      }
      return null;
    }
    case 'BLOCKQUOTE':
      return jsx('element', { type: 'quote' }, children);
    case 'P':
      return jsx('element', { type: 'p' }, children);
    case 'A':
      return jsx(
        'element',
        { type: 'link', data: { url: el.getAttribute('href') } },
        children,
      );
    case 'STRONG':
    case 'EM':
    case 'DEL':
      // These are handled as marks, not elements
      return children;
    default:
      return children;
  }
}

/**
 * Helper to check if element is block-level
 */
function isBlockElement(element) {
  const blockElements = [
    'P',
    'DIV',
    'BLOCKQUOTE',
    'H1',
    'H2',
    'H3',
    'H4',
    'H5',
    'H6',
    'UL',
    'OL',
    'LI',
  ];
  return blockElements.includes(element.nodeName);
}

/**
 * Converts HTML to Slate value (compatibility wrapper for toggleMark)
 * Note: nodeIds are managed by hydra.js, not by the Admin UI
 *
 * @param {string} html - HTML string
 * @returns {Array} Slate document value
 */
export function htmlToSlate(html) {
  const document = new DOMParser().parseFromString(html, 'text/html');
  const slateValue = deserialize(document.body);
  return slateValue;
}

/**
 * Splits a Slate block at the current selection point
 * Used when Enter key is pressed to create a new block
 * Uses Volto's existing splitEditorInTwoFragments utility
 *
 * @param {Array} value - Slate document value
 * @param {Object} selection - Selection object
 * @returns {Object} Object with 'topValue' (content before split) and 'bottomValue' (content after split)
 */
export function splitBlock(value, selection) {
  const editor = createHeadlessEditor(value);
  const at = outsideInlineEdge(editor, selection);
  Transforms.select(editor, at);
  const [topValue, bottomValue] = splitEditorInTwoFragments(editor, at);
  return { topValue, bottomValue };
}

/**
 * A caret at the very end (or start) of an inline such as a link is, visually,
 * also just after (or before) it — but "from the caret to the end" then starts
 * INSIDE the inline, so the split copies it, empty, into the other half (slate
 * always keeps a text node beside an inline, so that half is never empty).
 * Move such a caret just outside the inline, so the inline stays whole on one
 * side and no empty copy is made. A caret inside the inline is left alone.
 */
function outsideInlineEdge(editor, selection) {
  if (!Range.isCollapsed(selection)) return selection;
  const point = selection.anchor;
  const [inlineEntry] = Editor.nodes(editor, {
    at: point,
    match: (n) => Element.isElement(n) && Editor.isInline(editor, n),
    mode: 'highest',
  });
  if (!inlineEntry) return selection;
  const [, inlinePath] = inlineEntry;
  let outside = null;
  if (Editor.isEnd(editor, point, inlinePath)) {
    const next = Path.next(inlinePath);
    if (SlateNode.has(editor, next)) outside = Editor.start(editor, next);
  } else if (Editor.isStart(editor, point, inlinePath) && Path.hasPrevious(inlinePath)) {
    outside = Editor.end(editor, Path.previous(inlinePath));
  }
  return outside ? { anchor: outside, focus: outside } : selection;
}

/**
 * Check if selection is inside a list item in the given Slate value.
 */
export function isSelectionInList(value, selection) {
  if (!selection) return false;
  const { slate } = config.settings;
  const editor = createHeadlessEditor(value);
  editor.selection = selection;
  const result = Editor.above(editor, {
    match: (n) => Element.isElement(n) && n.type === slate.listItemType,
  });
  return !!result;
}

/**
 * Check if the current list item at the selection is empty (no text content).
 */
export function isCurrentListItemEmpty(value, selection) {
  const { slate } = config.settings;
  const editor = createHeadlessEditor(value);
  editor.selection = selection;
  const [match] = Editor.nodes(editor, {
    at: selection.anchor.path,
    match: (n) => Element.isElement(n) && n.type === slate.listItemType,
    mode: 'lowest',
  });
  if (!match) return false;
  const [, listItemPath] = match;
  return !Editor.string(editor, listItemPath);
}

/**
 * Split the list item at cursor position. Returns new value and selection.
 * Used when Enter is pressed in a non-empty list item.
 * Pattern from breakList.js:50-56.
 */
export function splitListItem(value, selection) {
  const { slate } = config.settings;
  const editor = createHeadlessEditor(value);
  editor.selection = selection;

  Transforms.splitNodes(editor, {
    at: editor.selection,
    match: (node) => Element.isElement(node) && node.type === slate.listItemType,
    always: true,
  });

  return { newValue: editor.children, newSelection: editor.selection };
}

/**
 * Remove the empty list item at the selection and return modified value.
 * Used when Enter is pressed on an empty list item (to exit the list).
 * The normalizer will clean up empty parent lists automatically.
 */
export function removeEmptyListItem(value, selection) {
  const { slate } = config.settings;
  const editor = createHeadlessEditor(value);
  editor.selection = selection;

  const [match] = Editor.nodes(editor, {
    at: selection.anchor.path,
    match: (n) => Element.isElement(n) && n.type === slate.listItemType,
    mode: 'lowest',
  });
  if (!match) return { newValue: value };

  const [, listItemPath] = match;
  Transforms.removeNodes(editor, { at: listItemPath });

  return { newValue: editor.children };
}

/**
 * Split a list block at a top-level list item into before/paragraph/after.
 * Returns null if the item is nested (not top-level) — caller should use toolbar outdent.
 * Returns { before, paragraph, after } where each is a Slate value or null.
 */
export function splitListAtItem(value, selection) {
  if (!selection) return null;
  const { slate } = config.settings;
  const editor = createHeadlessEditor(value);
  editor.selection = selection;

  const [match] = Editor.nodes(editor, {
    at: selection.anchor.path,
    match: (n) => Element.isElement(n) && n.type === slate.listItemType,
    mode: 'lowest',
  });
  if (!match) return null;
  const [listItemNode, listItemPath] = match;

  // Find parent list (ul/ol)
  const [parentList, parentListPath] = Editor.parent(editor, listItemPath);

  // Only handle top-level: parent list is direct child of editor root
  if (parentListPath.length !== 1) return null;

  const listItemIndex = listItemPath[listItemPath.length - 1];
  const totalItems = parentList.children.length;

  // Convert li children to paragraph
  const paragraph = [{ type: slate.defaultBlockType, children: JSON.parse(JSON.stringify(listItemNode.children)) }];

  if (totalItems === 1) {
    return { before: null, paragraph, after: null };
  }

  const before = listItemIndex > 0
    ? [{ type: parentList.type, children: JSON.parse(JSON.stringify(parentList.children.slice(0, listItemIndex))) }]
    : null;

  const after = listItemIndex < totalItems - 1
    ? [{ type: parentList.type, children: JSON.parse(JSON.stringify(parentList.children.slice(listItemIndex + 1))) }]
    : null;

  return { before, paragraph, after };
}

// mergeBlockValues (the inverse of splitBlock) now lives in the dep-free
// ./slateMerge.js and is imported + re-exported above.

// Export default for backwards compatibility
export default {
  createHeadlessEditor,
  htmlToSlate,
  splitBlock,
  mergeBlockValues,
  isSelectionInList,
  isCurrentListItemEmpty,
  splitListItem,
  removeEmptyListItem,
  splitListAtItem,
};
