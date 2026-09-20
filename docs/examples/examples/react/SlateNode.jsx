function SlateNode({ node }) {
  if (node.text !== undefined) {
    // "\n" is a line break (Shift+Enter in the editor), drawn as <br>. A break at
    // the very end needs a second <br> to show, as it does in the editor.
    const [first, ...rest] = node.text.split('\n');
    return <>{first}{rest.flatMap((line, i) => [<br key={i} />, line])}{node.text.endsWith('\n') && <br />}</>;
  }
  const children = (node.children || []).map((c, i) => <SlateNode key={i} node={c} />);
  const Tag = node.type === 'link' ? 'a' : node.type;
  const props = { 'data-node-id': node.nodeId };
  if (node.type === 'link') props.href = node.data?.url;
  return <Tag {...props}>{children}</Tag>;
}
