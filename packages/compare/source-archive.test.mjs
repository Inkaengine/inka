/**
 * The source site is recorded once and replayed from then on: a compare never
 * loads the live site unless it was asked to record.
 *
 * Against a local server, never the live site.
 *
 *   node --test packages/compare/source-archive.test.mjs
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { chromium } from "@playwright/test";

import { NotRecorded, RedirectArchive, archiveFile, useArchive } from "./source-archive.mjs";

const page = `<html><head><link rel="stylesheet" href="/site.css"></head><body><h1>Our legislation</h1></body></html>`;

async function serve() {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    if (req.url === "/page") res.writeHead(200, { "content-type": "text/html" }).end(page);
    else if (req.url === "/site.css") res.writeHead(200, { "content-type": "text/css" }).end("h1 { color: rgb(1, 2, 3); }");
    else res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, hits, base: `http://127.0.0.1:${server.address().port}` };
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "compare-archive-"));

async function render(browser, url, file, record) {
  const context = await browser.newContext();
  await useArchive(context, file, { record });
  const p = await context.newPage();
  await p.goto(url, { waitUntil: "load" });
  const got = await p.evaluate(() => [document.querySelector("h1").textContent, getComputedStyle(document.querySelector("h1")).color]);
  await context.close();
  return got;
}

test("a recorded page replays with the site gone", async () => {
  const browser = await chromium.launch();
  const { server, hits, base } = await serve();
  const file = path.join(tmp(), "page.har");
  try {
    assert.deepEqual(await render(browser, `${base}/page`, file, true), ["Our legislation", "rgb(1, 2, 3)"]);
    assert.deepEqual(hits.sort(), ["/page", "/site.css"]);
    await new Promise((r) => server.close(r));
    // The server is gone: everything comes from the archive, styles included.
    assert.deepEqual(await render(browser, `${base}/page`, file, false), ["Our legislation", "rgb(1, 2, 3)"]);
  } finally {
    await browser.close();
  }
});

test("replaying asks the site for nothing, even what was not recorded", async () => {
  const browser = await chromium.launch();
  const { server, hits, base } = await serve();
  const file = path.join(tmp(), "page.har");
  try {
    await render(browser, `${base}/page`, file, true);
    hits.length = 0;
    const context = await browser.newContext();
    await useArchive(context, file, { record: false });
    const p = await context.newPage();
    await p.goto(`${base}/page`, { waitUntil: "load" });
    // A request the recording never saw is refused, not sent.
    const status = await p.evaluate((u) => fetch(u).then((r) => r.status, () => "refused"), `${base}/not-recorded`);
    await context.close();
    assert.equal(status, "refused");
    assert.deepEqual(hits, []);
  } finally {
    await new Promise((r) => server.close(r));
    await browser.close();
  }
});

test("a request the recording saw fail is refused at replay, not left hanging", async () => {
  // The recording keeps a request still in flight when the page was saved
  // (YouTube's ad_status.js) as status -1, and replaying that entry never
  // answered: the page's load never fired, and the page went uncompared.
  const browser = await chromium.launch();
  const { server, base } = await serve();
  const file = path.join(tmp(), "page.har");
  try {
    await render(browser, `${base}/page`, file, true);
    await new Promise((r) => server.close(r));
    const har = JSON.parse(fs.readFileSync(file, "utf8"));
    const css = har.log.entries.find((e) => e.request.url.endsWith("/site.css"));
    css.response = { ...css.response, status: -1, statusText: "", _failureText: "net::ERR_ABORTED", content: { size: -1, mimeType: "x-unknown" } };
    fs.writeFileSync(file, JSON.stringify(har));
    const started = Date.now();
    const [, colour] = await render(browser, `${base}/page`, file, false);
    assert.ok(Date.now() - started < 10_000, "the page loaded");
    assert.equal(colour, "rgb(0, 0, 0)");
  } finally {
    await browser.close();
  }
});

test("a page never recorded fails loudly instead of loading the live site", async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    await assert.rejects(useArchive(context, path.join(tmp(), "missing.har"), { record: false }), NotRecorded);
    await context.close();
  } finally {
    await browser.close();
  }
});

test("redirect answers are kept with the archive; one never recorded is unknown, and counted", () => {
  const dir = tmp();
  const recorded = new RedirectArchive(dir);
  recorded.set("/old.pdf", "/new.pdf");
  recorded.set("/same", null);
  const replayed = new RedirectArchive(dir);
  assert.ok(fs.existsSync(path.join(dir, "redirects.json")), "kept beside the pages");
  assert.equal(replayed.has("/old.pdf"), true);
  assert.equal(replayed.get("/old.pdf"), "/new.pdf");
  assert.equal(replayed.get("/same"), null);
  assert.equal(replayed.has("/never"), false);
});

test("a page's recording is named by its slug, in the archive directory given", () => {
  assert.equal(archiveFile("/archive", "about-us__contact"), path.join("/archive", "about-us__contact.har"));
});

test("a redirect archive needs its directory", () => {
  assert.throws(() => new RedirectArchive(), /archive directory/);
});
