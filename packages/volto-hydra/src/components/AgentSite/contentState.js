/**
 * A page's state, what can be done to it, and what each of those can set at
 * the same time. Plone keeps workflow, sharing and working copies as three
 * separate things; here they answer one question, so they are one list:
 *
 *   get(path)       { state, transitions, effective } — the cheap part
 *   getForms(path)  { [transition id]: { schema, data } } — what it can set
 *   transition({ path, id, data })  null, or { redirect } if the page moved
 *   draftOf(path)   the path of the page's draft, or null
 *   originalOf(path)  the page a draft belongs to
 *
 * A page has at most one draft, and having one is part of its state: `draft`
 * in get(), with publishing and discarding it on offer on the page itself. In
 * Plone a draft is a working copy at another path; draftOf(path) finds it.
 *
 * "update" is the transition that stays where it is: who can reach the page,
 * its address, whether it is listed. Its form is offered to whoever may share.
 *
 * Written against Plone's REST API, which is what the admin talks to, in the
 * shape a CMS adapter's state.get, state.getForms and state.transition answer,
 * so nothing that calls this has to know which CMS is behind it.
 *
 * `fetchJson(path, { method, body })` reads and writes; `toPath(url)` turns a
 * URL the CMS gave into a site path.
 */
const FORM_WITH_NOTHING = { schema: { fieldsets: [], properties: {}, required: [] }, data: {} };

const ADDRESS_FIELDS = {
  id: {
    title: 'Short name',
    description: 'The last part of this item’s address. Changing it after people have linked here breaks those links.',
    type: 'string',
  },
  exclude_from_nav: {
    title: 'Exclude from navigation',
    description: 'Still readable by anyone who has the address — just not listed in menus.',
    type: 'boolean',
  },
};

/** What POST @workflow/<id> takes (plone.restapi's recorded workflow_post_with_body). */
const WORKFLOW_FIELDS = {
  comment: {
    title: 'Comment',
    description: 'Recorded in this item’s workflow history.',
    type: 'string',
    widget: 'textarea',
  },
  effective: {
    title: 'Publishing date',
    description: 'Before this date the item stays invisible even once published — the state alone is not the whole story.',
    type: 'string',
    widget: 'datetime',
  },
  expires: {
    title: 'Expiration date',
    description: 'After this date the item stops being visible.',
    type: 'string',
    widget: 'datetime',
  },
  include_children: {
    title: 'Include contained items',
    description: 'Apply the same change to everything inside this item.',
    type: 'boolean',
  },
};

const formOf = (properties, data) => ({
  schema: {
    fieldsets: [{ id: 'default', title: 'Default', fields: Object.keys(properties) }],
    properties,
    required: [],
  },
  data,
});

const pick = (data, fields) => Object.fromEntries(
  fields.filter((field) => data[field] !== undefined).map((field) => [field, data[field]]),
);

/**
 * Whether a role is given on this page. Plone marks one held from elsewhere with
 * 'global' or 'acquired', which can't be changed here and must not be sent back
 * as if it were given here.
 */
const givenHere = (role) => role === true;

const lastSegment = (path) => path.split('/').pop();
const parentOf = (path) => path.slice(0, path.lastIndexOf('/'));
const transitionId = (t) => lastSegment(t['@id']);

export function contentState({ fetchJson, toPath }) {
  const at = (path, service) => `${path.replace(/\/$/, '')}/${service}`;

  /** The path of `page`'s draft, or null. A copy names itself as working_copy too, as well as what it is a copy of. */
  const draftPathOf = (page) => (page.working_copy && !page.working_copy_of ? toPath(page.working_copy['@id']) : null);

  const draftOf = async (path) => draftPathOf(await fetchJson(path));

  async function originalOf(path) {
    const { working_copy_of: original } = await fetchJson(path);
    if (!original) throw new Error(`${path} is not a draft`);
    return toPath(original['@id']);
  }

  async function get(path) {
    const [actions, workflow, page] = await Promise.all([
      fetchJson(at(path, '@actions')), fetchJson(at(path, '@workflow')), fetchJson(path),
    ]);
    const draft = draftPathOf(page);
    // Only the copy offers checking in, so that is who is asked.
    const draftActions = draft && await fetchJson(at(draft, '@actions'));
    // Categories as plone.restapi records them: these two are not the same list.
    const has = (id) => actions.object.some((a) => a.id === id);
    const hasButton = (id) => actions.object_buttons.some((a) => a.id === id);
    const canCheckIn = hasButton('iterate_checkin') || draftActions?.object_buttons.some((a) => a.id === 'iterate_checkin');
    // A draft goes live by being checked in. Taking it through the workflow
    // would make it a second public page, beside the one it is a draft of.
    const transitions = page.working_copy_of ? [] : workflow.transitions.map((t) => ({ id: transitionId(t), label: t.title }));
    // Checking out a copy IS a state change: the page gains a draft only its
    // author sees, while the published version stays put.
    if (hasButton('iterate_checkout')) {
      transitions.push({ id: 'checkout', label: 'Work on a draft copy', relocates: true });
    }
    if (canCheckIn) {
      transitions.push({ id: 'checkin', label: 'Publish the draft', relocates: true });
      transitions.push({ id: 'cancel-checkout', label: 'Discard the draft', relocates: true });
    }
    return {
      state: { name: workflow.state.id, label: workflow.state.title },
      ...(draft && { draft: { path: draft } }),
      transitions,
      effective: {
        canEdit: has('edit'),
        canPublish: transitions.some((t) => t.id === 'publish'),
        canDelete: hasButton('delete'),
        canShare: has('sharing') || has('local_roles'),
        canComment: has('discussion'),
      },
    };
  }

  /**
   * Sharing, one field per role (Plone's @sharing has one row per person), with
   * `pageFields`, the page's own fields it can set.
   */
  async function updateForm(path, pageFields) {
    const sharing = await fetchJson(at(path, '@sharing'));
    const properties = {};
    const data = {};
    for (const role of sharing.available_roles) {
      properties[role.id] = {
        title: role.title,
        description: `The ${role.id} role, local to this item: the people and groups holding it, by id.`,
        type: 'array',
        vocabulary: 'principals',
      };
      data[role.id] = sharing.entries.filter((e) => givenHere(e.roles[role.id])).map((e) => e.id);
    }
    return formOf(
      {
        ...properties,
        ...(pageFields && ADDRESS_FIELDS),
        inherit: {
          title: 'Inherit permissions from parent',
          description: 'On, people given access further up the tree also have it here.',
          type: 'boolean',
        },
      },
      { ...data, ...pageFields, inherit: sharing.inherit },
    );
  }

  async function getForms(path) {
    const { transitions, effective } = await get(path);
    const page = await fetchJson(path);
    // Checking out locks the page against saves, so while it has a draft its
    // own fields can't be written (the draft's title and the like are edited there).
    const pageFields = draftPathOf(page) ? null : { id: page.id, exclude_from_nav: Boolean(page.exclude_from_nav) };
    const forms = {};
    for (const { id, relocates } of transitions) {
      // Working copies take no body at all (neither PATCH nor DELETE does).
      if (relocates) forms[id] = FORM_WITH_NOTHING;
      // The moment a page becomes visible is when its address and whether it
      // is listed matter. Retracting asks for neither.
      else if (id === 'publish' && pageFields) forms[id] = formOf({ ...ADDRESS_FIELDS, ...WORKFLOW_FIELDS }, pageFields);
      else forms[id] = formOf(WORKFLOW_FIELDS, {});
    }
    if (effective.canShare) forms.update = await updateForm(path, pageFields);
    return forms;
  }

  /** The page's own fields, in a write of their own; the new path if that moved it. */
  async function writePageFields(path, data) {
    const fields = pick(data, ['exclude_from_nav']);
    const moved = data.id !== undefined && data.id !== lastSegment(path);
    if (moved) fields.id = data.id;
    if (Object.keys(fields).length) await fetchJson(path, { method: 'PATCH', body: fields });
    return moved ? { redirect: `${parentOf(path)}/${data.id}` } : null;
  }

  /** Give roles as named; a role not named stays as it is, and so does anyone it doesn't change. */
  async function share(path, data) {
    const sharing = await fetchJson(at(path, '@sharing'));
    const roles = sharing.available_roles.map((r) => r.id);
    const known = new Map(sharing.entries.map((e) => [e.id, e]));
    const holds = (role, id) => givenHere(known.get(id)?.roles[role]);
    const named = new Set([...known.keys(), ...roles.flatMap((role) => data[role] ?? [])]);
    const entries = [...named]
      .map((id) => ({
        id,
        type: known.get(id)?.type ?? 'user',
        roles: Object.fromEntries(roles.map((role) => [role, data[role]?.includes(id) ?? holds(role, id)])),
      }))
      .filter(({ id, roles: now }) => !known.has(id) || roles.some((role) => now[role] !== holds(role, id)));
    await fetchJson(at(path, '@sharing'), {
      method: 'POST',
      body: { entries, inherit: data.inherit ?? sharing.inherit },
    });
  }

  /** Apply or discard a working copy: it is gone after, and Plone answers nothing, so ask where it came from first. */
  async function endWorkingCopy(path, method) {
    const { working_copy_of: baseline } = await fetchJson(at(path, '@workingcopy'));
    if (!baseline) throw new Error(`${path} is not a working copy`);
    await fetchJson(at(path, '@workingcopy'), { method });
    return { redirect: toPath(baseline['@id']) };
  }

  async function transition({ path, id, data = {} }) {
    const forms = await getForms(path);
    const form = forms[id];
    if (!form) {
      throw new Error(`no transition '${id}' is offered on ${path} (offered: ${Object.keys(forms).join(', ') || 'none'})`);
    }
    const undeclared = Object.keys(data).filter((field) => !(field in form.schema.properties));
    // Dropping these is the dangerous version: success reported for a setting
    // that never took, and the wrong audience seeing the page.
    if (undeclared.length) throw new Error(`'${id}' does not take ${undeclared.join(', ')}`);

    if (id === 'update') {
      await share(path, data);
      return writePageFields(path, data);
    }
    if (id === 'checkout') {
      const copy = await fetchJson(at(path, '@workingcopy'), { method: 'POST' });
      return { redirect: toPath(copy['@id']) };
    }
    if (id === 'checkin') return endWorkingCopy(await draftOf(path) ?? path, 'PATCH');
    if (id === 'cancel-checkout') return endWorkingCopy(await draftOf(path) ?? path, 'DELETE');

    await fetchJson(at(path, `@workflow/${id}`), { method: 'POST', body: pick(data, Object.keys(WORKFLOW_FIELDS)) });
    // After the transition, so that addresses a path that still exists.
    return writePageFields(path, data);
  }

  return { get, getForms, transition, draftOf, originalOf };
}
