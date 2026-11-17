#!/usr/bin/env node
/**
 * Compare a CONVERTED site against the SOURCE site it was converted from, page
 * by page. WHICH sites, and everything else that belongs to one comparison
 * rather than to comparing, comes from a settings module (`--settings`).
 *
 * TWO questions, ONE render, and neither of them is about HTML.
 *
 * "Does it say the same?" — the document a reader takes away: the words, and
 * where the links, images and videos point. "Does it look the same?" — the
 * pixels. Both are ways for a conversion to be wrong and neither implies the
 * other: a dropped paragraph is a fraction of a percent of pixels, and a colour
 * that shifted moves no words at all.
 *
 * The markup is deliberately NOT compared. The two sites are different
 * implementations (an older CMS's theme vs our frontend) with
 * different markup and partly different CSS, so a structural diff reports a
 * hundred differences nobody can see and buries the two questions above.
 *
 * How the reading half is measured: each side's rendered DOM is converted to
 * markdown (`pageMarkdown`, @inka/compare/reading) and the two are diffed.
 * Markdown because it keeps what a reader gets — the words, the headings, and
 * the targets of links, images and videos — and discards the wrappers, classes
 * and attribute order the two stacks were never going to agree on.
 *
 * THE RENDERED DOM, always. There is no fetch-the-server-HTML path any more.
 * It existed as a fast mode and it read a document nobody sees: pre-inkation,
 * before a client block mounts or a design system's script runs, which is silent about
 * exactly the content most likely to have been lost in conversion. We always
 * have the rendered page — a render answers both halves at once, and the OLD
 * side is cached per page, so the second run is not paying for it twice.
 *
 * The conversion is meant to REPRODUCE the design, so a component in a
 * different place or a different colour is a defect, not noise — there is no
 * shift tolerance here on purpose. The only difference that gets absorbed is
 * the one neither site controls: how two browsers rasterise text and edges.
 *
 *  - Both sides are shot at the same viewport width, full page.
 *  - Pixels are compared in CIELAB with the CIEDE2000 colour-difference
 *    formula (the metric looks-same uses, default ΔE 2.3): perceptually
 *    equal colours compare equal, and a genuinely different colour does not.
 *  - Anti-aliased edge pixels are excused by pixelmatch's heuristic — a pixel
 *    that is a local extreme on one side and not the other is a rasterisation
 *    artefact, not a change.
 *  - Differing pixels are CLUSTERED into bounding boxes, so the report says
 *    "these three regions differ, at these coordinates" rather than handing
 *    you a percentage.
 *  - Page-height differences are reported on their own: a taller page means
 *    something was added, dropped or reflowed, and that is worth its own line.
 *  - Exceptions can MASK regions (hidden on both sides before the shot) or
 *    raise the tolerance for one page — each is printed when it fires.
 *
 *   S=--settings=compare-settings.mjs
 *   inka-compare-sites $S --pages=/about
 *   inka-compare-sites $S --sample       # one page per block+variation
 *   inka-compare-sites $S --sample 8     # ...capped at 8, rarest first
 *   inka-compare-sites $S --limit=40 --concurrency=3
 *   inka-compare-sites $S --max-diffs=5   # stop once 5 pages differ
 *
 * Every flag takes `--key=value` or `--key value`.
 *
 * A conversion defect is usually SITE-WIDE — one wrong colour or a shifted
 * header differs on every page — so a full run spends its time re-reporting
 * one problem. --max-diffs stops once that many pages have differed; the
 * pages not compared are COUNTED in the summary, never silently dropped.
 */
import { describeDivergence, firstDivergence, regionSkeletons } from "./geometry.mjs";
import fs from "node:fs";
import { mapLimit, pageSource, parseArgs, slugOf } from "./pages.mjs";
import { attributeClusters, dropPrecludedSubtrees, imageFindings, selectorOverlaps, unsettledVerdict } from "./regions.mjs";
import { createHash } from "node:crypto";
import path from "node:path";
import { chromium } from "@playwright/test";
import { createRequire } from "node:module";
import { fetchRetrying, Unreachable } from "./fetch.mjs";
import { COMPARE_JS } from "./pixels.mjs";
import { archiveFile, NotRecorded, RedirectArchive, useArchive } from "./source-archive.mjs";
import { axeOptions, axeRulesKey, summariseAxe, wcagDiff, wcagFailures, wcagTotals } from "./accessibility.mjs";

const args = parseArgs(process.argv.slice(2));

// WHAT is compared: the two sites, where the pages are listed, the
// conversion's findings, the approved exceptions and how a visitor's consent
// is seeded. A module that default-exports them. No default: a comparison of
// nothing in particular is not one.
if (!args.settings) {
  throw new Error("compare-sites: --settings=<module> names the comparison to run");
}
const settings = (await import(path.resolve(args.settings))).default;
// The comparison's own knowledge, from its settings: its region mapping bound
// to @inka/compare/regions, its reading (@inka/compare/reading, plus the
// review list the conversion kept), how ours is wrapped into one content area,
// and the source's markup normalisers.
const {
  BLOCK_REGIONS,
  RULES,
  blockRegionsFor,
  blockTypesOn,
  exceptionFor,
  localise,
  reflowExcuse,
  regionsFor,
  unmappedBlockTypes,
} = settings.regions;
const { wrap: wrapContentArea, unwrap: unwrapContentArea } = settings.contentArea;
const SOURCE_NORMALISERS = settings.normalisers;
const OLD = settings.source.url;
const NEW = settings.ours.url;
const API = settings.api;
const AUTH = settings.source.auth;
const NEW_AUTH = settings.ours.auth;
// A request to the API, retried (@inka/compare/fetch): an API machine that
// auto-suspends times out while it wakes, and that ended whole runs (a
// 64-page run, twice).
const apiFetch = (url) => fetchRetrying(url, { headers: { Accept: "application/json" } });

// What the conversion did. `--findings=<file>` reads a local copy instead of
// the settings' own source, for working on this script.
//
// No fallback. Without it the comparison cannot tell a restructured page from a
// broken one, and would report all eleven reflowed pages as defects.
const findings = args.findings ? JSON.parse(fs.readFileSync(args.findings, "utf8")) : await settings.findings();

const OUT = args.out ?? settings.out;
const WIDTH = Number(args.width ?? 1280);
// ΔE 2.3 is the CIEDE2000 "just noticeable difference" looks-same defaults to.
const DELTA_E = Number(args["delta-e"] ?? 2.3);
// Cluster grid resolution, in device pixels.
const CELL = Number(args.cell ?? 16);
// Fraction of compared pixels allowed to differ before a page is a failure.
// Small on purpose: we are reproducing a design, not approximating it.
const DEFAULT_TOLERANCE = Number(args.tolerance ?? 0.002);
// Recording the live source (@inka/compare/source-archive) is one page at a time, with
// a pause between pages: it is someone else's production site.
const RECORD = Boolean(args["record-source"]);
const RECORD_PAUSE = 2_000;
const CONCURRENCY = RECORD ? 1 : Number(args.concurrency ?? 3);
// Every run checks every page with axe-core on both renders — WCAG 2.0/2.1/2.2
// A and AA, plus the best-practice rules the design keeps — and reports which
// violations are new on ours, shared with the source, or fixed (@inka/compare/accessibility).
// It was a --wcag flag, and no full run ever passed it: a page with no h1 went
// unseen. A few seconds a page.
// The caller's axe-core: the comparison runs from its project, which depends on it.
const AXE_PATH = createRequire(path.resolve("package.json")).resolve("axe-core/axe.min.js");
// Stop after this many DIFFERING pages (the ones already in flight finish, so
// the real count can land a little over). Unlimited unless asked.
const MAX_DIFFS = args["max-diffs"] ? Number(args["max-diffs"]) : Infinity;
let diffCount = 0;
let notCompared = 0;
// Per-shot budgets. Deliberately tight: this tool is used most when something
// is broken, and that is exactly when generous timeouts make it useless.
const NAV_TIMEOUT = Number(args["nav-timeout"] ?? 20000);
// 4s was too short and the timeout was swallowed, so a page whose content
// arrives client-side got shot mid-flight and every difference it produced was
// noise. A source's listings may be fetched in the browser: at 4s a listing
// measured as an empty block, which read as "the conversion dropped six cards"
// and was really "we looked too early". 30s, not 12s: a source's listings and
// our API's first image scales
// after a pack both ran past 12s.
const SETTLE_TIMEOUT = Number(args["settle-timeout"] ?? 30000);

const {
  pageMarkdown,
  markdownDiff,
  excuseContent,
  excuseReviewed,
  followSourceRedirects,
  sourcePathsOf,
  chromeLists,
  chromeDiff,
  excuseChrome,
  listingCopyAdded,
  addedDescriptionsOf,
  CHROME_VERSION,
} = settings.reading;
// Descriptions the conversion gave pages that had none: a listing on another
// page shows them (excuseReviewed).
const addedDescriptions = addedDescriptionsOf(findings);
const { CHROME_EXCEPTIONS, CONTENT_EXCEPTIONS, VISUAL_EXCEPTIONS } = settings.exceptions;
const announced = new Set();
function exceptionsFor(pagePath) {
  const active = VISUAL_EXCEPTIONS.filter((e) => !e.when || e.when(pagePath));
  for (const e of active) {
    if (announced.has(e.label)) continue;
    announced.add(e.label);
    console.log(`‼ APPROVED ${settings.name} VISUAL EXCEPTION — ${e.label}: ${e.why}`);
  }
  return {
    masks: active.flatMap((e) => e.mask ?? []),
    css: active.map((e) => e.css).filter(Boolean),
    // Source-only markup changes an exception names (the settings' normalisers).
    normalise: active.flatMap((e) => e.normalise ?? []),
    tolerance: Math.max(DEFAULT_TOLERANCE, ...active.map((e) => e.tolerance ?? 0)),
  };
}

async function apiJson(url) {
  const res = await apiFetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

const { allPages, samplePages } = pageSource({
  api: API,
  apiJson,
  concurrency: CONCURRENCY,
  ...settings.pages,
});

/** Screenshot one page, with the consent banner answered and masks hidden. */
// The consent a visitor would have given, as the settings record it, seeded
// both as a cookie and in localStorage (each site keeps it in one of them).
const CONSENT_NAME = settings.consent.name;
const CONSENT_JSON = settings.consent.json;
const CONSENT_COOKIE = { name: CONSENT_NAME, value: encodeURIComponent(CONSENT_JSON) };

async function shoot(browser, url, file, { auth, masks, css = [], regions = [], contentArea = false, normalise = [], archive = null }) {
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: 900 },
    ...(auth ? { httpCredentials: auth } : {}),
    // axe is injected as a script, which both sites' Content Security Policy
    // rightly refuses. Lifted for this test browser only.
    bypassCSP: true,
    // A late-loading font repaints half the page; the same page shot twice
    // must give the same bytes or the score is noise.
    reducedMotion: "reduce",
  });
  // The source is drawn from its recording, never the live site (or recorded,
  // when the run was asked to).
  if (archive) {
    try {
      await useArchive(context, archive.file, { record: archive.record });
    } catch (e) {
      await context.close();
      throw e;
    }
  }
  // Requests the settings refuse (a frame that never lets the page load).
  // Registered after the archive's routes, so they are asked first.
  for (const blocked of settings.blockedRequests ?? []) {
    await context.route(blocked, (route) => route.abort("blockedbyclient"));
  }
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });
  await context.addCookies([{ ...CONSENT_COOKIE, url }]).catch(() => {});
  await context.addInitScript(
    ([name, value]) => {
      try {
        localStorage.setItem(name, value);
      } catch {
        // An opaque frame (about:blank, data:) has no storage to seed.
      }
    },
    [CONSENT_NAME, CONSENT_JSON],
  );
  const page = await context.newPage();
  // Declared BEFORE the navigation try that assigns them. They were below it,
  // so `status = response.status()` hit the temporal dead zone, threw, and the
  // bare `catch {}` swallowed it — every page then read as "still waiting" for
  // content that had in fact arrived in 39ms.
  let status = 0;
  let settled = false;
  // WHICH expected regions never settled — the fatal verdict names them, so
  // "a block never appeared" says which block and which selector.
  let unsettled = [];
  // The navigation's own failure: it never reached the wait for those regions.
  let loadError = null;
  try {
    // `load`, not `networkidle`: a page that polls never goes idle, and when
    // the site was DOWN every shot burned the full networkidle budget — one
    // page took 27 minutes to report "blank". Budget is explicit and small;
    // a page that cannot render in it is a finding, not something to wait out.
    const response = await page.goto(url, { waitUntil: "load", timeout: NAV_TIMEOUT });
    // The STATUS, because not every path in the worklist is a public page. The
    // conversion converts restricted content too, and a 401 renders a login
    // page whose chrome is perfectly comparable and perfectly meaningless —
    // one page reported "main nav 1280x0" and a 215px footer
    // for exactly that reason, and both were the login page's.
    status = response?.status() ?? 0;
    await page.waitForLoadState("networkidle", { timeout: SETTLE_TIMEOUT }).catch(() => {});
    // networkidle is NOT the settle signal on this site — these pages poll, so
    // it never fires and requiring it made every page fatal. Wait instead for
    // what the conversion SAYS should be here: each expected block's selector,
    // bounded. That is the app's own signal rather than a guess at the clock,
    // and a selector that never appears is a finding rather than a silent
    // measurement of an empty page.
    //
    // This is what the source's listings needed: they are fetched in the
    // browser, and measuring before the cards arrive reported six missing
    // cards that were merely late.
    // TWO PHASES, borrowed from AdminUIHelper.getStableBlockCount, which had
    // already solved this properly:
    //
    //   1. a measurement, ANY measurement — until one arrives there is nothing
    //      to call stable or unstable. This is what separates "finished" from
    //      "not started", which quiescence alone cannot do.
    //   2. the count stops changing — the same number twice running.
    //
    // Waiting only for the selector to be attached (what I had) is phase 1 on
    // its own, and it cannot tell four cards that are all of them from four
    // cards with two more still streaming in. On the source that is a live
    // risk: its listings arrive in the browser, a few at a time.
    const expected = regions.filter((r) => r.expect);
    const outcomes = (
      await Promise.all(
        expected.map(async (r) => {
          const count = () => page.locator(r.sel).count().catch(() => -1);
          const deadline = Date.now() + SETTLE_TIMEOUT;
          // Phase 1.
          let n = await count();
          while (n < 1 && Date.now() < deadline) {
            await page.waitForTimeout(150);
            n = await count();
          }
          if (n < 1) return false;
          // Phase 2.
          let last = -1;
          let stable = 0;
          while (stable < 2 && Date.now() < deadline) {
            const now = await count();
            if (now !== -1 && now === last) stable += 1;
            else {
              last = now;
              stable = 1;
            }
            if (stable < 2) await page.waitForTimeout(150);
          }
          return stable >= 2;
        }),
      )
    );
    unsettled = expected.filter((_, i) => !outcomes[i]).map((r) => `${r.name} (${r.sel})`);
    settled = unsettled.length === 0;
  } catch (navError) {
    // Whatever rendered still gets shot; a blank one is reported as one.
    loadError = String(navError).split("\n")[0].slice(0, 160);
    if (settings.debug) console.log(`  [debug] ${url}: ${loadError}`);
  }
  // Consent is SEEDED, not clicked. A click costs a page load's worth of waiting
  // on every page and leaves a banner mid-animation in the shot; arriving with
  // the choice already made is both faster and steadier.
  //
  // It only works alongside the webdriver mask above. vanilla-cookieconsent
  // ships `hideFromBots: true`, which checks `navigator.webdriver`, and when it
  // decides it is talking to a bot `run()` returns before reading anything back
  // — no stored consent, no accepted categories. The banner still appears,
  // because the design system builds that DOM itself, so the page looks like it
  // simply refused the stored answer. That is what made one page report 24% of
  // pixels differing against a "blocked embed" callout no reader ever
  // sees: the map was gated on permission the library had thrown away.
  //
  // (The frontend has the same helper for the same reason —
  // frontend/tests/helpers/not-a-bot.ts.)

  // OURS: the content area as one `<main>`, as the source has it (the
  // settings' contentArea). Before any exception's CSS goes on: some are
  // scoped to the wrapper, and with them already applied the check below
  // would measure the exception rather than the wrap. The wrap itself must
  // not move anything, or the measurement would be of a page nobody sees.
  if (contentArea) {
    // Only once the page has hydrated (the settings' `ours.ready`): a
    // hydration that fails re-renders the page, and a re-render throws away
    // nodes moved into the wrapper (32 pages lost it that way to a header
    // hydration mismatch).
    const ready = await page
      .locator(settings.ours.ready)
      .waitFor({ state: "attached", timeout: SETTLE_TIMEOUT })
      .then(() => true, () => false);
    if (!ready) {
      await context.close();
      return { height: 0, error: `our page never finished hydrating (no ${settings.ours.ready} in ${SETTLE_TIMEOUT}ms)` };
    }
    const moved = await page
      .evaluate(`(() => {
        const before = document.body.scrollHeight;
        (${wrapContentArea})(document);
        return document.body.scrollHeight - before;
      })()`)
      .catch((error) => String(error));
    if (moved !== 0) {
      await context.close();
      return {
        height: 0,
        error: typeof moved === "number" ? `wrapping the content area moved the page by ${moved}px` : moved.slice(0, 120),
      };
    }
  }
  // The SOURCE's markup brought to the conversion's, where an approved
  // exception names a change CSS cannot make (the settings' normalisers).
  const normalisers = normalise.map((name) => {
    const fn = SOURCE_NORMALISERS[name];
    if (typeof fn !== "function") throw new Error(`no source normaliser ${name}`);
    return fn;
  });
  // A page that navigates under these (a client-side redirect) fails as THAT
  // page, not the run: one did, and took the other twelve with it.
  const prepared = await (async () => {
    for (const fn of normalisers) await page.evaluate(`(${fn})(document)`);
    // Blank paragraphs and headings, marked for the exceptions to hide
    // (an exception hides them): no text a reader sees and nothing drawn in
    // them. CSS cannot tell a paragraph holding only a <br> or a bold space
    // from one with words. The source's heading anchor icon (`a.anchor`, never
    // drawn: source-heading-anchor-space) is not something drawn. Headings
    // on the SOURCE only: axe reads this same render, and a blank heading on
    // ours is a fault it must still see.
    await page.evaluate((isSource) => {
      const drawn = "img, svg, iframe, video, input, select, textarea, button";
      const blankable = isSource ? "main :is(p, h1, h2, h3, h4, h5, h6)" : "main p";
      for (const el of document.querySelectorAll(blankable)) {
        const shown = [...el.querySelectorAll(drawn)].filter((x) => !x.closest("a.anchor"));
        if (!el.textContent.replace(/[\s\u00a0\u200b\ufeff]/g, "") && !shown.length) {
          el.setAttribute("data-compare-blank", "");
        }
      }
    }, Boolean(archive));
    return null;
  })().catch((error) => String(error));
  if (prepared !== null) {
    await context.close();
    return { height: 0, error: `preparing the page failed: ${prepared.slice(0, 120)}` };
  }
  if (masks.length) {
    await page.addStyleTag({
      content: `${masks.join(", ")} { visibility: hidden !important; }`,
    }).catch(() => {});
  }
  // An approved exception that NEUTRALISES one property rather than hiding an
  // element — a marker only one side draws, where hiding the element would
  // hide its text too. Applied to both sides, like a mask.
  if (css.length) {
    // Same as the masks above: a page that did not render has no <head> to
    // inject into, and it is reported as blank below — the injection must not
    // end the whole run (it did, 31 pages into 64).
    await page.addStyleTag({ content: css.join("\n") }).catch(() => {});
  }
  // Lay the page out BEFORE waiting on the fonts: a face an exception just
  // declared is only fetched once layout needs it, so without this
  // `fonts.ready` could resolve before the swap had even started.
  await page
    .evaluate(() => {
      void document.body?.offsetHeight;
      return document.fonts?.ready;
    })
    .catch(() => {});
  let height = 0;
  let html = "";
  let axe;
  let regionBoxes = {};
  let images = [];
  try {
    // The full-page shot lays the page out again at its whole height, and
    // that layout is not always the one measured before it: Greek text, which
    // Public Sans does not cover, took its fallback face only then, two list
    // items each lost a line, and every box below them was measured 48px lower
    // than the shot drew it (both sides of
    // /information-in-other-languages/ellenika/mporoume-na-boethesoume). One
    // shot first, thrown away, so what is measured is what is shot; the page's
    // height across the real one is checked below.
    await page.screenshot({ fullPage: true, timeout: 25000, animations: "disabled" });
    const measuredAt = await page.evaluate(() => document.documentElement.scrollHeight);
    // Measured from the SAME render as the shot and the markdown, for the same
    // reason: a second load is a different page. A region that is absent is
    // recorded as null rather than skipped — "the footer is not there" is a
    // finding, and a missing key would read as "not measured".
    regionBoxes = await page.evaluate(({ sels, masked }) => {
      // NOT COUNTED IF NOT COMPARED. A mask hides a region from the pixel
      // comparison because the two sites were never going to agree about it —
      // and then the region measurement went on counting it anyway, because it
      // matches selectors DOCUMENT-WIDE rather than within the page.
      //
      // A cookie dialog may hold four tables, one per cookie
      // category. So a page with ONE table in it reported `block:table 1 vs 5`
      // and 68% of its differing pixels — against a source whose consent was a
      // third-party script. The table converted perfectly: 2x2, same headers,
      // both sides.
      const inMasked = (el) => masked.some((m) => el.closest(m));
      const out = {};
      for (const { name, sel } of sels) {
        // COUNT as well as size. A layout region is one element; a block region
        // is however many of that block the page has, and "8 cards here, 6
        // there" is the finding — a size comparison of the first one would
        // report two identical cards and miss the two that vanished.
        // RENDERED instances only. An element with no box is not on the page:
        // a cookie dialog may hold four display:none tables, one per
        // cookie category, so a page with ONE table in it reported
        // `block:table 1 vs 5` against a source whose consent was a
        // third-party script. Their boxes came back {w:0,h:0,x:0,y:0}, which
        // is the page saying so. Masked regions go too — not counted if not
        // compared.
        const all = [...document.querySelectorAll(sel)].filter(
          (el) =>
            !inMasked(el) &&
            (el.getBoundingClientRect().width > 0 ||
              el.getBoundingClientRect().height > 0),
        );
        const el = all[0];
        if (!el) {
          out[name] = null;
          continue;
        }
        // EVERY instance, in document order. Six cards on one side and six on
        // the other are the same six in the same order, so they compare
        // pairwise — and the report can show card 3 beside card 3 rather than
        // "the cards differ somewhere".
        const boxes = all.map((node) => {
          const b = node.getBoundingClientRect();
          return {
            w: Math.round(b.width),
            // scrollHeight for `body` ONLY — the `height: 100%` case
            // below. On anything else it counts content that is not drawn:
            // the main nav's hidden dropdown panels made it 418px tall
            // against a 56px bar, so it swallowed the banner under it and
            // a page blamed a light-blue band on the nav.
            // And never less than the viewport: a page shorter than the
            // screen is drawn the screen's height on both sides (the shot is
            // too), but only a `height: 100%` body says so — a short page
            // read 900 against our 847 with nothing on either side differing.
            h: Math.round(
              node === document.body
                ? Math.max(b.height, node.scrollHeight, document.documentElement.clientHeight)
                : b.height,
            ),
            x: Math.round(b.left + window.scrollX),
            y: Math.round(b.top + window.scrollY),
          };
        });
        const r = el.getBoundingClientRect();
        // scrollHeight, not just the bounding rect. A site may set
        // `html, body { height: 100% }`, so `body`'s rect is the VIEWPORT and
        // never grows — the `page` region reported 1280x900 against our real
        // page height on every page, which is a bug in the measurement, not a
        // difference in the site. The existing height check already knew this
        // and reads document.body.scrollHeight.
        // Height from scrollHeight, WIDTH from the rect: scrollWidth includes
        // the scrollbar gutter, which made `page` read 1296 on our side against
        // the source's 1280 on every page — a 16px difference in the browser, not the
        // site.
        // Page-absolute position too, so the report can CROP the full-page
        // screenshot to this region — no second render, no extra file. The
        // rect is viewport-relative; the shot is the whole scroll height.
        out[name] = { n: all.length, ...boxes[0], boxes };
      }
      // Who contains whom, OBSERVED. For each measured node, the nearest other
      // measured node above it in the DOM. Built per page and per side, so it
      // is the tree that actually rendered rather than a table someone has to
      // keep true — and when the two sides nest differently, that is itself
      // visible rather than a mismatch with a declaration.
      const firstOf = new Map();
      for (const { name, sel } of sels) {
        const el = [...document.querySelectorAll(sel)].find((e) => !inMasked(e));
        if (el) firstOf.set(name, el);
      }
      const parent = {};
      for (const [name, el] of firstOf) {
        for (let p = el.parentElement; p; p = p.parentElement) {
          const hit = [...firstOf].find(([other, oel]) => other !== name && oel === p);
          if (hit) {
            parent[name] = hit[0];
            break;
          }
        }
      }
      out.__parent = parent;
      // Elements more than one BLOCK region matched (selectorOverlaps): their
      // counts and sizes describe each other's blocks.
      const owners = new Map();
      for (const { name, sel } of sels) {
        if (!name.startsWith("block:")) continue;
        for (const el of document.querySelectorAll(sel)) {
          if (inMasked(el)) continue;
          owners.set(el, [...(owners.get(el) ?? []), name]);
        }
      }
      const shared = new Map();
      for (const names of owners.values()) {
        if (names.length < 2) continue;
        const key = [...new Set(names)].sort().join("|");
        shared.set(key, (shared.get(key) ?? 0) + 1);
      }
      out.__shared = [...shared].map(([key, n]) => ({ names: key.split("|"), n }));
      return out;
    }, {
      sels: regions.map((r) => ({ name: r.name, sel: r.sel })),
      masked: masks,
    });
    // What is INSIDE each instance, for the verdict to say why a box differs
    // (@inka/compare/geometry). The same instances, in the same order, as the boxes.
    const skeletons = await page.evaluate(regionSkeletons, {
      sels: regions.map((r) => ({ name: r.name, sel: r.sel })),
      masked: masks,
      classPrefix: settings.classPrefix,
    });
    for (const [name, skels] of Object.entries(skeletons)) {
      const region = regionBoxes[name];
      if (!region) continue;
      region.boxes.forEach((box, i) => {
        box.skel = skels[i] ?? null;
      });
    }
    // What each image COSTS against what it shows (oversizedImages). Served size is the decoded image: naturalWidth.
    // BOTH sides, and the whole page: the footer's artwork was outside `main`
    // and loaded the wrong copy unnoticed. `key` is the file (the path before
    // `/@@images/`), so ours and the source's copy of one file pair up;
    // `largest` is the widest copy the srcset offered, so a stretched image
    // can be told from one whose upload is simply small (imageFindings).
    // An image that finished and decoded to nothing (`broken`) is kept, masked
    // or not: a mask hides pixels from the diff, it does not excuse a 404. It
    // was dropped here, so broken hero images passed the compare.
    images = await page.evaluate(({ masked, cardSel }) =>
      [...document.querySelectorAll("img")]
        .filter((img) => img.complete && img.getAttribute("src"))
        .filter((img) => img.naturalWidth === 0 || !masked.some((m) => img.closest(m)))
        .map((img) => {
          const r = img.getBoundingClientRect();
          const src = new URL(img.currentSrc || img.src, location.href).pathname;
          const widths = (img.srcset || "")
            .split(",")
            .map((c) => parseInt(c.trim().split(/\s+/)[1] ?? "", 10))
            .filter(Number.isFinite);
          return {
            src,
            key: src.split("/@@images/")[0],
            natural: { w: img.naturalWidth, h: img.naturalHeight },
            broken: img.naturalWidth === 0,
            drawn: { w: Math.round(r.width), h: Math.round(r.height) },
            largest: widths.length ? Math.max(...widths) : undefined,
            // Named by where it sits: a card's (the one image a rule speaks
            // of, single-card-grid-reviewed), or the chrome's.
            where: img.closest("footer") ? "footer" : img.closest("header") ? "header" : img.closest("main") ? "main" : "page",
            inCard: Boolean(img.closest(`main ${cardSel}`)),
          };
        }),
    { masked: masks, cardSel: BLOCK_REGIONS.card.sel });
    await page.screenshot({ path: file, fullPage: true, timeout: 25000, animations: "disabled" });
    const shotAt = await page.evaluate(() => document.documentElement.scrollHeight);
    if (shotAt !== measuredAt) {
      return { height: 0, error: `the page was ${measuredAt}px tall when measured and ${shotAt}px when shot` };
    }
    // At least the viewport, as the body's box above: the full-page shot is.
    height = await page.evaluate(() =>
      Math.max(document.body.scrollHeight, document.documentElement.clientHeight),
    );
    // The SAME render answers both questions. Fetching the page again for the
    // structural comparison would be a second, different render — consent not
    // yet accepted, masks not applied, client-side blocks not yet mounted — and
    // the two halves would then disagree about what was on screen.
    html = await page.content();
    // axe reads the page as published: one main, the frontend's.
    if (contentArea) await page.evaluate(`(${unwrapContentArea})(document)`);
    // The same render once more: axe reads the page the reader got, masks and
    // all, rather than a second load that may not have settled the same way.
    await page.addScriptTag({ path: AXE_PATH });
    axe = summariseAxe(
      await page.evaluate((options) => window.axe.run(document, options), axeOptions(settings.accessibilityRules)),
    );
  } catch (error) {
    await context.close();
    return { height: 0, error: String(error).slice(0, 120) };
  }
  await context.close();
  return { height, html, regionBoxes, images, status, settled, unsettled, loadError, axe };
}

let paths;
if (args.pages) paths = String(args.pages).split(",");
else {
  const all = await allPages();
  paths = args.sample
    ? // A bare `--sample` is the whole covering set; `--sample 8` caps it.
      // (`Number(true)` is 1, so the boolean must be excluded explicitly.)
      await samplePages(all, args.sample === true ? Infinity : Number(args.sample))
    : all;
}
// `--limit` is applied AFTER the block filter below, not here: `--blocks=search
// --limit 6` means six pages that HAVE a search block, not six arbitrary pages
// narrowed to whichever of them happens to. Asked the wrong way round it
// answered "0 page(s) carry one" for a block that is on thirteen.

fs.mkdirSync(OUT, { recursive: true });
const BASELINE_DIR = path.join(OUT, "baseline");
fs.mkdirSync(BASELINE_DIR, { recursive: true });
const MANIFEST = path.join(BASELINE_DIR, "manifest.json");
const baseline = fs.existsSync(MANIFEST)
  ? JSON.parse(fs.readFileSync(MANIFEST, "utf8"))
  : {};
const REFRESH = Boolean(args.refresh);

const browser = await chromium.launch();
// A browser that goes away takes every pending page with it, and nothing
// waiting on one of those pages ever hears: a full run sat for 65 minutes
// after Chromium vanished at page 86. Stop, saying so.
browser.on("disconnected", () => {
  if (closing) return;
  console.error("compare-sites: the browser disconnected mid-run; stopping. Re-run to finish.");
  process.exit(3);
});
let closing = false;
const comparator = await browser.newPage();
await comparator.setContent("<html><body></body></html>");

// A PAGE is something with blocks. The conversion converts every object it
// finds — Images, Files, the lot — and two thirds of what it reports has no
// blocks at all (667 of 1126 look like .png/.jpg/.svg/.pdf by name, 697 have no
// blocks). Both sites answer text/html for those, so comparing one as a page
// measures a browser's file-viewer against ours: on an .svg file the source body never grows past the viewport while ours builds a
// 1734px page. All noise, and it drowns the findings that matter.
// `--blocks=search` (or a comma list): compare ONE kind of block, on every page
// the conversion says has one. The worklist comes from the findings rather than
// from crawling — the conversion already recorded every page's block types.
const ONLY_BLOCKS = args.blocks
  ? String(args.blocks).split(",").map((b) => b.trim()).filter(Boolean)
  : null;
let comparable = paths.filter((p) => (findings.pages[p]?.blocks ?? []).length > 0);
if (ONLY_BLOCKS) {
  comparable = comparable.filter((p) =>
    ONLY_BLOCKS.some((b) => blockTypesOn(p, findings).includes(b)),
  );
  console.log(
    `[visual] --blocks=${ONLY_BLOCKS.join(",")}: ${comparable.length} page(s) carry one`,
  );
}
const skippedNotPages = paths.length - comparable.length;
if (skippedNotPages) {
  console.log(
    `[visual] ${skippedNotPages} object(s) with no blocks are not pages — not compared`,
  );
}
paths = comparable;
if (args.limit) paths = paths.slice(0, Number(args.limit));
console.log(`[visual] ${paths.length} page(s) at ${WIDTH}px: ${OLD} → ${NEW}`);

// Wake our side before the first page. The demo frontend and API auto-suspend,
// and the first requests of a run paid the wake-up: a 9s first page, and a
// connect timeout on the API that ended a 64-page run three pages in. Asked
// until each answers, then shot; a side that never answers stops the run here,
// with its name, instead of 64 half-rendered pages later.
async function warm(label, url, headers = {}) {
  const deadline = Date.now() + 120_000;
  let last = "no answer";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
      if (res.ok) {
        console.log(`[visual] ${label} awake (${url})`);
        return;
      }
      last = `HTTP ${res.status}`;
    } catch (e) {
      last = String(e.cause?.code || e.name || e);
    }
    await new Promise((r) => setTimeout(r, 3_000));
  }
  throw new Error(`${label} never answered at ${url} within 120s (last: ${last})`);
}
// Where the SOURCE sends an old path, asked of the source itself: a HEAD
// that does not follow, so a 3xx names its Location. Only a redirect counts;
// anything else leaves the path alone, and the line is compared as written.
// Recorded with the source (@inka/compare/source-archive): asked of the live site only
// while recording. A path the recording never asked about is not followed,
// and counted, so the run says how many lines it could not check.
const redirects = new RedirectArchive(settings.archiveDir);
let unrecordedRedirects = 0;
async function sourceRedirects(paths) {
  const found = {};
  for (const p of new Set(paths)) {
    if (!redirects.has(p)) {
      if (!RECORD) {
        unrecordedRedirects++;
        continue;
      }
      const response = await fetchRetrying(`${OLD}${encodeURI(p)}`, {
        method: "HEAD",
        redirect: "manual",
        headers: basic(AUTH),
      });
      const location = response.headers.get("location");
      const target =
        response.status >= 300 && response.status < 400 && location
          ? new URL(location, OLD)
          : null;
      redirects.set(
        p,
        target && target.origin === new URL(OLD).origin ? target.pathname.replace(/\/$/, "") : null,
      );
    }
    if (redirects.get(p)) found[p] = redirects.get(p);
  }
  return found;
}

const basic = (c) =>
  c ? { Authorization: `Basic ${Buffer.from(`${c.username}:${c.password}`).toString("base64")}` } : {};
await warm("API", `${API}/++api++/`, { Accept: "application/json" });
await warm("our frontend", `${NEW}/`, basic(NEW_AUTH));
const started = Date.now();
async function comparePage(p) {
  // Cap reached: don't shoot this page at all (the shots are the slow part).
  if (diffCount >= MAX_DIFFS) {
    notCompared++;
    return null;
  }
  const plan = regionsFor(p, findings);
  // Block regions are measured from the same render as everything else. When
  // --blocks narrows the run, the LAYOUT regions drop out: the question asked
  // was about search blocks, and answering it with a footer finding as well is
  // how one question becomes three hundred.
  const blockRegions = blockRegionsFor(p, findings, ONLY_BLOCKS);
  // A block's PARTS get measured as nodes of their own, so the descent has
  // something below block level to land on. Where they sit in the tree is not
  // declared here — the page answers that.
  const partRegions = blockRegions.flatMap((r) =>
    (BLOCK_REGIONS[r.blockType]?.parts ?? []).map((partName) => ({
      name: partName,
      // Same shape as a block: `sel` when both sides agree, `old`/`new` when
      // two design versions spell the part differently.
      old: BLOCK_REGIONS[partName].old ?? BLOCK_REGIONS[partName].sel,
      new: BLOCK_REGIONS[partName].new ?? BLOCK_REGIONS[partName].sel,
      blockType: r.blockType,
      // Measured, never WAITED for. A part is optional by nature — a card with
      // no image has no image part — so expecting one turns an ordinary
      // card into "a block the conversion expects never appeared".
      isPart: true,
    })),
  );
  // A block type the findings place here that the region mapping has no selector
  // for. Named, so it reads as "nobody has decided how to compare this" rather
  // than vanishing from a run that looks complete.
  const unmapped = unmappedBlockTypes(p, findings).filter(
    (t) => !ONLY_BLOCKS || ONLY_BLOCKS.includes(t),
  );
  if (ONLY_BLOCKS) plan.regions = [];
  plan.regions = [...plan.regions, ...blockRegions, ...partRegions];
  const slug = slugOf(p);
  const { masks, css, normalise, tolerance } = exceptionsFor(p);
  const oldFile = path.join(BASELINE_DIR, `${slug}.png`);
  const newFile = path.join(OUT, `${slug}--ours.png`);
  // The masks are part of the baseline's identity: hiding a different set of
  // regions produces a different picture, and comparing against it would
  // report the mask as a change in OUR site.
  // Hashed: an exception's CSS can be large (inlined font files), and this
  // key is stored with every page's baseline.
  const masksKey = createHash("sha256").update([...masks, ...css, ...normalise.map((n) => `normalise:${n}`)].sort().join("|")).digest("hex");
  // So are the SELECTORS measured on it. The region boxes are cached with the
  // shot; a region added to the map since has no box in that cache, and read
  // back it says "only on ours" — which is what the content-block pictogram
  // reported on its first run, against a baseline that plainly has four.
  const regionsKey = plan.regions
    // `?` marks a region measured but not waited for, `!` one the source is
    // not expected to have (the conversion's own): whether the capture waited
    // changes what `settled` means, so both are part of the identity too. A
    // rule that made a page's blocks the conversion's otherwise kept the
    // cached render that had waited for them on the source, and failed.
    .map((r) => `${r.name}=${r.old}${r.optional ? "?" : ""}${r.createdByConversion ? "!" : ""}`)
    .sort()
    .join("|");
  const cached = baseline[slug];
  // A baseline captured before the reading half existed has a screenshot but no
  // markdown. Reusing it would silently drop half the comparison and report the
  // page as pixel-only — so it counts as a MISS and is re-captured once, after
  // which both halves come from the one cached render.
  //
  // EVERYTHING the shot measured, or it counts as a miss. A cache hit used to
  // rebuild only `{height, markdown}`, so `settled`, `status` and `regionBoxes`
  // came back undefined — and `!o.settled` is the fatal check three screens
  // down, which meant every cached page was reported as "a block the conversion
  // expects never appeared (source waiting)". A first run passed and every run
  // after it blamed the source for the cache's missing fields.
  //
  // These belong in the cache for the reason the markdown already does: they
  // were measured from the SAME render as the screenshot, so they describe the
  // picture being compared. Re-deriving them means loading the source again,
  // which is the cost the cache exists to avoid.
  const usable =
    !REFRESH &&
    !RECORD &&
    cached &&
    cached.masks === masksKey &&
    cached.regions === regionsKey &&
    cached.markdown &&
    cached.regionBoxes &&
    // A baseline from before skeletons were recorded cannot say WHY a box
    // differs: a miss, re-captured once, rather than a silently shallower run.
    Object.entries(cached.regionBoxes).every(
      ([name, r]) => name.startsWith("__") || !r || r.boxes.every((box) => "skel" in box),
    ) &&
    Array.isArray(cached.images) &&
    // Lists read by an older chromeLists are re-read, not trusted.
    cached.chromeVersion === CHROME_VERSION &&
    // A capture that never settled is not a baseline: reused, one slow load
    // on the source failed the page on every run after it. Re-captured until
    // it settles.
    cached.settled === true &&
    typeof cached.status === "number" &&
    // Checked with the rules this run checks (a rule added since would read
    // as new on ours on every page).
    cached.wcagRules === axeRulesKey(settings.accessibilityRules) &&
    fs.existsSync(oldFile);
  const o = usable
    ? {
        height: cached.height,
        markdown: cached.markdown,
        regionBoxes: cached.regionBoxes,
        images: cached.images,
        chrome: cached.chrome,
        settled: cached.settled,
        unsettled: cached.unsettled ?? [],
        status: cached.status,
        axe: cached.wcag,
      }
    : await shoot(browser, `${OLD}${p}`, oldFile, {
        archive: { file: archiveFile(settings.archiveDir, slug), record: RECORD },
        auth: AUTH,
        masks,
        css,
        normalise,
        regions: plan.regions.map((r) => ({
          name: r.name,
          sel: r.old,
          // Only wait for BLOCKS: the chrome is server-rendered and always
          // present, and a `createdByConversion` block has no source side.
          expect:
            Boolean(r.blockType) && !r.isPart && !r.optional && !r.createdByConversion && Boolean(r.old),
        })),
      });
  if (!usable && o.height) {
    baseline[slug] = {
      path: p,
      masks: masksKey,
      regions: regionsKey,
      height: o.height,
      // Cached beside the shot, and for the same reason: the baseline is what
      // the source site WAS at capture time. Re-deriving it later would mean
      // loading the source again — the cost the cache exists to avoid — and
      // would compare today's source against yesterday's screenshot.
      markdown: pageMarkdown(o.html, { origins: [OLD, NEW], page: p }),
      // The rest of that same measurement, so a cache hit is the same verdict
      // as the capture rather than a degraded one.
      regionBoxes: o.regionBoxes,
      images: o.images,
      // The chrome's lists (nav, breadcrumbs, footer), from the same render:
      // the text half reads only `<main>`.
      chrome: chromeLists(o.html),
      chromeVersion: CHROME_VERSION,
      settled: o.settled,
      unsettled: o.unsettled,
      status: o.status,
      wcag: o.axe,
      wcagRules: axeRulesKey(settings.accessibilityRules),
      capturedAt: new Date().toISOString(),
    };
    fs.writeFileSync(MANIFEST, JSON.stringify(baseline, null, 2));
  }
  const n = await shoot(browser, `${NEW}${p}`, newFile, {
    contentArea: true,
    auth: NEW_AUTH,
    masks,
    css,
    regions: plan.regions.map((r) => ({
      name: r.name,
      sel: r.new,
      expect: Boolean(r.blockType) && !r.isPart && !r.optional,
    })),
  });
  if (o.error || n.error || !o.height || !n.height)
    return { p, slug, fatal: o.error ?? n.error ?? "blank page", tolerance };
  // Not public on one or both sides. Reported as its own thing rather than
  // compared: a login page has a header and a footer like any other, so every
  // region "works" and every verdict is about content nobody can see.
  // BOTH sides must have settled. Comparing a settled page against one still
  // loading measures the clock, not the conversion — and it does it silently,
  // which is worse: every region on the unsettled side reads as a difference.
  // Only a side that was still waiting for content it was TOLD to expect is
  // unmeasurable. A page with nothing expected settles trivially.
  if (!o.settled || !n.settled)
    return {
      p,
      slug,
      fatal: unsettledVerdict(o, n, SETTLE_TIMEOUT),
      tolerance,
    };
  if ((o.status && o.status !== 200) || (n.status && n.status !== 200))
    return {
      p,
      slug,
      // A 401 on our side with no credentials set is not a conversion defect,
      // it is a missing environment variable — say so here rather than leaving
      // every page in the run reporting "not public".
      fatal:
        n.status === 401 && !NEW_AUTH
          ? `ours answered 401 and ${settings.ours.unauthorised}`
          : `not public (source ${o.status || "?"}, ours ${n.status || "?"})`,
      tolerance,
    };
  const toData = (f) => `data:image/png;base64,${fs.readFileSync(f).toString("base64")}`;
  let cmp;
  try {
    cmp = await comparator.evaluate(COMPARE_JS, {
      aData: toData(oldFile),
      bData: toData(newFile),
      deltaE: DELTA_E,
      cell: CELL,
      maxPixels: 60_000_000,
      // Every region measured on BOTH sides, so each one gets its own verdict
      // aligned to its own origin — "differs" or "the same thing, moved".
      regions: plan.regions
        .map((r) => ({
          name: r.name,
          a: o.regionBoxes?.[r.name] ?? null,
          b: n.regionBoxes?.[r.name] ?? null,
        }))
        .filter((r) => r.a && r.b),
    });
  } catch (error) {
    return { p, slug, fatal: `compare failed: ${String(error).slice(0, 120)}`, tolerance };
  }
  fs.writeFileSync(
    path.join(OUT, `${slug}--diff.png`),
    Buffer.from(cmp.diff.split(",")[1], "base64"),
  );
  const heightSkew = Math.abs(o.height - n.height) / Math.max(o.height, n.height);
  // The structural verdict, from the renders already taken. "Looks the same"
  // and "says the same" are different failures and neither implies the other:
  // a dropped paragraph can be a fraction of a percent of pixels, and a font
  // that renders a shade darker moves no words at all. Both are reported, and
  // either one failing fails the page.
  // Cached markdown on a warm baseline, the just-rendered HTML on a fresh one —
  // the two paths are the only ways the old side gets here, and both must yield
  // a document or the reading half goes quietly missing. What is compared is
  // that document (words, and where the links, images and videos point), never
  // the HTML it was read out of.
  const oldMarkdown =
    o.markdown ?? (o.html ? pageMarkdown(o.html, { origins: [OLD, NEW], page: p }) : null);
  let struct =
    oldMarkdown && n.html
      ? markdownDiff(oldMarkdown, pageMarkdown(n.html, { origins: [OLD, NEW], page: p }))
      : null;
  // Approved content differences, removed from the diff and ANNOUNCED — the
  // same protocol the visual exceptions follow. Narrowing the diff rather than
  // skipping the page is the point: everything else on it is still compared,
  // and any other difference still fails it.
  if (struct) {
    const excused = excuseContent(struct, p, CONTENT_EXCEPTIONS);
    struct = excused.struct;
    for (const e of excused.fired) {
      if (announced.has(e.label)) continue;
      announced.add(e.label);
      console.log(`\u203c APPROVED ${settings.name} CONTENT EXCEPTION — ${e.label}: ${e.why}`);
    }
    // Links the SOURCE redirects, compared by where the redirect lands: the
    // conversion repoints them there (the news pages' moved PDFs).
    const followed = followSourceRedirects(
      struct,
      await sourceRedirects(struct.missing.flatMap(sourcePathsOf)),
      CONTENT_EXCEPTIONS,
    );
    for (const e of followed.fired) {
      if (announced.has(e.label)) continue;
      announced.add(e.label);
      console.log(`\u203c APPROVED ${settings.name} CONTENT EXCEPTION — ${e.label}: ${e.why}`);
    }
    // What the conversion itself put on this page's review list is known,
    // not a new failure: kept in the report, out of the verdict.
    const reviewed = excuseReviewed(followed.struct, findings.pages[p]?.review ?? [], p, addedDescriptions, oldMarkdown);
    // A settled rule that covers the page's words (content drift): every
    // remaining difference is known, kept in the report, out of the verdict.
    const textRule = plan.rules.find((r) => RULES[r]?.excusesText);
    const settled = textRule
      ? [...reviewed.struct.missing, ...reviewed.struct.extra]
      : [];
    struct = {
      ...reviewed.struct,
      // Nothing left to weigh, so no score (contentScore of nothing is 0).
      ...(textRule ? { missing: [], extra: [], score: 0, settledBy: textRule } : {}),
      redirectsFollowed: followed.followed,
      knownInReview: [...reviewed.known, ...settled],
      addedDescriptionsShown: reviewed.addedShown,
    };
  }
  // The region verdicts. A region is a NAMED part the conversion says should
  // have survived, so a difference here is a sentence — "footer differs, 360 vs
  // 133" — rather than a percentage and a list of coordinates. Absent on one
  // side, or a different size, are both findings in their own right: the
  // pixel comparator takes Math.min of the two widths, so a mismatch would
  // otherwise be silently compared on its overlap and pass.
  // Excused findings whose exception says there is nothing inside to compare
  // (an empty list). Collected as they are filtered out, so their subtree can
  // be dropped below — localise never sees an excused finding.
  const precluding = [];
  // What a rule may weigh beyond the finding itself: how many listing items
  // both sides drew (a folder listing's rounding is a pixel an item).
  const ruleContext = {
    listingItems: Math.min(o.regionBoxes?.["block:listing"]?.n ?? 0, n.regionBoxes?.["block:listing"]?.n ?? 0),
  };
  const flatFindingsAll = plan.regions
    .map(({ name }) => {
      if (name === "__parent") return null;
      const a = o.regionBoxes?.[name] ?? null;
      const b = n.regionBoxes?.[name] ?? null;
      const created = plan.regions.find((r) => r.name === name)?.createdByConversion;
      if (created) {
        // The conversion made this; the source has no equivalent. Its absence
        // over there is correct, so only its absence HERE is a finding.
        if (!b) return { name, verdict: "the conversion should have created one, and did not" };
        return null;
      }
      // A PART neither side has is not a finding: a card without an image has
      // no image part anywhere, and saying so on every such card buries
      // the run. A BLOCK absent on both sides still is one — the conversion
      // said it was there.
      // An OPTIONAL region may not be drawn at all (a folder's chromeless
      // search has no filters): absent on both sides is the same.
      if (!a && !b) {
        const region = plan.regions.find((r) => r.name === name);
        return region?.isPart || region?.optional ? null : { name, verdict: "absent both sides" };
      }
      if (!a) return { name, verdict: `only on ours (${b.n})`, b };
      if (!b) return { name, verdict: `missing from ours (${a.n} on the source)`, a };
      // Count before size: a page that lost half its cards is a bigger finding
      // than one whose first card is 3px taller, and reporting the size alone
      // would say the two agree.
      if (a.n !== b.n) return { name, verdict: `${a.n} vs ${b.n}`, a, b };
      // Same count: they are the same things in the same order, so say WHICH
      // one differs. "card 3 of 6" is a finding; "the cards differ" is a
      // shrug, and on a page of six identical-looking cards it is useless.
      const differing = (a.boxes ?? [])
        .map((box, i) => ({ i, box, other: b.boxes?.[i] }))
        .filter(({ box, other }) => other && (box.w !== other.w || box.h !== other.h));
      if (differing.length) {
        // WHY, from the first differing instance: the element inside it that
        // explains the difference (@inka/compare/geometry), when both sides have one.
        const first = differing[0];
        const cause =
          first.box.skel && first.other.skel
            ? firstDivergence(first.box.skel, first.other.skel)
            : null;
        return {
          name,
          verdict:
            differing
              .map(
                ({ i, box, other }) =>
                  `${i + 1}/${a.n} ${box.w}x${box.h} vs ${other.w}x${other.h}`,
              )
              .join(", ") + (cause ? ` — because ${describeDivergence(cause)}` : ""),
          cause,
          instances: differing.map(({ i, box, other }) => ({ i, a: box, b: other })),
          a,
          b,
        };
      }
      return null;
    })
    .filter(Boolean)
    // The skeletons were for the cause; the report keeps the boxes and the
    // cause line, not 400 nodes per instance per page.
    .map((finding) => {
      const strip = (r) => r && r.boxes ? { ...r, boxes: r.boxes.map(({ skel, ...box }) => box) } : r;
      const bareBox = (box) => box && (({ skel, ...rest }) => rest)(box);
      return {
        ...finding,
        ...(finding.a ? { a: strip(finding.a) } : {}),
        ...(finding.b ? { b: strip(finding.b) } : {}),
        ...(finding.instances
          ? { instances: finding.instances.map((x) => ({ ...x, a: bareBox(x.a), b: bareBox(x.b) })) }
          : {}),
      };
    })
    // Approved differences, announced. The protocol the visual exceptions
    // already follow: printed every time one fires, so it stays reviewable.
    .filter((finding) => {
      // A listing taller only by the descriptions the conversion added to the
      // pages it lists (their words are already known: excuseReviewed).
      if (listingCopyAdded(finding, struct?.addedDescriptionsShown ?? 0)) {
        if (!announced.has("listing-shows-added-descriptions")) {
          announced.add("listing-shows-added-descriptions");
          console.log(
            "\u203c KNOWN: a listing shows descriptions the conversion added to the pages it lists " +
              "(description-added, reviewed on those pages): its items are taller by that line.",
          );
        }
        return false;
      }
      // What the page's conversion rule did to it (a reflow), announced the
      // same way as an exception.
      const rule = reflowExcuse(finding, plan.rules, ruleContext);
      if (rule) {
        if (!announced.has(rule)) {
          announced.add(rule);
          console.log(`\u203c CONVERSION RULE ${rule} accounts for ${finding.name}: ${rule.split(" + ").map((r) => RULES[r].why).join(" AND ")}`);
        }
        return false;
      }
      const excused = exceptionFor(finding);
      if (!excused) return true;
      if (excused.precludesSubtree) precluding.push(finding.name);
      if (!announced.has(excused.label)) {
        announced.add(excused.label);
        console.log(`\u203c APPROVED ${settings.name} BLOCK EXCEPTION — ${excused.label}: ${excused.why}`);
      }
      return false;
    })
    .concat(
      unmapped.map((t) => ({
        name: `block:${t}`,
        // Where the page-level regions are precluded, NOTHING compares this
        // block — not a region above it, not a selector for it. Say so; that
        // is the difference between "unexplained" and "unchecked".
        verdict: plan.precluded.some((x) => x.name === "main content")
          ? `no selector — NOT COMPARED by anything here (main content precluded: ${plan.precluded.find((x) => x.name === "main content").rule})`
          : "no selector — unmapped",
        // Unchecked by a settled rule's decision: said, not a difference.
        unchecked: plan.precluded.some((x) => x.name === "main content"),
      })),
    );
  const parentOf = new Map(Object.entries(n.regionBoxes?.__parent ?? {}));
  const flatFindings = dropPrecludedSubtrees(flatFindingsAll, precluding, parentOf);

  // Localise: report the DEEPEST node that differs, using the containment the
  // page itself reported. Ours, because it is the side we can fix; where the
  // two nest differently that shows up as a node with no parent on one side.
  // The VISUAL half of what localise walks. A region whose box matches on both
  // sides but whose pixels do not is a difference, and until now it could not
  // become one — so localise reported the nearest region whose BOX differed and
  // said "LOOK HARDER, nothing inside it differs", which was true and useless.
  // Compared aligned to each side's own origin, so a region that merely moved
  // is NOT a finding: that is the whole point, and it is measured rather than
  // inferred from the box size plus the text.
  const named = new Set(flatFindings.map((f) => f.name));
  const visual = Object.entries(cmp.regionRatios ?? {})
    .filter(([name, v]) => v.ratio > tolerance && !named.has(name))
    .map(([name, v]) => ({
      name,
      verdict: `${(v.ratio * 100).toFixed(2)}% of its own pixels differ`,
      visual: true,
    }))
    // A reflowed page's content is not compared on pixels (its size and
    // pixels are the reflow's) — announced like the size findings above.
    .filter((finding) => {
      const rule = reflowExcuse(finding, plan.rules, ruleContext);
      if (!rule) return true;
      if (!announced.has(rule)) {
        announced.add(rule);
        console.log(`\u203c CONVERSION RULE ${rule} accounts for ${finding.name}: ${rule.split(" + ").map((r) => RULES[r].why).join(" AND ")}`);
      }
      return false;
    });
  const oversized = imageFindings(
    n.images.map((img) => ({
      ...img,
      block: img.inCard ? "card image" : img.where !== "main" ? `${img.where} image` : null,
    })),
    o.images ?? [],
  ).filter(
    // The one image difference a settled rule explains: a reviewed lone card
    // drawn the row's width stretches its image with it. Every other image
    // finding stands, drift pages included: a mis-served image is ours.
    (f) =>
      !(
        plan.rules.includes("single-card-grid-reviewed") &&
        f.name === "card image" &&
        /^image stretched/.test(f.verdict ?? "")
      ),
  );
  // The chrome as text: the nav's order, the breadcrumb trail, the footer's
  // links. The source's lists come from its capture (cached with it).
  // Less the links an approved exception names, announced like the others.
  const oursChrome = n.html ? chromeLists(n.html) : null;
  const excusedChrome = excuseChrome(
    o.chrome ?? (o.html ? chromeLists(o.html) : null),
    oursChrome,
    CHROME_EXCEPTIONS,
  );
  for (const e of excusedChrome.fired) {
    if (announced.has(e.label)) continue;
    announced.add(e.label);
    console.log(`\u203c APPROVED ${settings.name} CHROME EXCEPTION — ${e.label}: ${e.why}`);
  }
  const chrome = chromeDiff(excusedChrome.lists, oursChrome);
  const overlaps = selectorOverlaps([
    ...(o.regionBoxes?.__shared ?? []).map((x) => ({ ...x, side: "the source" })),
    ...(n.regionBoxes?.__shared ?? []).map((x) => ({ ...x, side: "ours" })),
  ]);
  const localised = [
    ...localise([...flatFindings, ...visual], parentOf),
    ...oversized,
    ...chrome,
    ...overlaps,
  ];

  // WHICH BLOCK the differing pixels are in. The structural findings localise
  // to the deepest differing node; this gives the pixel half the same answer,
  // using the same containment. Blamed on OUR boxes because ours is the side
  // we can fix.
  const clusterOwners = attributeClusters(cmp.clusters, n.regionBoxes, parentOf);

  // The whole page aligned at its corner: reported, not the verdict. One block
  // a pixel taller moved everything under it, so a page whose every part
  // matched (or was excused) "differed" on pixels all the same. The parts
  // decide: every region on its own pixels (the `page` region's own are what
  // no measured region covers), every size, the reading half.
  const pixelsFailed = cmp.ratio > tolerance || heightSkew > 0.02;
  const failed = Boolean(struct && struct.score > 0) || localised.some((f) => !f.unchecked);
  if (failed) diffCount++;
  // Accessibility is a verdict of its own: every rule axe finds on ours fails
  // the page (wcagFailures), whether or not the source breaks it too.
  const wcagFailed = wcagFailures(n.axe);
  const knownNote = struct?.knownInReview?.length
    ? ` (${struct.knownInReview.length} known, on the review list)`
    : "";
  const structNote = struct
    ? struct.score === 0
      ? `, same document${knownNote}`
      : `, ${struct.missing.length} line(s) missing${knownNote}`
    : "";
  // ONE VERDICT, both surfaces. This line used to exist only on the terminal,
  // so report.json held the ingredients and not the answer — and a reader who
  // went to the json (me, repeatedly) re-derived a worse summary from them and
  // missed what the line says plainly, like a page being 777px taller.
  const summary =
    `${p} ${(cmp.ratio * 100).toFixed(2)}% of pixels differ in ` +
      `${cmp.clusters.length} region(s), height ${o.height}/${n.height}` +
      `${structNote}` +
      (clusterOwners.length
        ? ` | pixels in ${clusterOwners
            .slice(0, 3)
            .map((o) => `${o.name ?? "nothing measured"} ${(o.share * 100).toFixed(0)}%`)
            .join(", ")}`
        : "") +
      (localised.length
        ? ` | ${localised.map((r) => `${r.name} ${r.verdict}${r.lookHarder ? " — LOOK HARDER, nothing inside it differs" : ""}`).join("; ")}`
        : "") +
      `${usable ? " (cached baseline)" : " (baseline captured)"}` +
      `${failed ? "  ← DIFFERS" : ""}` +
      `${wcagFailed.length ? `  ← FAILS ACCESSIBILITY: ${wcagFailed.join(", ")}` : ""}`;
  console.log(`  ${summary}`);
  const d = wcagDiff(o.axe, n.axe);
  if (d.new.length) console.log(`      WCAG new on ours: ${d.new.join(", ")}`);
  if (d.shared.length) console.log(`      WCAG on both: ${d.shared.join(", ")}`);
  if (failed) {
    // The paths, on the line that says it failed. They existed all along and
    // the run never mentioned them, so the only way to look at a difference
    // was to know the slug rule and go hunting.
    console.log(`      ${oldFile}\n      ${newFile}\n      ${path.join(OUT, `${slug}--diff.png`)}`);
  }
  return {
    p,
    slug,
    // The same sentence the run printed, so the json answers the question
    // rather than supplying parts to rebuild the answer from.
    summary,
    // Stated, not left to be derived from `heights`. A page that is 777px
    // taller is the finding on that page, and everything below the first
    // height difference lands at different coordinates — so the regions that
    // then "differ" are victims of it, not causes.
    heightDiffers: o.height !== n.height,
    // Where to LOOK. The pictures are the answer; the numbers point at them.
    shots: {
      source: oldFile,
      ours: newFile,
      diff: path.join(OUT, `${slug}--diff.png`),
      report: `${path.join(OUT, "index.html")}#${slug}`,
    },
    regionFindings: localised,
    // Every region's own verdict, moved-vs-changed already decided.
    regionRatios: cmp.regionRatios ?? {},
    clusterOwners,
    precluded: plan.precluded,
    ratio: cmp.ratio,
    clusters: cmp.clusters,
    compared: cmp.compared,
    sizes: cmp.sizes,
    heights: { old: o.height, new: n.height },
    heightSkew,
    tolerance,
    pixelsFailed,
    markdown: struct,
    failed,
    wcagFailed,
    wcag: { source: o.axe, ours: n.axe, diff: wcagDiff(o.axe, n.axe) },
    baselineCapturedAt: baseline[slug]?.capturedAt,
  };
}

// A page that did not finish loading in the wait is tried once more before it
// is reported as not compared: a run once lost 16 pages to one slow
// moment, and every one of them loaded at once when retried. A second failure
// is reported as it is.
const LOAD_FAILURE = /did not load|never appeared in|never finished hydrating|took longer than|preparing the page failed|did not answer after/;
// One page may not hold the run: a page that has not finished in this long is
// reported as not compared (and retried once, as a slow load is).
const PAGE_LIMIT = Number(args["page-limit"] ?? 300000);
const pageFailure = (p, fatal) => ({
  p,
  slug: slugOf(p),
  fatal,
});
const limited = (p) =>
  Promise.race([
    // A site that did not answer this page's requests (@inka/compare/fetch) fails this
    // page, not the run: a run once lost 373 pages to one source HEAD.
    comparePage(p).catch((e) => {
      if (e instanceof Unreachable || e instanceof NotRecorded) return pageFailure(p, e.message);
      throw e;
    }),
    new Promise((resolve) =>
      setTimeout(
        () => resolve(pageFailure(p, `took longer than ${PAGE_LIMIT / 1000}s to compare`)),
        PAGE_LIMIT,
      ).unref(),
    ),
  ]);
const results = await mapLimit(paths, CONCURRENCY, async (p) => {
  if (RECORD) await new Promise((r) => setTimeout(r, RECORD_PAUSE));
  const first = await limited(p);
  if (!first?.fatal || !LOAD_FAILURE.test(String(first.fatal))) return first;
  console.log(`  ${p} did not finish loading (${String(first.fatal).slice(0, 80)}); trying once more`);
  return limited(p);
});

closing = true;
await browser.close();
if (unrecordedRedirects) {
  console.log(
    `[visual] ${unrecordedRedirects} link(s) whose redirect was never recorded were compared as written — --record-source records them`,
  );
}
const scored = results
  .filter(Boolean)
  .sort((a, b) => (b.ratio ?? 9) - (a.ratio ?? 9));
const failing = scored.filter((r) => r.fatal || r.failed || r.wcagFailed?.length);
fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(scored, null, 2));

// The reading half, SHOWN. It was computed, used to pass or fail the page, and
// then reported as a count: "28 line(s) missing" tells you a page is wrong and
// nothing about how, so the only way to find out was to open report.json by
// hand. A count is not a finding. These are the lines, as a reader would read
// them, with their link and image targets intact — which is usually where the
// answer is.
const escape = (t) =>
  String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// A differing region, shown — cropped out of the full-page shots with CSS.
// `background-position` on the PNG we already took: no second render, no extra
// file, and you see the FOOTER rather than a 7000px page with a footer at the
// bottom of it. Side by side, because the answer to "what changed" is almost
// always visible the moment the two are next to each other.
function regionCrops(r) {
  if (!r.regionFindings?.length) return "";
  const pane = (src, box, label) => {
    if (!box) return `<div class="crop-missing">${label}: absent</div>`;
    const w = Math.min(box.w, 620);
    const h = Math.min(box.h, 420);
    return (
      `<figure class="crop"><figcaption>${label} ${box.w}&times;${box.h}</figcaption>` +
      `<div style="width:${w}px;height:${h}px;` +
      `background-image:url(${src});background-position:-${box.x}px -${box.y}px;` +
      `background-repeat:no-repeat"></div></figure>`
    );
  };
  return r.regionFindings
    .map((rf) => {
      // One pair of crops per DIFFERING instance. The whole point of knowing
      // they are in the same order is being able to put number three beside
      // number three.
      const pairs = rf.instances?.length
        ? rf.instances.map(
            (inst) =>
              `<div class="crops">${pane(`baseline/${r.slug}.png`, inst.a, `source #${inst.i + 1}`)}` +
              `${pane(`${r.slug}--ours.png`, inst.b, `ours #${inst.i + 1}`)}</div>`,
          )
        : [
            `<div class="crops">${pane(`baseline/${r.slug}.png`, rf.a, "source")}` +
              `${pane(`${r.slug}--ours.png`, rf.b, "ours")}</div>`,
          ];
      return (
        `<div class="region"><strong>${escape(rf.name)}</strong> — ${escape(rf.verdict)}` +
        pairs.join("") +
        `</div>`
      );
    })
    .join("");
}

function docDiff(md) {
  if (!md || md.score === 0) return "<small>same document</small>";
  const list = (lines, cls, sign) =>
    lines.length
      ? `<ul class="${cls}">${lines
          .slice(0, 40)
          .map((l) => `<li>${sign} ${escape(l)}</li>`)
          .join("")}${
          lines.length > 40
            ? `<li>…and ${lines.length - 40} more</li>`
            : ""
        }</ul>`
      : "";
  return (
    `<details open><summary><strong>${md.missing.length} line(s) missing, ` +
    `${md.extra.length} added</strong> (score ${md.score})</summary>` +
    list(md.missing, "gone", "−") +
    list(md.extra, "new", "+") +
    `</details>`
  );
}

const rows = scored
  .map((r) =>
    r.fatal
      ? `<tr class="fatal"><td>${r.p}</td><td colspan="3">DID NOT LOAD — ${r.fatal}</td></tr>`
      : `<tr class="${r.failed ? "diff" : "ok"}">
  <td>${r.p}<br><small>${(r.ratio * 100).toFixed(2)}% of pixels differ
  (tolerance ${(r.tolerance * 100).toFixed(2)}%)<br>
  height ${r.heights.old} vs ${r.heights.new}${r.heightSkew > 0.02 ? " ← PAGE HEIGHT DIFFERS" : ""}<br>
  baseline ${(r.baselineCapturedAt ?? "?").slice(0, 10)}<br>
  ${r.clusters.length} region(s): ${r.clusters
    .slice(0, 5)
    .map((c) => `${c.width}×${c.height} at ${c.x},${c.y}`)
    .join("; ") || "none"}</small>
  ${regionCrops(r)}
  ${docDiff(r.markdown)}</td>
  <td><img src="baseline/${r.slug}.png" style="width:100%"></td>
  <td><img src="${r.slug}--ours.png" style="width:100%"></td>
  <td><img src="${r.slug}--diff.png" style="width:100%;background:#fff"></td></tr>`,
  )
  .join("\n");
fs.writeFileSync(
  path.join(OUT, "index.html"),
  `<title>${settings.title}</title>
<style>body{font:14px system-ui;margin:1.5rem}table{border-collapse:collapse;width:100%}
td{border:1px solid #ccc;padding:6px;vertical-align:top;width:25%}
.ok{opacity:.5}.fatal{background:#fee}.diff{background:#fffbe6}
details{margin-top:.6rem}summary{cursor:pointer}
.region{margin:.5rem 0;padding:.4rem;border-left:3px solid #c33;background:#fff}
.crops{display:flex;gap:8px;margin-top:.3rem}
.crop figcaption{font:11px ui-monospace,monospace;color:#666}
.crop div{border:1px solid #ccc}.crop-missing{font:12px ui-monospace,monospace;color:#a11}
ul.gone,ul.new{margin:.3rem 0;padding-left:1rem;font:12px/1.45 ui-monospace,monospace}
ul.gone li{color:#a11}ul.new li{color:#161}</style>
<h1>${settings.title}</h1>
<p>${OLD} → ${NEW} · ${scored.length} pages · ${failing.length} failing (pixels, reading or accessibility) ·
${((Date.now() - started) / 1000).toFixed(0)}s${
  notCompared
    ? ` · <strong>stopped at --max-diffs=${MAX_DIFFS}, ${notCompared} page(s) not compared</strong>`
    : ""
}</p>
<table><tr><th>page</th><th>source</th><th>ours</th><th>difference</th></tr>${rows}</table>`,
);
const capNote = notCompared
  ? ` STOPPED at --max-diffs=${MAX_DIFFS}: ${notCompared} page(s) NOT compared.`
  : "";
const totals = wcagTotals(scored);
const line = (side) =>
  Object.entries(totals[side])
    .sort((a, b) => b[1] - a[1])
    .map(([id, pages]) => `${id} (${pages})`)
    .join(", ") || "none";
console.log(`[wcag] ${totals.pages} page(s) checked — rule (pages):`);
console.log(`[wcag]   new on ours: ${line("new")}`);
console.log(`[wcag]   on both:     ${line("shared")}`);
console.log(`[wcag]   fixed:       ${line("fixed")}`);
console.log(`[wcag]   ${scored.filter((r) => r.wcagFailed?.length).length} page(s) FAIL: every rule found on ours fails its page`);
console.log(
  `[visual] ${scored.length} pages in ${((Date.now() - started) / 1000).toFixed(0)}s — ` +
    `${failing.length} failing (pixels, reading or accessibility).${capNote} Report: ${path.join(OUT, "index.html")}`,
);
process.exit(failing.length ? 1 : 0);
