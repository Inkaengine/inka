/**
 * Which pages a comparison run looks at: "every page of the source site", and
 * "the smallest set of pages that still shows every kind of block". Defined
 * once: two runs that each kept a copy drifted, and a sample asked of one
 * silently shot every page.
 *
 * What a site's API calls a page, the path its pages are mounted under, and
 * which pages the conversion added (the source has nothing to compare them
 * to) are the caller's (pageSource).
 */

import { createHash } from "node:crypto";

/**
 * A page's slug: names its screenshots, its cached baseline and its source
 * recording. Readable, and at most 120 characters; a path cut short carries a
 * hash of the whole path, because two news items shared their first 110
 * characters and so shared one baseline.
 */
export function slugOf(p) {
  const full = p === "/" ? "home" : p.slice(1).replaceAll("/", "__");
  if (full.length <= 110) return full;
  return `${full.slice(0, 110)}-${createHash("sha256").update(p).digest("hex").slice(0, 8)}`;
}

/** Run `fn` over `items`, at most `limit` at a time, results in input order. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const i = cursor++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

/**
 * Page selection bound to one site's API.
 *
 * `apiJson` fetches and parses (each caller has its own auth/retry policy);
 * `api` is the API root; `concurrency` caps the sampling fan-out.
 */


/**
 * Every block on a page, at any depth, as `type:variation`. A converted page's
 * top level is one page layout, so reading only the top level saw that and
 * nothing in it: the sample "covered" the site with twelve pages and none had
 * a listing. A container keeps its children in `blocks`, whatever its regions
 * are called; only what sits there is a block (a link a field holds carries
 * its target's `@type` too, and is not one). A listing's signature names the
 * sources it maps, since those are what it draws.
 *
 * `types`: the content types that are pages; `stripPrefixes`: the paths the
 * source's pages are mounted under (RegExps); `addedByConversion`: the paths
 * the conversion added, which the source never had — comparing one scores our
 * page against the source's error page, which is not a conversion defect.
 */
export function blockSignatures(data) {
  const sigs = new Set();
  const walk = (value) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (key === "blocks" && child && typeof child === "object") {
        for (const block of Object.values(child)) {
          // A listing draws what its mapping maps: one showing a column as
          // tags is a different thing to see than one that doesn't.
          const mapped = block.fieldMapping ? `:${Object.keys(block.fieldMapping).sort().join(",")}` : "";
          sigs.add(`${block["@type"]}:${block.variation ?? block.styleName ?? "-"}${mapped}`);
        }
      }
      walk(child);
    }
  };
  walk(data);
  return [...sigs];
}

export function pageSource({ api, apiJson, concurrency, types, stripPrefixes, addedByConversion }) {
  if (!Array.isArray(types) || !Array.isArray(stripPrefixes) || !(addedByConversion instanceof RegExp)) {
    throw new TypeError("pageSource: types (the content types that are pages), stripPrefixes (RegExps) and addedByConversion (a RegExp of paths the source does not have)");
  }
  /** Every content page on the source site, as site-root-relative paths. */
  async function allPages() {
    const typeQuery = types.map((t) => `portal_type=${encodeURIComponent(t)}`).join("&");
    const items = [];
    for (let start = 0; ; start += 200) {
      const page = await apiJson(`${api}/@search?${typeQuery}&b_size=200&b_start=${start}`);
      items.push(...page.items);
      if (items.length >= page.items_total || page.items.length === 0) break;
    }
    const paths = items.map(
      (i) => stripPrefixes.reduce((p, prefix) => p.replace(prefix, ""), new URL(i["@id"]).pathname) || "/",
    );
    const kept = paths.filter((p) => !addedByConversion.test(p));
    const dropped = paths.length - kept.length;
    if (dropped) {
      console.log(
        `[pages] ${dropped} page(s) the conversion ADDED are not compared ` +
          `(${addedByConversion}) — the source has nothing to compare them to.`,
      );
    }
    return kept;
  }

  /**
   * The fewest pages that still carry every (block type, variation) the site
   * uses — a conversion defect lives in a BLOCK, so a set covering every block
   * covers every defect, and the hundred pages repeating one block add time,
   * not information.
   */
  /**
   * The smallest set of pages that still shows every block signature. An
   * optional `limit` caps it: the list is ordered rarest-signature first, so
   * truncating keeps the most distinctive pages and drops the ones adding
   * only common blocks.
   */
  async function samplePages(paths, limit = Infinity) {
    const seen = new Set();
    const chosen = [];
    const byPath = new Map();
    const rows = await mapLimit(paths, concurrency, async (p) => {
      const data = await apiJson(`${api}${p}`).catch(() => null);
      if (!data) return null;
      const sigs = blockSignatures(data);
      return { p, sigs };
    });
    // Rarest signature first, so a page carrying a one-off block is picked
    // before a page that only repeats what everything else already has.
    const freq = new Map();
    for (const r of rows.filter(Boolean))
      for (const s of r.sigs) freq.set(s, (freq.get(s) ?? 0) + 1);
    const scored = rows
      .filter(Boolean)
      .map((r) => ({
        ...r,
        rarity: Math.min(...r.sigs.map((s) => freq.get(s) ?? 1), Infinity),
      }))
      .sort((a, b) => a.rarity - b.rarity);
    for (const r of scored) {
      const fresh = r.sigs.filter((s) => !seen.has(s));
      if (!fresh.length) continue;
      fresh.forEach((s) => seen.add(s));
      byPath.set(r.p, r.sigs);
      chosen.push(r.p);
    }
    const capped = Number.isFinite(limit) ? chosen.slice(0, limit) : chosen;
    const dropped = chosen.length - capped.length;
    // Coverage of what is actually being compared, not of the full set — a
    // capped run genuinely sees fewer signatures, and saying otherwise reads
    // like full coverage.
    const kept = new Set(capped.flatMap((p) => byPath.get(p) ?? []));
    console.log(
      `[sample] ${capped.length} pages cover ${kept.size} of ${seen.size} ` +
        `block signatures` +
        (dropped ? ` (capped: ${dropped} covering page(s) dropped)` : ""),
    );
    return capped;
  }

  return { allPages, samplePages };
}

/**
 * `--flag`, `--key=value` AND `--key value` — the last form is what a hand
 * typing the command reaches for first, and silently reading it as `true`
 * turned `--max-diffs 4` into `Number(true)` = 1: the run stopped at the
 * first difference and reported a limit nobody asked for.
 */
export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const [key, inline] = arg.replace(/^--/, "").split("=");
    if (inline !== undefined) {
      out[key] = inline;
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}
