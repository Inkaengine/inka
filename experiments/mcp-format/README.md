# MCP page-format experiment

Which page format and which kind of write an agent gets right, for the MCP
proposal (`proposals/mcp-content-authoring.md`).

## What it compares

One canonical form (an ordered block tree, no uids, rich text as markdown) and
five ways to give it to an agent, with the same tasks and the same block
catalogue (generated from `tests-playwright/fixtures/shared-block-schemas.js`):

| format | the agent reads and returns |
|---|---|
| `blockmd` | the page as blockmd, with the page's own prototype rules |
| `tagged` | markdown prose, other blocks as `<block type="…">{json}</block>` |
| `simple` | a JSON array of blocks, rich text as `{"md": …}` |
| `stored` | Volto's stored `blocks` / `blocks_layout` JSON |
| `ops` | reads `simple` with an `@uid` per block, returns `edit_blocks` operations |

Each answer is parsed, validated against the schemas (`validate.mjs`), and
compared with the task's expected page (`tasks.mjs`). A rejected answer gets one
repair turn with the error, as the MCP tool would give it.

## Files

- `formats.mjs` — converters to and from the canonical form
- `ops.mjs` — the `edit_blocks` operations
- `describe.mjs` — what the MCP tells the agent: each format, the block catalogue
- `tasks.mjs` — the editing tasks and their expected results
- `validate.mjs` — schema validation of a result
- `score.mjs` — canonicalisation and comparison
- `run.mjs` — runner (DeepInfra, OpenAI-compatible); `--perfect`, `--rescore`
- `selftest.mjs` — every format round-trips every docs page; the validator accepts them all
- `summarise.py` — tables from a `results/*.jsonl` run

## Running

```sh
node selftest.mjs                 # converters are lossless on all docs pages
node run.mjs --perfect            # every expected answer scores ok in every format
set -a; . path/to/.env; set +a    # DEEPINFRA_API_KEY
node run.mjs --models anthropic/claude-haiku-4-5 --reps 3 --run myrun
python3 summarise.py results/myrun.jsonl
```

## Results

See the "Experiment results" section of the proposal. Raw replies are in
`results/*.jsonl`; `round2.lenient.jsonl` is round 2 re-scored ignoring a copied
`<<<PAGE` marker (a prompt artefact, now handled by default).
