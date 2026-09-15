#!/usr/bin/env python3
"""
blockmd — prototype of the markdown/directive format from
proposals/mcp-content-authoring.md.

Two directions:
  blocks_to_md(page)  -> markdown with ::: directives
  md_to_blocks(md)    -> {blocks, blocks_layout}

Design follows the proposal:
  - markdown for prose (slate), the 65% case
  - ::: directives for everything with structure: name -> @type,
    {attrs} -> scalar fields, body -> children
  - a raw-JSON escape hatch (```block) so nothing is unrepresentable
  - block uids are carried as an attr so edits can be id-addressed; ordering
    is implicit in document order, which is what blocks_layout.items is
"""
import json
import re

# ---------------------------------------------------------------- slate ----
MARKS = [("bold", "**"), ("italic", "*"), ("code", "`"), ("strikethrough", "~~")]
BLOCK_TAGS = {"p": "", "h1": "# ", "h2": "## ", "h3": "### ", "h4": "#### ",
              "h5": "##### ", "h6": "###### "}


def _inline(node):
    if isinstance(node, list):
        return "".join(_inline(n) for n in node)
    if not isinstance(node, dict):
        return ""
    if "text" in node and node.get("type") is None:
        t = node["text"]
        for key, wrap in MARKS:
            if node.get(key):
                t = f"{wrap}{t}{wrap}"
        return t
    t = node.get("type")
    kids = _inline(node.get("children", []))
    if t in ("strong", "b"):
        return f"**{kids}**"
    if t in ("em", "i"):
        return f"*{kids}*"
    if t == "del":
        return f"~~{kids}~~"
    if t == "code":
        return f"`{kids}`"
    if t in ("link", "a"):
        url = (node.get("data") or {}).get("url") or node.get("url") or ""
        return f"[{kids}]({url})"
    return kids


def slate_to_md(value, depth=0):
    out = []
    for node in value or []:
        if not isinstance(node, dict):
            continue
        t = node.get("type")
        if t in BLOCK_TAGS:
            out.append(BLOCK_TAGS[t] + _inline(node.get("children", [])))
        elif t in ("ul", "ol"):
            # One string for the whole list: items joined by single newlines.
            # Joining with blank lines split one ul into several on the way back.
            items = []
            for i, li in enumerate(node.get("children", []), 1):
                bullet = "- " if t == "ul" else f"{i}. "
                items.append("  " * depth + bullet + _inline(li.get("children", [])).strip())
            out.append("\n".join(items))
        elif t == "blockquote":
            out.append("> " + _inline(node.get("children", [])))
        else:
            out.append(_inline(node.get("children", [])) if t else _inline(node))
    return "\n\n".join(x for x in out if x.strip())


_INLINE_RE = re.compile(
    r"(?P<link>\[(?P<ltext>[^\]]*)\]\((?P<lurl>[^)]*)\))"
    r"|(?P<strong>\*\*(?P<stext>.+?)\*\*)"
    r"|(?P<del>~~(?P<dtext>.+?)~~)"
    r"|(?P<code>`(?P<ctext>[^`]+)`)"
    r"|(?P<em>\*(?P<etext>[^*]+)\*)", re.S)


def md_inline_to_slate(text):
    kids, pos = [], 0
    for m in _INLINE_RE.finditer(text):
        if m.start() > pos:
            kids.append({"text": text[pos:m.start()]})
        if m.group("link"):
            kids.append({"type": "link", "data": {"url": m.group("lurl")},
                         "children": [{"text": m.group("ltext")}]})
        elif m.group("strong"):
            kids.append({"type": "strong", "children": [{"text": m.group("stext")}]})
        elif m.group("del"):
            kids.append({"type": "del", "children": [{"text": m.group("dtext")}]})
        elif m.group("code"):
            # Content stores inline code as a NODE ({"type":"code"}), 859 of
            # them, not as a {"code": true} mark. Emit the form in use.
            kids.append({"type": "code", "children": [{"text": m.group("ctext")}]})
        elif m.group("em"):
            kids.append({"type": "em", "children": [{"text": m.group("etext")}]})
        pos = m.end()
    if pos < len(text):
        kids.append({"text": text[pos:]})
    return kids or [{"text": ""}]


def md_to_slate(md):
    """
    Parse markdown into slate top-level nodes.

    NOTE: docs/visual-editing.md says a slate value always holds exactly one
    top-level node. Stored content disagrees — 43 of 997 slate blocks have
    more than one (grid cards are typically a bold lead-in paragraph plus a
    body paragraph). So this returns a LIST, splitting on blank lines.
    """
    chunks = [c for c in re.split(r"\n\s*\n", md.strip()) if c.strip()]
    if len(chunks) > 1:
        out = []
        for c in chunks:
            out.extend(_md_chunk_to_slate(c))
        return out
    return _md_chunk_to_slate(md)


def _md_chunk_to_slate(md):
    lines = [l for l in md.split("\n") if l.strip()]
    if not lines:
        return [{"type": "p", "children": [{"text": ""}]}]
    first = lines[0]
    h = re.match(r"^(#{1,6})\s+(.*)$", first)
    if h:
        return [{"type": f"h{len(h.group(1))}", "children": md_inline_to_slate(h.group(2))}]
    if re.match(r"^\s*[-*]\s+", first):
        items = [{"type": "li", "children": md_inline_to_slate(re.sub(r"^\s*[-*]\s+", "", l))}
                 for l in lines if l.strip()]
        return [{"type": "ul", "children": items}]
    if re.match(r"^\s*\d+\.\s+", first):
        items = [{"type": "li", "children": md_inline_to_slate(re.sub(r"^\s*\d+\.\s+", "", l))}
                 for l in lines if l.strip()]
        return [{"type": "ol", "children": items}]
    return [{"type": "p", "children": md_inline_to_slate(md)}]


def plaintext_of(value):
    out = []

    def w(n):
        if isinstance(n, dict):
            if isinstance(n.get("text"), str):
                out.append(n["text"])
            for c in n.get("children", []):
                w(c)
        elif isinstance(n, list):
            for c in n:
                w(c)
    w(value)
    return "".join(out)


# ------------------------------------------------------------ directives ---
# Fields that are storage bookkeeping, not content. Carried as attrs so a
# round-trip is lossless, but an agent never has to write them.
BOOKKEEPING = {"templateId", "templateInstanceId", "slotId", "fixed", "readOnly"}
SCALARS = (str, int, float, bool)


def _fmt_attrs(d):
    parts = []
    for k, v in d.items():
        if isinstance(v, bool):
            parts.append(f"{k}={str(v).lower()}")
        elif isinstance(v, (int, float)):
            parts.append(f"{k}={v}")
        else:
            parts.append(f'{k}="{v}"')
    return " ".join(parts)


_ATTR_RE = re.compile(r'(\w+)=(?:"([^"]*)"|([^\s}]+))')


def _parse_attrs(s):
    out = {}
    for k, qv, bare in _ATTR_RE.findall(s or ""):
        if qv != "":
            out[k] = qv
        elif bare in ("true", "false"):
            out[k] = bare == "true"
        else:
            try:
                out[k] = int(bare) if bare.isdigit() else float(bare)
            except ValueError:
                out[k] = bare
    return out


def block_to_md(uid, b, depth=0):
    t = b.get("@type")
    simple = {k: v for k, v in b.items()
              if k not in ("@type", "blocks", "blocks_layout", "value", "plaintext")
              and isinstance(v, SCALARS)}
    complex_fields = {k: v for k, v in b.items()
                      if k not in ("@type", "blocks", "blocks_layout", "value", "plaintext")
                      and not isinstance(v, SCALARS)}

    # slate with no extra structure -> plain markdown, no directive at all
    if t == "slate" and not complex_fields:
        body = slate_to_md(b.get("value"))
        attrs = _fmt_attrs({"uid": uid, **simple})
        return f":::slate{{{attrs}}}\n{body}\n:::"

    if t == "separator" and not complex_fields:
        return f':::separator{{{_fmt_attrs({"uid": uid, **simple})}}}\n:::'

    attrs = _fmt_attrs({"uid": uid, **simple})
    lines = [f":::{t}{{{attrs}}}"]

    # anything that isn't a scalar rides the JSON escape hatch
    if complex_fields:
        lines.append("```fields")
        lines.append(json.dumps(complex_fields, indent=1, ensure_ascii=False))
        lines.append("```")
    if t == "slate" and b.get("value"):
        lines.append(slate_to_md(b["value"]))

    kids = b.get("blocks")
    if isinstance(kids, dict):
        order = []
        bl = b.get("blocks_layout") or {}
        for key in bl:
            order.extend(bl[key] or [])
        for k in kids:
            if k not in order:
                order.append(k)
        for k in order:
            if k in kids:
                lines.append(block_to_md(k, kids[k], depth + 1))
    lines.append(":::")
    return "\n".join(lines)


def blocks_to_md(page):
    blocks = page.get("blocks") or {}
    order = list((page.get("blocks_layout") or {}).get("items") or [])
    for k in blocks:
        if k not in order:
            order.append(k)
    return "\n\n".join(block_to_md(k, blocks[k]) for k in order if k in blocks)


_OPEN_RE = re.compile(r"^:::(\w[\w-]*)\{(.*)\}\s*$")


def md_to_blocks(md):
    lines = md.split("\n")
    blocks, root_order = {}, []
    stack = []            # (uid, block, child_order)

    i = 0
    while i < len(lines):
        line = lines[i]
        m = _OPEN_RE.match(line.strip())
        if m:
            t, attrs = m.group(1), _parse_attrs(m.group(2))
            uid = attrs.pop("uid", f"{t}-{len(blocks)}")
            blk = {"@type": t, **attrs}
            if stack:
                parent = stack[-1]
                parent[1].setdefault("blocks", {})[uid] = blk
                parent[2].append(uid)
            else:
                blocks[uid] = blk
                root_order.append(uid)
            stack.append((uid, blk, []))
            i += 1
            continue
        if line.strip() == ":::" and stack:
            uid, blk, kid_order = stack.pop()
            if kid_order:
                blk["blocks_layout"] = {"items": kid_order}
            if blk.get("@type") == "slate" and "_md" in blk:
                blk["value"] = md_to_slate(blk.pop("_md").strip())
                blk["plaintext"] = plaintext_of(blk["value"])
            else:
                blk.pop("_md", None)
            i += 1
            continue
        if line.strip() == "```fields" and stack:
            j = i + 1
            buf = []
            while j < len(lines) and lines[j].strip() != "```":
                buf.append(lines[j]); j += 1
            stack[-1][1].update(json.loads("\n".join(buf)))
            i = j + 1
            continue
        if stack:
            stack[-1][1]["_md"] = stack[-1][1].get("_md", "") + line + "\n"
        i += 1

    return {"blocks": blocks, "blocks_layout": {"items": root_order}}
