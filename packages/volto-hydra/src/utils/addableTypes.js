/**
 * Whether the site lets the signed-in user add a content type in a folder.
 *
 * Which types go where is each site's: Plone's @types on the folder lists every
 * type, each marked `addable` there for this user (its type constraints and
 * permissions). Inka asks it rather than deciding by a type's name.
 */

/** The folder doesn't take that type from this user. */
export class NotAllowedThere extends Error {}

/**
 * Resolve if `folder` (a path) takes `typeId` from the signed-in user; reject
 * with NotAllowedThere, saying so in `message(typeTitle, folder)`, if not.
 * `typesIn(folder)` resolves to the folder's @types.
 */
export async function checkAddable(typeId, folder, typesIn, message) {
  if (typeof typeId !== 'string' || !typeId) {
    throw new Error(`checkAddable needs a content type id, got ${typeId}`);
  }
  const type = (await typesIn(folder)).find((t) => t.id === typeId);
  if (!type?.addable) {
    throw new NotAllowedThere(message(type?.title || typeId, folder));
  }
}
