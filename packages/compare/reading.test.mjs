/**
 * The reading measure: what a page still says — its words, and where its
 * links, images and videos point — compared line by line, never its markup.
 *
 *   node --test packages/compare/reading.test.mjs
 */
import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

import {
  chromeDiff,
  chromeLists,
  excuseChrome,
  excuseContent,
  followSourceRedirects,
  lineKey,
  markdownDiff,
  normaliseUrl,
  pageContent,
  pageMarkdown,
} from "./reading.mjs";

const parseHTML = (html) => ({ document: new JSDOM(html).window.document });
// A design with closed panels still read, inline icons, and sr-only link descriptions.
const reader = { openPanelClass: "ui-panel", inlineIconClass: "ui-icon", linkDescriptionClass: "sr-only" };
const read = (body, options = {}) =>
  pageMarkdown(`<!doctype html><html><body><main>${body}</main></body></html>`, { parseHTML, reader, ...options });

test("the same destination reads the same, however each site writes it", () => {
  const origins = ["https://old.example", "http://cms:8080"];
  const strip = { origins, stripPrefixes: [/^\/\d+\/mnt\/site/, /^\/site/] };
  assert.equal(normaliseUrl("https://old.example/about/", strip), "/about");
  assert.equal(normaliseUrl("http://cms:8080/04/mnt/site/about", strip), "/about");
  assert.equal(normaliseUrl("/site/about?utm=1", strip), "/about");
  assert.equal(normaliseUrl("/report.pdf/@@download/file", strip), "/report.pdf");
  assert.equal(normaliseUrl("/report.pdf/%40%40download/file", strip), "/report.pdf");
  assert.equal(normaliseUrl("/photo.jpg/@@images/image/large", strip), "/photo.jpg");
  assert.equal(normaliseUrl("#section", { page: "/about" }), "/about#section", "an in-page link is to its page");
  assert.equal(normaliseUrl("mailto:a@example.org?subject=x"), "mailto:a@example.org");
});

test("a page reads as what a reader takes away: headings, words and where links point", () => {
  const md = read(
    `<h2>Contact <span aria-hidden="true">east</span></h2>
     <p>Read the <a href="/guide/">guide</a> first.</p>
     <img src="/images/map.png" alt="A map">`,
  );
  assert.deepEqual(md, ["## Contact", "Read the [guide](/guide) first.", "![A map](/images/map.png)"]);
});

test("a page's words are counted node by node, so words that touch across elements stay apart", () => {
  // The DOM's own concatenation would read "the report" + "Section 4" as
  // "reportsection", a word neither side has.
  const { words } = pageContent("<main><p><span>the report</span><span>Section 4</span></p></main>", { parseHTML });
  assert.deepEqual(words, ["the", "report", "section"], "short words (a digit) left out");
});

test("a design's closed panel is read; its icon is recorded; a link's sr-only description is not", () => {
  const md = read(
    `<div class="ui-panel" hidden><p>Panel words</p></div>
     <div class="ui-icon" aria-hidden="true"><svg></svg></div>
     <p><a href="/x" aria-describedby="d1">Go</a><span id="d1" class="sr-only">(opens in new window)</span></p>
     <div hidden><p>Hidden words</p></div>`,
  );
  assert.ok(md.includes("Panel words"), "a closed panel's words are the page's");
  assert.ok(md.includes("!icon(inline-svg)"));
  assert.ok(!md.some((l) => l.includes("opens in new window")));
  assert.ok(!md.some((l) => l.includes("Hidden words")), "hidden content is not read");
});

test("a design without those rules reads its panels as hidden", () => {
  const md = read(`<div class="ui-panel" hidden><p>Panel words</p></div>`, {
    reader: { openPanelClass: null, inlineIconClass: null, linkDescriptionClass: null },
  });
  assert.deepEqual(md, []);
});

test("the diff is the lines one side has and the other does not, repeated lines counted", () => {
  const d = markdownDiff(["# Title", "A", "B", "B"], ["# Title", "B", "C"]);
  assert.deepEqual(d.missing, ["A", "B"]);
  assert.deepEqual(d.extra, ["C"]);
  assert.ok(d.score > 0);
  assert.equal(markdownDiff(["A"], ["A"]).score, 0);
});

test("a link is compared by where it points, not its fragment or a list marker", () => {
  assert.equal(lineKey("- [Guide](/guide#top)"), lineKey("[Guide](/guide)"));
  assert.equal(lineKey("![x](/a/b/map.png)"), lineKey("![y](/c/map.png)"), "an image by its file");
});

test("an approved content difference excuses its line on its pages, and says it did", () => {
  const exception = { label: "skip-link", why: "ours has a skip link", when: (p) => p === "/about", extra: ["[Skip to content](/about)"] };
  const struct = markdownDiff(["A"], ["A", "[Skip to content](/about)", "New line"]);
  const { struct: left, fired } = excuseContent(struct, "/about", [exception]);
  assert.deepEqual(left.extra, ["New line"], "anything else is still a finding");
  assert.deepEqual(fired, [exception]);
  assert.deepEqual(excuseContent(struct, "/other", [exception]).fired, [], "not on another page");
});

test("an exception may pair a source line with one of ours: the same thing said differently", () => {
  const exception = { label: "date-zone", why: "dates in the site's zone", pairs: (a, b) => a.replace("4", "5") === b };
  const { struct, fired } = excuseContent(markdownDiff(["Published 4 May"], ["Published 5 May"]), "/news", [exception]);
  assert.deepEqual([struct.missing, struct.extra], [[], []]);
  assert.equal(fired.length, 1);
});

test("a link the source redirects is the link to where it lands", () => {
  const struct = markdownDiff(["See [the report](/old/report.pdf)."], ["See [the report](/new/report.pdf)."]);
  const { struct: left, followed } = followSourceRedirects(struct, { "/old/report.pdf": "/new/report.pdf" }, []);
  assert.deepEqual([left.missing, left.extra], [[], []]);
  assert.equal(followed.length, 1);
});

const CHROME = {
  nav: { list: ".ui-nav__list", item: ":scope > a" },
  breadcrumbs: ".ui-crumbs li",
  footer: { links: "footer a", except: ".ui-built-with" },
};
const chromePage = (nav, crumbs, footer) => `<!doctype html><html><body>
  <ul class="ui-nav__list">${nav.map((n) => `<li><a href="#">${n}</a></li>`).join("")}</ul>
  <ol class="ui-crumbs">${crumbs.map((c) => `<li>${c}</li>`).join("")}</ol>
  <footer>${footer.map((f) => `<a href="#">${f}</a>`).join("")}<p class="ui-built-with"><a href="#">Built by X</a></p></footer>
</body></html>`;

test("the chrome is read as lists: nav, breadcrumbs and footer, by the design's selectors", () => {
  const lists = chromeLists(chromePage(["Home", "About"], ["Home", "About"], ["Privacy", "Contact"]), CHROME, parseHTML);
  assert.deepEqual(lists, { nav: ["Home", "About"], breadcrumbs: ["Home", "About"], footer: ["Privacy", "Contact"] });
});

test("a chrome list differs in membership or only in order, and an approved link is excused", () => {
  const source = { nav: ["Home", "About", "News"], breadcrumbs: [], footer: ["Sitemap", "Privacy"] };
  const ours = { nav: ["Home", "News", "About"], breadcrumbs: [], footer: ["Privacy"] };
  const sitemap = { label: "no-sitemap", list: "footer", missing: ["Sitemap"] };
  const { lists, fired } = excuseChrome(source, ours, [sitemap]);
  assert.deepEqual(fired, [sitemap]);
  assert.deepEqual(chromeDiff(lists, ours), [
    { name: "chrome: nav", verdict: "same items, different order: the source has Home · About · News; ours has Home · News · About" },
  ]);
});

test("the design's reader, chrome and parser are always handed in", () => {
  assert.throws(() => pageMarkdown("<main></main>", { parseHTML }), /reader/);
  assert.throws(() => pageMarkdown("<main></main>", { reader }), /parseHTML/);
  assert.throws(() => chromeLists("<body></body>", undefined, parseHTML), /chrome/);
});
