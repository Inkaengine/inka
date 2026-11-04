function SlateNode({ node }) {
  if (node.text !== undefined) {
    // "\n" is a line break (Shift+Enter in the editor), drawn as <br>. A break at
    // the very end needs a second <br> to show, as it does in the editor.
    const [first, ...rest] = node.text.split('\n');
    return <>{first}{rest.flatMap((line, i) => [<br key={i} />, line])}{node.text.endsWith('\n') && <br />}</>;
  }
  const kids = isList(node) ? nestSubLists(node.children || []) : node.children || [];
  const children = kids.map((c, i) => <SlateNode key={i} node={c} />);
  const Tag = node.type === 'link' ? 'a' : node.type;
  const props = { 'data-node-id': node.nodeId };
  if (node.type === 'link') props.href = node.data?.url;
  return <Tag {...props}>{children}</Tag>;
}

function isList(node) {
  return node.type === 'ul' || node.type === 'ol';
}

// The editor keeps an indented item's sub-list BESIDE the item it belongs to
// (ul > li, ul); HTML puts it inside that item (ul > li > ul). The nodes keep
// their own data-node-id, so editing reads them back where they are kept.
function nestSubLists(children) {
  const out = [];
  for (const child of children) {
    const prev = out[out.length - 1];
    if (isList(child) && prev?.type === 'li') {
      out[out.length - 1] = { ...prev, children: [...prev.children, child] };
    } else {
      out.push(child);
    }
  }
  return out;
}
