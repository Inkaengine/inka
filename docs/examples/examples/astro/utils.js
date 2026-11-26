/**
 * Frontend bindings for shared Plone helpers.
 *
 * The canonical implementations live in `@volto-hydra/helpers` and are
 * pure. Each frontend wraps them to supply runtime-bound values
 * (`apiUrl` etc.) from wherever that frontend keeps them.
 *
 * In the Astro example these run BOTH client-side AND server-side via
 * the /api/render endpoint (where `window` is undefined). The API URL is
 * the test app's build-time constant `__HYDRA_API_URL__`
 * (astro.config.mjs), which Vite puts in both, so an image renders
 * against the API on either side: a relative image path (a linked
 * preview image's `base_path`) would otherwise load from this frontend.
 */
import { getImageUrl as _getImageUrl } from '$helpers';

export function getImageUrl(value) {
  return _getImageUrl(value, __HYDRA_API_URL__);
}

export function contentPath(url) {
  if (typeof window !== 'undefined' && window._contentPath) return window._contentPath(url);
  return url || '';
}
