/**
 * A source site, recorded once and replayed.
 *
 * A source site is usually someone else's production site. Shooting it live
 * on every run asks it for every page again, and again for each change to an
 * exception's CSS, and asks it for its redirects every run: to its owner, a
 * comparison run is load they did not ask for.
 *
 * So each source page is a HAR archive (every request it made, bodies
 * embedded), recorded in one gentle pass (`--record-source`) and replayed with
 * the network shut: a request the recording never saw is refused, not sent.
 * An exception change re-renders from the archive. A page never recorded
 * fails loudly; nothing falls through to the live site.
 */

import fs from "node:fs";
import path from "node:path";

export class NotRecorded extends Error {
  name = "NotRecorded";
}

/** Where a page's recording lives, in the archive directory `dir`. */
export const archiveFile = (dir, slug) => path.join(dir, `${slug}.har`);

/**
 * Route `context` through `file`: recorded to it (written when the context
 * closes), or replayed from it with everything else refused.
 */
export async function useArchive(context, file, { record }) {
  if (record) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await context.routeFromHAR(file, { update: true, updateContent: "embed", updateMode: "full" });
    return;
  }
  if (!fs.existsSync(file)) {
    throw new NotRecorded(`no recording of the source page at ${file} — record it with --record-source`);
  }
  dropFailedEntries(file);
  // Every request goes through here: one the archive answers is answered from
  // it; anything else is refused before it leaves the browser.
  await context.route("**/*", (route) => route.abort("blockedbyclient"));
  await context.routeFromHAR(file, { notFound: "abort" });
}

/**
 * A request still in flight when its page was saved (YouTube's ad_status.js)
 * is recorded as failed, status -1, and replaying that entry never answers:
 * the page's load never fired, and the page went uncompared.
 * Without it, the request is refused like any other the recording lacks.
 */
function dropFailedEntries(file) {
  const har = JSON.parse(fs.readFileSync(file, "utf8"));
  const kept = har.log.entries.filter((e) => e.response.status > 0);
  if (kept.length === har.log.entries.length) return;
  har.log.entries = kept;
  fs.writeFileSync(file, JSON.stringify(har));
}

/**
 * Where the source sent an old path, as recorded: path → its new path, or
 * null for "no redirect". Written as each answer is learned, so a stopped
 * recording keeps what it had.
 */
export class RedirectArchive {
  /** `dir`: the archive directory, where the redirects are kept with the pages. */
  constructor(dir) {
    if (!dir) throw new TypeError("RedirectArchive: the archive directory its redirects are kept in");
    const file = path.join(dir, "redirects.json");
    this.file = file;
    this.map = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  }
  has(p) {
    return Object.hasOwn(this.map, p);
  }
  get(p) {
    return this.map[p];
  }
  set(p, target) {
    this.map[p] = target;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.map, null, 1));
  }
}
