/**
 * Where "Make template" saves a new template, and as what content type.
 *
 * Both are set as environment variables like the admin's other settings
 * (docs/deploy-and-secure.md). The folder is the deployment's: Inka has none of its own,
 * and unset is an error that names the setting. It is only where a new template starts;
 * the editor can save it anywhere. The type is a plain Document, which every site has,
 * unless the deployment names a type of its own in RAZZLE_TEMPLATE_TYPE. A value set
 * when the admin is built wins; otherwise the value at run time is used.
 */
const setting = (name) =>
  process.env[name] ||
  // `window.env` is only injected by Razzle in the browser build.
  (typeof window !== 'undefined' && window.env && window.env[name]) ||
  '';

export function newTemplateSettings() {
  const folder = setting('RAZZLE_TEMPLATES_PATH').replace(/\/+$/, '');
  const type = setting('RAZZLE_TEMPLATE_TYPE') || 'Document';
  if (!folder) {
    throw new Error(
      "Templates can't be made until the admin has RAZZLE_TEMPLATES_PATH (the folder new templates are saved in).",
    );
  }
  return { folder, type };
}
