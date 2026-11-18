/**
 * The accessibility measure: axe-core on both renders a comparison makes, the
 * source's and ours, with the WCAG 2.0 / 2.1 / 2.2 A and AA rules, plus the
 * best-practice rules the caller names (a design system keeps some that axe
 * files under "best practice" rather than a WCAG tag). Each side is reduced
 * to one entry per rule, and the two are compared:
 *
 *   new     only on ours — the conversion, or our frontend, introduced it
 *   shared  on both — it was in the content or the source's design already
 *   fixed   only on the source — something we no longer do
 *
 * Pure functions over axe's result shape, so the verdicts can be tested
 * without a browser (accessibility.test.mjs).
 */

/** The axe rule tags the comparison runs: WCAG 2.0, 2.1 and 2.2, levels A and AA. */
export const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** The best-practice rules a comparison runs besides the WCAG tags: a list, even an empty one. */
function rulesOf(extraRules) {
  if (!Array.isArray(extraRules)) throw new TypeError("extraRules: the best-practice rules to run besides WCAG, as a list (an empty one for none)");
  return extraRules;
}

/** axe.run options for a comparison: the WCAG tags, plus `extraRules`. */
export function axeOptions(extraRules) {
  return {
    runOnly: { type: "tag", values: WCAG_TAGS },
    rules: Object.fromEntries(rulesOf(extraRules).map((id) => [id, { enabled: true }])),
  };
}

/**
 * Which rules an axe result came from, stored with a cached baseline. A
 * baseline checked before a rule was added never ran it, and reusing it would
 * report the rule as new on ours on every page — so it is checked again.
 */
export function axeRulesKey(extraRules) {
  return JSON.stringify({ tags: WCAG_TAGS, rules: rulesOf(extraRules) });
}

/** How many offending elements to keep per rule: enough to find it, short enough to read. */
const EXAMPLES = 3;

/** One axe run → `{ ruleId: { impact, help, helpUrl, count, targets } }`. */
export function summariseAxe(result) {
  const out = {};
  for (const v of result.violations) {
    out[v.id] = {
      impact: v.impact,
      help: v.help,
      helpUrl: v.helpUrl,
      count: v.nodes.length,
      targets: v.nodes.slice(0, EXAMPLES).map((n) => n.target.join(" ")),
    };
  }
  return out;
}

/**
 * The rules a page of ours breaks — each one fails the page. The rules run
 * are the ones the comparison chose to keep, so breaking one is wrong whatever
 * the source did:
 * which side it came from (wcagDiff) says who fixes it, not whether it fails.
 */
export function wcagFailures(ours) {
  return Object.keys(ours).sort();
}

/** Which side each rule's violation belongs to. */
export function wcagDiff(source, ours) {
  const s = new Set(Object.keys(source));
  const o = new Set(Object.keys(ours));
  return {
    new: [...o].filter((id) => !s.has(id)).sort(),
    shared: [...o].filter((id) => s.has(id)).sort(),
    fixed: [...s].filter((id) => !o.has(id)).sort(),
  };
}

/** Across a run: for each rule, how many pages it is new / shared / fixed on. */
export function wcagTotals(results) {
  const totals = { new: {}, shared: {}, fixed: {}, pages: 0 };
  for (const r of results) {
    if (!r.wcag) continue;
    totals.pages += 1;
    for (const side of ["new", "shared", "fixed"]) {
      for (const id of r.wcag.diff[side]) totals[side][id] = (totals[side][id] ?? 0) + 1;
    }
  }
  return totals;
}
