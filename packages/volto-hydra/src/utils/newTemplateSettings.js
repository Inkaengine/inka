/**
 * Where "Make template" saves a new template, and as what content type.
 *
 * Both are the deployment's choice, set as environment variables like the admin's other
 * settings (docs/deploy-and-secure.md): Inka has no folder or type of its own for
 * templates. The folder is only where a new template starts; the editor can save it
 * anywhere. A value set when the admin is built wins; otherwise the value at run time is
 * used. Unset is an error that names the setting, not a guess.
 */
const setting = (name) =>
  process.env[name] ||
  // `window.env` is only injected by Razzle in the browser build.
  (typeof window !== 'undefined' && window.env && window.env[name]) ||
  '';

export function newTemplateSettings() {
  const folder = setting('RAZZLE_TEMPLATES_PATH').replace(/\/+$/, '');
  const type = setting('RAZZLE_TEMPLATE_TYPE');
  const missing = [
    !folder && 'RAZZLE_TEMPLATES_PATH (the folder new templates are saved in)',
    !type && 'RAZZLE_TEMPLATE_TYPE (the content type of a new template)',
  ].filter(Boolean);
  if (missing.length) {
    throw new Error(
      `Templates can't be made until the admin has ${missing.join(' and ')}.`,
    );
  }
  return { folder, type };
}
