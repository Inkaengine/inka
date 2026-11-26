import { columnKind, sourceTypeOfKind } from '@volto-hydra/helpers/mappingConversions.js';

/**
 * The sources a field-mapping widget offers: what its schema declares
 * (`sourceFields`, each with a title and a type), then every term of the
 * vocabulary it names (`vocabulary: { '@id': … }`) that the declaration does
 * not already cover — a column differing from a declared source only in case
 * (a catalog's Title beside a result's title) is the same field.
 *
 * A vocabulary column has no type of its own: it holds what its field on the
 * site's content types holds (columnKind), so `site` is { contentTypes,
 * pageType }. A column there is no telling the kind of (types that hold it
 * differently), or whose kind Inka can't convert, isn't offered.
 */
export function mergeVocabularySources(sourceFields, terms, site) {
  const merged = { ...(sourceFields || {}) };
  const covered = new Set(Object.keys(merged).map((key) => key.toLowerCase()));
  for (const term of terms || []) {
    if (!term?.token || covered.has(term.token.toLowerCase())) continue;
    covered.add(term.token.toLowerCase());
    const { kind } = columnKind(term.token, site);
    if (!kind) continue;
    merged[term.token] = { title: term.title || term.token, type: sourceTypeOfKind(kind) };
  }
  return merged;
}
