import { test, expect } from '@playwright/test';
import { URLS } from '../ports';

/**
 * The site root has a content type, and it is editable.
 *
 * Volto edits the site root the way it edits a page — the chrome that belongs to
 * the whole site (a cookie banner, an announcement) lives in its blocks — and to
 * do that the admin loads `@types/Plone Site`. This mock served every type it
 * had a file for and 404ed the rest, and it had no file for the site root: so
 * the admin's `schema` never arrived, `_page` was registered without the page's
 * own fields, and the bridge never finished its handshake. Editing the site root
 * simply did not work, and the symptom was an iframe that never connected.
 *
 * The site root is NOT a dexterity content type, so it does not carry the
 * behaviours every other type does. Offering an author a publication date for
 * the site, or a tick to keep the site out of its own menu, would be inventing
 * fields Plone does not have.
 */
test.describe('the site root content type', () => {
  test('is served, with the fields an author edits', async ({ request }) => {
    const res = await request.get(`${URLS.mockApi}/@types/Plone%20Site`);
    expect(res.status(), 'the site root type is a type this mock knows').toBe(200);

    const schema = await res.json();
    expect(schema.title).toBe('Plone Site');
    expect(Object.keys(schema.properties)).toEqual(
      expect.arrayContaining(['title', 'description', 'blocks', 'blocks_layout']),
    );
  });

  test('carries none of the dexterity behaviours it does not have', async ({ request }) => {
    const res = await request.get(`${URLS.mockApi}/@types/Plone%20Site`);
    const schema = await res.json();

    expect(
      Object.keys(schema.properties),
      'the site root has no short name and nothing to exclude it from',
    ).not.toEqual(expect.arrayContaining(['exclude_from_nav', 'id', 'effective']));
    expect(
      (schema.fieldsets ?? []).map((f: { id: string }) => f.id),
      'and so no Dates or Settings fieldset either',
    ).toEqual(['default']);
  });

  test('is still not addable', async ({ request }) => {
    // Real Plone lists what you may ADD here; you cannot add a site root inside
    // a site. Having a schema for a type must not put it in that list.
    const res = await request.get(`${URLS.mockApi}/@types`);
    const ids = (await res.json()).map((t: { '@id': string }) => t['@id'].split('/').pop());
    expect(ids).not.toContain('Plone Site');
  });
});
