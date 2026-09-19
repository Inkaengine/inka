"use client";

import { useEffect, useState } from "react";

/**
 * Serializes Slate JSON into JSX elements
 * @param {Array} value - The Slate JSON value (array of nodes)
 * @returns {Array} - An array of JSX elements
 */
function serializeSlateJSON(value) {
  if (!Array.isArray(value)) {
    return null;
  }
  return value?.map(serializeNode);
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
 * Recursively serializes a single Slate node into a JSX element
 * @param {Object} node - The Slate node object
 * @returns {JSX.Element} - The JSX representation of the node
 */
function serializeNode(node) {
  if (!node) {
    return null;
  }
  const uid = Date.now().toString(36) + Math.random().toString(36).slice(2, 11);
  if (node.text !== undefined) {
    // Only render data-node-id when nodeId is a valid path (text leaves don't
    // get nodeIds from addNodeIds). Rendering "undefined" breaks hydra.js lookups.
    const nodeIdProps = node.nodeId != null ? { "data-node-id": `${node.nodeId}` } : {};
    return node.text !== "" ? (
      <span key={uid} {...nodeIdProps}>
        {lineBreaks(node.text)}
      </span>
    ) : (
      <span key={uid} {...nodeIdProps}>
        &#xFEFF;
      </span>
    );
  }

  const children = node.children ? node.children.map(serializeNode) : null;
  // Only attach data-node-id when nodeId is a valid path. The previous
  // `${node?.nodeId}` template would emit the literal string "undefined"
  // when missing, which the bridge then treated as a real (broken) anchor
  // path and the DOM-to-Slate round-trip would short-circuit to [].
  const nodeIdProps = node?.nodeId != null ? { "data-node-id": `${node.nodeId}` } : {};

  switch (node.type) {
    case "link":
      return (
        <a key={uid} href={node.data?.url} {...nodeIdProps}>
          {children}
        </a>
      );

    default:
      const Tag = node.type;
      if (Tag)
        return (
          <Tag key={uid} {...nodeIdProps}>
            {children}
          </Tag>
        );
      else return null;
  }
}

export default function SlateBlock({ value }) {
  const [slateValue, setSlateValue] = useState(value);
  const elements = serializeSlateJSON(slateValue);
  useEffect(() => {
    setSlateValue(value);
  }, [value]);
  const uid = Date.now().toString(36) + Math.random().toString(36).slice(2, 11);
  return (
    <div key={uid} data-edit-text="value">
      {elements}
    </div>
  );
}

/**
 * Render slate nodes WITHOUT the [data-edit-text="value"] wrapper. Use this
 * when the slate value is a FIELD of another block (e.g. hero.description),
 * since that parent already owns the edit-text container for its own field.
 */
export function SlateInline({ value }) {
  return <>{serializeSlateJSON(value)}</>;
}
