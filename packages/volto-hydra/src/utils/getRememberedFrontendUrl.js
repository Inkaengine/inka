import Cookies from 'js-cookie';
import getSavedURLs from './getSavedURLs';
import { getIframeUrlCookieName } from './cookieNames';

const bare = (url) => url.replace(/\/$/, '');

/**
 * The frontend to open for an editor, from the one they last used.
 *
 * The iframe_url cookie remembers the edit URL the editor last had open. A
 * frontend can later gain an editing build at its own address, with its old
 * address kept as its publish URL (`Name|EditURL|PublishURL`). The
 * remembered address is then a site the editor cannot edit through, so open
 * that frontend's edit URL instead. Any other remembered URL is kept as it is:
 * an editor may have typed any URL into the switcher.
 *
 * @param {Array<{url:string, publishUrl?:string}>} savedEntries
 * @param {string|null|undefined} rememberedUrl
 * @returns {string|undefined}
 */
export const getRememberedFrontendUrl = (savedEntries, rememberedUrl) => {
  if (!rememberedUrl) return undefined;
  const published = savedEntries.find(
    (e) =>
      e.publishUrl &&
      bare(e.publishUrl) === bare(rememberedUrl) &&
      e.url !== rememberedUrl,
  );
  return published ? published.url : rememberedUrl;
};

/** The remembered frontend, read from this admin's iframe_url cookie. */
const rememberedFrontendUrl = () =>
  getRememberedFrontendUrl(
    getSavedURLs(),
    Cookies.get(getIframeUrlCookieName()),
  );

export default rememberedFrontendUrl;
