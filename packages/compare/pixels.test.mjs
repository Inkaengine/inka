/**
 * The page is compared part by part: every instance of a block at its own
 * origin, and each region on its OWN pixels, the ones no measured block inside
 * it covers. A block that is a pixel taller moves everything under it; that is
 * the block's size finding, not a pixel difference in its parent.
 *
 *   node --test packages/compare/pixels.test.mjs
 */

import assert from "node:assert/strict";
import test from "node:test";

import { chromium } from "@playwright/test";

import { COMPARE_JS } from "./pixels.mjs";

// A 300x400 white page with list items drawn at `tops`, each `h` tall: a dark
// bar near its top and a rule under it, at the item's own offsets (a taller
// item is taller below them, as a row whose thumbnail rounded up is).
const draw = (page, { tops, h, extra = [] }) =>
  page.evaluate(
    ({ tops, h, extra }) => {
      const c = document.createElement("canvas");
      c.width = 300;
      c.height = 400;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, 300, 400);
      ctx.fillStyle = "#123";
      for (const y of tops) {
        ctx.fillRect(10, y + 10, 120, 16);
        ctx.fillRect(10, y + 96, 280, 1);
      }
      for (const [x, y, w, hh, colour] of extra) {
        ctx.fillStyle = colour;
        ctx.fillRect(x, y, w, hh);
      }
      return c.toDataURL("image/png");
    },
    { tops, h, extra },
  );

const items = (tops, h) => ({ n: tops.length, w: 300, h, x: 0, y: tops[0], boxes: tops.map((y) => ({ w: 300, h, x: 0, y })) });
const main = (h) => ({ n: 1, w: 300, h, x: 0, y: 0, boxes: [{ w: 300, h, x: 0, y: 0 }] });

async function compare(a, b) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const aData = await draw(page, a);
    const bData = await draw(page, b);
    const cmp = await page.evaluate(COMPARE_JS, {
      aData,
      bData,
      deltaE: 2.3,
      cell: 16,
      maxPixels: 60_000_000,
      regions: [
        { name: "main content", a: main(400), b: main(400) },
        { name: "block:listing", a: items(a.tops, a.h), b: items(b.tops, b.h) },
      ],
    });
    return cmp.regionRatios;
  } finally {
    await browser.close();
  }
}

test("items a pixel taller each differ in size, not in their parent's pixels", async () => {
  // Every row a pixel taller than the source's, so the whole list below the
  // first row sat lower and main content "differed" by 1.21%.
  const r = await compare({ tops: [0, 100, 200], h: 100 }, { tops: [0, 101, 202], h: 101 });
  assert.equal(r["main content"].ratio, 0);
  assert.equal(r["block:listing"].ratio, 0);
});

test("a real difference in a later item is that item's, every instance compared", async () => {
  // The third item, not the first: comparing boxes[0] only would miss it.
  const r = await compare(
    { tops: [0, 100, 200], h: 100 },
    { tops: [0, 100, 200], h: 100, extra: [[10, 250, 60, 20, "#c00"]] },
  );
  assert.ok(r["block:listing"].ratio > 0.01, `listing ${r["block:listing"].ratio}`);
  assert.equal(r["main content"].ratio, 0);
});

test("a difference between the blocks is the parent's own", async () => {
  const r = await compare(
    { tops: [0, 100, 200], h: 100 },
    { tops: [0, 100, 200], h: 100, extra: [[10, 330, 200, 40, "#c00"]] },
  );
  assert.ok(r["main content"].ratio > 0.01, `main ${r["main content"].ratio}`);
  assert.equal(r["block:listing"].ratio, 0);
});

// Two 200x200 white images with filled rectangles: [colour, x, y, w, h].
async function comparePlain(aRects, bRects) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const draw = (rects) =>
      page.evaluate((rects) => {
        const c = document.createElement("canvas");
        c.width = 200;
        c.height = 200;
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, 200, 200);
        for (const [colour, x, y, w, h] of rects) {
          ctx.fillStyle = colour;
          ctx.fillRect(x, y, w, h);
        }
        return c.toDataURL("image/png");
      }, rects);
    return await page.evaluate(COMPARE_JS, {
      aData: await draw(aRects),
      bData: await draw(bRects),
      deltaE: 2.3,
      cell: 16,
      maxPixels: 60_000_000,
    });
  } finally {
    await browser.close();
  }
}

const contains = (box, [x, y, w, h]) => box.x <= x && box.y <= y && box.x + box.width >= x + w && box.y + box.height >= y + h;

test("the same picture differs nowhere", async () => {
  const r = await comparePlain([["#336699", 50, 60, 40, 40]], [["#336699", 50, 60, 40, 40]]);
  assert.equal(r.differing, 0);
  assert.deepEqual(r.clusters, []);
});

test("a colour no one could tell apart (CIEDE2000 under 2.3) is the same colour", async () => {
  const r = await comparePlain([["#336699", 50, 60, 40, 40]], [["#346699", 50, 60, 40, 40]]);
  assert.equal(r.differing, 0);
});

test("a different colour differs, every pixel of it, boxed where it is", async () => {
  const r = await comparePlain([["#336699", 50, 60, 40, 40]], [["#993333", 50, 60, 40, 40]]);
  assert.equal(r.differing, 1600);
  assert.equal(r.clusters.length, 1);
  assert.ok(contains(r.clusters[0], [50, 60, 40, 40]), "the box holds the patch (on the clustering grid)");
});

test("separate differences are separate boxes, the biggest first", async () => {
  const r = await comparePlain([["#000", 10, 10, 20, 20], ["#000", 120, 120, 40, 40]], []);
  assert.equal(r.differing, 2000);
  assert.deepEqual(r.clusters.map((c) => c.pixels), [1600, 400]);
  assert.ok(contains(r.clusters[0], [120, 120, 40, 40]));
  assert.ok(contains(r.clusters[1], [10, 10, 20, 20]));
});
