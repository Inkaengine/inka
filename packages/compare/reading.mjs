/**
 * The reading measure: what a page still SAYS, compared against another
 * render of it. The words a reader reads, the links they can follow, the
 * images and videos they can see — not the markup, which two implementations
 * of the same design disagree on by construction.
 *
 * Each side's rendered page becomes markdown (pageMarkdown): it keeps what a
 * reader gets, the words, the headings and where links, images and videos
 * point, and discards the wrappers, classes and attribute order. The two are
 * diffed line by line (markdownDiff). URLs are normalised first, because the
 * same destination is written differently on two sites (an internal host, a
 * mount path, an image scale): a difference that survives normalisation is
 * one a reader would notice.
 *
 * What depends on a design system or a site is the caller's:
 *
 *   stripPrefixes  paths a source site is mounted under (RegExps)
 *   reader         { openPanelClass, inlineIconClass, linkDescriptionClass }:
 *                  a closed panel still read (its words are the page's), a
 *                  container drawn as an inline icon, a link's sr-only
 *                  description; each null when the design has none
 *   chrome         the selectors of the header nav, breadcrumbs and footer
 *   parseHTML      the HTML parser, (html) => ({ document })
 */
/** The caller's HTML parser: `(html) => ({ document })` (linkedom's parseHTML, or jsdom). */
function parserOf(parseHTML, fn) {
  if (typeof parseHTML !== "function") throw new TypeError(`${fn}: parseHTML, the caller's HTML parser, (html) => ({ document })`);
  return parseHTML;
}

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "SVG", "NOSCRIPT", "TEMPLATE", "PATH"]);

/**
 * One destination, written the way both sites can be compared.
 *
 * The source stores absolute urls into its own back end, and both sites serve
 * images through Plone's scale machinery. What matters is WHICH thing is
 * pointed at, not the route taken to it.
 */
export function normaliseUrl(raw, { origins = [], page = null, stripPrefixes = [] } = {}) {
  let url = (raw || "").trim();
  // A bare "#fragment" is a link to the page it is on. A source writes
  // /reports#<uid>, ours renders #<slug>: with the fragment ignored by
  // lineKey they have to leave here as the SAME page, or every good in-page
  // link reads as one missing and one extra.
  if (page && url.startsWith("#")) url = (page === "/" ? "" : page.replace(/\/$/, "")) + url;
  if (!url || url.startsWith("data:") || url.startsWith("mailto:") || url.startsWith("tel:")) {
    return url ? url.split("?")[0] : "";
  }
  // Absolute into either site (including the source's internal host) becomes a
  // path, so the same destination reads the same on both sides.
  for (const origin of origins) {
    if (url.startsWith(origin)) url = url.slice(origin.length);
  }
  url = url.replace(/^https?:\/\/[^/]+/, "");
  // A source mounted under a site root or an export path; ours is not.
  for (const prefix of stripPrefixes) url = url.replace(prefix, "");
  // Plone serves the same image through a scale ladder and a download view —
  // and a page may write the view URL-encoded (%40%40download).
  url = url.replace(/%40/gi, "@");
  url = url.replace(/\/@@images\/[^/]+(\/[^/]+)?$/, "").replace(/\/@@download\/[^/]+$/, "");
  // Editing and view suffixes are not the destination.
  url = url.replace(/\/(edit|view)$/, "");
  url = url.split("?")[0].replace(/\/$/, "");
  return url || "/";
}

/**
 * The content of a page: its words, and everything it points at.
 *
 * `origins` lets a caller name the hosts that count as "this site" so an
 * absolute self-link normalises the same as a relative one.
 */
export function pageContent(html, { origins = [], page = null, stripPrefixes = [], parseHTML } = {}) {
  const { document } = parserOf(parseHTML, "pageContent")(html);
  const root = document.querySelector("main") ?? document.body;

  // Text NODES, not textContent: the DOM's own concatenation runs the end of
  // one element into the start of the next ("...the report" + "Section" ->
  // "reportsection"), inventing words that then appear lost on the other side.
  const chunks = [];
  const readText = (el) => {
    for (const node of el.childNodes ?? []) {
      if (node.nodeType === 3) chunks.push(node.nodeValue ?? "");
      else if (node.nodeType === 1 && !SKIP_TAGS.has(node.tagName)) readText(node);
    }
  };
  readText(root);
  const text = chunks.join(" ").replace(/\s+/g, " ").trim().toLowerCase();

  const collect = (selector, attr) =>
    new Set(
      Array.from(root.querySelectorAll(selector))
        .map((el) => normaliseUrl(el.getAttribute(attr), { origins, page, stripPrefixes }))
        .filter(Boolean),
    );

  return {
    words: text.split(" ").filter((w) => w.length > 2),
    // Anchors only: a button that opens a dialog points at nothing a reader can
    // follow, and an in-page anchor is still a destination worth keeping.
    links: collect("a[href]", "href"),
    images: collect("img[src]", "src"),
    // A video is an iframe (YouTube, Vimeo) or a real <video>; both are things
    // a reader can watch, and both went missing during this conversion before.
    videos: new Set([
      ...collect("iframe[src]", "src"),
      ...collect("video[src]", "src"),
      ...collect("video source[src]", "src"),
    ]),
  };
}

/** What the converted page no longer carries. */
export function contentDiff(before, after) {
  const missing = (a, b) => [...a].filter((x) => !b.has(x)).sort();
  const beforeWords = new Set(before.words);
  const afterWords = new Set(after.words);
  const wordsLost = [...beforeWords].filter((w) => !afterWords.has(w)).sort();
  const linksLost = missing(before.links, after.links);
  const imagesLost = missing(before.images, after.images);
  const videosLost = missing(before.videos, after.videos);
  return {
    wordsLost,
    linksLost,
    imagesLost,
    videosLost,
    // Media and links are counted heavier than words on purpose: a lost word is
    // often a label the design system words differently, while a lost link or
    // image is something a reader can no longer reach.
    score:
      wordsLost.length +
      (linksLost.length + imagesLost.length + videosLost.length) * 10,
  };
}

/**
 * The page as MARKDOWN — the document a reader would take away from it.
 *
 * This is the comparison. A converted page should reduce to the same markdown
 * as the page it came from: the same headings at the same levels, the same
 * paragraphs in the same order, the same links with the same words pointing at
 * the same places, the same images, the same lists and tables.
 *
 * Markdown is the right shape for it because it keeps exactly what a reader
 * cares about and drops exactly what they do not. Classes, wrappers and element
 * choices vanish — which is why the two sites' markup can disagree completely
 * and still compare equal — while ORDER survives, which a bag of words does
 * not: text moved from a heading into a paragraph, a link whose label changed,
 * a list flattened into prose all show up here and were invisible before.
 */
const BLOCK_TAGS = new Set([
  "P", "DIV", "SECTION", "ARTICLE", "HEADER", "FOOTER", "MAIN", "ASIDE", "NAV",
  "UL", "OL", "LI", "TABLE", "TR", "BLOCKQUOTE", "FIGURE", "FIGCAPTION", "DL",
  "DT", "DD", "H1", "H2", "H3", "H4", "H5", "H6", "BR", "HR",
  // CELLS, because the two stacks disagree about what is inside one. The
  // source wraps each cell's text in a <p> and gets a line per cell; ours puts
  // the text straight in the <th>, and without a boundary "Record" and
  // "Description" came out as "RecordDescription" — one table reported as two
  // different documents.
  "TD", "TH",
]);

/**
 * Hidden from a reader, so not part of what they take away.
 *
 * The design system renders Material Icons as ligature TEXT — an <span
 * aria-hidden="true">east</span> inside a link label — so "Contact Form"
 * extracted as "Contact Formeast" and every such link read as changed. The
 * page is telling us, in the markup, that this is decoration.
 */
const hiddenFromReaders = (el, reader) =>
  el.getAttribute?.("aria-hidden") === "true" ||
  (el.hasAttribute?.("hidden") && !isClosedPanel(el, reader));

/**
 * A closed panel (an accordion's, say). One implementation hides it with the
 * hidden attribute, another (a <details>) leaves it in the page unhidden. The
 * same words a reader opens the panel to read, so they are read on both
 * sides — skipping them on one side reported every panel as added, and on
 * both would let a panel lost in conversion go unseen.
 */
const isClosedPanel = (el, reader) => Boolean(reader.openPanelClass) && Boolean(el.classList?.contains(reader.openPanelClass));

/**
 * An icon link's screen-reader description: an sr-only span after the link
 * (its icon's title — "(opens in new window)", "download file") that the link
 * names in its aria-describedby. One implementation renders it, another never
 * had one, so it is not a difference in what the page says.
 */
const isLinkDescription = (el, reader) =>
  Boolean(reader.linkDescriptionClass) &&
  !!el.id &&
  el.classList?.contains(reader.linkDescriptionClass) &&
  [...(el.ownerDocument?.querySelectorAll("a[aria-describedby]") ?? [])].some((a) =>
    a.getAttribute("aria-describedby").split(/\s+/).includes(el.id),
  );

export function pageMarkdown(html, { origins = [], page = null, stripPrefixes = [], reader, parseHTML } = {}) {
  if (!reader) throw new TypeError("pageMarkdown: reader, the design's { openPanelClass, inlineIconClass, linkDescriptionClass } (each null for none)");
  const { document } = parserOf(parseHTML, "pageMarkdown")(html);
  const root = document.querySelector("main") ?? document.body;
  const out = [];
  let line = "";

  const flush = () => {
    const text = line.replace(/[ \t]+/g, " ").trim();
    // A heading with no words (an empty <h3>) reads as nothing, as an
    // anchor with no label does: a page of them read as "###".
    if (text && !/^#+$/.test(text)) out.push(text);
    line = "";
  };

  const walk = (node, depth) => {
    for (const child of node.childNodes ?? []) {
      if (child.nodeType === 3) {
        line += child.nodeValue ?? "";
        continue;
      }
      if (child.nodeType !== 1) continue;
      const tag = child.tagName;
      // An icon drawn as an inline SVG on one side (the other has an <img> of
      // the same file). It names no file, so it is recorded as what it is;
      // any other inline SVG is decoration. Read off its CONTAINER, before
      // the hidden check: the container is aria-hidden (the icon is
      // decorative), and skipping it read every such icon as missing.
      if (reader.inlineIconClass && child.classList?.contains(reader.inlineIconClass) && child.querySelector?.("svg")) {
        flush();
        out.push("!icon(inline-svg)");
        continue;
      }
      if (SKIP_TAGS.has(tag)) continue;
      if (hiddenFromReaders(child, reader) || isLinkDescription(child, reader)) continue;

      if (/^H[1-6]$/.test(tag)) {
        flush();
        line = `${"#".repeat(Number(tag[1]))} `;
        walk(child, depth);
        flush();
        continue;
      }
      if (tag === "A") {
        // Label AND destination: a link whose words survived but whose href
        // broke is a link a reader cannot follow, and the words alone said
        // nothing about it.
        const href = normaliseUrl(child.getAttribute("href"), { origins, page, stripPrefixes });
        const before = line;
        line = "";
        walk(child, depth);
        const words = line.replace(/\s+/g, " ");
        const label = words.trim();
        // An anchor with NO label presents nothing to a reader — it is a jump
        // target, not a link. The source puts one before every heading, so its
        // headings read `## [](/page#uuid)Title` against our `## Title` and
        // twenty such lines looked like a dropped section.
        // A space at the edge of the link's words stays outside its brackets:
        // "Agency<a> website</a>" reads as "Agency website", as
        // "Agency <a>website</a>" does.
        const lead = label && words.startsWith(" ") && !/\s$/.test(before) ? " " : "";
        const trail = label && words.endsWith(" ") ? " " : "";
        line = label ? `${before}${lead}[${label}](${href})${trail}` : before;
        continue;
      }
      // A button drawn as an <input> says its value, as a <button> says its
      // text: the source's forms submit with <input type="submit" value=…>.
      if (tag === "INPUT") {
        if (["submit", "button", "reset"].includes((child.getAttribute("type") || "").toLowerCase())) {
          line += ` ${child.getAttribute("value") || ""} `;
        }
        continue;
      }
      if (tag === "IMG") {
        const src = normaliseUrl(child.getAttribute("src"), { origins, stripPrefixes });
        const alt = (child.getAttribute("alt") || "").trim();
        line += `![${alt}](${src})`;
        continue;
      }
      if (tag === "IFRAME" || tag === "VIDEO") {
        flush();
        out.push(`!video(${normaliseUrl(child.getAttribute("src"), { origins, stripPrefixes })})`);
        continue;
      }
      // A video not yet played: the click-to-play thumbnail names its video. The
      // same video as the source's player, and its image is not content.
      if (tag === "BUTTON" && child.hasAttribute("data-video-src")) {
        flush();
        out.push(`!video(${normaliseUrl(child.getAttribute("data-video-src"), { origins, stripPrefixes })})`);
        continue;
      }
      if (tag === "LI") {
        flush();
        line = "- ";
        walk(child, depth + 1);
        flush();
        continue;
      }
      if (BLOCK_TAGS.has(tag)) {
        flush();
        walk(child, depth);
        flush();
        continue;
      }
      walk(child, depth);
    }
  };

  walk(root, 0);
  flush();
  return out;
}

/** The lines one document has that the other does not, in order. */
// What a line is COMPARED by — the report still shows the line as written.
// Two spellings of one destination are one destination:
//  - a link's #fragment: the source anchors on block uids, ours on heading
//    slugs, and the conversion rewrites one to the other. Whether the rewritten
//    anchor resolves is checked where it is made: the server conversion
//    reports every fragment it could not resolve.
//  - an image by its FILE: ours serves the same file from a folder, and gives
//    it alt text the source never had.
//  - whitespace as a browser shows it (white-space: normal): a site's text
//    holds carriage returns from pasted documents, which the source keeps as "\r"
//    and our server render turns into "\n". Both read as one space. Here and
//    not in pageMarkdown, because the source side can come from the cache.
//  - a line that is ONLY a link, as that link: the source's in-page nav is a
//    heading and plain links, ours a list of them.
export function lineKey(line) {
  return line
    .replace(/\s+/g, " ")
    .trim()
    .replace(/!\[[^\]]*\]\(([^)]*\/)?([^/)]+)\)/g, "![]($2)")
    .replace(/\]\(([^)#]*)#[^)]*\)/g, "]($1)")
    .replace(/^- (\[[^\]]*\]\([^)]*\))$/, "$1");
}

export const LINK_RE = /\[([^\]]*)\]\(([^)]*)\)/g;
export const hrefsOf = (line) => [...line.matchAll(LINK_RE)].map((m) => m[2]);
export const pathOf = (href) => href.split("#")[0].split("?")[0].replace(/\/$/, "") || "/";

// The path of the THING a link points at: its download or view suffix off
// (/x.pdf/@@download/file, or written %40%40, is /x.pdf).
// That is the path the source redirects, when the thing has moved.
const thingPathOf = (href) => {
  const path = pathOf(href).replace(/%40/gi, "@").split("/@@")[0].split("/++")[0];
  return path.replace(/\/(view|download)$/, "") || "/";
};

/** A line's links that are paths on the site, as the things they point at —
 * not a fragment, an external url or a resolveuid (which names content, not a
 * place). What the comparison asks the source's redirects about. */
export function sourcePathsOf(line) {
  return hrefsOf(line)
    .filter((href) => href.startsWith("/") && !href.startsWith("//") && !href.includes("resolveuid/"))
    .map(thingPathOf);
}
// The words a line says with its links taken out: "[website](/x)." -> "website."
// A file link's type and size, which a design may draw inside the link
// ("Report (PDF, 1.2 MB)"), are not words the source said.
const FILE_INFO_IN_LINK = / \([A-Z][A-Z0-9]*(?:, [0-9.]+ [KMGT]?B)?\)(?=\]\()/g;
export const wordsOf = (line) =>
  line.replace(FILE_INFO_IN_LINK, "").replace(LINK_RE, "$1").replace(/\s+/g, " ").trim();
export const isOnlyLinks = (line) => lineKey(line).replace(LINK_RE, "").replace(/^- /, "").trim() === "";

/**
 * Links the SOURCE redirects, compared by where the redirect goes.
 *
 * The conversion repoints a link to an old path through the source's own
 * redirects (an old /archive/…pdf moved elsewhere), so ours links the
 * page the source's link lands on. `redirects` maps a source path to where
 * the source sends it; a missing line that, followed, IS one of our extra
 * lines is the same link. Returns the narrowed diff and the redirects that
 * explained a line, so the report can say so.
 */
export function followSourceRedirects(struct, redirects, exceptions) {
  const followed = [];
  const fired = [];
  const extra = [...struct.extra];
  const missing = [];
  // A line whose links now land where ours do may still differ by something
  // an approved exception covers (a file link's size drawn inside the link):
  // it pairs through that exception, which is announced like any other.
  const pairers = exceptions.filter((e) => e.pairs);
  for (const line of struct.missing) {
    let rewritten = line;
    const used = [];
    for (const href of hrefsOf(line)) {
      const target = href.startsWith("/") ? redirects[thingPathOf(href)] : undefined;
      if (!target) continue;
      // The thing, where it went: its fragment kept, its view dropped (the
      // link to it on our side names the thing, not the view).
      const fragment = href.includes("#") ? href.slice(href.indexOf("#")) : "";
      rewritten = rewritten.replace(`](${href})`, `](${target}${fragment})`);
      used.push(`${thingPathOf(href)} -> ${target}`);
    }
    let j = used.length ? extra.findIndex((other) => lineKey(other) === lineKey(rewritten)) : -1;
    let through = null;
    if (j === -1 && used.length) {
      for (const e of pairers) {
        j = extra.findIndex((other) => e.pairs(rewritten, other));
        if (j !== -1) {
          through = e;
          break;
        }
      }
    }
    if (j === -1) {
      missing.push(line);
      continue;
    }
    extra.splice(j, 1);
    for (const u of used) if (!followed.includes(u)) followed.push(u);
    if (through && !fired.includes(through)) fired.push(through);
  }
  return { struct: { missing, extra, score: contentScore(missing, extra) }, followed, fired };
}

export function markdownDiff(before, after) {
  const afterCounts = new Map();
  for (const l of after) afterCounts.set(lineKey(l), (afterCounts.get(lineKey(l)) ?? 0) + 1);
  const missing = [];
  for (const l of before) {
    const n = afterCounts.get(lineKey(l)) ?? 0;
    if (n > 0) afterCounts.set(lineKey(l), n - 1);
    else missing.push(l);
  }
  const beforeCounts = new Map();
  for (const l of before) beforeCounts.set(lineKey(l), (beforeCounts.get(lineKey(l)) ?? 0) + 1);
  const extra = [];
  for (const l of after) {
    const n = beforeCounts.get(lineKey(l)) ?? 0;
    if (n > 0) beforeCounts.set(lineKey(l), n - 1);
    else extra.push(l);
  }
  return { missing, extra, score: contentScore(missing, extra) };
}

// A line carrying a link, an image or a video counts heavier: prose is
// reworded by the design system all the time, a destination is not.
//
// And LOSING is worse than GAINING, so an addition weighs half — but not
// nothing, which is what it used to weigh. `score` came from `missing` alone,
// so anything our side gained was rendered in the report and then scored zero:
// a conversion that duplicated a section, injected boilerplate or rendered a
// block twice reported "same document" every time.
const WEIGHT = {
  missing: { media: 10, prose: 2 },
  extra: { media: 5, prose: 1 },
};

const isMedia = (line) => line.startsWith("!video(") || line.includes("](");

export function contentScore(missing, extra) {
  const weigh = (lines, w) =>
    lines.reduce((n, l) => n + (isMedia(l) ? w.media : w.prose), 0);
  return weigh(missing, WEIGHT.missing) + weigh(extra, WEIGHT.extra);
}

/**
 * Approved content differences, removed from the diff and announced.
 *
 * The visual half has had exceptions all along; the reading half had none, so
 * the only way to stop a known difference failing a page was to stop checking
 * the page. This is the same protocol: a NAMED line on a NAMED page, carrying
 * a reason, reported every time it fires so it stays reviewable.
 *
 * Whole lines only. A fragment match would quietly excuse any line that
 * happened to contain the text, which is how an exception stops being a
 * statement about one difference and becomes a waiver.
 *
 * Returns the narrowed diff and the exceptions that actually fired — an
 * exception nobody needed any more should be visible as one that never fires.
 */
export function excuseContent(struct, pagePath, exceptions = []) {
  const active = exceptions.filter((e) => !e.when || e.when(pagePath));
  if (!active.length) return { struct, fired: [] };

  const fired = [];
  const drop = (lines, key) => {
    let kept = lines;
    for (const exception of active) {
      const allowed = exception[key];
      if (!allowed?.length) continue;
      const before = kept.length;
      // Our side without a file link's type and size, which our links to
      // files may carry and a listed line predates.
      const plain = key === "extra" ? (line) => line.replace(FILE_INFO_IN_LINK, "") : (line) => line;
      kept = kept.filter((line) => !allowed.includes(line) && !allowed.includes(plain(line)));
      if (kept.length !== before && !fired.includes(exception)) fired.push(exception);
    }
    return kept;
  };

  let missing = drop(struct.missing, "missing");
  let extra = drop(struct.extra, "extra");

  // PAIRS: an exception may excuse a source line together with ONE of ours
  // (`pairs(missingLine, extraLine)`), for a difference that is a relation
  // between the two — the same date shown in another zone — rather than a
  // fixed line. Each line pairs at most once.
  for (const exception of active) {
    if (!exception.pairs) continue;
    const used = new Set();
    const unpaired = [];
    for (const line of missing) {
      const j = extra.findIndex((other, k) => !used.has(k) && exception.pairs(line, other));
      if (j === -1) unpaired.push(line);
      else {
        used.add(j);
        if (!fired.includes(exception)) fired.push(exception);
      }
    }
    missing = unpaired;
    extra = extra.filter((_, k) => !used.has(k));
  }
  // Lines of OURS excused by pattern — after the pairs, so a line that has a
  // partner on the source is paired first rather than dropped unpaired.
  for (const exception of active) {
    if (!exception.extraMatching?.length) continue;
    const before = extra.length;
    extra = extra.filter((line) => !exception.extraMatching.some((re) => re.test(line.trim())));
    if (extra.length !== before && !fired.includes(exception)) fired.push(exception);
  }
  return {
    struct: { missing, extra, score: contentScore(missing, extra) },
    fired,
  };
}

/**
 * The chrome's lists, as a reader meets them: the main nav's top-level items,
 * the breadcrumb trail, the footer's links, each in document order. The text
 * half reads `<main>` only, so the chrome was compared as pixels alone — two
 * nav items swapped on every page read as "main nav 1.7% different".
 *
 * The footer's built-with line is left out: it names the platform that built
 * each site and differs on purpose (the `footer-built-with` exception).
 */
/** Bumped when chromeLists reads differently, so a cached baseline's lists are re-read. */
export const CHROME_VERSION = 2;

export function chromeLists(html, chrome, parseHTML) {
  if (!chrome?.nav || !chrome.breadcrumbs || !chrome.footer) {
    throw new TypeError("chromeLists: chrome, the selectors of { nav: { list, item }, breadcrumbs, footer: { links, except } }");
  }
  const { document } = parserOf(parseHTML, "chromeLists")(html);
  // What a reader hears: the same skips as the page text (SKIP_TAGS — an
  // icon's <style>, an SVG's <title>) and nothing aria-hidden.
  const reader = (node) => {
    if (node.nodeType === 3) return node.textContent;
    if (node.nodeType !== 1) return "";
    if (SKIP_TAGS.has(node.tagName.toUpperCase()) || node.getAttribute("aria-hidden") === "true") return "";
    return [...node.childNodes].map(reader).join("");
  };
  const labels = (nodes) =>
    [...nodes].map((n) => reader(n).replace(/\s+/g, " ").trim()).filter(Boolean);
  const nav = document.querySelector(chrome.nav.list);
  return {
    nav: nav ? labels([...nav.children].map((li) => li.querySelector(chrome.nav.item)).filter(Boolean)) : [],
    breadcrumbs: labels(document.querySelectorAll(chrome.breadcrumbs)),
    footer: labels(
      [...document.querySelectorAll(chrome.footer.links)].filter((a) => !(chrome.footer.except && a.closest(chrome.footer.except))),
    ),
  };
}

/**
 * The source's chrome lists less the links an approved exception names as
 * `missing`, where ours does not have them, and with those it names as
 * `added`, where only ours has them (a comparison's chrome exceptions), and
 * the exceptions that did that, to be
 * announced. Only the named link, on
 * the named list: anything else that differs there is still a finding.
 */
export function excuseChrome(source, ours, exceptions) {
  const lists = { ...(source ?? {}) };
  const fired = [];
  for (const e of exceptions) {
    if (!e.missing && !e.added) throw new Error(`chrome exception ${e.label} names no missing or added link`);
    let a = lists[e.list] ?? [];
    const b = ours?.[e.list] ?? [];
    const gone = (e.missing ?? []).filter((item) => a.includes(item) && !b.includes(item));
    const extra = (e.added ?? []).filter((item) => b.includes(item) && !a.includes(item));
    if (!gone.length && !extra.length) continue;
    a = a.filter((item) => !gone.includes(item));
    // An added link goes where ours has it: after the link before it on ours
    // (first, when it opens the list), so the order is still compared.
    for (const item of extra) {
      const before = b.slice(0, b.indexOf(item)).reverse().find((x) => a.includes(x));
      a = [...a];
      a.splice(before === undefined ? 0 : a.indexOf(before) + 1, 0, item);
    }
    lists[e.list] = a;
    fired.push(e);
  }
  return { lists, fired };
}

/** Each chrome list that differs: in membership, or only in order. */
export function chromeDiff(source, ours) {
  const findings = [];
  for (const list of ["nav", "breadcrumbs", "footer"]) {
    const a = source?.[list] ?? [];
    const b = ours?.[list] ?? [];
    if (a.length === b.length && a.every((x, i) => x === b[i])) continue;
    const missing = a.filter((x) => !b.includes(x));
    const extra = b.filter((x) => !a.includes(x));
    const verdict =
      missing.length || extra.length
        ? [
            missing.length ? `missing from ours: ${missing.join(", ")}` : "",
            extra.length ? `only on ours: ${extra.join(", ")}` : "",
          ].filter(Boolean).join("; ")
        : `same items, different order: the source has ${a.join(" · ")}; ours has ${b.join(" · ")}`;
    findings.push({ name: `chrome: ${list}`, verdict });
  }
  return findings;
}
