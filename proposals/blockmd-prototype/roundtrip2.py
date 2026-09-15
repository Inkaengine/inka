#!/usr/bin/env python3
"""Whole-page round-trip: JSON -> markdown (frontmatter + directives) -> JSON."""
import json, sys
from pathlib import Path
from collections import Counter
sys.path.insert(0, str(Path(__file__).parent))
from blockmd2 import page_to_md, md_to_page, AUTHORED, IDENTITY

def sem(v):
    if isinstance(v, dict):
        if set(v) == {"text"} and v["text"] == "": return None
        out = {}
        for k, val in v.items():
            if k == "plaintext": continue
            r = sem(val)
            if r is not None: out[k] = r
        return out
    if isinstance(v, list):
        return [x for x in (sem(i) for i in v) if x is not None]
    return v

def flat(bs, out=None, pre=""):
    out = out if out is not None else {}
    for u, b in (bs or {}).items():
        if isinstance(b, dict):
            out[pre+u] = {k: v for k, v in b.items() if k not in ("blocks", "blocks_layout")}
            if isinstance(b.get("blocks"), dict): flat(b["blocks"], out, pre+u+"/")
    return out

pages = okblocks = blocks = okmeta = okorder = 0
badtypes = Counter()
for root in [Path.home()/"Projects/inka-site/content/content",
             Path.home()/"Projects/inka-site/inka/docs/content/content/content"]:
    for p in root.rglob("data.json"):
        try: d = json.loads(p.read_text())
        except Exception: continue
        if not d.get("blocks"): continue
        pages += 1
        back = md_to_page(page_to_md(d))
        # metadata
        if all(sem(d.get(k)) == sem(back.get(k)) for k in AUTHORED + IDENTITY if k in d):
            okmeta += 1
        # order
        if list((d.get("blocks_layout") or {}).get("items") or []) == list(back["blocks_layout"]["items"]):
            okorder += 1
        A, B = flat(d["blocks"]), flat(back["blocks"])
        for u in set(A) | set(B):
            blocks += 1
            if sem(A.get(u)) == sem(B.get(u)): okblocks += 1
            else: badtypes[(A.get(u) or B.get(u) or {}).get("@type", "?")] += 1

print(f"pages            : {pages}")
print(f"metadata exact   : {okmeta}/{pages} ({100*okmeta//pages}%)")
print(f"block order exact: {okorder}/{pages} ({100*okorder//pages}%)")
print(f"blocks semantic  : {okblocks}/{blocks} ({100*okblocks//blocks}%)")
if badtypes:
    print("\nblocks still differing, by type:")
    for t, n in badtypes.most_common(10): print(f"  {n:5d}  {t}")
