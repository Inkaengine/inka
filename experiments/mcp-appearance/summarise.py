"""Summarise an experiment-2 run: judged scores and cost by setup (arm) and model."""
import json, sys
from collections import defaultdict
from statistics import mean

rows = [json.loads(l) for l in open(sys.argv[1])]
ARMS = ['schema', 'desc', 'shots', 'loop']

def cell(rs):
    ok = [r for r in rs if r['final'] == 'ok']
    if not ok: return f'0/{len(rs)} valid'
    s = lambda k: mean(r['score'][k] for r in ok)
    total = mean(r['score']['complete'] + r['score']['fit'] + r['score']['visual'] for r in ok)
    return f"{total:.1f} (c{s('complete'):.1f} f{s('fit'):.1f} v{s('visual'):.1f})" + ('' if len(ok) == len(rs) else f' {len(ok)}/{len(rs)} valid')

def table(key, title):
    g = defaultdict(list)
    for r in rows: g[(key(r), r['arm'])].append(r)
    print(f'\n## {title}  (total /15: complete, fit, visual /5)\n')
    print('| | ' + ' | '.join(ARMS) + ' |'); print('|---|' + '---|' * len(ARMS))
    for k in sorted({k for k, _ in g}):
        print(f'| {k} | ' + ' | '.join(cell(g.get((k, a), [])) if g.get((k, a)) else '' for a in ARMS) + ' |')

table(lambda r: 'all', 'All')
table(lambda r: r['model'].split('/')[-1], 'By model')
table(lambda r: r['brief'], 'By brief')

print('\n## Input tokens per page (mean)\n')
g = defaultdict(list)
for r in rows:
    if r.get('usage'): g[(r['model'].split('/')[-1], r['arm'])].append(r['usage']['in'])
for m in sorted({m for m, _ in g}):
    print(f'- {m}: ' + ', '.join(f"{a} {int(mean(g[(m, a)]))}" for a in ARMS if g.get((m, a))))

print('\n## Block types used, by setup\n')
for a in ARMS:
    c = defaultdict(int)
    for r in rows:
        if r['arm'] == a and r['final'] == 'ok':
            for t in set(r['types']): c[t] += 1
    n = sum(1 for r in rows if r['arm'] == a and r['final'] == 'ok')
    print(f'- {a} ({n} pages): ' + ', '.join(f'{t} {v}' for t, v in sorted(c.items(), key=lambda x: -x[1])))

bad = [r for r in rows if r['final'] != 'ok' or r.get('missing')]
if bad:
    print('\n## Invalid or partly unrendered\n')
    for r in bad: print(f"- {r['model'].split('/')[-1]} {r['brief']} {r['arm']} #{r['rep']}: {r['final']} {r.get('error', '')[:150]} missing={r.get('missing')}")
