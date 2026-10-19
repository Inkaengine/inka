import seed from './seed.json';

/**
 * The canonical fixture, PROJECTED into one CMS's query vocabulary.
 *
 * A listing block stores what the ADAPTER advertised — `querystring.getIndexes`
 * says what this CMS can be queried on, with which operations, and the admin's
 * query builder offers exactly those. So a block authored against WordPress
 * holds `parent` + `parent.is`, against Drupal `menu_parent` + `menu_parent.is`,
 * against Plone `path` + `plone.app.querystring.operation.string.absolutePath`.
 *
 * Which means a fixture shared by four CMSes cannot be written in any one of
 * their vocabularies. It carries TOKENS, and each seeder substitutes what its
 * own adapter advertises — the same projection the fixture already undergoes
 * for types (`folder` -> Document/page) and states.
 *
 * All THREE parts, not just the index name. Projecting the name alone left the
 * operator and the sort key as Plone's on every other CMS, and a reader that
 * refuses what its CMS never advertised then refused the fixture's own
 * listing: `wpFetchItems: WordPress cannot apply
 * 'plone.app.querystring.operation.string.absolutePath' to 'parent'`. The
 * public page rendered nothing at all, and the admin's sort had a key WordPress
 * does not sort by.
 *
 * Nothing translates at READ time. A frontend hands the stored criteria to that
 * CMS's helper, which knows what its own names mean; a reader that accepted
 * another CMS's vocabulary would be a second place where they are decided.
 */
export const PATH_INDEX_TOKEN = '__PATH_INDEX__';
export const PATH_OP_TOKEN = '__PATH_OP__';
export const SORT_ON_TOKEN = '__SORT_ON__';

/** What one CMS calls the things a stored listing query is made of. */
export type QueryVocabulary = {
  /** The index that takes a path — `path`, `parent`, `menu_parent`. */
  pathIndex: string;
  /** Its "everything under here" operation — the target's `queryOps.under`. */
  pathOperator: string;
  /** A SORTABLE index, as this adapter's `sortable_indexes` advertises it. */
  sortOn: string;
};

export function seedDocuments(vocabulary: QueryVocabulary) {
  const { pathIndex, pathOperator, sortOn } = vocabulary;
  const projected = JSON.parse(JSON.stringify(seed.documents));
  for (const doc of projected) {
    for (const block of Object.values<any>(doc.blocks ?? {})) {
      const querystring = block?.querystring;
      if (!querystring) continue;
      for (const criterion of querystring.query ?? []) {
        if (criterion.i === PATH_INDEX_TOKEN) criterion.i = pathIndex;
        if (criterion.o === PATH_OP_TOKEN) criterion.o = pathOperator;
      }
      if (querystring.sort_on === SORT_ON_TOKEN) querystring.sort_on = sortOn;
    }
  }
  // A token that survived is a fixture the CMS cannot answer, and it fails as
  // an empty page three layers away. Said here instead.
  const left = JSON.stringify(projected).match(/__[A-Z_]+__/g);
  if (left) {
    throw new Error(
      `seedDocuments: unprojected ${[...new Set(left)].join(', ')} — the ` +
        `fixture names something this vocabulary does not.`,
    );
  }
  return projected as typeof seed.documents;
}

/** The whole fixture, including the parts that need no projection. */
export function seedFixture(vocabulary: QueryVocabulary) {
  return { ...seed, documents: seedDocuments(vocabulary) };
}
