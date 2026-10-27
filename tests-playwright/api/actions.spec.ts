import { test, expect, type APIRequestContext } from '@playwright/test';
import { URLS } from '../ports';

/**
 * @actions as a real Plone 6 site with plone.volto serves it to a Manager.
 *
 * Which actions exist, their category, title and URL come from Plone's own
 * profiles (Products.CMFPlone, plone.volto, plone.app.iterate actions.xml),
 * evaluated for a Manager; `url` on every entry is what a live Plone 6 emits
 * (demo.plone.org). The admin builds its toolbar from these — the More menu
 * offers "Rules" only when `contentrules` is listed, and the personal menu
 * reads `user`.
 */
const FOLDERISH = '/_test_data';
const NOT_FOLDERISH = '/_test_data/section-test-page';

async function actionsFor(request: APIRequestContext, path: string) {
  const res = await request.get(`${URLS.mockApi}${path === '/' ? '' : path}/@actions`);
  expect(res.ok()).toBe(true);
  return res.json();
}
const ids = (list: { id: string }[]) => list.map((a) => a.id);

test.describe('@actions', () => {
  test('a folderish item offers Rules, after the editing actions', async ({ request }) => {
    const { object } = await actionsFor(request, FOLDERISH);
    expect(ids(object)).toEqual([
      'view',
      'edit',
      'folderContents',
      'history',
      'local_roles',
      'contentrules',
    ]);
    const rules = object.find((a: { id: string }) => a.id === 'contentrules');
    expect(rules.title).toBe('Rules');
    expect(rules.url).toBe(`${URLS.mockApi}${FOLDERISH}/@@manage-content-rules`);
  });

  test('an item that is not folderish cannot hold rules', async ({ request }) => {
    const { object } = await actionsFor(request, NOT_FOLDERISH);
    expect(ids(object)).not.toContain('contentrules');
  });

  test('the site root can hold rules', async ({ request }) => {
    const { object } = await actionsFor(request, '/');
    expect(ids(object)).toContain('contentrules');
  });

  test('URL Management is offered everywhere but the site root', async ({ request }) => {
    expect(ids((await actionsFor(request, FOLDERISH)).object_buttons)).toContain('redirection');
    expect(ids((await actionsFor(request, '/')).object_buttons)).not.toContain('redirection');
  });

  test('a signed-in Manager has the personal actions, and the site its footer actions', async ({
    request,
  }) => {
    const actions = await actionsFor(request, FOLDERISH);
    expect(ids(actions.user)).toEqual(['preferences', 'dashboard', 'plone_setup', 'logout']);
    const setup = actions.user.find((a: { id: string }) => a.id === 'plone_setup');
    expect(setup).toMatchObject({
      title: 'Site Setup',
      url: `${URLS.mockApi}/@@overview-controlpanel`,
    });
    // plone.volto hides Accessibility; Site Map and Contact stay.
    expect(ids(actions.site_actions)).toEqual(['sitemap', 'contact']);
  });

  test('every action carries the url Plone 6 emits', async ({ request }) => {
    const actions = await actionsFor(request, FOLDERISH);
    for (const [category, list] of Object.entries(actions)) {
      if (!Array.isArray(list)) continue;
      for (const action of list as { id: string; url?: string }[]) {
        expect(action.url, `${category}/${action.id} has a url`).toMatch(/^http/);
      }
    }
  });
});
