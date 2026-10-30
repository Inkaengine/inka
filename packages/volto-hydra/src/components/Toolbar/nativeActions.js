/**
 * Entries the CMS answers for itself, picked out of Volto's actions store.
 *
 * A plain module rather than a helper inside the plug, because importing the
 * plug drags in Volto's store and nothing about this needs React. It had no
 * tests while it lived there, which is how it came to read the wrong two
 * fields.
 *
 * The shape is Plone's, since that is what the store holds by the time it gets
 * here: `url` carries the destination, and the site category is `site_actions`.
 * Verified against a live Plone 6 — tests-adapters/fixtures/plone/.
 */
export const NATIVE_ACTION_CATEGORIES = ['object', 'site_actions', 'user'];

export const nativeActionsFrom = (actions) =>
  NATIVE_ACTION_CATEGORIES.flatMap((category) => actions?.[category] ?? [])
    // `native` marks an entry that leaves the admin; `url` is where to. Volto's
    // own screens arrive as actions too, but they are permission flags with no
    // destination, and rendering one as a link sends the user nowhere.
    .filter((action) => action?.native && action.url);

/**
 * The CMS's own answer to one of the admin's screens, if it has one.
 *
 * Volto's Site Setup and Profile are real screens that work against Plone.
 * Against a CMS that is not Plone they would call endpoints that do not exist,
 * so the adapter offers its own screen instead — and says WHICH of its actions
 * answers that screen, because the category cannot: WordPress declares two
 * `site` actions (settings and the media library) and picking either by
 * position would be a coin flip.
 *
 * `null` means this CMS has no such screen to offer, which is the signal to
 * keep the admin's own — Plone declares nothing here, deliberately.
 *
 * @param {Object} actions - Volto's actions store (Plone's category names)
 * @param {'site-setup'|'profile'} panel
 * @returns {Object|null}
 */
export const nativeActionForPanel = (actions, panel) =>
  nativeActionsFrom(actions).find((action) => action.panel === panel) ?? null;
