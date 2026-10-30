import seed from './seed.json';
import {
  VOCABULARIES,
  projectQueryVocabulary,
  type QueryVocabulary,
} from './query-vocabulary.cjs';

/**
 * The canonical fixture, PROJECTED into one CMS's query vocabulary.
 *
 * The projection itself lives in query-vocabulary.cjs, because three places
 * need it and only one of them can import this module: the journey's seeder
 * reads seed.json from disk (Playwright's ESM loader wants an import attribute
 * that vitest does not) and the Drupal mock is CommonJS. They each had their
 * own copy, and two of those knew only about the index NAME.
 *
 * This module is the convenience for callers that CAN import the fixture.
 */
export { VOCABULARIES, projectQueryVocabulary };
export type { QueryVocabulary };

export function seedDocuments(vocabulary: QueryVocabulary) {
  return projectQueryVocabulary(seed.documents, vocabulary) as typeof seed.documents;
}

/** The whole fixture, including the parts that need no projection. */
export function seedFixture(vocabulary: QueryVocabulary) {
  return { ...seed, documents: seedDocuments(vocabulary) };
}
