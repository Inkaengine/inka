import { test, expect } from '@playwright/test';
import { URLS } from '../ports';

/**
 * The endpoints the admin's Publishing and Sharing views read.
 *
 * Neither had a test, and both broke in the mock rewrite (#358) without anything
 * here noticing: `workflow_history` was read as a list where Plone keys it by
 * workflow id, so publishing a page threw "is not iterable" and took `@history`
 * down with it; and `@sharing` served a single group, which cannot show a
 * permissions matrix at all. They were found weeks later by a consumer's doc
 * clips, where the failure blocked a DEPLOY rather than a test run.
 *
 * That is the gap these close. A behaviour with no test is a behaviour that
 * breaks silently — and here it also meant nothing downstream could tell that
 * the recordings which demonstrate it had stopped working.
 */
const PAGE = '/test-page';

test.describe('@workflow', () => {
  test('publishing writes the trail in Plone shape, keyed by workflow id', async ({ request }) => {
    const before = await request.get(`${URLS.mockApi}${PAGE}/@workflow`);
    expect(before.ok(), 'the workflow endpoint answers').toBe(true);
    const state = (await before.json()).state?.id;
    expect(state, 'a page has a review state').toBeTruthy();

    // Whatever transition this state offers — the point is the WRITE, not which.
    const transition = (await before.json()).transitions?.[0];
    if (!transition) test.skip(true, 'no transition available from this state');
    const id = String(transition['@id']).split('/').pop();

    const posted = await request.post(`${URLS.mockApi}${PAGE}/@workflow/${id}`, { data: {} });
    expect(posted.ok(), `POST @workflow/${id} succeeds`).toBe(true);

    // The trail is a DICT keyed by workflow id, as Plone writes it. Content
    // exported from a real site arrives carrying `workflow_history: {}`, and
    // reading that as a list is what threw.
    const after = await request.get(`${URLS.mockApi}${PAGE}`, {
      headers: { Accept: 'application/json' },
    });
    const history = (await after.json()).workflow_history;
    expect(Array.isArray(history), 'workflow_history is not a bare list').toBe(false);
    expect(typeof history, 'workflow_history is a dict').toBe('object');
    const entries = history?.simple_publication_workflow;
    expect(Array.isArray(entries), 'the trail lives under the workflow id').toBe(true);
    expect(entries.length, 'the transition was recorded').toBeGreaterThan(0);
  });

  test('@history reads the trail back without dying on it', async ({ request }) => {
    // The other half of the same bug: @history mapped over workflow_history and
    // threw the moment anything had published.
    const res = await request.get(`${URLS.mockApi}${PAGE}/@history`);
    expect(res.status(), '@history is servable').toBe(200);
    expect(Array.isArray(await res.json()), '@history is a list of entries').toBe(true);
  });
});

test.describe('@sharing', () => {
  test('offers more than one group, so a matrix can show anything', async ({ request }) => {
    const res = await request.get(`${URLS.mockApi}${PAGE}/@sharing`);
    expect(res.ok()).toBe(true);
    const body = await res.json();

    // One row cannot show a role being given to one group and not another,
    // which is the whole content of the Sharing view. The rewrite left one.
    expect(
      body.entries.length,
      'a sharing matrix needs at least two principals to be a matrix',
    ).toBeGreaterThan(1);
    expect(body.available_roles.length, 'and roles to grant').toBeGreaterThan(0);
  });

  test('a globally-held role is marked as such, not as a plain tick', async ({ request }) => {
    // Plone marks a role held globally with the string 'global' rather than
    // `true`; the UI renders it as an inherited tick you cannot clear here. It
    // is the second thing the view has to be able to draw.
    const res = await request.get(`${URLS.mockApi}${PAGE}/@sharing`);
    const roleValues = (await res.json()).entries.flatMap((e: { roles: Record<string, unknown> }) =>
      Object.values(e.roles),
    );
    expect(roleValues, 'some role is held globally').toContain('global');
  });
});
