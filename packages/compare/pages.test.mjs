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
