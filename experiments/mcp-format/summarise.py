"""Summarise a results/*.jsonl run: accuracy and tokens by format, by model×format, by task×format."""
import json, sys
from collections import defaultdict

rows = [json.loads(l) for l in open(sys.argv[1])]
FORMATS = ['blockmd', 'tagged', 'simple', 'stored', 'ops']

def table(key, title):
    g = defaultdict(list)
    for r in rows: g[key(r)].append(r)
    print(f'\n## {title}\n')
    print('| | ' + ' | '.join(FORMATS) + ' |')
    print('|---|' + '---|' * len(FORMATS))
    for k in sorted({k[0] for k in g}):
        cells = []
        for f in FORMATS:
            rs = g.get((k, f), [])
            if not rs: cells.append(''); continue
            ok = sum(r['final'] == 'ok' for r in rs)
            first = sum(r['final'] == 'ok' and r['turns'] == 1 for r in rs)
            cells.append(f'{ok}/{len(rs)}' + (f' ({first} first try)' if first != ok else ''))
        print(f'| {k} | ' + ' | '.join(cells) + ' |')

def tokens():
    g = defaultdict(list)
    for r in rows: g[(r['model'].split('/')[-1], r['format'])].append(r)
    print('\n## Mean tokens per attempt (in + out)\n')
    print('| model | ' + ' | '.join(FORMATS) + ' |')
    print('|---|' + '---|' * len(FORMATS))
    for m in sorted({k[0] for k in g}):
        cells = []
        for f in FORMATS:
            rs = g.get((m, f), [])
            cells.append(f"{sum(r['tokensIn'] for r in rs)//max(len(rs),1)} + {sum(r['tokensOut'] for r in rs)//max(len(rs),1)}" if rs else '')
        print(f'| {m} | ' + ' | '.join(cells) + ' |')

def failures():
    g = defaultdict(int)
    for r in rows:
        if r['final'] != 'ok': g[(r['format'], r['final'])] += 1
    print('\n## Failure kinds\n')
    for (f, k), n in sorted(g.items()): print(f'- {f}: {k} ×{n}')

table(lambda r: ('all', r['format']), 'Correct, all models')
table(lambda r: (r['model'].split('/')[-1], r['format']), 'Correct by model')
table(lambda r: (r['task'], r['format']), 'Correct by task')
tokens()
failures()
