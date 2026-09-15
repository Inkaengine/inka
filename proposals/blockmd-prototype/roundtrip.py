#!/usr/bin/env python3
"""Round-trip every real page: JSON -> markdown -> JSON, and report fidelity."""
import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from blockmd import blocks_to_md, md_to_blocks, plaintext_of  # noqa: E402

ROOTS = [
    Path.home() / "Projects/inka-site/content/content",
    Path.home() / "Projects/inka-site/inka/docs/content/content/content",
]

pages = ok = 0
diff_types = Counter()
diff_fields = Counter()
examples = []


def norm(b):
    """Compare on content, ignoring key order and the derived plaintext."""
    if isinstance(b, dict):
        return {k: norm(v) for k, v in sorted(b.items()) if k != "plaintext"}
    if isinstance(b, list):
        return [norm(x) for x in b]
    return b


def flatten(blocks, out=None, path=""):
    out = out if out is not None else {}
    for uid, b in (blocks or {}).items():
        if not isinstance(b, dict):
            continue
        out[path + uid] = {k: v for k, v in b.items() if k not in ("blocks", "blocks_layout")}
        if isinstance(b.get("blocks"), dict):
            flatten(b["blocks"], out, path + uid + "/")
    return out


for root in ROOTS:
    for p in root.rglob("data.json"):
        try:
            d = json.loads(p.read_text())
        except Exception:
            continue
        if "blocks" not in d or not d["blocks"]:
            continue
        pages += 1
        md = blocks_to_md(d)
        back = md_to_blocks(md)

        a, b = flatten(d.get("blocks")), flatten(back.get("blocks"))
        page_ok = True

        if set(a) != set(b):
            page_ok = False
            for uid in set(a) ^ set(b):
                t = (a.get(uid) or b.get(uid) or {}).get("@type", "?")
                diff_types[f"{t} (missing/extra)"] += 1

        for uid in set(a) & set(b):
            ta = a[uid].get("@type")
            for f in set(a[uid]) | set(b[uid]):
                if f == "plaintext":
                    continue
                if norm(a[uid].get(f)) != norm(b[uid].get(f)):
                    page_ok = False
                    diff_types[ta] += 1
                    diff_fields[f"{ta}.{f}"] += 1
                    if len(examples) < 6:
                        examples.append((p.parent.name, uid, ta, f,
                                         json.dumps(a[uid].get(f))[:90],
                                         json.dumps(b[uid].get(f))[:90]))

        # order must survive
        if list((d.get("blocks_layout") or {}).get("items") or []) != \
           list(back["blocks_layout"]["items"]):
            page_ok = False
            diff_fields["blocks_layout.items"] += 1

        ok += page_ok

print(f"pages round-tripped: {ok}/{pages}  ({100*ok//max(pages,1)}%)\n")
if diff_types:
    print("=== block types with differences ===")
    for t, n in diff_types.most_common(12):
        print(f"  {n:5d}  {t}")
    print("\n=== fields that differ ===")
    for f, n in diff_fields.most_common(15):
        print(f"  {n:5d}  {f}")
    print("\n=== examples ===")
    for page, uid, t, f, before, after in examples:
        print(f"  {page} :: {t}.{f}")
        print(f"     was: {before}")
        print(f"     got: {after}")
else:
    print("no differences — lossless on every page")
