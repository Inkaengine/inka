"use client";

/**
 * Serializes Slate JSON into JSX elements
 * @param {Array} value - The Slate JSON value (array of nodes)
 * @returns {Array} - An array of JSX elements
 */
function serializeSlateJSON(value) {
  if (!Array.isArray(value)) {
    return null;
  }
  return value.map((node, index) => serializeNode(node, index));
}

/**
 * A leaf's text with its line breaks: "\n" is Shift+Enter in the editor, drawn as
 * <br>. A break at the very end needs a second <br> to show, as it does there.
 */
function lineBreaks(text) {
  const [first, ...rest] = text.split("\n");
  return [
    first,
    ...rest.flatMap((line, i) => [<br key={`br${i}`} />, line]),
    text.endsWith("\n") ? <br key="trailing" /> : null,
  ];
}

/**
 * Recursively serializes a single Slate node into a JSX element. Keys are the
 * node's position among its siblings: stable across renders, so React updates
 * the DOM it already has instead of replacing it on every edit.
 * @param {Object} node - The Slate node object
 * @param {number} index - The node's position among its siblings
 * @returns {JSX.Element} - The JSX representation of the node
 */
function serializeNode(node, index) {
  if (!node) {
    return null;
  }
  if (node.text !== undefined) {
    // Only render data-node-id when nodeId is a valid path (text leaves don't
    // get nodeIds from addNodeIds). Rendering "undefined" breaks hydra.js lookups.
    const nodeIdProps = node.nodeId != null ? { "data-node-id": `${node.nodeId}` } : {};
    return (
      <span key={index} {...nodeIdProps}>
        {lineBreaks(node.text)}
      </span>
    );
  }

  const children = node.children
    ? node.children.map((child, i) => serializeNode(child, i))
    : null;
  // Only attach data-node-id when nodeId is a valid path. The previous
  // `${node?.nodeId}` template would emit the literal string "undefined"
  // when missing, which the bridge then treated as a real (broken) anchor
  // path and the DOM-to-Slate round-trip would short-circuit to [].
  const nodeIdProps = node?.nodeId != null ? { "data-node-id": `${node.nodeId}` } : {};

  switch (node.type) {
    case "link":
      return (
        <a key={index} href={node.data?.url} {...nodeIdProps}>
          {children}
        </a>
      );

    default:
      const Tag = node.type;
      if (Tag)
        return (
          <Tag key={index} {...nodeIdProps}>
            {children}
          </Tag>
        );
      else return null;
  }
}

export default function SlateBlock({ value }) {
  return <div data-edit-text="value">{serializeSlateJSON(value)}</div>;
}

/**
 * Render slate nodes WITHOUT the [data-edit-text="value"] wrapper. Use this
 * when the slate value is a FIELD of another block (e.g. hero.description),
 * since that parent already owns the edit-text container for its own field.
 */
export function SlateInline({ value }) {
  return <>{serializeSlateJSON(value)}</>;
}
