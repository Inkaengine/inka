# @inka/compare

Compares two renders of a site: a converted site against the one it came from,
or a design system's examples against a frontend's reproduction of them. One
engine; each comparison is a set of settings (the two sources, how pages or
components are paired, which measures, and its approved differences).

The measures here so far:

| Module | Measures |
|---|---|
| `pixels` | Two screenshots compared in CIEDE2000, anti-aliased edges excused, the differing pixels clustered into boxes |
| `geometry` | Two element trees walked together to the first element whose box differs, or that only one side has |
| `accessibility` | axe-core on both sides: which violations are new on ours, shared, or fixed |

And what a comparison runs on:

| Module | |
|---|---|
| `fetch` | A request retried on a network failure, then failed loudly |
| `source-archive` | A source site recorded once (HAR) and replayed with the network shut |

Nothing here knows a design system or a site: a class prefix, the
best-practice accessibility rules to keep, and where a recording lives are the
caller's.

    node --test packages/compare/*.test.mjs   # pnpm test:compare
