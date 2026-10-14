import seed from './seed.json';

/**
 * The canonical fixture, PROJECTED into one CMS's query vocabulary.
 *
 * A listing block stores the index names the ADAPTER advertised — that is the
 * design: `querystring.getIndexes` says what this CMS can be queried on, the
 * admin's query builder offers those names, and the block keeps them. So a
 * block authored against WordPress holds `parent`, against Drupal
 * `menu_parent`, against Plone `path`. They all take a PATH as the value and
 * differ only in the name.
 *
 * Which means a fixture shared by four CMSes cannot be written in any one of
 * their vocabularies. seed.json carries `__PATH_INDEX__` and every seeder
 * substitutes the name its own CMS advertises — the same projection the rest
 * of the fixture already undergoes for types (`folder` -> Document/page) and
 * states.
 *
 * Nothing translates at READ time. A frontend hands the stored criteria to
 * that CMS's helper, which knows what its own index names mean; a reader that
 * accepted another CMS's vocabulary would be a second place where index names
 * are decided.
 */
export const PATH_INDEX_TOKEN = '__PATH_INDEX__';

export function seedDocuments(pathIndex: string) {
  const projected = JSON.parse(JSON.stringify(seed.documents));
  for (const doc of projected) {
    for (const block of Object.values<any>(doc.blocks ?? {})) {
      for (const criterion of block?.querystring?.query ?? []) {
        if (criterion.i === PATH_INDEX_TOKEN) criterion.i = pathIndex;
      }
    }
  }
  return projected as typeof seed.documents;
}

/** The whole fixture, including the parts that need no projection. */
export function seedFixture(pathIndex: string) {
  return { ...seed, documents: seedDocuments(pathIndex) };
}
