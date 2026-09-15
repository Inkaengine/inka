#!/usr/bin/env python3
"""Survey every block in the content tree: types, fields, nesting, oddities."""
import json
from collections import Counter, defaultdict
from pathlib import Path

ROOTS = [
    Path.home() / "Projects/inka-site/content/content",
    Path.home() / "Projects/inka-site/inka/docs/content/content/content",
]

types = Counter()
fields_by_type = defaultdict(Counter)
field_kinds = defaultdict(Counter)          # type.field -> python kind
containers = Counter()                       # types that nest blocks
layout_keys = Counter()                      # blocks_layout key names seen
slate_node_types = Counter()
pages = 0


def kind(v):
    if isinstance(v, dict):
        if "value" in v and "plaintext" in v:
            return "richtext"
        return "object"
    if isinstance(v, list):
        if v and isinstance(v[0], dict) and "@id" in v[0]:
            return "ref[]"
        return "list"
    if isinstance(v, bool):
        return "bool"
    if isinstance(v, (int, float)):
        return "number"
    if v is None:
        return "null"
    return "string"


def walk_slate(nodes):
    if isinstance(nodes, dict):
        t = nodes.get("type")
        if t:
            slate_node_types[t] += 1
        for k in ("children", "value"):
            walk_slate(nodes.get(k))
        if "text" in nodes:
            marks = [k for k in nodes if k in ("bold", "italic", "code", "strikethrough", "underline")]
            for m in marks:
                slate_node_types[f"mark:{m}"] += 1
    elif isinstance(nodes, list):
        for n in nodes:
            walk_slate(n)


def walk_blocks(blocks, layout=None):
    for uid, b in (blocks or {}).items():
        if not isinstance(b, dict):
            continue
        t = b.get("@type", "?")
        types[t] += 1
        for f, v in b.items():
            if f in ("@type", "blocks", "blocks_layout"):
                continue
            fields_by_type[t][f] += 1
            field_kinds[f"{t}.{f}"][kind(v)] += 1
            if f == "value" or kind(v) == "richtext":
                walk_slate(v if f != "value" else b.get("value"))
        if isinstance(b.get("blocks"), dict):
            containers[t] += 1
            for k in (b.get("blocks_layout") or {}):
                layout_keys[k] += 1
            walk_blocks(b["blocks"])


for root in ROOTS:
    for p in root.rglob("data.json"):
        try:
            d = json.loads(p.read_text())
        except Exception:
            continue
        if "blocks" not in d:
            continue
        pages += 1
        for k in (d.get("blocks_layout") or {}):
            layout_keys[k] += 1
        walk_blocks(d.get("blocks"))

print(f"pages with blocks: {pages}")
print(f"distinct block types: {len(types)}   total blocks: {sum(types.values())}\n")

print("=== block types by frequency ===")
for t, n in types.most_common():
    c = " [container]" if containers.get(t) else ""
    print(f"  {n:5d}  {t}{c}")

print("\n=== blocks_layout key names ===")
for k, n in layout_keys.most_common():
    print(f"  {n:5d}  {k}")

print("\n=== slate node types / marks ===")
for t, n in slate_node_types.most_common(18):
    print(f"  {n:5d}  {t}")

print("\n=== fields per type (top types) ===")
for t, _ in types.most_common(12):
    fs = ", ".join(f"{f}({'/'.join(field_kinds[f'{t}.{f}'])})" for f, _ in fields_by_type[t].most_common())
    print(f"  {t}: {fs}")
