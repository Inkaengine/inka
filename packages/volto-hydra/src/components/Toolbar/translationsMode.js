/**
 * Whether the admin may offer to link and unlink translations.
 *
 * Two independent facts have to hold, and they come from different places
 * because they answer different questions:
 *
 *   1. CAN the adapter serve the calls at all — a capability, static, about the
 *      code. Without it `translations.link` is rejected, so the control would
 *      fail on click.
 *   2. Does linking MEAN anything on this site — reported by site.get, because
 *      it is configuration, not code. Drupal does both:
 *
 *        'grouped'  — one document per language, linked. Pointing an existing
 *                     page at a group, or detaching one, is metadata on two
 *                     documents that both survive.
 *        'variants' — one entity with a version of each field per language.
 *                     There is no second document to link, and the nearest
 *                     operation copies one in and deletes it.
 *
 * Both, or neither offer. A grouped site whose adapter cannot serve the calls
 * is the case that made this explicit: the mode says linking is meaningful, and
 * the adapter still has no implementation of it.
 *
 * Absent means grouped: Plone has only that kind, so its @site never had to say
 * so, and an admin talking to a Plone directly keeps the linking it always had.
 */
export const translationsAreGrouped = (siteData) =>
  (siteData?.features?.translations ?? 'grouped') === 'grouped';

/**
 * Whether to offer translating at all.
 *
 * Two facts again, and the same two: the site has to be multilingual, and the
 * adapter has to be able to serve the calls. Gating only on the site's answer
 * put a Manage Translations entry in the menu of a multilingual Drupal whose
 * adapter implements none of the translation intents — every affordance behind
 * it rejects, which is the dead-button failure one level up from linking.
 */
export const canTranslate = ({ siteData, adapterInfo, bridged }) => {
  if (!siteData?.features?.multilingual) return false;
  // No adapter: a Plone the admin talks to directly, where everything Volto
  // ships works and gating it would remove a working feature.
  if (!bridged) return true;
  // Before the announcement lands there is nothing to go on. Withhold rather
  // than let a control appear and vanish under the pointer — and subscribe, so
  // it appears when the answer arrives (see useAdapterInfo).
  return Boolean(adapterInfo?.capabilities?.includes('multilingual'));
};

export const canLinkTranslations = (args) =>
  canTranslate(args) && translationsAreGrouped(args.siteData);
