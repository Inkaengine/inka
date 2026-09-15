import { test, expect } from '@playwright/test';
import { URLS } from '../ports';

/**
 * The menu follows the editing session.
 *
 * `/@navigation` builds the site menu from content. An editing session's saves
 * live in that session's store, so the menu it serves has to read them — the
 * label on a menu item IS the page's title, so renaming a page renames its
 * entry, and ticking exclude_from_nav removes it.
 *
 * There was no test for any of this, which is how it came to be broken in a way
 * that looked fine: `getNavigationItems` declared three parameters while both
 * call sites passed a fourth (the session id), so JavaScript dropped it and
 * every item came off disk. The plumbing read as though the menu were
 * session-aware and nothing about it was. A demo of "the pages ARE the menu"
 * renamed a page, saved, and watched the menu not change.
 *
 * Isolation is the other half of the contract and is asserted here too: one
 * session's unsaved-to-the-world rename must not leak into anybody else's menu,
 * or parallel tests would see each other's edits.
 */

const MOCK_API = URLS.mockApi;
const PAGE = '/++api++/test-page';

/** The titles the menu offers at the top level. */
async function menuTitles(request: any, token?: string): Promise<string[]> {
  const res = await request.get(`${MOCK_API}/++api++/@navigation`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  expect(res.ok(), 'the navigation endpoint answers').toBeTruthy();
  const body = await res.json();
  return (body.items ?? []).map((i: any) => i.title);
}

test.describe('navigation follows the session', () => {
  test('a renamed page is renamed in the menu — for that session only', async ({ request }) => {
    const token = `navtest-rename-${Date.now()}`;
    const renamed = `Renamed ${token}`;

    const before = await menuTitles(request, token);
    expect(before.length, 'the menu has items to begin with').toBeGreaterThan(0);
    expect(before).not.toContain(renamed);
    const original = before[0];

    // Rename whatever the menu lists first, in this session.
    const target = await request.get(`${MOCK_API}/++api++/@navigation`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const path = new URL((await target.json()).items[0]['@id']).pathname;
    const patch = await request.patch(`${MOCK_API}/++api++${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { title: renamed },
    });
    expect(patch.status(), 'the rename saves').toBeLessThan(300);

    // The label IS the title, so the menu follows.
    expect(
      await menuTitles(request, token),
      'the session that renamed the page sees the new label',
    ).toContain(renamed);

    // …and nobody else's menu moved.
    const others = await menuTitles(request);
    expect(others, "another session keeps the page's real title").toContain(original);
    expect(others, "another session does not see this session's rename").not.toContain(renamed);
  });

  test('a page excluded from navigation leaves the menu', async ({ request }) => {
    const token = `navtest-exclude-${Date.now()}`;

    const before = await menuTitles(request, token);
    const target = await request.get(`${MOCK_API}/++api++/@navigation`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const first = (await target.json()).items[0];
    const path = new URL(first['@id']).pathname;

    await request.patch(`${MOCK_API}/++api++${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { exclude_from_nav: true },
    });

    const after = await menuTitles(request, token);
    expect(after, 'the excluded page is gone from the menu').not.toContain(first.title);
    expect(after.length, 'only that one page left').toBe(before.length - 1);
  });

  test('a page moved into another folder moves in the menu', async ({ request }) => {
    const token = `navtest-move-${Date.now()}`;
    const headers = { Authorization: `Bearer ${token}` };

    // Two top-level folders with children, whatever this content set has.
    const top = await request.get(`${MOCK_API}/++api++/@navigation`, {
      headers,
      params: { 'expand.navigation.depth': 2 },
    });
    const items = (await top.json()).items ?? [];
    const from = items.find((i: any) => (i.items ?? []).length > 0);
    const to = items.find((i: any) => i !== from);
    expect(from && to, 'the content set has a folder with children, and somewhere to move to').toBeTruthy();

    const child = from.items[0];
    const childPath = new URL(child['@id']).pathname;
    const toPath = new URL(to['@id']).pathname;

    const moved = await request.post(`${MOCK_API}/++api++${toPath}/@move`, {
      headers,
      data: { source: `${MOCK_API}${childPath}` },
    });
    expect(moved.ok(), 'the move succeeds').toBeTruthy();

    // The menu is the content tree: gone from where it was, present where it is.
    const after = await request.get(`${MOCK_API}/++api++/@navigation`, {
      headers,
      params: { 'expand.navigation.depth': 2 },
    });
    const sections = (await after.json()).items ?? [];
    const titlesUnder = (name: string) =>
      (sections.find((i: any) => i.title === name)?.items ?? []).map((i: any) => i.title);

    expect(titlesUnder(to.title), 'the page is in the folder it moved to').toContain(child.title);
    expect(titlesUnder(from.title), 'and no longer in the one it left').not.toContain(child.title);
  });

  test('reordering a folder reorders its menu section', async ({ request }) => {
    const token = `navtest-order-${Date.now()}`;
    const headers = { Authorization: `Bearer ${token}` };

    const top = await request.get(`${MOCK_API}/++api++/@navigation`, {
      headers,
      params: { 'expand.navigation.depth': 2 },
    });
    const section = ((await top.json()).items ?? []).find(
      (i: any) => (i.items ?? []).length > 1,
    );
    expect(section, 'a section with more than one child').toBeTruthy();
    const before = section.items.map((i: any) => i.title);
    const parentPath = new URL(section['@id']).pathname;
    const firstId = new URL(section.items[0]['@id']).pathname.split('/').filter(Boolean).pop();

    // How Volto reorders: a PATCH on the CONTAINER carrying `ordering`.
    const patched = await request.patch(`${MOCK_API}/++api++${parentPath}`, {
      headers,
      data: { ordering: { obj_id: firstId, delta: 1 } },
    });
    expect(patched.status(), 'the reorder saves').toBeLessThan(300);

    const after = await request.get(`${MOCK_API}/++api++/@navigation`, {
      headers,
      params: { 'expand.navigation.depth': 2 },
    });
    const now = ((await after.json()).items ?? [])
      .find((i: any) => i.title === section.title)
      .items.map((i: any) => i.title);
    expect(now, 'the menu section follows the new order').not.toEqual(before);
    expect(now.slice().sort(), 'the same pages, only reordered').toEqual(before.slice().sort());
  });
});
