/**
 * A change an agent makes is checked with the validator the content in this
 * repo goes through (plone-content-validator.cjs) before it is previewed or
 * saved. An agent's slider had slides without ids: the front end refused the
 * page, and nothing had said why. The draft is one page of a live site, so a
 * link to another page is looked up there; and only what the change brings
 * is refused, never a problem the page already had.
 */
import { describe, it, expect } from 'vitest';
import { sharedBlocksConfig } from '../../tests-playwright/fixtures/shared-block-schemas.js';
import { checkDraft, DraftInvalid } from './checkDraft.mjs';

/** The site, as far as the check asks it: which paths are there, and what has a UID. */
function siteWith({ paths = [], uids = {} } = {}) {
  return {
    exists: async (path) => paths.includes(path),
    search: async ({ uid }) => (uids[uid] ? { total: 1, items: [{ path: uids[uid] }] } : { total: 0, items: [] }),
    get: async (path) => { throw new Error(`not asked for in these tests: ${path}`); },
  };
}

const page = (blocks) => ({
  '@id': '/news', '@type': 'Document', id: 'news', UID: 'news-uid', title: 'News',
  blocks, blocks_layout: { items: Object.keys(blocks) },
});
const SAVED = page({ a: { '@type': 'slate', value: [{ type: 'p', children: [{ text: 'Hi' }] }], plaintext: 'Hi' } });
const withBlock = (base, uid, block) => page({ ...base.blocks, [uid]: block });
const teaserTo = (href) => ({ '@type': 'teaser', href: [{ '@id': href }] });

const check = (saved, draft, site = siteWith()) => checkDraft({ path: '/news', saved, draft, blocksConfig: sharedBlocksConfig, site });

describe('checkDraft', () => {
  it('lets a change through that links to a page the site has', async () => {
    await expect(check(SAVED, withBlock(SAVED, 't', teaserTo('/events')), siteWith({ paths: ['/events'] }))).resolves.toBeUndefined();
  });

  it('refuses a link to a page the site does not have, saying where', async () => {
    const refused = await check(SAVED, withBlock(SAVED, 't', teaserTo('/no-such-page'))).catch((error) => error);
    expect(refused).toBeInstanceOf(DraftInvalid);
    expect(refused.message).toMatch(/block t \(teaser\) href: path not in content: \/no-such-page/);
  });

  it('refuses a list of objects whose items have no ids', async () => {
    const slider = { '@type': 'slider', slides: [{ '@type': 'slide', title: 'One' }] };
    const refused = await check(SAVED, withBlock(SAVED, 's', slider)).catch((error) => error);
    expect(refused).toBeInstanceOf(DraftInvalid);
    expect(refused.message).toMatch(/has no id "@id"/);
  });

  it('looks a resolveuid link up on the site', async () => {
    const draft = withBlock(SAVED, 't', teaserTo('../resolveuid/events-uid'));
    await expect(check(SAVED, draft, siteWith({ uids: { 'events-uid': '/events' } }))).resolves.toBeUndefined();
    await expect(check(SAVED, draft)).rejects.toThrow(/broken resolveuid\/events-uid/);
  });

  it('does not blame the change for a problem the page already had', async () => {
    const broken = withBlock(SAVED, 't', teaserTo('/gone'));
    const edited = { ...broken, title: 'News, retitled' };
    await expect(check(broken, edited)).resolves.toBeUndefined();
  });
});
