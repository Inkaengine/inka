/**
 * The sources a field-mapping widget offers: what its schema declares
 * (`sourceFields`, each with a title and a type), then every term of the
 * vocabulary it names (`vocabulary: { '@id': … }`) that the declaration does
 * not already cover — a column differing from a declared source only in case
 * (a catalog's Title beside a result's title) is the same field. A vocabulary
 * column carries no type, so it maps as text; a frontend that needs another
 * conversion declares that source itself.
 */
export function mergeVocabularySources(sourceFields, terms) {
  const merged = { ...(sourceFields || {}) };
  const covered = new Set(Object.keys(merged).map((key) => key.toLowerCase()));
  for (const term of terms || []) {
    if (!term?.token || covered.has(term.token.toLowerCase())) continue;
    covered.add(term.token.toLowerCase());
    merged[term.token] = { title: term.title || term.token, type: 'string' };
  }
  return merged;
}
