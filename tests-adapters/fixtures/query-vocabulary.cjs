/**
 * What each CMS calls the parts of a stored listing query — and the projection
 * that puts the canonical fixture into one of them.
 *
 * A listing block stores what the ADAPTER advertised: `querystring.getIndexes`
 * says which indexes this CMS can be queried on and with which operations, the
 * admin's query builder offers exactly those, and the block keeps them. So the
 * same listing is `parent` + `parent.is` on WordPress, `menu_parent` +
 * `menu_parent.is` on Drupal, `path` + Volto's long operator on Plone.
 *
 * A fixture shared by four CMSes therefore cannot be written in any one of
 * their vocabularies. seed.json carries TOKENS and each seeder projects.
 *
 * ONE module, and plain CommonJS so that everything can read it: the contract
 * suite's TypeScript targets, the journey's seeder (which reads seed.json from
 * disk rather than importing it, because Playwright's ESM loader wants an
 * import attribute that vitest does not), and the Drupal mock, which is CJS.
 * There were three copies before, and two of them knew only about the index
 * NAME — so the operator and the sort key stayed Plone's on every other CMS
 * and their public listings came back empty, with nothing saying why.
 */

/** @typedef {{ pathIndex: string, pathOperator: string, sortOn: string }} QueryVocabulary */

const PATH_INDEX_TOKEN = '__PATH_INDEX__';
const PATH_OP_TOKEN = '__PATH_OP__';
const SORT_ON_TOKEN = '__SORT_ON__';

/** @type {Record<string, QueryVocabulary>} */
const VOCABULARIES = {
  plone: {
    pathIndex: 'path',
    pathOperator: 'plone.app.querystring.operation.string.absolutePath',
    sortOn: 'sortable_title',
  },
  wordpress: { pathIndex: 'parent', pathOperator: 'parent.is', sortOn: 'title' },
  drupal: {
    pathIndex: 'menu_parent',
    pathOperator: 'menu_parent.is',
    sortOn: 'title',
  },
  // `parent.under` is a SUBTREE match, which is what Strapi's relation filter
  // gives — not the direct-children `parent.is` the other two advertise.
  strapi: { pathIndex: 'parent', pathOperator: 'parent.under', sortOn: 'title' },
};

/**
 * The canonical documents, in one CMS's vocabulary.
 *
 * @param {Array<any>} documents
 * @param {QueryVocabulary} vocabulary
 */
function projectQueryVocabulary(documents, vocabulary) {
  const { pathIndex, pathOperator, sortOn } = vocabulary ?? {};
  // A vocabulary with a part missing substitutes the token for NOTHING, which
  // is a query with an empty operator — refused by the CMS, or worse, ignored.
  const missing = Object.entries({ pathIndex, pathOperator, sortOn })
    .filter(([, value]) => typeof value !== 'string' || value === '')
    .map(([name]) => name);
  if (missing.length) {
    throw new Error(
      `projectQueryVocabulary: the vocabulary has no ${missing.join(', ')}. ` +
        `Every part of a stored query is a name this CMS advertises.`,
    );
  }
  const projected = JSON.parse(JSON.stringify(documents));
  for (const doc of projected) {
    for (const block of Object.values(doc.blocks ?? {})) {
      const querystring = block && block.querystring;
      if (!querystring) continue;
      for (const criterion of querystring.query ?? []) {
        if (criterion.i === PATH_INDEX_TOKEN) criterion.i = pathIndex;
        if (criterion.o === PATH_OP_TOKEN) criterion.o = pathOperator;
      }
      if (querystring.sort_on === SORT_ON_TOKEN) querystring.sort_on = sortOn;
    }
  }
  // A token that survived is a query this CMS cannot answer, and it fails as
  // an empty listing three layers away. Said here instead.
  const left = JSON.stringify(projected).match(/__[A-Z_]+__/g);
  if (left) {
    throw new Error(
      `projectQueryVocabulary: unprojected ${[...new Set(left)].join(', ')} — ` +
        `the fixture names something this vocabulary does not.`,
    );
  }
  return projected;
}

module.exports = {
  PATH_INDEX_TOKEN,
  PATH_OP_TOKEN,
  SORT_ON_TOKEN,
  VOCABULARIES,
  projectQueryVocabulary,
};
