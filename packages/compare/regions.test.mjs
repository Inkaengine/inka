/**
 * Regions: a difference is reported at the deepest named region that differs,
 * with the names and selectors the comparison hands in.
 *
 *   node --test packages/compare/regions.test.mjs
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  attributeClusters,
  blockRegionsFor,
  exceptionFor,
  imageFindings,
  localise,
  reflowExcuse,
  regionsFor,
  unmappedBlockTypes,
  unsettledVerdict,
} from "./regions.mjs";

// A small comparison: a page with a header and its content, cards and a
// sidebar-to-inline-nav rule.
const MAPPING = {
  regions: [
    { name: "header", old: ".ui-header", new: ".ui-header" },
    { name: "main content", old: "main", new: "main" },
    { name: "page", old: "body", new: "body" },
  ],
  blockRegions: {
    card: { sel: ".ui-card", parts: ["card image"] },
    "card image": { sel: ".ui-card__image", partOnly: true },
    teaser: { sameAs: "card" },
    listing: { old: ".old-listing", new: ".ui-list", createdByConversion: true },
    column: { sel: ".ui-col" },
  },
  rules: {
    "sidebar-nav-inline": {
      why: "the sidebar becomes an inline nav, so the content re-wraps",
      precludes: ["page", "main content"],
      counts: { column: (times) => [2 * times, 2 * times] },
      excuses: (finding) => Boolean(finding.visual),
    },
    "heading-raised": { why: "a heading rises a level", precludes: [], counts: { column: () => [1, 1] } },
    "made-a-listing": { why: "a folder becomes a listing", precludes: [], blocksMade: ["listing"] },
    "reviewed-intro": { why: "settled on the review list", precludes: [] },
    "drift": { why: "the live source is newer", precludes: ["main content"] },
  },
  reviewRules: { "opening-paragraph": "reviewed-intro" },
  decidedPages: { "/news": ["drift"] },
  blockExceptions: [
    {
      node: "card image",
      when: "the image is 2px taller",
      why: "rounding",
      checked: ["measured"],
      decided: "2026-01-01",
      sizeOnly: true,
      // Only that difference: a bigger one is a finding.
      matches: (finding) => {
        const m = /^(\d+)x(\d+) vs (\d+)x(\d+)$/.exec(finding.verdict);
        return Boolean(m) && m[4] - m[2] === 2;
      },
    },
    { node: "listing", when: "an empty listing", why: "nothing inside to compare", checked: ["looked"], decided: "2026-01-01", precludesSubtree: true },
  ],
  unmappedTypes: ["title", "slate"],
};

const findings = {
  pages: {
    "/about": { rules: ["sidebar-nav-inline"], review: [{ kind: "opening-paragraph" }], blocks: ["card", "teaser:wide", "title", "slate", "map"] },
    "/news": { rules: [], blocks: ["listing"] },
    "/folder": { rules: ["made-a-listing"], blocks: ["listing", "card"] },
    "/odd": { rules: ["unheard-of"], blocks: [] },
  },
};

test("a page's regions leave out the ones its rules make incomparable, and say which rule did", () => {
  const r = regionsFor("/about", findings, MAPPING);
  assert.deepEqual(r.regions.map((x) => x.name), ["header"]);
  assert.deepEqual(r.precluded, [
    { name: "page", rule: "sidebar-nav-inline" },
    { name: "main content", rule: "sidebar-nav-inline" },
  ]);
  assert.deepEqual(r.rules, ["sidebar-nav-inline", "reviewed-intro"], "a settled review kind applies its rule");
  assert.deepEqual(regionsFor("/news", findings, MAPPING).rules, ["drift"], "a page settled by name");
});

test("a rule the mapping does not know, or a page the conversion did not record, stops the run", () => {
  assert.throws(() => regionsFor("/odd", findings, MAPPING), /"unheard-of".*region mapping/s);
  assert.throws(() => regionsFor("/missing", findings, MAPPING), /No conversion findings for \/missing/);
  const broken = { ...MAPPING, rules: { ...MAPPING.rules, bad: { why: "x", precludes: ["sidebar"] } } };
  assert.throws(() => regionsFor("/odd", { pages: { "/odd": { rules: ["bad"] } } }, broken), /precludes a region called "sidebar"/);
});

test("a page's blocks: one region per type it carries, a type that is another's counted as that one", () => {
  const blocks = blockRegionsFor("/about", findings, MAPPING);
  assert.deepEqual(blocks, [{ name: "block:card", old: ".ui-card", new: ".ui-card", blockType: "card", createdByConversion: false, optional: false }]);
  const folder = blockRegionsFor("/folder", findings, MAPPING);
  assert.equal(folder.find((b) => b.blockType === "listing").createdByConversion, true);
  assert.equal(folder.find((b) => b.blockType === "listing").old, ".old-listing", "a pair where the sides differ");
  assert.deepEqual(blockRegionsFor("/folder", findings, MAPPING, ["card"]).map((b) => b.blockType), ["card"], "only the types asked for");
  assert.deepEqual(unmappedBlockTypes("/about", findings, MAPPING), ["map"], "named as unmapped rather than skipped");
});

test("a difference is reported at the deepest region that differs", () => {
  const parentOf = new Map([
    ["block:card", "main content"],
    ["card image", "block:card"],
    ["main content", "page"],
  ]);
  const differing = [
    { name: "page", verdict: "1280x900 vs 1280x940" },
    { name: "main content", verdict: "1280x700 vs 1280x740" },
    { name: "card image", verdict: "300x200 vs 300x240" },
  ];
  assert.deepEqual(localise(differing, parentOf, MAPPING).map((f) => f.name), ["card image"]);
});

test("an approved exception explains its node, within the shape it is about", () => {
  assert.equal(exceptionFor({ name: "card image", verdict: "300x200 vs 300x202" }, MAPPING).node, "card image");
  assert.equal(exceptionFor({ name: "card image", verdict: "3 vs 0" }, MAPPING), null, "a size exception does not excuse a count");
  const parentOf = new Map([["card image", "block:card"]]);
  assert.deepEqual(localise([{ name: "card image", verdict: "300x200 vs 300x202" }], parentOf, MAPPING), []);
});

test("rules account for counts together, and for what they say they excuse", () => {
  const columns = { name: "block:column", a: { n: 9 }, b: { n: 6 } };
  assert.equal(reflowExcuse(columns, ["sidebar-nav-inline", "heading-raised"], {}, MAPPING), "sidebar-nav-inline + heading-raised");
  assert.equal(reflowExcuse(columns, ["sidebar-nav-inline"], {}, MAPPING), null, "2 fewer explained, 3 found");
  assert.equal(reflowExcuse({ name: "block:card", visual: true }, ["sidebar-nav-inline"], {}, MAPPING), "sidebar-nav-inline");
});

test("differing pixels belong to the deepest region that holds most of them", () => {
  const regionBoxes = {
    page: { x: 0, y: 0, w: 1280, h: 2000 },
    "block:card": { x: 100, y: 100, w: 400, h: 300 },
    "card image": { x: 100, y: 100, w: 400, h: 200 },
  };
  const parentOf = new Map([
    ["block:card", "page"],
    ["card image", "block:card"],
  ]);
  const clusters = [
    { x: 150, y: 150, width: 100, height: 50, pixels: 300 },
    { x: 0, y: 1500, width: 50, height: 50, pixels: 100 },
    { x: 2000, y: 3000, width: 10, height: 10, pixels: 100 },
  ];
  assert.deepEqual(attributeClusters(clusters, regionBoxes, parentOf), [
    { name: "card image", pixels: 300, share: 0.6 },
    { name: "page", pixels: 100, share: 0.2 },
    { name: null, pixels: 100, share: 0.2 },
  ]);
});

test("an image that loads the wrong copy is named, with what the source loads", () => {
  const img = (over) => ({ key: "/a.jpg", src: "/a.jpg", block: "block:card", drawn: { w: 300, h: 200 }, natural: { w: 300, h: 200 }, largest: 300, ...over });
  assert.match(imageFindings([img({ natural: { w: 1200, h: 800 } })], [img({ natural: { w: 600, h: 400 } })])[0].verdict, /served 1200x800 for 300x200 \(4x\).*the source loads 600x400/);
  assert.equal(imageFindings([img({ natural: { w: 150, h: 100 }, largest: 600 })], [])[0].undersized, true);
  assert.equal(imageFindings([img({ broken: true })], [])[0].broken, true);
  assert.deepEqual(imageFindings([img({})], []), []);
});

test("an approved stretch excuses an image drawn up to that factor wider, and no further", () => {
  const img = (over) => ({ key: "/a.jpg", src: "/a.jpg", block: null, drawn: { w: 1168, h: 365 }, natural: { w: 800, h: 250 }, largest: 3333, ...over });
  assert.equal(imageFindings([img({})], [])[0].undersized, true);
  assert.deepEqual(imageFindings([img({})], [], { stretch: 1168 / 768 }), []);
  assert.deepEqual(imageFindings([img({ natural: { w: 768, h: 240 } })], [], { stretch: 1168 / 768 }), []);
  assert.equal(imageFindings([img({ natural: { w: 600, h: 188 } })], [], { stretch: 1168 / 768 })[0].undersized, true);
  // Only the stretch: a copy many times too big is still reported.
  assert.equal(imageFindings([img({ drawn: { w: 300, h: 94 }, natural: { w: 3333, h: 1042 } })], [], { stretch: 2 })[0].oversized, true);
});

test("a page that did not settle says why, for each side", () => {
  assert.equal(unsettledVerdict({ loadError: "timeout" }, {}, 1000), "the page did not load (source: timeout)");
  assert.equal(
    unsettledVerdict({ settled: true }, { settled: false, unsettled: ["block:card (.ui-card)"] }, 1000),
    "a block the conversion expects never appeared in 1000ms (source ok, ours waiting for block:card (.ui-card))",
  );
});

test("the mapping is always handed in", () => {
  assert.throws(() => regionsFor("/about", findings), /region mapping/);
  assert.throws(() => localise([], new Map()), /region mapping/);
});
