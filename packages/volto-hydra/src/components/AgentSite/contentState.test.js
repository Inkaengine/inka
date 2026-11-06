import { describe, it, expect } from 'vitest';
import { contentState } from './contentState';

/** A Plone answering in the shapes of plone.restapi's recorded examples, keeping what was written to it. */
function plone({
  review = 'private',
  transitions = [['publish', 'Publish'], ['submit', 'Submit for publication']],
  object = ['view', 'edit', 'local_roles'],
  buttons = ['delete', 'iterate_checkout'],
  baseline = null,
  globalReviewer = false,
  draft = false,
} = {}) {
  const wrote = [];
  const site = 'https://api.example';
  const answers = {
    '/news/@actions': { object: object.map((id) => ({ id })), object_buttons: buttons.map((id) => ({ id })) },
    '/news/@workflow': {
      state: { id: review, title: review === 'private' ? 'Private' : 'Published' },
      transitions: transitions.map(([id, title]) => ({ '@id': `${site}/news/@workflow/${id}`, title })),
    },
    '/news': { id: 'news', exclude_from_nav: true, ...(draft && { working_copy: { '@id': `${site}/copy_of_news` }, working_copy_of: null }) },
    // The copy names both, as Volto's toasts read them.
    '/copy_of_news': { id: 'copy_of_news', working_copy: { '@id': `${site}/copy_of_news` }, working_copy_of: { '@id': `${site}/news` } },
    '/copy_of_news/@workflow': {
      state: { id: 'private', title: 'Private' },
      transitions: [{ '@id': `${site}/copy_of_news/@workflow/publish`, title: 'Publish' }],
    },
    '/copy_of_news/@sharing': { available_roles: [], entries: [], inherit: true },
    '/copy_of_news/@actions': { object: [], object_buttons: [{ id: 'iterate_checkin' }] },
    '/copy_of_news/@workingcopy': { working_copy: { '@id': `${site}/copy_of_news` }, working_copy_of: { '@id': `${site}/news` } },
    '/news/@sharing': {
      available_roles: [
        { id: 'Reader', title: 'Can view' },
        { id: 'Editor', title: 'Can edit' },
        ...(globalReviewer ? [{ id: 'Reviewer', title: 'Can review' }] : []),
      ],
      entries: [
        { id: 'staff', type: 'group', roles: { Reader: true, Editor: false, ...(globalReviewer && { Reviewer: false }) } },
        { id: 'ann', type: 'user', roles: { Reader: false, Editor: true, ...(globalReviewer && { Reviewer: 'global' }) } },
      ],
      inherit: true,
    },
    '/news/@workingcopy': { working_copy: { '@id': `${site}/copy_of_news` }, working_copy_of: baseline && { '@id': `${site}${baseline}` } },
  };
  return {
    wrote,
    fetchJson: async (path, { method = 'GET', body } = {}) => {
      if (method !== 'GET') {
        wrote.push([method, path, ...(body === undefined ? [] : [body])]);
        // Applying or discarding a copy answers nothing: plone.restapi's is a 204.
        return method === 'POST' && path.endsWith('/@workingcopy') ? { '@id': `${site}/copy_of_news` } : undefined;
      }
      if (path === '/@relations?relation=iterate-working-copy') {
        return { relations: { 'iterate-working-copy': { items: draft ? [{ source: { '@id': `${site}/news`, title: 'News', review_state: 'published' }, target: { '@id': `${site}/copy_of_news` } }] : [], items_total: draft ? 1 : 0 } } };
      }
      if (!(path in answers)) throw new Error(`no ${path} here`);
      return answers[path];
    },
    toPath: (url) => url.replace(site, ''),
  };
}

const stateOf = (cms) => contentState({ fetchJson: cms.fetchJson, toPath: cms.toPath });

describe('what state a page is in, and what can be done to it', () => {
  it('says the state, the transitions the CMS offers and what the user may do', async () => {
    const got = await stateOf(plone()).get('/news');
    expect(got.state).toEqual({ name: 'private', label: 'Private' });
    expect(got.transitions.slice(0, 2)).toEqual([{ id: 'publish', label: 'Publish' }, { id: 'submit', label: 'Submit for publication' }]);
    expect(got.effective).toEqual({ canEdit: true, canPublish: true, canDelete: true, canShare: true, canComment: false });
  });

  it('counts checking out a working copy as a transition, where the CMS offers it', async () => {
    const got = await stateOf(plone()).get('/news');
    expect(got.transitions.at(-1)).toMatchObject({ id: 'checkout', relocates: true });
    const none = await stateOf(plone({ buttons: ['delete'] })).get('/news');
    expect(none.transitions.map((t) => t.id)).not.toContain('checkout');
  });

  it('counts applying and discarding a working copy as transitions, on the copy', async () => {
    const got = await stateOf(plone({ buttons: ['iterate_checkin'] })).get('/news');
    expect(got.transitions.map((t) => t.id)).toEqual(['publish', 'submit', 'checkin', 'cancel-checkout']);
    expect(got.transitions.at(-1).relocates).toBe(true);
  });
});

describe('what each transition can set at the same time', () => {
  it('offers publishing dates and a comment with every workflow transition', async () => {
    const { submit } = await stateOf(plone()).getForms('/news');
    expect(Object.keys(submit.schema.properties)).toEqual(['comment', 'effective', 'expires', 'include_children']);
    expect(submit.data).toEqual({});
  });

  it('offers the address and the menu listing with publishing too, filled in as they are', async () => {
    const { publish } = await stateOf(plone()).getForms('/news');
    expect(Object.keys(publish.schema.properties)).toEqual(['id', 'exclude_from_nav', 'comment', 'effective', 'expires', 'include_children']);
    expect(publish.data).toEqual({ id: 'news', exclude_from_nav: true });
  });

  it('asks nothing for a working copy', async () => {
    const { checkout } = await stateOf(plone()).getForms('/news');
    expect(checkout).toEqual({ schema: { fieldsets: [], properties: {}, required: [] }, data: {} });
  });

  it('offers a form only for what is offered', async () => {
    const forms = await stateOf(plone({ buttons: ['delete'] })).getForms('/news');
    expect(forms.checkout).toBeUndefined();
    expect(forms.checkin).toBeUndefined();
  });

  it('offers sharing as "update", one field per role, naming who holds it', async () => {
    const { update } = await stateOf(plone()).getForms('/news');
    expect(update.schema.properties.Reader).toMatchObject({ title: 'Can view', type: 'array' });
    expect(update.data).toEqual({ Reader: ['staff'], Editor: ['ann'], id: 'news', exclude_from_nav: true, inherit: true });
  });

  it('does not offer sharing to someone who may not share', async () => {
    const forms = await stateOf(plone({ object: ['view', 'edit'] })).getForms('/news');
    expect(forms.update).toBeUndefined();
  });
});

describe('taking a transition', () => {
  it('sends the workflow what it takes', async () => {
    const cms = plone();
    const data = { comment: 'Ready', effective: '2027-01-01T09:00:00', expires: '2027-02-01T09:00:00', include_children: true };
    expect(await stateOf(cms).transition({ path: '/news', id: 'publish', data })).toBeNull();
    expect(cms.wrote).toEqual([['POST', '/news/@workflow/publish', data]]);
  });

  it('writes the page\'s own fields separately, and follows a new address', async () => {
    const cms = plone();
    const result = await stateOf(cms).transition({ path: '/news', id: 'publish', data: { id: 'latest', exclude_from_nav: false } });
    expect(cms.wrote).toEqual([
      ['POST', '/news/@workflow/publish', {}],
      ['PATCH', '/news', { exclude_from_nav: false, id: 'latest' }],
    ]);
    expect(result).toEqual({ redirect: '/latest' });
  });

  it('does not count the id it already has as a move', async () => {
    const cms = plone();
    expect(await stateOf(cms).transition({ path: '/news', id: 'publish', data: { id: 'news' } })).toBeNull();
    expect(cms.wrote).toEqual([['POST', '/news/@workflow/publish', {}]]);
  });

  it('refuses a transition that is not offered, naming those that are, and writes nothing', async () => {
    const cms = plone();
    await expect(stateOf(cms).transition({ path: '/news', id: 'retract' })).rejects.toThrow(/no transition 'retract'.*publish, submit, checkout, update/);
    expect(cms.wrote).toEqual([]);
  });

  it('refuses a setting the transition does not take, and writes nothing', async () => {
    const cms = plone();
    await expect(stateOf(cms).transition({ path: '/news', id: 'submit', data: { id: 'latest' } })).rejects.toThrow(/'submit' does not take id/);
    expect(cms.wrote).toEqual([]);
  });

  it('shares role by role, writing only the people that changes', async () => {
    const cms = plone();
    expect(await stateOf(cms).transition({ path: '/news', id: 'update', data: { Reader: ['bob'] } })).toBeNull();
    const [[method, path, body]] = cms.wrote;
    expect([method, path]).toEqual(['POST', '/news/@sharing']);
    expect(body.inherit).toBe(true);
    expect(body.entries).toEqual([
      { id: 'staff', type: 'group', roles: { Reader: false, Editor: false } },
      { id: 'bob', type: 'user', roles: { Reader: true, Editor: false } },
    ]);
  });

  it('never turns a role held from elsewhere into one given here', async () => {
    const cms = plone({ globalReviewer: true });
    const { update } = await stateOf(cms).getForms('/news');
    expect(update.data.Reviewer).toEqual([]);
    await stateOf(cms).transition({ path: '/news', id: 'update', data: { Reader: ['ann'] } });
    const [[, , body]] = cms.wrote;
    expect(body.entries.find((e) => e.id === 'ann').roles).toEqual({ Reader: true, Editor: true, Reviewer: false });
  });

  it('checks out a working copy and goes to it', async () => {
    const cms = plone();
    expect(await stateOf(cms).transition({ path: '/news', id: 'checkout' })).toEqual({ redirect: '/copy_of_news' });
    expect(cms.wrote).toEqual([['POST', '/news/@workingcopy']]);
  });

  it.each([['checkin', 'PATCH'], ['cancel-checkout', 'DELETE']])('%s goes back to the original, though Plone answers nothing', async (id, method) => {
    const cms = plone({ buttons: ['iterate_checkin'], baseline: '/news-original' });
    expect(await stateOf(cms).transition({ path: '/news', id })).toEqual({ redirect: '/news-original' });
    expect(cms.wrote).toEqual([[method, '/news/@workingcopy']]);
  });
});

describe('a page with a draft', () => {
  const withDraft = () => plone({ draft: true, buttons: ['delete'], review: 'published', transitions: [['retract', 'Retract']] });

  it('says so, as part of its state, and where the draft is', async () => {
    expect((await stateOf(withDraft()).get('/news')).draft).toEqual({ path: '/copy_of_news' });
    expect(await stateOf(withDraft()).draftOf('/news')).toBe('/copy_of_news');
  });

  it('says nothing of a draft when it has none', async () => {
    expect((await stateOf(plone()).get('/news')).draft).toBeUndefined();
    expect(await stateOf(plone()).draftOf('/news')).toBeNull();
  });

  it('does not call a draft its own draft', async () => {
    expect(await stateOf(withDraft()).draftOf('/copy_of_news')).toBeNull();
  });

  it('offers publishing and discarding the draft on the page itself', async () => {
    const got = await stateOf(withDraft()).get('/news');
    expect(got.transitions.map((t) => t.id)).toEqual(['retract', 'checkin', 'cancel-checkout']);
    const forms = await stateOf(withDraft()).getForms('/news');
    expect(forms.checkin.schema.properties).toEqual({});
  });

  it.each([['checkin', 'PATCH'], ['cancel-checkout', 'DELETE']])('%s from the page acts on its draft, and stays on the page', async (id, method) => {
    const cms = withDraft();
    expect(await stateOf(cms).transition({ path: '/news', id })).toEqual({ redirect: '/news' });
    expect(cms.wrote).toEqual([[method, '/copy_of_news/@workingcopy']]);
  });

  it('offers no workflow on the draft itself: publishing it there would be a second public page', async () => {
    const got = await stateOf(withDraft()).get('/copy_of_news');
    expect(got.transitions.map((t) => t.id)).toEqual(['checkin', 'cancel-checkout']);
  });

  it('offers no address or listing while the page has a draft: Plone has locked the page', async () => {
    const forms = await stateOf(plone({ draft: true, buttons: ['delete'] })).getForms('/news');
    expect(Object.keys(forms.publish.schema.properties)).toEqual(['comment', 'effective', 'expires', 'include_children']);
    expect(forms.publish.data).toEqual({});
    expect(Object.keys(forms.update.schema.properties)).toEqual(['Reader', 'Editor', 'inherit']);
    expect(forms.update.data).toEqual({ Reader: ['staff'], Editor: ['ann'], inherit: true });
  });

  it('finds the pages that have one, as the pages', async () => {
    expect(await stateOf(withDraft()).pagesWithDrafts()).toEqual([expect.objectContaining({ '@id': 'https://api.example/news', title: 'News' })]);
    expect(await stateOf(plone()).pagesWithDrafts()).toEqual([]);
  });
});
