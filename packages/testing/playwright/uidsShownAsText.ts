/**
 * The block uids that appear in a page's visible text.
 *
 * A uid is an internal key; a reader never sees one. Shown as text, it means
 * something drew a block's raw data (a fallback dumping its JSON, an error
 * naming it) in place of the block, however the frontend chose to fail.
 *
 * Matched as a whole token (`card-1` isn't shown by `card-10`). A uid made only
 * of letters (`intro`, `title`) can't be told from prose, so it isn't judged:
 * only one with a digit, `-` or `_` in it is.
 */
export function uidsShownAsText(text: string, uids: string[]): string[] {
  const looksLikeAKey = (uid: string) => /[\d_-]/.test(uid);
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return uids.filter((uid) => looksLikeAKey(uid)
    && new RegExp(`(^|[^A-Za-z0-9_-])${escape(uid)}($|[^A-Za-z0-9_-])`).test(text));
}
