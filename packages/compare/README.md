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
| `markup` | A node as a canonical string: structure compared, instance data (text, URLs, ids) tokenised; a comparison may add its own rewrite |
| `reading` | What a page still says: each side as markdown (its words, headings, and where links, images and videos point), diffed line by line, with URLs normalised; approved content lines, redirects the source followed, and the header, breadcrumb and footer lists. The design's reader rules, its chrome selectors and the HTML parser are the caller's |
| `regions` | Where a difference is: the comparison's named regions (selectors on each side, and the parts within a block), each difference reported at the deepest region that differs, differing pixels given to the region that holds them, and the conversion's rules and approved exceptions applied. The mapping is the caller's |
| `accessibility` | axe-core on both sides: which violations are new on ours, shared, or fixed |

The runner, `inka-compare-sites --settings=<module>`, compares a converted site
with its source page by page, with every measure, and writes a report. The
settings module names the two sites, the API the pages are listed from, the
conversion's findings, the region mapping, the reading options, the approved
exceptions and the rest; the runner names none.

An approved exception can also name a markup change CSS cannot make, run in
the page before it is shot: `normalise` names functions from the settings'
`normalisers`, which bring the SOURCE to the conversion's markup, and
`normaliseOurs` names functions from `oursNormalisers`, which set aside on
OURS a difference the exception approves (a run of text, where CSS can only
hide elements). Each is `(document) => void`, run with `page.evaluate`.

And what a comparison runs on:

| Module | |
|---|---|
| `fetch` | A request retried on a network failure, then failed loudly |
| `pages` | Every page of the source site, or the fewest that still show every block it uses; a page's slug |
| `source-archive` | A source site recorded once (HAR) and replayed with the network shut |

Nothing here knows a design system or a site: a class prefix, the
best-practice accessibility rules to keep, and where a recording lives are the
caller's.

    node --test packages/compare/*.test.mjs   # pnpm test:compare
