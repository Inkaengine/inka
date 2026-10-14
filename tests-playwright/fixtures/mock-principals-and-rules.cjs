/**
 * Users, groups and content rules — the endpoints the admin's Users and
 * Content Rules control panels, and a folder's Rules view, read and write.
 *
 * Shapes are plone.restapi's recorded responses (tests/http-examples: users*,
 * groups, roles, userschema, controlpanels_*rule*, rules_*), not what Volto
 * happens to read — see checking-against-plone.md. The rule elements a rule
 * can be given, with their form schemas and summaries, are lifted from a
 * recording into api/contentrules-elements.json, and the user schema into
 * api/userschema.json.
 *
 * Like every other write in this mock, a write is scoped to the caller's
 * session: a user or rule added by one test is not seen by another, and
 * nothing is persisted.
 *
 * Registered by mock-plone-api.cjs, which passes the session lookup, the
 * origin (so @ids match the rest of the mock) and a content title lookup.
 */
const fs = require('fs');
const path = require('path');

const readFixture = (name) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, 'api', name), 'utf-8'));

// @roles, in the order Plone lists them.
const ROLES = [
  'Contributor',
  'Editor',
  'Member',
  'Reader',
  'Reviewer',
  'Site Administrator',
  'Manager',
];

// Plone's default groups, as @groups lists them. AuthenticatedUsers is
// virtual: every user is in it, nobody is added to it.
const GROUPS = [
  { id: 'Administrators', title: 'Administrators', description: '', roles: ['Manager'] },
  { id: 'Reviewers', title: 'Reviewers', description: '', roles: ['Reviewer'] },
  {
    id: 'Site Administrators',
    title: 'Site Administrators',
    description: '',
    roles: ['Site Administrator'],
  },
  {
    id: 'AuthenticatedUsers',
    title: 'Authenticated Users (Virtual Group)',
    description: 'Automatic Group Provider',
    roles: [],
    virtual: true,
  },
];

// More than one, so the panel has a list to show and a query something to
// narrow.
const USERS = [
  {
    id: 'admin',
    fullname: 'Admin User',
    email: 'admin@example.com',
    roles: ['Manager'],
    groups: ['Administrators'],
  },
  {
    id: 'editor',
    fullname: 'Ed Editor',
    email: 'editor@example.com',
    roles: ['Editor'],
    groups: [],
  },
  {
    id: 'reviewer',
    fullname: 'Rae Reviewer',
    email: 'reviewer@example.com',
    roles: ['Member'],
    groups: ['Reviewers'],
  },
];

const USER_SCHEMA = readFixture('userschema.json');
const USER_FIELDS = Object.keys(USER_SCHEMA.properties).filter((f) => f !== 'portrait');

// The events plone.app.contentrules registers; the vocabulary's token and title
// are both the name.
const RULE_EVENTS = [
  'Object added to this container',
  'Object removed from this container',
  'Object modified',
  'Object copied',
  'Workflow state changed',
  'User Logged in',
  'User Logged out',
  'User Created',
  'User Removed',
];

/** Vocabularies the rule forms read, which the main mock does not hold. */
const EXTRA_VOCABULARIES = {
  'plone.contentrules.events': RULE_EVENTS.map((name) => ({ token: name, title: name })),
  'plone.app.vocabularies.WorkflowStates': [
    { token: 'private', title: 'Private [private]' },
    { token: 'pending', title: 'Pending review [pending]' },
    { token: 'published', title: 'Published [published]' },
  ],
  'plone.app.vocabularies.WorkflowTransitions': [
    { token: 'publish', title: 'Publish [publish]' },
    { token: 'retract', title: 'Retract [retract]' },
    { token: 'submit', title: 'Submit for publication [submit]' },
    { token: 'reject', title: 'Send back [reject]' },
  ],
  'plone.app.vocabularies.Groups': GROUPS.filter((g) => !g.virtual).map((g) => ({
    token: g.id,
    title: g.title,
  })),
  'plone.app.vocabularies.Roles': ROLES.map((r) => ({ token: r, title: r })),
};

// Registry-backed panels: their settings, as a form schema of switches. The
// Users panel reads both — usergroup for whether to list users at all,
// security for whether the login is the email address.
const SETTINGS_PANELS = {
  usergroup: {
    title: 'Users and Groups',
    group: 'Users',
    data: { many_groups: false, many_users: false },
  },
  security: {
    title: 'Security',
    group: 'Security',
    data: {
      enable_self_reg: false,
      enable_user_pwd_choice: false,
      enable_user_folders: false,
      allow_anon_views_about: false,
      use_email_as_login: false,
      use_uuid_as_userid: false,
    },
  },
};

// The @controlpanels listing: Volto draws Site Setup from it (and hides
// content-rules, linking its own Rules screen instead).
const PANELS = [
  { id: 'editing', title: 'Editing', group: 'General' },
  { id: 'language', title: 'Language', group: 'General' },
  { id: 'mail', title: 'Mail', group: 'General' },
  { id: 'navigation', title: 'Navigation', group: 'General' },
  { id: 'site', title: 'Site', group: 'General' },
  { id: 'search', title: 'Search', group: 'General' },
  { id: 'content-rules', title: 'Content Rules', group: 'Content' },
  { id: 'usergroup', title: 'Users and Groups', group: 'Users' },
  { id: 'security', title: 'Security', group: 'Security' },
];

const notFound = (res, message) =>
  res.status(404).json({ error: { type: 'NotFound', message } });
const badRequest = (res, message) =>
  res.status(400).json({ error: { type: 'BadRequest', message } });

// Python's repr of a list of strings, which Plone's assignment messages embed.
const pyList = (ids) => `[${ids.map((id) => `'${id}'`).join(', ')}]`;

function register(app, { getSessionId, origin, titleOf }) {
  const elements = JSON.parse(
    JSON.stringify(readFixture('contentrules-elements.json')).replaceAll('{origin}', origin),
  );
  const sessions = {};

  function signedInAs(req) {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) return null;
    const payload = auth.slice(7).split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf-8')).sub;
  }

  function state(req) {
    const id = getSessionId(req);
    if (!sessions[id]) {
      sessions[id] = {
        users: new Map(USERS.map((u) => [u.id, structuredClone(u)])),
        rules: new Map(),
        // content path → Map(rule id → { enabled, bubbles }), in assignment order
        assignments: new Map(),
        ruleCounter: 0,
      };
    }
    // @login here accepts any name and answers that it is a Manager, so the
    // name a session signed in with is a user of that session — the admin
    // fetches `@users/<login>` straight after signing in.
    const login = signedInAs(req);
    if (login && !sessions[id].users.has(login)) {
      sessions[id].users.set(login, {
        id: login,
        fullname: login,
        email: `${login}@example.com`,
        roles: ['Manager'],
        groups: [],
      });
    }
    return sessions[id];
  }

  // --- users, groups, roles, user schema -------------------------------------

  function serializeUser(user) {
    const groups = [
      ...GROUPS.filter((g) => user.groups.includes(g.id)).map((g) => ({
        id: g.id,
        title: g.title,
      })),
      // Plone titles the virtual group by its id here.
      { id: 'AuthenticatedUsers', title: 'AuthenticatedUsers' },
    ];
    return {
      '@id': `${origin}/@users/${user.id}`,
      id: user.id,
      username: user.id,
      roles: user.roles,
      ...Object.fromEntries(USER_FIELDS.map((f) => [f, user[f] ?? null])),
      portrait: null,
      groups: { '@id': `${origin}/@users`, items: groups, items_total: groups.length },
    };
  }

  function serializeGroup(s, group) {
    const members = group.virtual
      ? []
      : [...s.users.values()].filter((u) => u.groups.includes(group.id)).map((u) => u.id);
    return {
      '@id': `${origin}/@groups/${group.id}`,
      id: group.id,
      groupname: group.id,
      email: '',
      title: group.title,
      description: group.description,
      roles: group.virtual ? [] : [...group.roles, 'Authenticated'],
      members: { '@id': `${origin}/@groups`, items: members.sort(), items_total: members.length },
    };
  }

  const userBatch = (users) => ({
    '@id': `${origin}/@users`,
    items: users.map(serializeUser),
    items_total: users.length,
  });

  app.get('/@users', (req, res) => {
    const s = state(req);
    const all = [...s.users.values()].sort((a, b) => a.id.localeCompare(b.id));
    const query = String(req.query.query || req.query.search || '').toLowerCase();
    if (!query) return res.json(userBatch(all));
    res.json(
      userBatch(
        all.filter((u) =>
          `${u.id} ${u.fullname || ''} ${u.email || ''}`.toLowerCase().includes(query),
        ),
      ),
    );
  });

  app.get('/@users/:userid', (req, res) => {
    const user = state(req).users.get(req.params.userid);
    if (!user) return notFound(res, `No user: ${req.params.userid}`);
    res.json(serializeUser(user));
  });

  app.post('/@users', (req, res) => {
    const s = state(req);
    const { username, password, sendPasswordReset, roles, groups = [], ...fields } =
      req.body || {};
    const id = username || fields.email;
    if (!id) return badRequest(res, "Property 'username' is required");
    if (!password && !sendPasswordReset) {
      return badRequest(res, 'You have to either send a password or sendPasswordReset');
    }
    if (s.users.has(id)) {
      return badRequest(
        res,
        'The login name you selected is already in use or is not valid. Please choose another.',
      );
    }
    const unknown = groups.filter((g) => !GROUPS.some((known) => known.id === g && !known.virtual));
    if (unknown.length) return badRequest(res, `No such group: ${unknown.join(', ')}`);
    const user = {
      id,
      ...Object.fromEntries(USER_FIELDS.filter((f) => f in fields).map((f) => [f, fields[f]])),
      // A user created without roles is a Member; given roles, it has those.
      roles: roles && roles.length ? roles : ['Member'],
      groups,
    };
    s.users.set(id, user);
    res.status(201).location(`${origin}/@users/${id}`).json(serializeUser(user));
  });

  app.patch('/@users/:userid', (req, res) => {
    const user = state(req).users.get(req.params.userid);
    if (!user) return notFound(res, `No user: ${req.params.userid}`);
    const { roles, ...fields } = req.body || {};
    for (const f of USER_FIELDS) if (f in fields) user[f] = fields[f];
    // Volto sends roles as {Role: bool}.
    for (const [role, on] of Object.entries(roles || {})) {
      user.roles = on ? [...new Set([...user.roles, role])] : user.roles.filter((r) => r !== role);
    }
    res.status(204).end();
  });

  app.delete('/@users/:userid', (req, res) => {
    if (!state(req).users.delete(req.params.userid)) {
      return notFound(res, `No user: ${req.params.userid}`);
    }
    res.status(204).end();
  });

  app.get('/@groups', (req, res) => {
    const s = state(req);
    const query = String(req.query.query || '').toLowerCase();
    res.json(
      GROUPS.filter((g) => !query || `${g.id} ${g.title}`.toLowerCase().includes(query)).map(
        (g) => serializeGroup(s, g),
      ),
    );
  });

  app.get('/@groups/:groupid', (req, res) => {
    const group = GROUPS.find((g) => g.id === req.params.groupid);
    if (!group) return notFound(res, `No group: ${req.params.groupid}`);
    res.json(serializeGroup(state(req), group));
  });

  app.get('/@roles', (req, res) => {
    res.json(ROLES.map((r) => ({ '@id': `${origin}/@roles/${r}`, '@type': 'role', id: r, title: r })));
  });

  app.get('/@userschema', (req, res) => {
    res.json(USER_SCHEMA);
  });

  // --- control panels --------------------------------------------------------

  app.get('/@controlpanels', (req, res) => {
    res.json(
      PANELS.map((p) => ({
        '@id': `${origin}/@controlpanels/${p.id}`,
        group: p.group,
        searchable_text: [p.title, p.group],
        title: p.title,
      })),
    );
  });

  for (const [id, panel] of Object.entries(SETTINGS_PANELS)) {
    app.get(`/@controlpanels/${id}`, (req, res) => {
      res.json({
        '@id': `${origin}/@controlpanels/${id}`,
        title: panel.title,
        group: panel.group,
        data: panel.data,
        schema: {
          type: 'object',
          fieldsets: [{ id: 'default', title: 'Default', fields: Object.keys(panel.data) }],
          properties: Object.fromEntries(
            Object.keys(panel.data).map((k) => [k, { title: k, type: 'boolean' }]),
          ),
          required: [],
        },
      });
    });
  }

  // --- content rules ---------------------------------------------------------

  const KINDS = {
    condition: { key: 'conditions', addable: elements.conditions },
    action: { key: 'actions', addable: elements.actions },
  };
  const ruleUrl = (id) => `${origin}/@controlpanels/content-rules/${id}`;

  function assignedPaths(s, ruleId) {
    return [...s.assignments.entries()]
      .filter(([, rules]) => rules.has(ruleId))
      .map(([p]) => p);
  }

  function listElements(rule, kind) {
    const stored = rule[KINDS[kind].key];
    return stored.map((data, idx) => {
      const type = KINDS[kind].addable.find((t) => t.addview === data.type);
      return {
        description: type.description,
        editview: `${origin}/++rule++${rule.id}/++${kind}++${idx}/edit`,
        first: idx === 0,
        idx,
        last: idx === stored.length - 1,
        summary: elements.summaries[type.title],
        title: type.title,
      };
    });
  }

  function serializeRule(s, rule) {
    return {
      '@id': ruleUrl(rule.id),
      actions: listElements(rule, 'action'),
      addable_actions: KINDS.action.addable,
      addable_conditions: KINDS.condition.addable,
      assignments: assignedPaths(s, rule.id).map((p) => ({
        url: `${origin}${p === '/' ? '' : p}`,
        title: titleOf(p),
        description: '',
      })),
      cascading: rule.cascading,
      conditions: listElements(rule, 'condition'),
      description: rule.description,
      enabled: rule.enabled,
      event: rule.event,
      group: 'Content',
      id: rule.id,
      stop: rule.stop,
      title: rule.title,
    };
  }

  function ruleOr404(req, res) {
    const rule = state(req).rules.get(req.params.rule);
    if (!rule) notFound(res, `No rule: ${req.params.rule}`);
    return rule;
  }

  app.get('/@controlpanels/content-rules', (req, res) => {
    const s = state(req);
    res.json({
      '@id': `${origin}/@controlpanels/content-rules`,
      group: 'Content',
      // plone.restapi appends the whole list as ONE item.
      items: [
        [...s.rules.values()].map((r) => {
          const assigned = assignedPaths(s, r.id).length > 0;
          return {
            '@id': ruleUrl(r.id),
            assigned,
            description: r.description,
            enabled: r.enabled,
            id: r.id,
            row_class: `state-${r.enabled ? 'enabled' : 'disabled'} assignment-${
              assigned ? 'assigned' : 'unassigned'
            }`,
            title: r.title,
            trigger: r.event,
          };
        }),
      ],
      title: 'Content Rules',
    });
  });

  app.post('/@controlpanels/content-rules', (req, res) => {
    const s = state(req);
    const {
      title,
      description = '',
      event,
      enabled = true,
      stop = false,
      cascading = false,
    } = req.body || {};
    if (!title) return badRequest(res, "Property 'title' is required");
    if (!RULE_EVENTS.includes(event)) return badRequest(res, `Unknown event: ${event}`);
    s.ruleCounter += 1;
    const id = `rule-${s.ruleCounter}`;
    const rule = { id, title, description, event, enabled, stop, cascading, conditions: [], actions: [] };
    s.rules.set(id, rule);
    res.status(201).location(ruleUrl(id)).json(serializeRule(s, rule));
  });

  app.get('/@controlpanels/content-rules/:rule', (req, res) => {
    const rule = ruleOr404(req, res);
    if (rule) res.json(serializeRule(state(req), rule));
  });

  app.patch('/@controlpanels/content-rules/:rule', (req, res) => {
    const rule = ruleOr404(req, res);
    if (!rule) return;
    for (const field of ['title', 'description', 'event', 'enabled', 'stop', 'cascading']) {
      if (req.body?.[field] !== undefined) rule[field] = req.body[field];
    }
    res.status(204).end();
  });

  app.delete('/@controlpanels/content-rules/:rule', (req, res) => {
    const rule = ruleOr404(req, res);
    if (!rule) return;
    const s = state(req);
    s.rules.delete(rule.id);
    for (const rules of s.assignments.values()) rules.delete(rule.id);
    res.status(204).end();
  });

  for (const [kind, { key, addable }] of Object.entries(KINDS)) {
    app.post(`/@controlpanels/content-rules/:rule/${kind}`, (req, res) => {
      const rule = ruleOr404(req, res);
      if (!rule) return;
      const { type, ...data } = req.body || {};
      const element = addable.find((t) => t.addview === type);
      if (!element) return badRequest(res, `Unknown ${kind}: ${type}`);
      const missing = element['@schema'].required.filter(
        (f) => data[f] === undefined || data[f] === '' || (Array.isArray(data[f]) && !data[f].length),
      );
      if (missing.length) return badRequest(res, `Missing: ${missing.join(', ')}`);
      rule[key].push({ type, ...data });
      res.status(201).location(ruleUrl(rule.id)).json(serializeRule(state(req), rule));
    });

    const storedOr404 = (req, res) => {
      const rule = ruleOr404(req, res);
      if (!rule) return [];
      const idx = Number(req.params.idx);
      const stored = rule[key][idx];
      if (!stored) notFound(res, `No ${kind} ${req.params.idx}`);
      return [rule, idx, stored];
    };

    app.get(`/@controlpanels/content-rules/:rule/${kind}/:idx`, (req, res) => {
      const [rule, idx, stored] = storedOr404(req, res);
      if (!stored) return;
      const { type, ...data } = stored;
      res.json({
        '@id': `${ruleUrl(rule.id)}/${kind}/${idx}`,
        '@schema': addable.find((t) => t.addview === type)['@schema'],
        ...data,
      });
    });

    app.patch(`/@controlpanels/content-rules/:rule/${kind}/:idx`, (req, res) => {
      const [rule, idx, stored] = storedOr404(req, res);
      if (!stored) return;
      const { 'form.button.Move': move, ...data } = req.body || {};
      if (move) {
        const to = move === '_move_up' ? idx - 1 : idx + 1;
        if (to < 0 || to >= rule[key].length) return badRequest(res, `Cannot ${move} ${kind} ${idx}`);
        [rule[key][idx], rule[key][to]] = [rule[key][to], rule[key][idx]];
      } else {
        Object.assign(stored, data);
      }
      res.status(204).end();
    });

    app.delete(`/@controlpanels/content-rules/:rule/${kind}/:idx`, (req, res) => {
      const [rule, idx, stored] = storedOr404(req, res);
      if (!stored) return;
      rule[key].splice(idx, 1);
      res.status(204).end();
    });
  }

  // A folder's Rules view: what applies here, and what could.
  const contentPath = (req) =>
    (req.path.replace(/\/?@content-rules(\/[^/]+)?$/, '') || '/').replace(/\/+$/, '') || '/';

  app.get(/.*\/@content-rules$/, (req, res) => {
    const s = state(req);
    const here = contentPath(req);
    const mine = s.assignments.get(here) || new Map();
    const assigned = [...mine.entries()].map(([id, a]) => {
      const rule = s.rules.get(id);
      return {
        bubbles: a.bubbles,
        description: rule.description,
        enabled: a.enabled,
        global_enabled: rule.enabled,
        id,
        title: rule.title,
        trigger: rule.event,
        url: `${origin}/++rule++${id}/@@manage-elements`,
      };
    });
    // Acquired: assigned on an ancestor with "apply to subfolders" on.
    const acquired = [];
    for (const [p, rules] of s.assignments.entries()) {
      if (p === here || !(p === '/' || here.startsWith(`${p}/`))) continue;
      for (const [id, a] of rules.entries()) {
        if (!a.bubbles) continue;
        const rule = s.rules.get(id);
        acquired.push({
          enabled: a.enabled,
          id,
          title: rule.title,
          trigger: rule.event,
          url: `${origin}/++rule++${id}/@@manage-elements`,
        });
      }
    }
    const assignable = [...s.rules.values()]
      .filter((r) => !mine.has(r.id))
      .map((r) => ({ description: r.description, id: r.id, title: r.title }));
    res.json({
      'content-rules': {
        acquired_rules: acquired,
        assignable_rules: assignable,
        assigned_rules: assigned,
      },
    });
  });

  app.post(/.*\/@content-rules\/[^/]+$/, (req, res) => {
    const s = state(req);
    const ruleId = req.path.split('/').pop();
    if (!s.rules.has(ruleId)) return notFound(res, `No rule: ${ruleId}`);
    const here = contentPath(req);
    if (!s.assignments.has(here)) s.assignments.set(here, new Map());
    s.assignments.get(here).set(ruleId, { enabled: true, bubbles: false });
    res.json({ message: `Successfully assigned the rule ${ruleId}` });
  });

  // Each button's field, value and the message Plone answers with (recorded).
  const ASSIGNMENT_BUTTONS = {
    'form.button.Enable': ['enabled', true, (ids) => `Successfully enabled rules ${pyList(ids)}`],
    'form.button.Disable': ['enabled', false, (ids) => `Successfully disabled rules ${pyList(ids)}`],
    'form.button.Bubble': ['bubbles', true, (ids) => `Successfully applied ${pyList(ids)} to subfolders`],
    'form.button.NoBubble': ['bubbles', false, (ids) => `Disabled apply to subfolders for ${pyList(ids)}`],
  };

  app.patch(/.*\/@content-rules$/, (req, res) => {
    const s = state(req);
    const mine = s.assignments.get(contentPath(req)) || new Map();
    const body = req.body || {};
    const ids = body.rule_ids || [];
    const button = Object.keys(ASSIGNMENT_BUTTONS).find((b) => body[b]);
    if (!button) return badRequest(res, 'No action given');
    const [field, value, message] = ASSIGNMENT_BUTTONS[button];
    for (const id of ids) {
      if (!mine.has(id)) return badRequest(res, `Rule ${id} is not assigned here`);
      mine.get(id)[field] = value;
    }
    res.json({ message: message(ids) });
  });

  app.delete(/.*\/@content-rules$/, (req, res) => {
    const mine = state(req).assignments.get(contentPath(req));
    for (const id of req.body?.rule_ids || []) mine?.delete(id);
    res.status(204).end();
  });
}

module.exports = { register, EXTRA_VOCABULARIES };
