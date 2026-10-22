/**
 * The CMS this frontend talks to — ONE answer, shared by the app and by the
 * proxy frame that hosts its adapter. If the two disagreed, the admin would be
 * editing one site while the preview rendered another.
 *
 * VITE_API_BASE_URL is set by dev:test (and CI); a plain build falls back to
 * the public demo site, which is what the deployed example renders.
 */
export const CMS_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'https://hydra-api.pretagov.com';
