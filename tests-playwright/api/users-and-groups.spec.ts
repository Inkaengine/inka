import { test, expect, type APIRequestContext } from '@playwright/test';
import { URLS } from '../ports';

/**
 * The endpoints the admin's Users control panel reads and writes.
 *
 * The panel loads the usergroup settings, the roles, the groups, the users and
 * the user schema before it draws anything, and "Add user" POSTs to @users. The
 * mock answered only `GET /@users/:id`, and with the same made-up admin for any
 * id, so the panel had nothing to list and nowhere to add to.
 *
 * Shapes follow plone.restapi: a user is `@id`/`id`/`username`/`roles` plus the
 * user-schema fields and a `groups` batch; a group carries `groupname`, `title`
 * and `roles`; a role is `{ '@type': 'role', id, title }`.
 *
 * Writes are scoped to the caller's token like every other write here, so each
 * test signs in for its own session.
 */
async function signIn(request: APIRequestContext): Promise<Record<string, string>> {
  const res = await request.post(`${URLS.mockApi}/@login`, {
    data: { login: 'admin', password: 'secret' },
  });
  expect(res.ok(), 'the mock signs admin in').toBe(true);
  const { token } = await res.json();
  return { Authorization: `Bearer ${token}`, Accept: 'application/json' };
}

test.describe('@users', () => {
  test('lists the site users, the signed-in admin among them', async ({ request }) => {
    const headers = await signIn(request);
    const res = await request.get(`${URLS.mockApi}/@users`, { headers });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    // A batch, as plone.restapi records it (users.resp) — not a bare list.
    expect(body.items_total).toBe(body.items.length);
    const users = body.items;
    const admin = users.find((u: { id: string }) => u.id === 'admin');
    expect(admin, 'admin is listed').toBeTruthy();
    expect(admin.roles).toContain('Manager');
    expect(admin.groups.items, 'a user carries its groups as a batch').toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'Administrators' })]),
    );
    expect(
      users.length,
      'one user cannot show a list being a list',
    ).toBeGreaterThan(1);
  });

  test('a query narrows the list to matching users', async ({ request }) => {
    const headers = await signIn(request);
    const res = await request.get(`${URLS.mockApi}/@users?query=editor`, { headers });
    const body = await res.json();
    expect(body.items_total, 'a query answers a batch').toBe(body.items.length);
    expect(body.items.length).toBeGreaterThan(0);
    for (const user of body.items) {
      expect(
        `${user.id} ${user.fullname} ${user.email}`.toLowerCase(),
        'every match contains the query',
      ).toContain('editor');
    }
  });

  test('adding a user lists it, with the roles and groups it was given', async ({ request }) => {
    const headers = await signIn(request);
    const created = await request.post(`${URLS.mockApi}/@users`, {
      headers,
      data: {
        username: 'jsmith',
        fullname: 'Jo Smith',
        email: 'jo@example.com',
        password: 'a-password',
        roles: ['Editor'],
        groups: ['Reviewers'],
      },
    });
    expect(created.status(), 'Plone answers 201 Created').toBe(201);
    expect(created.headers().location).toMatch(/@users\/jsmith$/);
    expect((await created.json()).id).toBe('jsmith');

    const user = await (await request.get(`${URLS.mockApi}/@users/jsmith`, { headers })).json();
    expect(user.fullname).toBe('Jo Smith');
    expect(user.email).toBe('jo@example.com');
    // Given roles, a new user has exactly those (users_created.resp).
    expect(user.roles).toEqual(['Editor']);
    expect(user.groups.items.map((g: { id: string }) => g.id)).toContain('Reviewers');

    const listed = await (await request.get(`${URLS.mockApi}/@users`, { headers })).json();
    expect(listed.items.map((u: { id: string }) => u.id)).toContain('jsmith');
  });

  test('a user created without roles is a Member', async ({ request }) => {
    const headers = await signIn(request);
    await request.post(`${URLS.mockApi}/@users`, {
      headers,
      data: { username: 'plain', email: 'plain@example.com', password: 'x' },
    });
    const user = await (await request.get(`${URLS.mockApi}/@users/plain`, { headers })).json();
    expect(user.roles).toEqual(['Member']);
  });

  test('a user added in one session is not seen by another', async ({ request }) => {
    const mine = await signIn(request);
    await request.post(`${URLS.mockApi}/@users`, {
      headers: mine,
      data: { username: 'only-mine', email: 'mine@example.com', password: 'x' },
    });
    const theirs = await signIn(request);
    const listed = await (await request.get(`${URLS.mockApi}/@users`, { headers: theirs })).json();
    expect(listed.items.map((u: { id: string }) => u.id)).not.toContain('only-mine');
  });

  test('adding a user who exists is refused', async ({ request }) => {
    const headers = await signIn(request);
    const res = await request.post(`${URLS.mockApi}/@users`, {
      headers,
      data: { username: 'admin', email: 'a@example.com', password: 'x' },
    });
    expect(res.status()).toBe(400);
  });

  test('whoever signed in is a user of their own session', async ({ request }) => {
    // The admin fetches @users/<login> straight after signing in, and @login
    // here accepts any name — a demo account signs in as `demo`.
    const res = await request.post(`${URLS.mockApi}/@login`, {
      data: { login: 'demo', password: 'demo' },
    });
    const { token } = await res.json();
    const me = await request.get(`${URLS.mockApi}/@users/demo`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    expect(me.status()).toBe(200);
    expect((await me.json()).roles).toContain('Manager');
  });

  test('an unknown user is not found', async ({ request }) => {
    const headers = await signIn(request);
    const res = await request.get(`${URLS.mockApi}/@users/nobody-here`, { headers });
    expect(res.status()).toBe(404);
  });
});

test.describe('@groups, @roles, @userschema', () => {
  test('groups carry Plone fields, and more than one exists', async ({ request }) => {
    const headers = await signIn(request);
    const groups = await (await request.get(`${URLS.mockApi}/@groups`, { headers })).json();
    expect(groups.length).toBeGreaterThan(1);
    const reviewers = groups.find((g: { id: string }) => g.id === 'Reviewers');
    expect(reviewers).toMatchObject({ groupname: 'Reviewers', title: 'Reviewers' });
    expect(reviewers.roles).toEqual(['Reviewer', 'Authenticated']);
    // Members are a batch of user ids (groups.resp).
    expect(reviewers.members.items).toContain('reviewer');
  });

  test('roles are the assignable Plone roles', async ({ request }) => {
    const headers = await signIn(request);
    const roles = await (await request.get(`${URLS.mockApi}/@roles`, { headers })).json();
    expect(roles.map((r: { id: string }) => r.id)).toEqual(
      expect.arrayContaining(['Contributor', 'Editor', 'Reviewer', 'Site Administrator', 'Manager']),
    );
    expect(roles[0]).toMatchObject({ '@type': 'role' });
  });

  test('the user schema is a form schema with email required', async ({ request }) => {
    const headers = await signIn(request);
    const schema = await (await request.get(`${URLS.mockApi}/@userschema`, { headers })).json();
    expect(schema.fieldsets[0].fields).toEqual(expect.arrayContaining(['fullname', 'email']));
    expect(schema.properties.email.title).toBeTruthy();
    expect(schema.required).toContain('email');
  });
});

test.describe('@controlpanels', () => {
  test('the listing offers users and content rules panels', async ({ request }) => {
    const headers = await signIn(request);
    const panels = await (await request.get(`${URLS.mockApi}/@controlpanels`, { headers })).json();
    const ids = panels.map((p: { '@id': string }) => String(p['@id']).split('/').pop());
    expect(ids).toEqual(expect.arrayContaining(['usergroup', 'content-rules']));
    for (const p of panels) expect(p.group, `${p['@id']} has a group`).toBeTruthy();
  });

  test('usergroup settings say the site lists its users', async ({ request }) => {
    const headers = await signIn(request);
    const panel = await (
      await request.get(`${URLS.mockApi}/@controlpanels/usergroup`, { headers })
    ).json();
    // many_users true makes the panel show a search box and list nobody.
    expect(panel.data.many_users).toBe(false);
    expect(panel.data.many_groups).toBe(false);
  });

  test('security settings say the login is a user name, not an email', async ({ request }) => {
    // The Users panel reads this to decide whether "Add user" asks for a user
    // name; it logged a 404 on every open while the mock lacked it.
    const headers = await signIn(request);
    const res = await request.get(`${URLS.mockApi}/@controlpanels/security`, { headers });
    expect(res.status()).toBe(200);
    expect((await res.json()).data.use_email_as_login).toBe(false);
  });
});
