/**
 * Pure slate-value merge — NO heavy imports (no `slate`, `@plone/volto-slate`,
 * `@plone/volto/registry`). Split out of slateTransforms.js so it can be used by
 * blockPath.js WITHOUT dragging Volto-only deps into the offline block-path
 * evaluator's esbuild bundle (block-sanity / buildBlockPathMap). slateTransforms.js
 * re-exports it for back-compat.
 */

/**
 * Merge two slate values (arrays of nodes). When the last node of `prevValue` and
 * the first node of `currentValue` share a type, their children are concatenated
 * into one node (the seam), matching core Volto's mergeSlateWithBlockBackward;
 * otherwise the two node lists are concatenated as-is. Returns the merged value
 * plus the cursor position at the seam.
 *
 * @param {Array} prevValue - the leading slate value
 * @param {Array} currentValue - the trailing slate value
 * @returns {{ mergedValue: Array, cursorPath: Object }}
 */
export function mergeBlockValues(prevValue, currentValue) {
  const lastNode = prevValue[prevValue.length - 1];
  const firstNode = currentValue[0];

  let merged;
  let cursorPath;

  if (lastNode && firstNode && lastNode.type === firstNode.type) {
    // Same type: merge children of last prev node with first current node
    const mergedNode = {
      ...lastNode,
      children: [...(lastNode.children || []), ...(firstNode.children || [])],
    };
    merged = [...prevValue.slice(0, -1), mergedNode, ...currentValue.slice(1)];
    // Cursor at the seam: end of prev's last node children
    cursorPath = {
      anchor: { path: [prevValue.length - 1, lastNode.children.length], offset: 0 },
      focus: { path: [prevValue.length - 1, lastNode.children.length], offset: 0 },
    };
  } else {
    // Different types: concatenate as separate nodes
    merged = [...prevValue, ...currentValue];
    cursorPath = {
      anchor: { path: [prevValue.length, 0], offset: 0 },
      focus: { path: [prevValue.length, 0], offset: 0 },
    };
  }

  return { mergedValue: merged, cursorPath };
}
