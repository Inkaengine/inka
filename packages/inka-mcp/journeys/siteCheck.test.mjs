/**
 * A journey checks what the agent left on the site with the validator the
 * content goes through, not only the words it was after: a page saved with a
 * field nothing reads passed every check before (inka#671). Only what the run
 * brought counts; the test content has problems of its own.
 */
import { describe, it, expect } from 'vitest';
import { sharedBlocksConfig } from '../../../tests-playwright/fixtures/shared-block-schemas.js';
import { siteProblems as problemsWith, broughtProblems } from './siteCheck.mjs';

const siteProblems = (cms) => problemsWith(cms, sharedBlocksConfig);

const doc = (path, blocks) => ({
  '@id': `http://cms${path}`, '@type': 'Document', UID: `${path.slice(1)}-uid`, id: path.slice(1), title: path,
  blocks, blocks_layout: { items: Object.keys(blocks) },
});
const teaser = (extra = {}) => ({ '@type': 'teaser', href: [{ '@id': 'http://cms/b' }], ...extra });

/** The CMS as a journey's `cms` sees it, holding `pages` by path. */
function cmsWith(pages) {
  return {
    async search() { return { items: Object.values(pages).map((p) => ({ '@id': p['@id'] })) }; },
    async get(path) { return pages[path]; },
  };
}

describe('the journey site check', () => {
  it('reports a field the run stored where no schema declares it, on the page it is on', async () => {
    const before = await siteProblems(cmsWith({ '/a': doc('/a', { t: teaser() }), '/b': doc('/b', {}) }));
    const after = await siteProblems(cmsWith({ '/a': doc('/a', { t: teaser({ align: 'center' }) }), '/b': doc('/b', {}) }));
    expect(broughtProblems(before, after)).toEqual([expect.stringMatching(/^\/a: teaser\.align is not declared/)]);
  });

  it('does not count what the site already had, even where the run saved the page', async () => {
    const stray = { '/a': doc('/a', { t: teaser({ align: 'center' }) }), '/b': doc('/b', {}) };
    const before = await siteProblems(cmsWith(stray));
    const after = await siteProblems(cmsWith({ ...stray, '/a': { ...stray['/a'], title: 'Retitled' } }));
    expect(broughtProblems(before, after)).toEqual([]);
  });

  it('reports a new stray on a page when another page already had the same one', async () => {
    // The validator's own report names one page per block type and field; the
    // check counts each page.
    const before = await siteProblems(cmsWith({ '/a': doc('/a', { t: teaser({ align: 'center' }) }), '/b': doc('/b', {}) }));
    const after = await siteProblems(cmsWith({ '/a': doc('/a', { t: teaser({ align: 'center' }) }), '/b': doc('/b', { t: teaser({ align: 'left' }) }) }));
    expect(broughtProblems(before, after)).toEqual([expect.stringMatching(/^\/b: teaser\.align/)]);
  });

  it('reports a link the run left to a page that is not there', async () => {
    const before = await siteProblems(cmsWith({ '/a': doc('/a', {}), '/b': doc('/b', {}) }));
    const after = await siteProblems(cmsWith({ '/a': doc('/a', { t: { '@type': 'teaser', href: [{ '@id': 'http://cms/gone' }] } }), '/b': doc('/b', {}) }));
    expect(broughtProblems(before, after)).toEqual([expect.stringMatching(/\/a: .*path not in content: \/gone/)]);
  });
});
