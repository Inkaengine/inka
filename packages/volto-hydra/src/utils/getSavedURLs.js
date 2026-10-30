import Cookies from 'js-cookie';
import isValidUrl from './isValidUrl';
import { getSavedUrlsCookieName } from './cookieNames';

/**
 * Frontend list entries are stored as comma-separated `Name|EditURL` or
 * `Name|EditURL|PublishURL` triples in both the env var
 * (RAZZLE_DEFAULT_IFRAME_URL) and the saved-URLs cookie. Old entries
 * without `|` are interpreted as URL-only and the name is derived from
 * the hostname; this keeps existing setups working without a forced
 * migration.
 *
 * The optional third slot (PublishURL) is for setups where the published
 * site lives at a different origin than the edit-mode frontend — e.g.
 * `edit.example.com` for previews and `www.example.com` for production.
 * It's used by the Url-helper shadow to recognise pasted URLs from the
 * published origin and flatten them to /paths (so resolveuid works).
 *
 * Examples:
 *   "Nuxt blog|https://nuxt.example.com,F7 mobile|https://f7.example.com/#!"
 *   "Site|https://edit.example.com|https://www.example.com"
 *   "https://legacy.example.com"           (no name → name = "legacy.example.com")
 */

// When the env/cookie entry has no `Name|` prefix, fall back to the URL
// minus its protocol — same string the old switcher used to render, so
// existing setups look identical until someone opts in to a real name.
const deriveName = (url) => url.replace(/^https?:\/\//, '');

const parseEntry = (raw) => {
  const s = (raw || '').trim();
  if (!s) return null;
  // Split on '|' — at most 3 parts: Name | EditURL | PublishURL.
  // PublishURL is optional and only present when the published frontend
  // lives at a different origin than the edit-mode frontend.
  const parts = s.split('|').map((p) => p.trim());
  if (parts.length === 1) {
    if (!isValidUrl(parts[0])) return null;
    return { url: parts[0], name: deriveName(parts[0]) };
  }
  const [name, url, publishUrl] = parts;
  if (!isValidUrl(url)) return null;
  const entry = { url, name: name || deriveName(url) };
  if (publishUrl && isValidUrl(publishUrl)) entry.publishUrl = publishUrl;
  return entry;
};

const parseList = (csv) =>
  (csv || '')
    .split(',')
    .map(parseEntry)
    .filter(Boolean);

const dedupeByUrl = (entries) => {
  const seen = new Set();
  const out = [];
  for (const e of entries) {
    if (seen.has(e.url)) continue;
    seen.add(e.url);
    out.push(e);
  }
  return out;
};

/**
 * Get the default frontend list from the environment.
 * @returns {Array<{url: string, name: string}>}
 */
export const getURlsFromEnv = () => {
  const presetUrlsString =
    process.env['RAZZLE_DEFAULT_IFRAME_URL'] ||
    // `window.env` is only injected by Razzle in the browser build; in SSR
    // and under jsdom (vitest) `window` exists but `window.env` does not,
    // so guard before indexing.
    (typeof window !== 'undefined' &&
      window.env &&
      window.env['RAZZLE_DEFAULT_IFRAME_URL']) ||
    // Nothing, when nobody configured a frontend.
    //
    // This used to fall back to a hydra TEST port, which made a deployed admin
    // claim a frontend at localhost:3002 — an address that exists on a
    // developer's laptop and nowhere else. Every caller already handles an
    // empty list (`getURlsFromEnv()[0]?.url`), and "no frontend configured" is
    // the truth in that case.
    '';
  return parseList(presetUrlsString);
};

/**
 * Get the saved frontend list from the cookie, merged with env entries.
 * Cookie entries take precedence (so the user can rename an env entry).
 * @returns {Array<{url: string, name: string}>}
 */
const getSavedURLs = () => {
  const cookieName = getSavedUrlsCookieName();
  const cookieEntries = parseList(Cookies.get(cookieName));
  const envEntries = getURlsFromEnv();
  return dedupeByUrl([...cookieEntries, ...envEntries]);
};

/**
 * Serialise an entry list to the `Name|EditURL[|PublishURL]` cookie/env
 * format. The third slot is only emitted when publishUrl is set; otherwise
 * the entry stays in the legacy 2-part shape so old setups round-trip
 * unchanged.
 * @param {Array<{url: string, name?: string, publishUrl?: string}>} entries
 */
export const serialiseEntries = (entries) =>
  entries
    .map((e) => {
      const base = `${e.name || deriveName(e.url)}|${e.url}`;
      return e.publishUrl ? `${base}|${e.publishUrl}` : base;
    })
    .join(',');

export default getSavedURLs;
