/**
 * Url helper.
 * @module helpers/Url
 *
 * VOLTO-HYDRA SHADOW.
 * Identical to the stock @plone/volto Url helper EXCEPT for
 * `flattenToAppURL` and `isInternalURL`, which both gain awareness of
 * iframe-frontend URLs registered via FrontendSettingsModal /
 * RAZZLE_DEFAULT_IFRAME_URL. Volto's stock helpers only strip
 * `settings.apiPath` / `internalApiPath` / `publicURL`, none of which
 * match a Hydra iframe's published origin — so a link pasted from the
 * published site (e.g. `https://www.example.com/about`) survives the
 * save round-trip as an absolute URL, breaking resolveuid.
 *
 * The Hydra additions are tagged with `HYDRA:` comments to keep
 * upstream-rebase diffing trivial.
 */

import last from 'lodash/last';
import memoize from 'lodash/memoize';
import isArray from 'lodash/isArray';
import isObject from 'lodash/isObject';
import isString from 'lodash/isString';
// HYDRA: stock helper imports urlRegex from a relative './urlRegex'; the
// shadow lives at a different depth, so reach the original via the
// package path.
import {
  urlRegex,
  telRegex,
  mailRegex,
} from '@plone/volto/helpers/Url/urlRegex';
import prependHttp from 'prepend-http';
import config from '@plone/volto/registry';
import { matchPath } from 'react-router';
// HYDRA: the saved iframe-frontend URLs and their optional publish URLs.
import getKnownFrontendUrls from '../../../../utils/getKnownFrontendUrls';

/**
 * Get base url.
 * @function getBaseUrl
 * @param {string} url Url to be parsed.
 * @return {string} Base url of content object.
 */
export const getBaseUrl = memoize((url) => {
  const { settings } = config;
  if (url === undefined) return;

  const normalized_nonContentRoutes = settings.nonContentRoutes.map((item) => {
    if (item.test) {
      return item;
    } else {
      return new RegExp(item + '$');
    }
  });

  let adjustedUrl = normalized_nonContentRoutes.reduce(
    (acc, item) => acc.replace(item, ''),
    url,
  );

  adjustedUrl = adjustedUrl || '/';
  return adjustedUrl === '/' ? '' : adjustedUrl;
});

/**
 * Get parent url.
 */
export const getParentUrl = memoize((url) => {
  return url.substring(0, url.lastIndexOf('/'));
});

export function getId(url) {
  return last(url.replace(/\?.*$/, '').split('/'));
}

export function getView(url) {
  const view = last(url.replace(/\?.*$/, '').split('/'));
  if (
    [
      'add',
      'layout',
      'contents',
      'edit',
      'delete',
      'diff',
      'history',
      'sharing',
      'controlpanel',
    ].indexOf(view) === -1
  ) {
    return 'view';
  }
  return view === 'layout' ? 'edit' : view;
}

/**
 * Flatten to app server URL.
 *
 * HYDRA: after the stock strip of apiPath/internalApiPath/publicURL,
 * also strip any registered iframe-frontend URL prefix. Sorted longest
 * first so a publish URL like `https://www.example.com` doesn't get
 * partially clipped before a more specific entry has a chance to match.
 */
export function flattenToAppURL(url) {
  const { settings } = config;
  if (!url) return url;
  let stripped = url
    .replace(settings.internalApiPath, '')
    .replace(settings.apiPath, '')
    .replace(settings.publicURL, '');
  // HYDRA: peel off any known frontend URL prefix, longest first.
  const frontends = getKnownFrontendUrls().sort((a, b) => b.length - a.length);
  for (const prefix of frontends) {
    if (stripped.startsWith(prefix)) {
      stripped = stripped.slice(prefix.length) || '/';
      break;
    }
  }
  return stripped;
}

export function stripQuerystring(url) {
  return url.replace(/\?.*$/, '');
}

export function toPublicURL(url) {
  const { settings } = config;
  return settings.publicURL.concat(flattenToAppURL(url));
}

export const isCmsUi = memoize((currentPathname) => {
  const { settings } = config;
  const fullPath = currentPathname.replace(/\?.*$/, '');
  return settings.nonContentRoutes.reduce(
    (acc, route) =>
      acc ||
      (!settings.nonContentRoutesPublic?.includes(route) &&
        new RegExp(route).test(fullPath)),
    false,
  );
});

export function flattenHTMLToAppURL(html) {
  const { settings } = config;
  return settings.internalApiPath
    ? html
        .replace(new RegExp(settings.internalApiPath, 'g'), '')
        .replace(new RegExp(settings.apiPath, 'g'), '')
    : html.replace(new RegExp(settings.apiPath, 'g'), '');
}

export function addAppURL(url) {
  const { settings } = config;
  return url.indexOf(settings.apiPath) === 0
    ? url
    : `${settings.apiPath}${url}`;
}

export function expandToBackendURL(path) {
  const { settings } = config;
  const apiSuffix = settings.legacyTraverse ? '' : '/++api++';
  let adjustedPath;
  if (path.startsWith('http://') || path.startsWith('https://')) {
    adjustedPath = flattenToAppURL(path);
  } else {
    adjustedPath = path[0] !== '/' ? `/${path}` : path;
  }

  let apiPath = '';
  if (settings.internalApiPath && __SERVER__) {
    apiPath = settings.internalApiPath;
  } else if (settings.apiPath) {
    apiPath = settings.apiPath;
  }

  return `${apiPath}${apiSuffix}${adjustedPath}`;
}

/**
 * Check if internal url.
 *
 * HYDRA: also return true if the URL starts with any known iframe
 * frontend prefix (edit or publish). Without this, a pasted link from
 * the published origin would be treated as external and skip the
 * flatten step in getFieldURL.
 */
export function isInternalURL(url) {
  const { settings } = config;

  const isMatch = (config.settings.externalRoutes ?? []).find((route) => {
    if (typeof route === 'object') {
      return matchPath(flattenToAppURL(url), route.match);
    }
    return matchPath(flattenToAppURL(url), route);
  });

  const isExcluded = isMatch && Object.keys(isMatch)?.length > 0;

  // HYDRA: known iframe frontends count as internal.
  const matchesFrontend =
    url &&
    getKnownFrontendUrls().some((prefix) => url.indexOf(prefix) !== -1);

  const internalURL =
    url &&
    (url.indexOf(settings.publicURL) !== -1 ||
      (settings.internalApiPath &&
        url.indexOf(settings.internalApiPath) !== -1) ||
      url.indexOf(settings.apiPath) !== -1 ||
      matchesFrontend ||
      url.charAt(0) === '/' ||
      url.charAt(0) === '.' ||
      url.startsWith('#'));

  if (internalURL && isExcluded) {
    return false;
  }

  return internalURL;
}

export function isUrl(url) {
  return urlRegex().test(url);
}

export function addSubpathPrefix(src) {
  let url = src;
  const { subpathPrefix } = config.settings;
  if (isInternalURL(src) && subpathPrefix && !src.startsWith(subpathPrefix)) {
    url = subpathPrefix + src;
  }
  return url;
}

export function stripSubpathPrefix(src) {
  let url = src;
  const { subpathPrefix } = config.settings;
  if (subpathPrefix && src.match(new RegExp(`^${subpathPrefix}(/|$)`))) {
    url = src.slice(subpathPrefix.length);
  }
  return url;
}

export const getFieldURL = (data) => {
  let url = data;
  const _isObject = data && isObject(data) && !isArray(data);
  if (_isObject && data['@type'] === 'URL') {
    url = data['value'] ?? data['url'] ?? data['href'] ?? data;
  } else if (_isObject) {
    url = data['@id'] ?? data['url'] ?? data['href'] ?? data;
  }
  if (isArray(data)) {
    url = data.map((item) => getFieldURL(item));
  }
  if (isString(url) && isInternalURL(url)) return flattenToAppURL(url);
  return url;
};

export function normalizeUrl(url) {
  return prependHttp(url);
}

export function removeProtocol(url) {
  return url.replace('https://', '').replace('http://', '');
}

export function isMail(text) {
  return mailRegex().test(text);
}

export function isTelephone(text) {
  return telRegex().test(text);
}

export function normaliseMail(email) {
  if (email?.toLowerCase()?.startsWith('mailto:')) {
    return email;
  }
  return `mailto:${email}`;
}

export function normalizeTelephone(tel) {
  if (tel?.toLowerCase()?.startsWith('tel:')) {
    return tel;
  }
  return `tel:${tel}`;
}

// HYDRA: `./x` and `../x` — a path relative to the page it is written on.
function isRelativePath(url) {
  return url.startsWith('./') || url.startsWith('../');
}

/**
 * Resolve a path relative to a page into a site path.
 *
 * HYDRA: resolved the way a browser resolves a link on that page, so `./x` on
 * `/about/team` is `/about/x` (a sibling) and `../x` goes up from `/about/`.
 * Anything that is not relative is returned unchanged.
 * @function resolveRelativeUrl
 * @param {string} url The url as typed.
 * @param {string} pagePath Site path of the page the link is on.
 * @returns {string} A site path (or the url unchanged).
 */
export function resolveRelativeUrl(url, pagePath) {
  if (!isRelativePath(url)) return url;
  const base = new URL(pagePath, 'http://site.invalid');
  const resolved = new URL(url, base);
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}

export function checkAndNormalizeUrl(url) {
  let res = {
    isMail: false,
    isTelephone: false,
    url: url,
    isValid: true,
  };
  if (URLUtils.isMail(URLUtils.normaliseMail(url))) {
    res.isMail = true;
    res.url = URLUtils.normaliseMail(url);
  } else if (URLUtils.isTelephone(url)) {
    res.isTelephone = true;
    res.url = URLUtils.normalizeTelephone(url);
  } else {
    // HYDRA: a path relative to the page (`./x`, `../x`) is a path too.
    // Stock Volto prefixed it with `http://`, failed the URL check, and the
    // link editor silently refused it.
    if (
      res.url?.length >= 0 &&
      !res.url.startsWith('/') &&
      !res.url.startsWith('#') &&
      !isRelativePath(res.url)
    ) {
      res.url = URLUtils.normalizeUrl(url);
      if (!URLUtils.isUrl(res.url)) {
        res.isValid = false;
      }
    }
    if (res.url === undefined || res.url === null) res.isValid = false;
  }
  return res;
}

export const URLUtils = {
  normalizeTelephone,
  normaliseMail,
  normalizeUrl,
  isTelephone,
  isMail,
  isUrl,
  checkAndNormalizeUrl,
};

export function flattenScales(path, image) {
  function removeObjectIdFromURL(basePath, scale) {
    return scale.replace(`${basePath}/`, '');
  }
  if (!image) return;

  const basePath = image.base_path || path;
  // HYDRA: build a NEW scales object rather than mutating in place. The image
  // data arrives FROZEN from the Redux store, so assigning to
  // scales[key].download throws "Cannot assign to read only property
  // 'download'" — surfaced via react-beautiful-dnd's error boundary when an
  // image block / image-led teaser is selected for editing.
  const sourceScales = image.scales || {};
  const scales = {};
  Object.keys(sourceScales).forEach((key) => {
    scales[key] = {
      ...sourceScales[key],
      download: flattenToAppURL(
        removeObjectIdFromURL(basePath, sourceScales[key].download),
      ),
    };
  });

  const imageInfo = {
    ...image,
    scales,
    download: flattenToAppURL(removeObjectIdFromURL(basePath, image.download)),
  };

  return imageInfo;
}
