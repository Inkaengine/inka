/**
 * A linked page's (or listing result's) address, as a mapping source.
 *
 * Mappings name it `getURL`, the catalog's own name for it. They named it `@id`
 * once, but Plone reads every `@id` in stored block data as a link: a listing's
 * stored `fieldMapping: { '@id': { field, type } }` crashed the save, and in a
 * block conversion `@id` was also the block's own id in its list. The result
 * itself still carries its address as `@id`; only the mapping's name changed.
 *
 * Pure, with no imports: the public expander uses it as well as the editor.
 */
export const ADDRESS_SOURCE = 'getURL';

/** The address's old name. Only to say it's wrong: nothing reads it. */
export const RETIRED_ADDRESS_SOURCE = '@id';

/**
 * A mapping source's value on a result / linked page. A mapping still keyed
 * by the retired name throws: content holding one needs migrating.
 */
export function sourceValue(item, source) {
  if (source === RETIRED_ADDRESS_SOURCE) {
    throw new Error(
      `A field mapping is keyed "${RETIRED_ADDRESS_SOURCE}": the address is mapped from "${ADDRESS_SOURCE}". ` +
        `Migrate the stored mapping (Plone reads every "${RETIRED_ADDRESS_SOURCE}" in a block as a link).`,
    );
  }
  if (source === ADDRESS_SOURCE) return item?.['@id'];
  return item?.[source];
}
