# MCP appearance experiment

How does an agent learn what blocks look like? Four cumulative setups (schema
catalogue → + descriptions → + block screenshots → + render-and-revise loop),
three page briefs, pages rendered by a real frontend and judged blind.
Results are in `results/<run>.jsonl`; summarise with `summarise.py`.

## Files

- `briefs.mjs` — the page briefs
- `examples.mjs` — the block library: description (first paragraph of the docs
  example page) and a screenshot of the block rendered by the frontend
- `render.mjs` — renders a draft by answering the frontend's own content fetch
  (client-rendered frontends only); counts drawn blocks (attribute or hydra comment)
- `run.mjs` — runner; draft → validate (+1 repair) → render → (loop: revise) → judge
- `summarise.py` — tables from `results/<run>.jsonl`

## Running

Start the mock API and a frontend once (Makefile ports): `pnpm start:mock-api`,
and `pnpm start:test-frontend` or `pnpm start:nuxt:test` (the inka.sh frontend).

```sh
RENDER_FRONTEND=http://localhost:3003 node examples.mjs <libDir>
set -a; . path/to/.env; set +a   # DEEPINFRA_API_KEY
RENDER_FRONTEND=http://localhost:3003 node run.mjs --library <libDir> \
  --models anthropic/claude-haiku-4-5,Qwen/Qwen3.5-27B --reps 3 --run myrun
python3 summarise.py results/myrun.jsonl
```

Images in briefs must be absolute backend URLs (the Nuxt frontend resolves a bare
path against itself). YouTube refuses localhost embeds, so the video example and
brief use the docs' local demo video.
