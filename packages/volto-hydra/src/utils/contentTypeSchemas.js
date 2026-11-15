/**
 * Every content type's schema, as Plone's `@types/<type>` serves it, by type
 * name: what a site's own catalog column holds (mappingConversions.columnKind)
 * comes from them. Loaded once per session and shared by the mapping widget
 * and the save check; a failed load is not kept, so the next asks again.
 */
import Api from '@plone/volto/helpers/Api/Api';

let pending = null;

export function loadContentTypeSchemas() {
  if (!pending) {
    const api = new Api();
    pending = api.get('/@types').then(async (types) => {
      const entries = await Promise.all(
        types.map(async (type) => {
          if (!type.id) throw new Error(`@types lists a type with no id: ${JSON.stringify(type)}`);
          return [type.id, await api.get(`/@types/${encodeURIComponent(type.id)}`)];
        }),
      );
      return Object.fromEntries(entries);
    });
    pending.catch(() => {
      pending = null;
    });
  }
  return pending;
}
