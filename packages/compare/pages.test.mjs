/**
 * Which pages a comparison run looks at: every page of the source site, or the
 * fewest that still show every block the site uses.
 *
 *   node --test packages/compare/pages.test.mjs
 */
import assert from "node:assert/strict";
import test from "node:test";

import { blockSignatures, pageSource, slugOf } from "./pages.mjs";

const OPTIONS = { types: ["Document"], stripPrefixes: [/^\/site/], addedByConversion: /^\/templates(\/|$)/ };

test("a short path is its readable slug", () => {
  assert.equal(slugOf("/"), "home");
  assert.equal(slugOf("/about/our-history"), "about__our-history");
});

test("two long paths that start alike get different slugs, each the same every time", () => {
  // Two releases that shared their first 110 characters once shared one baseline.
  const stem = `/news/${"a-very-long-media-release-title-that-goes-on-".repeat(3)}`;
  const a = slugOf(`${stem}-1900`);
  const b = slugOf(`${stem}-1900-second-report`);
  assert.notEqual(a, b);
  assert.ok(a.length <= 120 && b.length <= 120);
  assert.ok(a.startsWith("news__a-very-long-media-release"));
  assert.equal(slugOf(`${stem}-1900`), a);
});

const layout = (main) => ({
  "@type": "contentLayout",
  blocks: Object.fromEntries(main.map((b, i) => [`b${i}`, b])),
  blocks_layout: { main: main.map((_, i) => `b${i}`) },
});
const PAGES = {
  "/a": { blocks: { l: layout([{ "@type": "slate" }]) } },
  "/b": { blocks: { l: layout([{ "@type": "slate" }, { "@type": "listing", variation: "listItem" }]) } },
};

test("a block nested in another has its signature", () => {
  assert.deepEqual(blockSignatures(PAGES["/b"]).sort(), ["contentLayout:-", "listing:listItem", "slate:-"]);
});

test("a link a block holds is not a block, though it names its target's type", () => {
  const page = { blocks: { t: { "@type": "teaser", href: [{ "@id": "/x", "@type": "Document" }] } } };
  assert.deepEqual(blockSignatures(page), ["teaser:-"]);
});

test("a listing's signature names what it maps", () => {
  const page = { blocks: { l: { "@type": "listing", variation: "listItem", fieldMapping: { title: {}, Topic: {} } } } };
  assert.deepEqual(blockSignatures(page), ["listing:listItem:Topic,title"]);
});

test("the sample picks the page whose nested block no other page has", async () => {
  const { samplePages } = pageSource({ api: "", apiJson: async (url) => PAGES[url], concurrency: 1, ...OPTIONS });
  assert.deepEqual(await samplePages(["/a", "/b"]), ["/b"]);
});

// The source is replayed from recordings, made once. A page the site gained
// since has none, so a sample of it compares nothing: the sample takes a
// recorded page carrying the same blocks instead.
const RECORDED_PAGES = {
  "/new": { blocks: { l: layout([{ "@type": "listing", variation: "listItem" }]) } },
  "/old": { blocks: { l: layout([{ "@type": "slate" }, { "@type": "listing", variation: "listItem" }]) } },
  "/plain": { blocks: { l: layout([{ "@type": "slate" }]) } },
};

test("the sample takes a recorded page over one with no recording that shows the same blocks", async () => {
  const { samplePages } = pageSource({ api: "", apiJson: async (url) => RECORDED_PAGES[url], concurrency: 1, ...OPTIONS });
  // Unrestricted, the page with no recording is picked first.
  assert.deepEqual(await samplePages(["/new", "/old", "/plain"]), ["/new", "/old"]);
  assert.deepEqual(await samplePages(["/new", "/old", "/plain"], Infinity, { recorded: (p) => p !== "/new" }), ["/old"]);
});

test("a page with no recording is not compared, and a block only it shows is said to go unchecked", async () => {
  // A page made on the new site after the recording: the source never had it.
  const pages = { ...RECORDED_PAGES, "/video": { blocks: { l: layout([{ "@type": "video" }]) } } };
  const { samplePages } = pageSource({ api: "", apiJson: async (url) => pages[url], concurrency: 1, ...OPTIONS });
  const said = [];
  const log = console.log;
  console.log = (line) => said.push(line);
  try {
    assert.deepEqual(await samplePages(["/video", "/old"], Infinity, { recorded: (p) => p !== "/video" }), ["/old"]);
  } finally {
    console.log = log;
  }
  assert.ok(
    said.some((l) =>
      /1 page\(s\) with no recording are not compared; 1 block signature\(s\) only they show go unchecked: video:- \(\/video\)/.test(l),
    ),
    said.join("\n"),
  );
});

test("every page: the source's paths under its mount, without the pages the conversion added", async () => {
  const asked = [];
  const items = ["/site/about", "/site", "/site/templates/footer", "/site/news/one"].map((p) => ({ "@id": `https://cms.example${p}` }));
  const { allPages } = pageSource({
    api: "https://cms.example/site",
    apiJson: async (url) => {
      asked.push(url);
      return { items, items_total: items.length };
    },
    concurrency: 1,
    ...OPTIONS,
  });
  assert.deepEqual(await allPages(), ["/about", "/", "/news/one"]);
  assert.match(asked[0], /@search\?portal_type=Document&b_size=200&b_start=0$/);
});

test("what a page is, and where pages live, are always said", () => {
  assert.throws(() => pageSource({ api: "", apiJson: async () => ({}), concurrency: 1 }), /types/);
});
