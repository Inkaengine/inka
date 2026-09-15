#!/usr/bin/env python3
"""
blockmd v2 — whole-page markdown, schema-aware.

Adds over v1:
  - YAML-ish frontmatter for page metadata (authored fields only)
  - an ordered `blocks:` map in frontmatter — the proposal's blockMap, so a
    run of prose does not need a directive wrapper each
  - schema-aware object_list: fields the schema marks object_list become
    nested directives; object_browser fields stay references

Schema comes from tests-playwright/fixtures/shared-block-schemas.js, dumped to
JSON by dump_schema.sh. Without it you can still round-trip (non-scalar fields
ride the JSON escape hatch) but you cannot author `:::accordion` with
`:::panel` children, because nothing else distinguishes a list of children from
a list of link references — both are [{"@id": ...}].
"""
import json
import re
from pathlib import Path

from blockmd import (  # reuse the slate <-> markdown core
    slate_to_md, md_to_slate, plaintext_of, _fmt_attrs, _parse_attrs, SCALARS,
)

SCHEMA_PATH = Path(__file__).with_name("schemas.json")
SCHEMA = json.loads(SCHEMA_PATH.read_text()) if SCHEMA_PATH.exists() else {}

# Page fields a human authors. Everything else (created, modified,
# workflow_history, lock, is_folderish, @id, parent, type_title, …) is server
# state: including it would produce spurious diffs on every export and invite
# someone to hand-edit an audit trail.
AUTHORED = ["title", "description", "review_state", "exclude_from_nav",
            "subjects", "language", "rights", "effective", "expires", "id"]
# Server-assigned but load-bearing: a re-import needs stable identity.
IDENTITY = ["UID", "@type"]


def child_fields(block_type):
    """Field names the schema says hold child blocks (object_list)."""
    return [f for f, p in (SCHEMA.get(block_type) or {}).items()
            if p.get("widget") == "object_list"]


# ------------------------------------------------------------------ emit ---
def _attrable(v):
    """A value that can live in {attrs}: scalar, single-line, not enormous."""
    if isinstance(v, bool) or isinstance(v, (int, float)):
        return True
    if isinstance(v, str):
        return "\n" not in v and '"' not in v and len(v) <= 200
    return False


def _scalars(b, skip=()):
    return {k: v for k, v in b.items() if k not in skip and _attrable(v)}


def block_to_md(uid, b, indent=0):
    t = b.get("@type")
    kids_fields = child_fields(t)
    # "@id" is emitted as uid=, so it must not also land in {attrs} — the attr
    # regex matches \w+ and would read "@id=x" back as a spurious "id" field.
    reserved = {"@type", "@id", "blocks", "blocks_layout", "value", "plaintext",
                *kids_fields}
    simple = _scalars(b, reserved)
    # Anything that can't be an attribute rides the JSON escape hatch —
    # including multi-line strings like codeExample's `code`, which is source
    # code and cannot be squeezed onto a directive line.
    complex_fields = {k: v for k, v in b.items()
                      if k not in reserved and not _attrable(v)}

    lines = [f":::{t}{{{_fmt_attrs({'uid': uid, **simple})}}}"]
    if complex_fields:
        lines += ["```fields", json.dumps(complex_fields, indent=1, ensure_ascii=False), "```"]
    if t in ("slate", "introduction") and b.get("value"):
        lines.append(slate_to_md(b["value"]))

    # object_list children — schema-driven
    for f in kids_fields:
        items = b.get(f)
        if not isinstance(items, list):
            continue
        lines.append(f"::::{f}")
        for item in items:
            if not isinstance(item, dict):
                continue
            iid = item.get("@id", "")
            itype = item.get("@type") or f.rstrip("s")
            lines.append(block_to_md(iid, {**item, "@type": itype}, indent + 1))
        lines.append("::::")

    # blocks_layout children
    kids = b.get("blocks")
    if isinstance(kids, dict):
        bl = b.get("blocks_layout") or {}
        for region, order in bl.items():
            multi = len(bl) > 1 or region != "items"
            if multi:
                lines.append(f"::::{region}")
            for k in (order or []):
                if k in kids:
                    lines.append(block_to_md(k, kids[k], indent + 1))
            if multi:
                lines.append("::::")
        if not bl:
            for k, v in kids.items():
                lines.append(block_to_md(k, v, indent + 1))
    lines.append(":::")
    return "\n".join(lines)


def _yaml(d):
    out = []
    for k, v in d.items():
        if isinstance(v, bool):
            out.append(f"{k}: {str(v).lower()}")
        elif isinstance(v, (int, float)) or v is None:
            out.append(f"{k}: {json.dumps(v)}")
        elif isinstance(v, list):
            out.append(f"{k}: {json.dumps(v, ensure_ascii=False)}")
        else:
            out.append(f"{k}: {json.dumps(str(v), ensure_ascii=False)}")
    return "\n".join(out)


def page_to_md(page):
    blocks = page.get("blocks") or {}
    order = list((page.get("blocks_layout") or {}).get("items") or [])
    for k in blocks:
        if k not in order:
            order.append(k)

    meta = {k: page[k] for k in AUTHORED + IDENTITY if k in page}
    # The blockMap: ordered uid -> type for top-level blocks. Lets a plain
    # paragraph be a slate block without a directive wrapper round it.
    blockmap = [f"  - {uid}: {blocks[uid].get('@type')}" for uid in order if uid in blocks]

    body = []
    for uid in order:
        b = blocks.get(uid)
        if not b:
            continue
        # Prose with nothing but a value renders as bare markdown.
        extra = {k for k in b if k not in ("@type", "value", "plaintext")}
        if b.get("@type") == "slate" and not extra and len(b.get("value") or []) == 1:
            body.append(slate_to_md(b["value"]))
        else:
            body.append(block_to_md(uid, b))

    return ("---\n" + _yaml(meta) + "\nblocks:\n" + "\n".join(blockmap) +
            "\n---\n\n" + "\n\n".join(body) + "\n")


# ----------------------------------------------------------------- parse ---
_OPEN = re.compile(r"^(?P<colons>:{3,4})(?P<name>[\w-]*)(?:\{(?P<attrs>.*)\})?\s*$")


def md_to_page(md):
    fm, _, body = md.partition("\n---\n")
    fm = fm.lstrip("-\n")
    meta, blockmap = {}, []
    in_map = False
    for line in fm.split("\n"):
        if line.strip() == "blocks:":
            in_map = True
            continue
        if in_map and line.strip().startswith("- "):
            uid, _, t = line.strip()[2:].partition(":")
            blockmap.append((uid.strip(), t.strip()))
            continue
        if ":" in line and not in_map:
            k, _, v = line.partition(":")
            try:
                meta[k.strip()] = json.loads(v.strip())
            except Exception:
                meta[k.strip()] = v.strip()

    blocks, order = {}, []
    stack = []          # (uid, block, child_order, region_or_None)
    buf = []
    bare_idx = [i for i, (_, t) in enumerate(blockmap) if t == "slate"]

    def flush_bare():
        """A run of prose = the next slate uid from the blockMap."""
        text = "\n".join(buf).strip()
        buf.clear()
        if not text:
            return
        for uid, t in blockmap:
            if uid in blocks or any(uid == s[0] for s in stack):
                continue
            if t != "slate":
                continue
            v = md_to_slate(text)
            blocks[uid] = {"@type": "slate", "value": v, "plaintext": plaintext_of(v)}
            order.append(uid)
            return

    lines = body.split("\n")
    i = 0
    while i < len(lines):
        raw = lines[i]
        line = raw.strip()
        m = _OPEN.match(line)
        if m and m.group("name") and m.group("attrs") is not None:
            flush_bare()
            t, attrs = m.group("name"), _parse_attrs(m.group("attrs"))
            uid = attrs.pop("uid", f"{t}-{len(blocks)}")
            blk = {"@type": t, **attrs}
            if stack:
                p_uid, p_blk, p_order, region = stack[-1]
                if region:
                    p_blk.setdefault(region, [])
                    if region in child_fields(p_blk.get("@type")):
                        # Append the SAME object that goes on the stack, not a
                        # copy: later ```fields updates mutate the stack entry,
                        # and a copy silently loses them (this is how every
                        # codeExample lost its `code`).
                        blk["@id"] = uid
                        blk["_objlist"] = region
                        p_blk[region].append(blk)
                    else:
                        p_blk.setdefault("blocks", {})[uid] = blk
                        p_order.append(uid)
                else:
                    p_blk.setdefault("blocks", {})[uid] = blk
                    p_order.append(uid)
            else:
                blocks[uid] = blk
                order.append(uid)
            stack.append((uid, blk, [], None))
            i += 1
            continue
        if m and m.group("colons") == "::::" and m.group("name") and m.group("attrs") is None:
            if stack:
                u, b, o, _ = stack[-1]
                stack[-1] = (u, b, o, m.group("name"))
            i += 1
            continue
        if line in (":::", "::::"):
            if line == "::::" and stack and stack[-1][3]:
                u, b, o, _ = stack[-1]
                stack[-1] = (u, b, o, None)
                i += 1
                continue
            if stack:
                uid, blk, kid_order, _ = stack.pop()
                if kid_order:
                    blk["blocks_layout"] = {"items": kid_order}
                region = blk.pop("_objlist", None)
                if region and blk.get("@type") == region.rstrip("s"):
                    # block_to_md synthesises a type from the field name
                    # (tabs -> tab) for items that have none; drop it again.
                    blk.pop("@type", None)
                if blk.get("@type") in ("slate", "introduction") and "_md" in blk:
                    v = md_to_slate(blk.pop("_md").strip())
                    blk["value"] = v
                    blk["plaintext"] = plaintext_of(v)
                else:
                    blk.pop("_md", None)
            i += 1
            continue
        if line == "```fields" and stack:
            j, jb = i + 1, []
            while j < len(lines) and lines[j].strip() != "```":
                jb.append(lines[j]); j += 1
            stack[-1][1].update(json.loads("\n".join(jb)))
            i = j + 1
            continue
        if stack:
            stack[-1][1]["_md"] = stack[-1][1].get("_md", "") + raw + "\n"
        else:
            # A blank line ends a prose chunk. Without this every paragraph on
            # the page accumulates into one buffer and collapses into a single
            # slate block.
            if not line and buf:
                flush_bare()
            elif line:
                buf.append(raw)
        i += 1
    flush_bare()

    page = dict(meta)
    page.pop("blocks", None)
    page["blocks"] = blocks
    page["blocks_layout"] = {"items": order}
    return page
