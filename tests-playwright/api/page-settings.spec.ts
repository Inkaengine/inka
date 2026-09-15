import { test, expect } from '@playwright/test';
import { URLS } from '../ports';

/**
 * The two settings an author reaches for that are not on the canvas: keeping a
 * page out of the menu, and changing its short name.
 *
 * Both are behaviours real Plone puts in the `settings` fieldset
 * (plone.excludefromnavigation, plone.shortname). The mock served
 * `exclude_from_nav` on content and filtered the menu by it, but never declared
 * EITHER field on the content type — so the editor had no control to render and
 * neither setting was reachable from the UI at all. The API worked and the menu
 * filtered correctly; the only thing that failed was the one thing an author
 * would do.
 */
const MOCK_API = URLS.mockApi;

test.describe('page settings', () => {
  test('the content type declares them, in a settings fieldset', async ({ request }) => {
    const res = await request.get(`${MOCK_API}/++api++/@types/Document`);
    expect(res.ok()).toBeTruthy();
    const schema = await res.json();

    expect(
      Object.keys(schema.properties ?? {}),
      'a field the editor can render for each',
    ).toEqual(expect.arrayContaining(['exclude_from_nav', 'id']));
    expect(schema.properties.exclude_from_nav.type).toBe('boolean');

    const settings = (schema.fieldsets ?? []).find((f: any) => f.id === 'settings');
    expect(settings, 'grouped where Plone groups them').toBeTruthy();
    expect(settings.fields).toEqual(expect.arrayContaining(['exclude_from_nav', 'id']));
  });

  test('excluding a page takes it out of the menu', async ({ request }) => {
    const token = `settings-hide-${Date.now()}`;
    const headers = { Authorization: `Bearer ${token}` };

    const nav = await request.get(`${MOCK_API}/++api++/@navigation`, { headers });
    const first = (await nav.json()).items[0];
    const path = new URL(first['@id']).pathname;

    await request.patch(`${MOCK_API}/++api++${path}`, {
      headers,
      data: { exclude_from_nav: true },
    });

    const after = await request.get(`${MOCK_API}/++api++/@navigation`, { headers });
    const titles = ((await after.json()).items ?? []).map((i: any) => i.title);
    expect(titles, 'the page is gone from the menu').not.toContain(first.title);
  });

  test('changing the short name moves the page, and the menu follows', async ({ request }) => {
    const token = `settings-rename-${Date.now()}`;
    const headers = { Authorization: `Bearer ${token}` };
    const shortName = `renamed-${Date.now()}`;

    const nav = await request.get(`${MOCK_API}/++api++/@navigation`, { headers });
    const first = (await nav.json()).items[0];
    const path = new URL(first['@id']).pathname;

    const patched = await request.patch(`${MOCK_API}/++api++${path}`, {
      headers,
      data: { id: shortName },
    });
    expect(patched.status(), 'the rename saves').toBeLessThan(300);

    // The short name IS the URL: the new one resolves…
    const atNew = await request.get(`${MOCK_API}/++api++/${shortName}`, { headers });
    expect(atNew.status(), 'the page answers at its new short name').toBe(200);

    // …the old one does not…
    const atOld = await request.get(`${MOCK_API}/++api++${path}`, { headers });
    expect(atOld.status(), 'and no longer at the old one').toBe(404);

    // …and the menu links to where the page now is.
    const after = await request.get(`${MOCK_API}/++api++/@navigation`, { headers });
    const hrefs = ((await after.json()).items ?? []).map((i: any) =>
      new URL(i['@id']).pathname,
    );
    expect(hrefs, 'the menu points at the new URL').toContain(`/${shortName}`);
    expect(hrefs, 'and not the old one').not.toContain(path);
  });
});
