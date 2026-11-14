/**
 * What a journey left wrong on the site, by the validator the content goes
 * through (plone-content-validator.cjs): each page's fields against its block
 * schemas, its structure, ids and references. A task's own check looks for the
 * words it was after; this looks at everything else, so a page saved with a
 * field nothing reads, or a link to nothing, fails the run (inka#671).
 *
 * The whole site is read before the agent starts and after it finishes, and
 * only what the run brought counts: the test content has problems of its own,
 * and a problem a page already had is not the agent's. `schemas` are the
 * block schemas of the front end the run draws with (run.mjs --schemas).
 */
import validator from '@inka/content-validator';

const { checkContent } = validator;

/**
 * Every page of the site, as `cms` (a run's session) sees it. The API writes
 * the site's own links as full URLs, which the validator takes for another
 * site's and cannot check; they are made paths again, as the editor keeps them.
 */
async function sitePages(cms) {
  const { items } = await cms.search('/@search?b_size=100000');
  const pages = [];
  for (const { '@id': id } of items) {
    const { origin, pathname: path } = new URL(id);
    const data = JSON.parse(JSON.stringify(await cms.get(path)).replaceAll(`"${origin}/`, '"/').replaceAll(`"${origin}"`, '"/"'));
    pages.push({ rel: path, data: { ...data, '@id': path } });
  }
  return pages;
}

/** Each problem on the site, as `<path>: <what is wrong>`, judged by `schemas`. */
export async function siteProblems(cms, schemas) {
  const { findings } = checkContent(await sitePages(cms), { schemas });
  return new Set(findings.map(({ rel, message }) => (message.startsWith(`${rel}:`) ? message : `${rel}: ${message}`)));
}

/** What `after` has that `before` did not: the run's own problems. */
export function broughtProblems(before, after) {
  return [...after].filter((problem) => !before.has(problem)).sort();
}
