/**
 * WCAG mode for the comparison: what each side's accessibility check found,
 * and which side a problem belongs to.
 *
 *   node --test packages/compare/accessibility.test.mjs
 *
 * axe runs on both renders the comparison already makes. A violation only on
 * OUR side is one the conversion (or our frontend) introduced; one on both was
 * in the content or the source's design already; one only on the source is
 * one we fixed. The three are different jobs for different people, so the
 * report keeps them apart.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  WCAG_TAGS,
  axeOptions,
  axeRulesKey,
  summariseAxe,
  wcagDiff,
  wcagFailures,
  wcagTotals,
} from "./accessibility.mjs";

const axeResult = (violations) => ({ violations });
const violation = (id, impact, targets, help = `${id} help`) => ({
  id,
  impact,
  help,
  helpUrl: `https://dequeuniversity.com/rules/axe/4.10/${id}`,
  tags: ["wcag2a"],
  nodes: targets.map((t) => ({ target: [t] })),
});

test("an axe result is reduced to one entry per rule: impact, help, how many, where", () => {
  const summary = summariseAxe(
    axeResult([
      violation("heading-order", "moderate", ["#a", "#b", "#c", "#d"]),
      violation("image-alt", "critical", ["img.hero"]),
    ]),
  );
  assert.deepEqual(summary, {
    "heading-order": {
      impact: "moderate",
      help: "heading-order help",
      helpUrl: "https://dequeuniversity.com/rules/axe/4.10/heading-order",
      count: 4,
      // A few examples, not every node: enough to find it, short enough to read.
      targets: ["#a", "#b", "#c"],
    },
    "image-alt": {
      impact: "critical",
      help: "image-alt help",
      helpUrl: "https://dequeuniversity.com/rules/axe/4.10/image-alt",
      count: 1,
      targets: ["img.hero"],
    },
  });
});

test("a violation only on ours is new; on both, shared; only on the source, fixed", () => {
  const source = summariseAxe(axeResult([violation("color-contrast", "serious", ["p"]), violation("image-alt", "critical", ["img"])]));
  const ours = summariseAxe(axeResult([violation("color-contrast", "serious", ["p"]), violation("heading-order", "moderate", ["h4"])]));
  assert.deepEqual(wcagDiff(source, ours), {
    new: ["heading-order"],
    shared: ["color-contrast"],
    fixed: ["image-alt"],
  });
});

test("a clean page on both sides has nothing to report", () => {
  assert.deepEqual(wcagDiff(summariseAxe(axeResult([])), summariseAxe(axeResult([]))), {
    new: [],
    shared: [],
    fixed: [],
  });
});

test("the site-wide totals count pages per rule, by which side it belongs to", () => {
  const pages = [
    { wcag: { diff: { new: ["heading-order"], shared: ["color-contrast"], fixed: [] } } },
    { wcag: { diff: { new: ["heading-order"], shared: [], fixed: ["image-alt"] } } },
    { fatal: "blank page" },
  ];
  assert.deepEqual(wcagTotals(pages), {
    new: { "heading-order": 2 },
    shared: { "color-contrast": 1 },
    fixed: { "image-alt": 1 },
    pages: 2,
  });
});

// A design system's best-practice rules, as a caller would name them.
const EXTRA = ["page-has-heading-one", "heading-order", "landmark-one-main"];

test("the run covers WCAG 2.0–2.2 A/AA, plus the best-practice rules the caller names", () => {
  const options = axeOptions(EXTRA);
  assert.deepEqual(options.runOnly, {
    type: "tag",
    values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
  });
  assert.deepEqual(Object.keys(options.rules).sort(), [...EXTRA].sort());
  assert.ok(Object.values(options.rules).every((r) => r.enabled === true));
  assert.deepEqual(axeOptions([]).rules, {});
});

test("the best-practice rules are always named, never assumed", () => {
  assert.throws(() => axeOptions(), /extraRules/);
  assert.throws(() => axeRulesKey(), /extraRules/);
});

test("a baseline's axe result is reused only when it ran the rules this run does", () => {
  const key = axeRulesKey(EXTRA);
  assert.equal(key, axeRulesKey(EXTRA), "the same rules give the same key");
  assert.ok(key.includes("page-has-heading-one"));
  // A source baseline axe'd before a rule was added never ran it: reusing it
  // would report the rule as new on ours on every page.
  assert.notEqual(key, axeRulesKey(["heading-order"]));
  assert.notEqual(key, JSON.stringify({ tags: WCAG_TAGS, rules: ["heading-order"] }));
});

test("every rule axe finds on ours fails the page, whether or not the source breaks it too", () => {
  // The rules the comparison runs are the ones it chose to keep; a page of ours
  // that breaks one is wrong whatever the source did. Which side it came from
  // says who fixes it, not whether it fails.
  const ours = summariseAxe(axeResult([violation("heading-order", "moderate", ["h3"]), violation("link-name", "serious", ["a"])]));
  assert.deepEqual(wcagFailures(ours), ["heading-order", "link-name"]);
  assert.deepEqual(wcagFailures({}), []);
});
