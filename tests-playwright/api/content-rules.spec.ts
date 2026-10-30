import { test, expect } from '../fixtures';
import { type APIRequestContext } from '@playwright/test';
import { URLS } from '../fixtures';

/**
 * The endpoints behind the admin's Content Rules control panel and a folder's
 * Rules view.
 *
 * A rule is a trigger (an event), conditions and actions, assigned to a part of
 * the site. The control panel adds and configures rules under
 * `@controlpanels/content-rules`; a folder lists and assigns them under its own
 * `@content-rules`. The mock had none of it, so neither screen could open.
 *
 * Shapes follow plone.restapi and plone.app.contentrules: the listing nests the
 * rules one level down (`items[0]`), a rule names its `event` by title and
 * offers `addable_conditions`/`addable_actions` each with an `addview` and a
 * form `@schema`, and an element added to a rule is listed back with a
 * `summary`.
 */
const FOLDER = '/test-page';

async function signIn(request: APIRequestContext): Promise<Record<string, string>> {
  const res = await request.post(`${URLS.mockApi}/@login`, {
    data: { login: 'admin', password: 'secret' },
  });
  const { token } = await res.json();
  return { Authorization: `Bearer ${token}`, Accept: 'application/json' };
}

async function addRule(request: APIRequestContext, headers: Record<string, string>) {
  const res = await request.post(`${URLS.mockApi}/@controlpanels/content-rules`, {
    headers,
    data: {
      title: 'Tell reviewers',
      description: 'Email reviewers when something is submitted',
      event: 'Workflow state changed',
      enabled: true,
      stop: false,
      cascading: false,
    },
  });
  expect(res.ok(), 'adding a rule succeeds').toBe(true);
  const listing = await (
    await request.get(`${URLS.mockApi}/@controlpanels/content-rules`, { headers })
  ).json();
  const rule = listing.items[0].find((r: { title: string }) => r.title === 'Tell reviewers');
  expect(rule, 'the new rule is listed').toBeTruthy();
  return rule;
}

test.describe('@controlpanels/content-rules', () => {
  test('the events a rule can trigger on are a vocabulary', async ({ request, urls }) => {
    const headers = await signIn(request);
    const vocab = await (
      await request.get(`${urls.mockApi}/@vocabularies/plone.contentrules.events`, { headers })
    ).json();
    expect(vocab.items.map((t: { token: string }) => t.token)).toEqual(
      expect.arrayContaining(['Object added to this container', 'Workflow state changed']),
    );
  });

  test('an added rule is listed with its trigger, enabled and unassigned', async ({ request }) => {
    const headers = await signIn(request);
    const rule = await addRule(request, headers);
    expect(rule).toMatchObject({
      trigger: 'Workflow state changed',
      enabled: true,
      assigned: false,
    });
    expect(rule['@id']).toMatch(/@controlpanels\/content-rules\/[^/]+$/);
  });

  test('a rule offers conditions and actions it can be given, each with a form', async ({ request, urls }) => {
    const headers = await signIn(request);
    const { id } = await addRule(request, headers);
    const rule = await (
      await request.get(`${urls.mockApi}/@controlpanels/content-rules/${id}`, { headers })
    ).json();
    expect(rule.event).toBe('Workflow state changed');
    expect(rule.conditions).toEqual([]);
    expect(rule.actions).toEqual([]);
    const condition = rule.addable_conditions.find(
      (c: { addview: string }) => c.addview === 'plone.conditions.WorkflowState',
    );
    expect(condition?.title).toBe('Workflow state');
    expect(condition['@schema'].properties.wf_states).toBeTruthy();
    const mail = rule.addable_actions.find(
      (a: { addview: string }) => a.addview === 'plone.actions.Mail',
    );
    expect(mail?.title).toBe('Send email');
    expect(mail['@schema'].required).toEqual(
      expect.arrayContaining(['subject', 'recipients', 'message']),
    );
  });

  test('a condition and an action added to a rule are listed back with a summary', async ({ request, urls }) => {
    const headers = await signIn(request);
    const { id } = await addRule(request, headers);
    const base = `${urls.mockApi}/@controlpanels/content-rules/${id}`;
    expect(
      (
        await request.post(`${base}/condition`, {
          headers,
          data: { type: 'plone.conditions.WorkflowState', wf_states: ['pending'] },
        })
      ).status(),
      'Plone answers 201 Created',
    ).toBe(201);
    expect(
      (
        await request.post(`${base}/action`, {
          headers,
          data: {
            type: 'plone.actions.Mail',
            subject: 'Please review',
            recipients: 'reviewers@example.com',
            message: 'Something is waiting for review.',
          },
        })
      ).ok(),
    ).toBe(true);
    const rule = await (await request.get(base, { headers })).json();
    expect(rule.conditions).toEqual([
      expect.objectContaining({ title: 'Workflow state', idx: 0, first: true, last: true }),
    ]);
    // Plone sends the summary's message id untranslated, placeholders and all
    // (controlpanels_post_rule_action_mail.resp) — so does the mock.
    expect(rule.conditions[0].summary).toBe('Workflow states are: ${states}');
    expect(rule.actions).toEqual([
      expect.objectContaining({ title: 'Send email', idx: 0, first: true, last: true }),
    ]);
    expect(rule.actions[0].summary).toBe('Email report to ${recipients}');

    // The element reads back with its values and its form.
    const condition = await (await request.get(`${base}/condition/0`, { headers })).json();
    expect(condition.wf_states).toEqual(['pending']);
    expect(condition['@schema'].properties.wf_states).toBeTruthy();
  });

  test('a rule can be deleted', async ({ request, urls }) => {
    const headers = await signIn(request);
    const { id } = await addRule(request, headers);
    const del = await request.delete(`${urls.mockApi}/@controlpanels/content-rules/${id}`, {
      headers,
    });
    expect(del.ok()).toBe(true);
    const listing = await (
      await request.get(`${urls.mockApi}/@controlpanels/content-rules`, { headers })
    ).json();
    expect(listing.items[0].map((r: { id: string }) => r.id)).not.toContain(id);
  });

  test('rules added in one session are not seen by another', async ({ request, urls }) => {
    const mine = await signIn(request);
    await addRule(request, mine);
    const theirs = await signIn(request);
    const listing = await (
      await request.get(`${urls.mockApi}/@controlpanels/content-rules`, { headers: theirs })
    ).json();
    expect(listing.items[0].map((r: { title: string }) => r.title)).not.toContain(
      'Tell reviewers',
    );
  });
});

test.describe('@content-rules on content', () => {
  test('a rule assigned to a folder is listed there and marked assigned', async ({ request, urls }) => {
    const headers = await signIn(request);
    const { id } = await addRule(request, headers);

    const before = await (
      await request.get(`${urls.mockApi}${FOLDER}/@content-rules`, { headers })
    ).json();
    expect(
      before['content-rules'].assignable_rules.map((r: { id: string }) => r.id),
      'an unassigned rule is offered',
    ).toContain(id);
    expect(before['content-rules'].assigned_rules).toEqual([]);

    const assign = await request.post(`${urls.mockApi}${FOLDER}/@content-rules/${id}`, {
      headers,
    });
    expect((await assign.json()).message).toBe(`Successfully assigned the rule ${id}`);

    const after = await (
      await request.get(`${urls.mockApi}${FOLDER}/@content-rules`, { headers })
    ).json();
    const assigned = after['content-rules'].assigned_rules;
    expect(assigned).toEqual([
      expect.objectContaining({
        id,
        title: 'Tell reviewers',
        trigger: 'Workflow state changed',
        enabled: true,
        bubbles: false,
      }),
    ]);
    expect(
      after['content-rules'].assignable_rules.map((r: { id: string }) => r.id),
      'an assigned rule is no longer offered',
    ).not.toContain(id);

    const listing = await (
      await request.get(`${urls.mockApi}/@controlpanels/content-rules`, { headers })
    ).json();
    expect(listing.items[0].find((r: { id: string }) => r.id === id).assigned).toBe(true);
  });

  test('an assignment can apply to subfolders, be disabled, and be removed', async ({ request, urls }) => {
    const headers = await signIn(request);
    const { id } = await addRule(request, headers);
    const url = `${urls.mockApi}${FOLDER}/@content-rules`;
    await request.post(`${url}/${id}`, { headers });

    const read = async () =>
      (await (await request.get(url, { headers })).json())['content-rules'].assigned_rules;

    const bubbled = await request.patch(url, {
      headers,
      data: { 'form.button.Bubble': true, rule_ids: [id] },
    });
    expect((await bubbled.json()).message).toBe(`Successfully applied ['${id}'] to subfolders`);
    expect((await read())[0].bubbles, 'applied to subfolders').toBe(true);

    await request.patch(url, { headers, data: { 'form.button.Disable': true, rule_ids: [id] } });
    expect((await read())[0].enabled, 'disabled here').toBe(false);

    const removed = await request.delete(url, {
      headers,
      data: { 'form.button.Delete': true, rule_ids: [id] },
    });
    expect(removed.status()).toBe(204);
    expect(await read(), 'unassigned').toEqual([]);
  });
});
