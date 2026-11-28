/**
 * What a text (slate) link keeps of the item it was picked from, stored beside
 * its address as `data.item`: `{ type: 'link', data: { url, item } }`.
 *
 * A frontend draws a link from it the way the item asks — a file's type and
 * size after a link to it, say — without fetching the item again. It is a
 * snapshot from when the link was picked.
 *
 * Everything the catalog returned is kept (the object browser asks for
 * metadata_fields: '_all'), so metadata a site adds later (a page count) comes
 * through with no change here. Two kinds of field are left out:
 *  - where the item is: `data.url` is the link's only address. Plone turns an
 *    internal one into a resolveuid when it is saved; a copy here would not
 *    be, and would go stale when the item moves.
 *  - who made it: people are not the link's business.
 */

/** The item's address, in any of the forms the catalog gives it. */
const ADDRESS_FIELDS = new Set(['@id', 'getURL', 'getPath', 'getRemoteUrl']);

/** Creators, contributors, authors, commentators and their e-mail. */
const PERSON_FIELD = /creator|contributor|author|commentator|email/i;

export function linkItemSnapshot(item) {
  return Object.fromEntries(
    Object.entries(item).filter(
      ([key]) => !ADDRESS_FIELDS.has(key) && !PERSON_FIELD.test(key),
    ),
  );
}
