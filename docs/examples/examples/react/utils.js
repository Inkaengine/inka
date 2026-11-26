/**
 * Frontend binding for the shared Plone image helper.
 *
 * The canonical implementation lives in `@volto-hydra/helpers` and is
 * pure — it takes `(value, apiUrl)` and returns the resolved URL. Each
 * frontend wraps it to supply `apiUrl` from wherever that frontend
 * keeps it (here: `__HYDRA_API_URL__`, the test app's build-time
 * constant, see its vite.config.js).
 */
import { getImageUrl as _getImageUrl } from '$helpers';

export function getImageUrl(value) {
  return _getImageUrl(value, __HYDRA_API_URL__);
}
