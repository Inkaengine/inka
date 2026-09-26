import { BaseAdapter, AdapterError } from '@volto-hydra/hydra-adapters-core';

/**
 * Decode base64url without Node's Buffer.
 *
 * Adapters run in the BROWSER — that is the whole point of the inversion, so
 * credentials stay on the frontend's origin. Buffer is a Node global and does
 * not exist there; using it made whoami() throw, which failed adapter
 * registration silently and left the editor waiting for an ADAPTER_READY that
 * never came. atob is available in browsers and in Node 16+.
 */
function decodeBase64Url(segment) {
  const padded = segment
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(segment.length / 4) * 4, '=');
  const binary = atob(padded);
  // Percent-decoding round trip so multi-byte UTF-8 survives.
  return decodeURIComponent(
    Array.from(binary, (c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''),
  );
}

/** Plone serves its REST API under a ++api++ traversal prefix. */
const API_PREFIX = '/++api++';

/**
 * Plone spells its query operations as fully-qualified dotted ids. The
 * canonical form drops the package prefix so a query builder written against
 * the contract does not have to know Plone exists.
 */
const OPERATION_PREFIX = 'plone.app.querystring.operation.';

const toCanonicalOperation = (op) =>
  op.startsWith(OPERATION_PREFIX) ? op.slice(OPERATION_PREFIX.length) : op;

const toPloneOperation = (op) =>
  op.startsWith(OPERATION_PREFIX) ? op : `${OPERATION_PREFIX}${op}`;

/** Plone review_state -> canonical state. */
const STATE_MAP = { published: 'published', private: 'draft' };

export class PloneAdapter extends BaseAdapter {
  constructor({ cmsBaseUrl, authToken, getAuthToken } = {}) {
    super({
      name: 'plone',
      capabilities: [
        'content',
        // Plone speaks the REST dialect the admin's action creators emit, so
        // it can serve them verbatim. Advertising this keeps those requests on
        // the passthrough; adapters without it get them as semantic intents.
        'http-passthrough',
        // Plone answers ?expand=breadcrumbs,actions,types,navigation inside
        // the content response, so the admin's expander bundle rides along in
        // a request it was making anyway. Adapters without this still SERVE
        // expansion — the base class emulates it concurrently — but the admin
        // does not ask them to, because emulation cannot reduce request count
        // and Volto already caches most of the bundle in its store.
        'expand-native',
        // Plone's catalog answers both free-text queries and structured
        // path/type filters, so both are real here. Adapters over CMSes with
        // only one (Drupal without search_api, Strapi) must advertise only
        // the one they have.
        'search-fulltext',
        'search-filter',
        'vocabulary',
        'schema',
        'asset',
        'state',
        // The only one of the three that can say WHO, per document: local
        // roles assigned on an object and inherited down the tree.
        'per-content-permissions',
        'hierarchical-permissions',
        // plone.app.multilingual: one document per language, linked as a group.
        // Declared because the ADAPTER can serve the calls; whether a given
        // site has languages configured is a different question, and site.get
        // answers that one (`features.multilingual`). The admin needs both — it
        // will not ask an adapter that cannot serve these, and it will not offer
        // translations on a site with one language.
        'multilingual',
        // …and its translations are separate documents, so linking an existing
        // page into a group and detaching one are both real, and neither
        // destroys anything.
        'translations-grouped',
      ],
    });
    this.cmsBaseUrl = cmsBaseUrl;
    // In a browser the session rides on a cookie and this stays null. Node
    // callers (the contract suite) hand one in explicitly.
    this.authToken = authToken ?? null;
    // Resolved per request, not captured once: a frontend often has no token
    // at the moment it constructs the adapter (it arrives via URL param or
    // sessionStorage during bootstrap), and a stale null there silently
    // downgrades every later call to cookie auth.
    this.getAuthToken = getAuthToken ?? null;
  }

  resolveToken() {
    return this.getAuthToken ? this.getAuthToken() : this.authToken;
  }

  async init(ctx) {
    await super.init(ctx);
    this.cmsBaseUrl = ctx.cmsBaseUrl ?? this.cmsBaseUrl;
  }

  url(path) {
    // Volto's formatUrl passes an already-absolute URL through untouched, so
    // callers can hand us one. Prefixing it would produce nonsense.
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    return `${this.cmsBaseUrl}${API_PREFIX}${path}`;
  }

  /**
   * Reads are served from the current scope; anything else clears it.
   *
   * Sits in front of requestJson so EVERY caller benefits, including the ones
   * that repeat a read indirectly — resolvePath and the ancestor walk repeat
   * the same lookups across different intents, and that is where most of the
   * duplication measured in the journey came from.
   */
  async fetchJson(path, options = {}) {
    const method = options.method ?? 'GET';
    if (method !== 'GET') {
      this.invalidateReads();
      return this.requestJson(path, options);
    }
    return this.cachedRead(`GET ${path}`, () => this.requestJson(path, options));
  }

  async requestJson(path, { method = 'GET', body, headers = {} } = {}) {
    const token = this.resolveToken();
    const auth = token ? { Authorization: `Bearer ${token}` } : {};
    const res = await fetch(this.url(path), {
      method,
      // With an explicit bearer token we must NOT send credentials: a
      // wildcard Access-Control-Allow-Origin (which is what a dev CMS
      // typically sends) makes the browser reject a credentialled
      // cross-origin request outright. Cookie auth is the same-origin case.
      credentials: token ? 'omit' : 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...auth,
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (res.status === 401) {
      throw new AdapterError('Unauthorized', {
        code: 'UNAUTHORIZED',
        status: 401,
      });
    }
    if (res.status === 404) {
      throw new AdapterError(`Not found: ${path}`, {
        code: 'NOT_FOUND',
        status: 404,
      });
    }
    if (!res.ok) {
      throw new AdapterError(`Plone returned ${res.status} for ${path}`, {
        code: 'SERVER_ERROR',
        status: res.status,
      });
    }
    if (res.status === 204) return null;
    const text = await res.text();
    return text.length === 0 ? null : JSON.parse(text);
  }

  /**
   * Plone's @id is an absolute URL; the canonical shape wants a CMS-relative
   * path so nothing downstream has to know where the CMS lives.
   */
  toPath(atId) {
    const u = new URL(atId);
    const p = u.pathname.replace(API_PREFIX, '');
    return p === '' ? '/' : p;
  }

  toDocument(raw) {
    const {
      '@id': atId,
      '@type': type,
      UID,
      title,
      language,
      blocks,
      blocks_layout: blocksLayout,
      review_state: reviewState,
      ...fields
    } = raw;

    return {
      id: String(UID ?? atId),
      path: this.toPath(atId),
      type,
      title,
      language: language?.token,
      blocks: blocks ?? {},
      blocksLayout: blocksLayout ?? { items: [] },
      fields,
      state: STATE_MAP[reviewState] ?? reviewState,
      _adapter: { raw },
    };
  }

  /**
   * Plone has no "current user" endpoint: the session's user id lives in the
   * JWT's `sub` claim and is then looked up via /@users/{id}. This mirrors
   * what Volto itself does.
   */
  subjectFromToken() {
    const token = this.resolveToken();
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(decodeBase64Url(parts[1])).sub ?? null;
  }

  toUser(raw) {
    return {
      id: String(raw.id),
      username: raw.username ?? raw.id,
      fullname: raw.fullname,
      email: raw.email,
      roles: raw.roles ?? [],
    };
  }

  async whoami() {
    return this.dispatch('auth.whoami', {});
  }

  /**
   * Search results and navigation items are "brains" — partial documents with
   * no blocks. Normalise them to the same canonical Document shape so callers
   * never branch on where a result came from.
   */
  toBrief(raw) {
    return {
      id: String(raw.UID ?? raw['@id']),
      path: this.toPath(raw['@id']),
      type: raw['@type'],
      title: raw.title,
      blocks: {},
      blocksLayout: { items: [] },
      fields: raw,
      state: STATE_MAP[raw.review_state] ?? raw.review_state,
      _adapter: { raw },
    };
  }

  /**
   * The transition body Plone accepts, from its own recorded example —
   * tests-adapters/fixtures/plone/workflow_post_with_body.req. Nothing here is
   * invented: comment, effective, expires and include_children are what
   * POST @workflow/<id> already takes.
   */
  transitionSchema({ visibility = false } = {}) {
    // Curated per transition, not "everything the endpoint takes". The moment
    // something becomes visible is the moment its address and whether it is
    // listed actually matter — WordPress has always asked for both here, and
    // Plone burying short name in a metadata accordion is the reason nobody
    // sets it until the URL is already wrong. Retracting asks for none of it.
    const visibilityFields = visibility ? ['id', 'exclude_from_nav'] : [];
    return {
      fieldsets: [
        {
          id: 'default',
          title: 'Default',
          fields: [
            ...visibilityFields,
            'comment',
            'effective',
            'expires',
            'include_children',
          ],
        },
      ],
      properties: {
        ...(visibility
          ? {
              id: {
                title: 'Short name',
                description:
                  'The last part of this item\u2019s address. Changing it after people have linked here breaks those links.',
                type: 'string',
              },
              exclude_from_nav: {
                title: 'Exclude from navigation',
                description:
                  'Still readable by anyone who has the address \u2014 just not listed in menus.',
                type: 'boolean',
              },
            }
          : {}),
        comment: {
          title: 'Comment',
          description: 'Recorded in this item\u2019s workflow history.',
          type: 'string',
          widget: 'textarea',
        },
        effective: {
          title: 'Publishing date',
          description:
            'Before this date the item stays invisible even once published \u2014 the state alone is not the whole story.',
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
      },
      required: [],
    };
  }

  /**
   * Sharing, transposed.
   *
   * Plone's @sharing is entry-major — `entries[].roles` is a {Role: bool} map,
   * the grid. Role-major is what the dialog needs, so one field per role with
   * the principals holding it, and back again on write. See
   * tests-adapters/fixtures/plone/sharing_folder_get.resp.
   */
  async updateForm(path) {
    const sharing = await this.fetchJson(`${path}/@sharing`);
    const roles = sharing.available_roles ?? [];

    const properties = {};
    const data = {};
    for (const role of roles) {
      properties[role.id] = {
        // Plone already writes the phrase: "Can view", "Can edit", "Can add".
        title: role.title,
        description: `The ${role.id} role, local to this item. Exactly what it permits varies by state, and Plone does not expose that mapping over REST.`,
        type: 'array',
        vocabulary: 'principals',
      };
      data[role.id] = (sharing.entries ?? [])
        .filter((e) => e.roles?.[role.id])
        .map((e) => e.id);
    }

    // Not only permissions. This is the entry for the state the document is
    // already in, so it carries what matters there — an already-published
    // document has no publish transition, and without this there would be
    // nowhere to change its address or take it out of the menu.
    const doc = await this.fetchJson(path);
    properties.id = {
      title: 'Short name',
      description:
        'The last part of this item\u2019s address. Changing it after people have linked here breaks those links.',
      type: 'string',
    };
    data.id = doc?.id ?? path.split('/').pop();
    properties.exclude_from_nav = {
      title: 'Exclude from navigation',
      description:
        'Still readable by anyone who has the address \u2014 just not listed in menus.',
      type: 'boolean',
    };
    data.exclude_from_nav = Boolean(doc?.exclude_from_nav);

    properties.inherit = {
      title: 'Inherit permissions from parent',
      description:
        'On, people given access further up the tree also have it here. How many that is, Plone cannot say \u2014 @sharing reports inherited roles only for principals you have already named.',
      type: 'boolean',
    };
    data.inherit = sharing.inherit ?? true;

    return {
      schema: {
        fieldsets: [
          {
            id: 'default',
            title: 'Default',
            fields: [...roles.map((r) => r.id), 'id', 'exclude_from_nav', 'inherit'],
          },
        ],
        properties,
        required: [],
      },
      data,
    };
  }

  async transitionForms(path) {
    const wf = await this.fetchJson(`${path}/@workflow`);
    const ids = (wf.transitions ?? []).map((t) => t['@id'].split('/').pop());

    // Only fetched when something here actually asks for the document's own
    // fields, so the common case stays one request.
    const doc = ids.includes('publish')
      ? await this.fetchJson(path)
      : null;

    const forms = {};
    for (const t of wf.transitions ?? []) {
      const id = t['@id'].split('/').pop();
      const visibility = id === 'publish';
      forms[id] = {
        schema: this.transitionSchema({ visibility }),
        data: visibility
          ? {
              id: doc?.id ?? path.split('/').pop(),
              exclude_from_nav: Boolean(doc?.exclude_from_nav),
            }
          : {},
      };
    }
    // Working copies take no body at all (neither PATCH nor DELETE @workingcopy
    // does), so these are a sentence and a confirm rather than a form. They are
    // listed by state.get only where the CMS said they are possible; an empty
    // schema here is what makes the dialog render as prose.
    const empty = { fieldsets: [], properties: {}, required: [] };
    for (const id of ['checkout', 'checkin', 'cancel-checkout']) {
      forms[id] = { schema: empty, data: {} };
    }

    // Changing who can reach this without moving it. A transition in the menu
    // like any other; its target state is the one it is already in.
    //
    // Gated on the same flag the UI gates the control on. Offering the form
    // while `effective.canShare` says no is a menu entry that argues with
    // itself, and the user finds out which half was right by clicking it.
    const { effective } = await this.dispatch('state.get', { path });
    if (effective.canShare) {
      forms.update = await this.updateForm(path);
    }
    return forms;
  }

  async dispatch(intent, args) {
    return this.dispatchWithInvalidation(intent, args, () =>
      this.withAuthRetry(() => this.dispatchOnce(intent, args)),
    );
  }

  async dispatchOnce(intent, args) {
    switch (intent) {
      case 'http': {
        const { op, path, data, headers } = args;
        const method = op === 'del' ? 'DELETE' : op.toUpperCase();
        const request = () => this.requestJson(path, { method, body: data, headers });
        // Past the read cache: these are the admin's own requests, and Volto
        // keeps its own store — when it asks again it means it (the template
        // re-fetch on unlock exists to replace a stale copy). Writes are
        // invalidated around by dispatchWithInvalidation already.
        return method === 'GET' ? this.readWithRetry(request) : request();
      }

      case 'content.get': {
        // Plone can expand natively, but only over its own @components set.
        // Emulating uniformly keeps one code path and one tested behaviour;
        // the native fast path is a later optimisation, not a correctness fix.
        const doc = this.toDocument(await this.fetchJson(args.path));
        return this.withContext(doc, args.path, args.expand);
      }

      case 'content.update': {
        const body = { ...args.data };
        if (body.blocksLayout) {
          body.blocks_layout = body.blocksLayout;
          delete body.blocksLayout;
        }
        await this.fetchJson(args.path, { method: 'PATCH', body });
        return null;
      }

      case 'content.create': {
        const raw = await this.fetchJson(args.parentPath, {
          method: 'POST',
          body: {
            '@type': args.data.type,
            title: args.data.title,
            ...args.data.fields,
          },
        });
        return this.toDocument(raw);
      }

      case 'content.delete':
        await this.fetchJson(args.path, { method: 'DELETE' });
        return null;

      case 'auth.logout':
        return this.logout();

      case 'auth.whoami': {
        const sub = this.subjectFromToken();
        if (!sub) {
          throw new AdapterError('No session token to identify the user', {
            code: 'UNAUTHORIZED',
            status: 401,
          });
        }
        return this.toUser(
          await this.fetchJson(`/@users/${encodeURIComponent(sub)}`),
        );
      }

      case 'asset.upload': {
        const raw = await this.fetchJson(args.parentPath, {
          method: 'POST',
          body: {
            '@type': 'Image',
            title: args.title ?? args.filename,
            image: {
              data: args.data,
              encoding: 'base64',
              'content-type': args.contentType,
              filename: args.filename,
            },
          },
        });
        // An uploaded asset carries the ABSOLUTE url it can be fetched at.
        //
        // Everything else in this contract travels as a path, because the
        // admin resolves paths itself. An image cannot: it ends up in an
        // <img src>, and a CMS-relative path there resolves against whichever
        // origin happens to render it — the admin's, which then 404s. Same
        // rule asset.imageUrl states; the widget reads this one straight after
        // the upload, before anything asks for a scale.
        const doc = this.toDocument(raw);
        return {
          ...doc,
          fields: {
            ...doc.fields,
            url: raw.image?.download ?? raw['@id'],
            filename: raw.image?.filename ?? args.filename,
          },
        };
      }

      case 'asset.imageUrl': {
        // Scale URLs are published by the CMS on the document itself; deriving
        // them by string-building would bake in Plone's @@images convention
        // and silently break the moment a scale is renamed.
        const doc = await this.fetchJson(args.path);
        const field = doc[args.field];
        if (!field) {
          throw new AdapterError(
            `No field '${args.field}' on ${args.path}`,
            { code: 'NOT_FOUND', status: 404 },
          );
        }
        const scale = field.scales?.[args.scale];
        if (!scale) {
          throw new AdapterError(
            `No scale '${args.scale}' for ${args.path}/${args.field}`,
            { code: 'NOT_FOUND', status: 404 },
          );
        }
        return scale.download;
      }

      case 'types.list': {
        const raw = await this.fetchJson('/@types');
        return {
          items: (raw ?? []).map((t) => ({
            // Plone identifies a type by the last segment of its @id; there is
            // no separate id field on the listing entries.
            id: decodeURIComponent(t['@id'].split('/').pop()),
            title: t.title,
            addable: t.addable === true,
          })),
        };
      }

      case 'types.getSchema': {
        const raw = await this.fetchJson(
          `/@types/${encodeURIComponent(args.type)}`,
        );
        return {
          fieldsets: raw.fieldsets ?? [],
          properties: raw.properties ?? {},
          required: raw.required ?? [],
        };
      }

      case 'vocabulary.get': {
        const params = new URLSearchParams();
        // Filter and batch server-side. Pulling the whole vocabulary back and
        // narrowing it here would work on a 3-term list and fall over on a
        // real taxonomy.
        if (args.title) params.set('title', args.title);
        if (args.limit) params.set('b_size', String(args.limit));
        const qs = params.toString();
        const raw = await this.fetchJson(
          `/@vocabularies/${encodeURIComponent(args.name)}${qs ? `?${qs}` : ''}`,
        );
        return {
          items: (raw.items ?? []).map((i) => ({
            token: i.token,
            title: i.title,
          })),
          total: raw.items_total ?? (raw.items ?? []).length,
        };
      }

      case 'content.move': {
        // plone.restapi posts to the TARGET container with the source in the
        // body; the object keeps its UID, which is what makes every stored
        // link to it survive the move.
        if (
          args.targetParentPath === args.path ||
          args.targetParentPath.startsWith(`${args.path}/`)
        ) {
          throw new AdapterError('Cannot move a document inside itself', {
            code: 'INVALID_MOVE',
            status: 400,
          });
        }
        const result = await this.fetchJson(`${args.targetParentPath}/@move`, {
          method: 'POST',
          body: { source: args.path },
        });
        const target = Array.isArray(result) ? result[0]?.target : null;
        const id = args.path.split('/').filter(Boolean).pop();
        const destPath =
          target ??
          `${args.targetParentPath === '/' ? '' : args.targetParentPath}/${id}`;
        return this.dispatchOnce('content.get', { path: destPath });
      }

      case 'content.order': {
        const segments = args.path.split('/').filter(Boolean);
        const objId = segments.pop();
        const parentPath = `/${segments.join('/')}`;
        await this.fetchJson(`${parentPath === '/' ? '' : parentPath}/@order`, {
          method: 'POST',
          body: {
            obj_id: objId,
            delta: args.targetIndex === 0 ? 'top' : 'bottom',
          },
        });
        return null;
      }

      // Plone's own @site, in canonical terms. It is the one CMS here that
      // already answers this question in this shape, which is why the admin
      // used to read it directly — and why nothing noticed the read had no
      // route once the admin stopped talking to a CMS itself.
      case 'site.get': {
        const site = await this.fetchJson('/@site');
        const defaultLanguage = site?.['plone.default_language'] ?? 'en';
        return {
          defaultLanguage,
          languages: site?.['plone.available_languages']?.length
            ? site['plone.available_languages']
            : [defaultLanguage],
          ...(site?.['plone.site_title']
            ? { title: site['plone.site_title'] }
            : {}),
          features: {
            multilingual: Boolean(site?.features?.multilingual),
          },
        };
      }

      // plone.app.multilingual's own endpoints, in canonical terms.
      case 'translations.get': {
        const raw = await this.fetchJson(`${args.path}/@translations`);
        return {
          items: (raw?.items ?? []).map((item) => ({
            language: item.language,
            path: this.toPath(item['@id']),
            ...(item.title ? { title: item.title } : {}),
          })),
        };
      }

      case 'translations.link': {
        // Plone takes the document to bring into the group as `id`, and it
        // accepts a path.
        await this.requestJson(`${args.path}/@translations`, {
          method: 'POST',
          body: { id: args.target },
        });
        return {};
      }

      case 'translations.unlink': {
        // A language, not a path: the group holds one item per language.
        await this.requestJson(`${args.path}/@translations`, {
          method: 'DELETE',
          body: { language: args.language },
        });
        return {};
      }

      case 'translations.locate': {
        const raw = await this.fetchJson(
          `${args.path}/@translation-locator?target_language=${encodeURIComponent(
            args.language,
          )}`,
        );
        return { path: this.toPath(raw?.['@id']) };
      }

      case 'querystring.getIndexes': {
        const raw = await this.fetchJson('/@querystring');
        const indexes = {};
        for (const [name, index] of Object.entries(raw.indexes ?? {})) {
          indexes[name] = {
            title: index.title,
            description: index.description,
            group: index.group,
            enabled: index.enabled !== false,
            sortable: index.sortable === true,
            operations: (index.operations ?? []).map(toCanonicalOperation),
            values: index.values,
          };
        }
        return { indexes };
      }

      case 'querystringSearch': {
        const raw = await this.fetchJson('/@querystring-search', {
          method: 'POST',
          body: {
            query: (args.query ?? []).map((c) => ({
              i: c.i,
              o: toPloneOperation(c.o),
              v: c.v,
            })),
            ...(args.sortOn ? { sort_on: args.sortOn } : {}),
            ...(args.sortOrder ? { sort_order: args.sortOrder } : {}),
            ...(args.limit ? { b_size: args.limit } : {}),
          },
        });
        return {
          items: (raw.items ?? []).map((i) => this.toBrief(i)),
          total: raw.items_total ?? (raw.items ?? []).length,
          batching: raw.batching,
        };
      }

      case 'reference.resolve': {
        // Plone's own answer to this is resolveuid: store the UID, look up the
        // current path at render time. The catalog is the index that makes it
        // cheap.
        const raw = await this.fetchJson(
          `/@search?UID=${encodeURIComponent(args.id)}`,
        );
        const hit = (raw.items ?? [])[0];
        if (!hit) {
          throw new AdapterError(`No document with id ${args.id}`, {
            code: 'NOT_FOUND',
            status: 404,
          });
        }
        return {
          id: args.id,
          path: this.toPath(hit['@id']),
          url: hit['@id'],
          title: hit.title,
        };
      }

      case 'search': {
        const params = new URLSearchParams();
        if (args.query) params.set('SearchableText', args.query);
        if (args.path) params.set('path.query', args.path);
        if (args.limit) params.set('b_size', String(args.limit));
        const raw = await this.fetchJson(
          `${args.path ?? ''}/@search?${params.toString()}`,
        );
        return {
          items: (raw.items ?? []).map((i) => this.toBrief(i)),
          total: raw.items_total ?? 0,
          batching: raw.batching,
        };
      }

      case 'tree.list': {
        // plone.restapi's @search is context-scoped: searching on /news
        // restricts to that subtree, and path.depth=1 narrows it to direct
        // children. Passing path.query on an unscoped /@search is NOT
        // equivalent — the context is what bounds the subtree.
        const base = args.parent === '/' ? '' : args.parent;
        const raw = await this.fetchJson(`${base}/@search?path.depth=1`);
        return {
          items: (raw.items ?? []).map((i) => this.toBrief(i)),
          total: raw.items_total ?? 0,
        };
      }

      case 'navigation.setExcluded':
        // A field on the document, unlike Drupal where it lives on the menu
        // link. Same claim either way: still readable, just not listed.
        await this.fetchJson(args.path, {
          method: 'PATCH',
          body: { exclude_from_nav: Boolean(args.excluded) },
        });
        return null;

      case 'state.get': {
        const [wf, actions] = await Promise.all([
          this.fetchJson(`${args.path}/@workflow`),
          this.fetchJson(`${args.path}/@actions`),
        ]);

        // Anonymous gets history/transitions with no `state` key at all (see
        // live_workflow_anon.json). The admin is always authenticated, so an
        // absent state means the session is not what we think it is — say so
        // rather than invent a review state.
        if (!wf.state) {
          throw new AdapterError('plone: @workflow returned no state', {
            code: 'UNAUTHORIZED',
            status: 401,
          });
        }

        // Categories matter: plone.restapi's own recorded example
        // (actions_get.resp) puts delete/cut/copy/rename in object_buttons and
        // view/edit/folderContents/history/local_roles in object. Reading
        // `delete` from `object` found nothing on a real Plone — it only
        // worked here because our mock had put it in the wrong category.
        const object = actions.object ?? [];
        const buttons = actions.object_buttons ?? [];
        const has = (id) => object.some((a) => a.id === id);
        const hasButton = (id) => buttons.some((a) => a.id === id);
        const transitions = (wf.transitions ?? []).map((t) => ({
          id: t['@id'].split('/').pop(),
          label: t.title,
          // Deliberately no targetState: @workflow does not name one.
        }));

        // Checking out a copy IS a state change — the document gains a draft
        // that only its author sees, while the published version stays put —
        // so it belongs in the same list rather than on its own screen.
        //
        // Whether it is possible is already in the actions we just fetched,
        // which is where Volto's own buttons read it from. No extra request.
        if (hasButton('iterate_checkout')) {
          transitions.push({
            id: 'checkout',
            label: 'Work on a draft copy',
            relocates: true,
          });
        }
        if (hasButton('iterate_checkin')) {
          transitions.push({
            id: 'checkin',
            label: 'Publish the draft',
            relocates: true,
          });
          transitions.push({
            id: 'cancel-checkout',
            label: 'Discard the draft',
            relocates: true,
          });
        }

        return {
          state: { name: wf.state.id, label: wf.state.title },
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

      case 'state.getForms':
        return this.transitionForms(args.path);

      case 'state.transition': {
        const forms = await this.transitionForms(args.path);
        this.assertDeclared(args.data, forms[args.id]?.schema, args.id);
        const d = args.data ?? {};

        if (args.id === 'update') {
          // Transpose back: role-major fields become Plone's entry-major
          // {Role: bool} maps. Principals not named in any field keep whatever
          // they had — this posts only what the dialog actually touched.
          const sharing = await this.fetchJson(`${args.path}/@sharing`);
          const roles = (sharing.available_roles ?? []).map((r) => r.id);
          const known = new Map(
            (sharing.entries ?? []).map((e) => [e.id, e.type ?? 'user']),
          );
          const named = new Set(roles.flatMap((r) => d[r] ?? []));
          for (const e of sharing.entries ?? []) named.add(e.id);

          const entries = [...named].map((id) => ({
            id,
            type: known.get(id) ?? 'user',
            roles: Object.fromEntries(
              roles.map((r) => [r, (d[r] ?? []).includes(id)]),
            ),
          }));

          await this.fetchJson(`${args.path}/@sharing`, {
            method: 'POST',
            body: { entries, inherit: d.inherit ?? sharing.inherit },
          });

          // The rest of the form is document metadata, in a second write
          // because @sharing takes none of it.
          const fields = {};
          if (d.exclude_from_nav !== undefined) {
            fields.exclude_from_nav = d.exclude_from_nav;
          }
          const was = args.path.split('/').pop();
          const moved = d.id !== undefined && d.id !== was;
          if (moved) fields.id = d.id;
          if (Object.keys(fields).length) {
            await this.fetchJson(args.path, { method: 'PATCH', body: fields });
          }
          if (moved) {
            const parent = args.path.slice(0, args.path.lastIndexOf('/'));
            return { redirect: `${parent}/${d.id}` };
          }
          return null;
        }

        if (args.id === 'checkout') {
          const copy = await this.fetchJson(`${args.path}/@workingcopy`, {
            method: 'POST',
          });
          // The copy lives at a DIFFERENT path, and the point of checking one
          // out is to work on it — so the transition says where the session
          // should go. Leaving the user on the original would show them the
          // published version while their draft sat elsewhere unedited.
          return { redirect: this.toPath(copy['@id']) };
        }
        if (args.id === 'checkin' || args.id === 'cancel-checkout') {
          const wc = await this.fetchJson(`${args.path}/@workingcopy`, {
            method: args.id === 'checkin' ? 'PATCH' : 'DELETE',
          });
          // Applying or discarding a draft ends the draft, so the session goes
          // back to the document it was a copy of.
          const baseline = wc?.working_copy_of?.['@id'];
          return baseline ? { redirect: this.toPath(baseline) } : null;
        }

        const body = {};
        for (const field of ['comment', 'effective', 'expires', 'include_children']) {
          if (d[field] !== undefined) body[field] = d[field];
        }
        await this.fetchJson(`${args.path}/@workflow/${args.id}`, {
          method: 'POST',
          body,
        });

        // The document's own fields go in a second write, because @workflow
        // does not take them. Transition first so this one addresses a path
        // that still exists: renaming changes it.
        const docFields = {};
        for (const field of ['exclude_from_nav']) {
          if (d[field] !== undefined) docFields[field] = d[field];
        }
        const current = args.path.split('/').pop();
        const renamed = d.id !== undefined && d.id !== current;
        if (renamed) docFields.id = d.id;

        if (Object.keys(docFields).length) {
          await this.fetchJson(args.path, { method: 'PATCH', body: docFields });
        }

        // A rename moves the document, so the session has to follow it or the
        // editor is left looking at an address that no longer resolves.
        if (renamed) {
          const parent = args.path.slice(0, args.path.lastIndexOf('/'));
          return { redirect: `${parent}/${d.id}` };
        }
        return null;
      }

      case 'breadcrumbs.get': {
        const raw = await this.fetchJson(`${args.path}/@breadcrumbs`);
        // Canonical breadcrumbs are the ancestors BELOW the site root. Plone
        // has a root document to point at; WordPress and Drupal do not, so a
        // root entry could not mean the same thing across adapters.
        const items = (raw.items ?? [])
          .map((i) => this.toBrief(i))
          .filter((i) => i.path !== '/');
        return { items };
      }

      case 'navigation.get': {
        const base = args.path === '/' ? '' : (args.path ?? '');
        const raw = await this.fetchJson(`${base}/@navigation`);
        return { items: (raw.items ?? []).map((i) => this.toBrief(i)) };
      }

      default:
        return super.dispatch(intent, args);
    }
  }
}

export default PloneAdapter;
