import {
  BaseAdapter,
  AdapterError,
  resolveOrderPosition,
} from '@volto-hydra/hydra-adapters-core';
import { flattenPayload, aliasOf } from './normalize.js';

/**
 * Hydra adapter for Drupal via JSON:API.
 *
 * Two things make Drupal unlike Plone and WordPress:
 *
 *  - Nodes are FLAT. There is no parent pointer and no tree. Hierarchy comes
 *    from menu links, which is how Drupal sites actually express structure.
 *    Content with no menu link therefore has no place in the tree at all, so
 *    it surfaces in a virtual folder rather than being invisible.
 *  - A path alias is the document's URL and carries no structure. Moving a
 *    document re-parents its MENU LINK; it must NOT rewrite a published URL.
 */

/** Virtual folder listing content that has no menu link yet. */
export const UNFILED_PATH = '/_unfiled';

/**
 * Assets are Media entities, not bare files.
 *
 * A file entity has a uuid and a URI and nothing else — no name, no published
 * state, no listing. Media is Drupal's equivalent of a WordPress attachment or
 * a Plone Image object, and it is what makes an asset something an editor can
 * find, rename and relocate. Core has shipped Media since 8.4 and the standard
 * profile enables it, so requiring it is reasonable; sites without it are told
 * so at init rather than silently given a degraded record.
 */
const MEDIA_BUNDLE = 'image';
const MEDIA_FILE_FIELD = 'field_media_image';

const STATE_MAP = { true: 'published', false: 'draft' };

/**
 * Order documents the admin's way, on the client.
 *
 * Used where the answer came from the MENU rather than a node query — the
 * menu's own order is menu weight, the sibling order an editor arranges by
 * hand, which is the right answer only until a sort is asked for. JSON:API
 * cannot be asked to sort a set it did not select, and the documents are
 * already in hand, so ordering them here costs nothing. Callers must apply any
 * limit AFTER this, or a first page is chosen by one order and shown in
 * another.
 */
function orderDocuments(items, sortOn, sortOrder) {
  if (!sortOn) return items;
  const field = sortFieldFor(sortOn);
  const keyOf = (doc) =>
    field === 'title'
      ? (doc.title ?? '')
      : (doc._adapter?.raw?.attributes?.[field] ?? '');
  const descending = String(sortOrder ?? '').startsWith('desc');
  return [...items].sort((a, b) => {
    const x = keyOf(a);
    const y = keyOf(b);
    // Numbers compare as numbers: nid 10 does not sort before nid 2.
    const order =
      typeof x === 'number' && typeof y === 'number'
        ? x - y
        : String(x) < String(y)
          ? -1
          : String(x) > String(y)
            ? 1
            : 0;
    return descending ? -order : order;
  });
}

export class DrupalAdapter extends BaseAdapter {
  /**
   * `translations` says how THIS Drupal holds them, because Drupal does both
   * and its own API cannot tell you which the editors use:
   *
   *   'variants' — Content Translation: one node carrying a version of each
   *                field per langcode. The default, and what `default_langcode`
   *                on a node means.
   *   'grouped'  — separate nodes per language joined by a reference field,
   *                which some sites prefer because each language then has its
   *                own revisions, workflow and URL history.
   *
   * Whoever builds the adapter knows which; the CMS's name does not settle it,
   * and guessing wrong offers an editor a lossless "link" that would actually
   * merge one node into another and delete it.
   */
  constructor({
    cmsBaseUrl,
    credentials,
    bundle = 'page',
    translations = 'variants',
  } = {}) {
    super({
      name: 'drupal',
      capabilities: [
        'content',
        // JSON:API filter groups search title OR stored block content with
        // CONTAINS, so core Drupal answers this without search_api.
        'search-fulltext',
        'search-filter',
        'vocabulary',
        'schema',
        'asset',
        'state',
        // A Drupal menu link carries an enabled flag and a title of its own,
        // so it can keep a document out of the menu and label it differently
        // there. Neither is a property of the node.
        'navigation-exclusion',
        'navigation-title',
      ],
    });
    this.cmsBaseUrl = cmsBaseUrl;
    this.credentials = credentials ?? null;
    this.bundle = bundle;
    this.translationsMode = translations;
    this.csrfToken = null;
  }

  async init(ctx) {
    await super.init(ctx);
    this.cmsBaseUrl = ctx.cmsBaseUrl ?? this.cmsBaseUrl;
    if (!this.csrfToken) this.csrfToken = await this.fetchCsrfToken();
    await this.assertMediaAvailable();
  }

  /**
   * Refuse to run against a site with no Media, rather than quietly degrading.
   *
   * Without it an upload can still create a file entity, but the editor gets an
   * asset with no name, no state and no listing — a record it cannot browse or
   * relocate. Failing here names the missing setup; failing later looks like a
   * broken object browser.
   */
  async assertMediaAvailable() {
    const res = await fetch(
      `${this.cmsBaseUrl}/jsonapi/media_type/media_type`,
      { credentials: this.credentials ? 'omit' : 'include', headers: this.authHeaders() },
    );
    // An auth failure is NOT a missing module. Conflating them would send an
    // integrator to install Media on a site that already has it, so leave 401
    // and 403 to the normal auth path.
    if (res.status === 401 || res.status === 403) return;
    if (!res.ok) {
      throw new AdapterError(
        'Drupal Media is required but /jsonapi/media_type is unavailable. ' +
          'Enable the Media and JSON:API modules.',
        { code: 'SETUP_REQUIRED', status: res.status },
      );
    }
    const bundles = (flattenPayload(await res.json()) ?? []).map(
      (t) => t.attributes?.drupal_internal__id,
    );
    if (!bundles.includes(MEDIA_BUNDLE)) {
      throw new AdapterError(
        `Drupal Media bundle '${MEDIA_BUNDLE}' not found (have: ${bundles.join(', ') || 'none'}). ` +
          'Hydra stores assets as media entities so editors can browse and rename them.',
        { code: 'SETUP_REQUIRED' },
      );
    }
  }

  /** Drupal requires a CSRF token for every write. */
  async fetchCsrfToken() {
    const res = await fetch(`${this.cmsBaseUrl}/session/token`, {
      credentials: this.credentials ? 'omit' : 'include',
      headers: this.authHeaders(),
    });
    if (!res.ok) return null;
    return (await res.text()).trim();
  }

  authHeaders() {
    if (!this.credentials) return {};
    const { username, password } = this.credentials;
    return { Authorization: `Basic ${btoa(`${username}:${password}`)}` };
  }

  /** See the Plone adapter: reads are scope-cached, writes clear the scope. */
  async fetchJson(route, options = {}) {
    const method = options.method ?? 'GET';
    if (method !== 'GET') {
      this.invalidateReads();
      return this.requestJson(route, options);
    }
    return this.cachedRead(
      `GET ${this.scopeKey(route, options.params)}`,
      () => this.requestJson(route, options),
    );
  }

  async requestJson(route, { method = 'GET', body, params } = {}) {
    const qs = params ? `?${params}` : '';
    const headers = {
      Accept: 'application/vnd.api+json',
      ...this.authHeaders(),
    };
    if (body !== undefined) headers['Content-Type'] = 'application/vnd.api+json';
    if (method !== 'GET' && this.csrfToken) headers['X-CSRF-Token'] = this.csrfToken;

    const res = await fetch(`${this.cmsBaseUrl}${route}${qs}`, {
      // With explicit credentials we must NOT also send cookies: a wildcard
      // Access-Control-Allow-Origin — what a dev CMS typically returns —
      // makes the browser reject a credentialled cross-origin request
      // outright, surfacing only as "Failed to fetch". Cookie auth is the
      // same-origin case. The Plone adapter had this exact bug.
      credentials: this.credentials ? 'omit' : 'include',
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (res.status === 401 || res.status === 403) {
      throw new AdapterError('Unauthorized', { code: 'UNAUTHORIZED', status: 401 });
    }
    if (res.status === 404) {
      throw new AdapterError(`Not found: ${route}`, { code: 'NOT_FOUND', status: 404 });
    }
    if (!res.ok) {
      throw new AdapterError(`Drupal returned ${res.status} for ${route}`, {
        code: 'SERVER_ERROR',
        status: res.status,
      });
    }
    if (res.status === 204) return null;
    const text = await res.text();
    return text.length === 0 ? null : JSON.parse(text);
  }

  // --- lookups -----------------------------------------------------------

  async nodeByAlias(alias) {
    const payload = await this.fetchJson(`/jsonapi/node/${this.bundle}`, {
      params: `filter[path.alias]=${encodeURIComponent(alias)}`,
    });
    const flat = flattenPayload(payload) ?? [];
    if (flat.length === 0) {
      throw new AdapterError(`Not found: ${alias}`, { code: 'NOT_FOUND', status: 404 });
    }
    return flat[0];
  }

  async nodeByUuid(id) {
    const payload = await this.fetchJson(`/jsonapi/node/${this.bundle}/${id}`);
    return flattenPayload(payload);
  }

  async allMenuLinks() {
    const payload = await this.fetchJson(
      '/jsonapi/menu_link_content/menu_link_content',
    );
    return flattenPayload(payload) ?? [];
  }

  toDocument(flat) {
    const blocksRaw = flat.attributes.field_hydra_blocks;
    const parsed = blocksRaw ? JSON.parse(blocksRaw) : {};
    return {
      id: flat.id,
      path: aliasOf(flat),
      type: flat.attributes.drupal_internal__type ?? this.bundle,
      title: flat.attributes.title,
      blocks: parsed.blocks ?? {},
      blocksLayout: parsed.blocksLayout ?? { items: [] },
      fields: { nid: flat.attributes.drupal_internal__nid },
      state: STATE_MAP[String(flat.attributes.status)] ?? 'draft',
      _adapter: { raw: flat },
    };
  }

  async whoami() {
    return this.dispatch('auth.whoami', {});
  }

  /**
   * Core Drupal, no Content Moderation: publishing is a status flip, so the
   * only thing worth asking for is the revision log message every node carries
   * anyway. With Content Moderation enabled this is where the workflow's own
   * transitions and their permissions would appear.
   */
  /**
   * Drupal's alias is what Plone calls the short name — except it is the WHOLE
   * address, not a segment, because nothing here comes from a hierarchy. Same
   * argument for putting it here either way: the moment a document becomes
   * visible is the moment its address matters, and a field nobody sees until
   * afterwards gets set once the URL is already wrong.
   */
  aliasField() {
    return {
      title: 'Address',
      description:
        'The whole path, and it carries no structure — moving this document in the menu will not change it. Changing it after people have linked here breaks those links.',
      type: 'string',
    };
  }

  revisionLogField() {
    return {
      title: 'Revision log message',
      description:
        'Recorded against this revision. Visible to anyone who can see the revision history.',
      type: 'string',
      widget: 'textarea',
    };
  }

  async transitionForms(path) {
    const node = await this.nodeByAlias(path);
    const published = node.attributes.status === true;
    const id = published ? 'unpublish' : 'publish';

    const withAddress = {
      schema: {
        fieldsets: [
          {
            id: 'default',
            title: 'Default',
            fields: ['path_alias', 'revision_log'],
          },
        ],
        properties: {
          path_alias: this.aliasField(),
          revision_log: this.revisionLogField(),
        },
        required: [],
      },
      data: { path_alias: path, revision_log: '' },
    };

    const forms = {
      // Unpublishing takes an audience away; there is nothing to configure
      // about that beyond saying why.
      [id]: published
        ? {
            schema: {
              fieldsets: [
                { id: 'default', title: 'Default', fields: ['revision_log'] },
              ],
              properties: { revision_log: this.revisionLogField() },
              required: [],
            },
            data: { revision_log: '' },
          }
        : withAddress,

      // Staying where it is, and changing what matters here. Drupal needs this
      // as much as Plone does and has nothing to do with permissions: the
      // address is editable whatever state the document is in, and an already
      // published document has no publish transition to reach it through.
      update: withAddress,
    };
    return forms;
  }

  async dispatch(intent, args) {
    return this.dispatchWithInvalidation(intent, args, () =>
      this.withAuthRetry(() => this.dispatchOnce(intent, args)),
    );
  }

  async dispatchOnce(intent, args) {
    switch (intent) {
      case 'content.get': {
        const doc = this.toDocument(await this.nodeByAlias(args.path));
        return this.withContext(doc, args.path, args.expand);
      }

      case 'content.update': {
        const node = await this.nodeByAlias(args.path);
        const attributes = {};
        if (args.data.title !== undefined) attributes.title = args.data.title;
        if (args.data.blocks !== undefined) {
          attributes.field_hydra_blocks = JSON.stringify({
            v: 1,
            blocks: args.data.blocks,
            blocksLayout: args.data.blocksLayout ?? { items: [] },
          });
        }
        await this.fetchJson(`/jsonapi/node/${this.bundle}/${node.id}`, {
          method: 'PATCH',
          body: { data: { type: `node--${this.bundle}`, id: node.id, attributes } },
        });
        return null;
      }

      case 'content.create': {
        const slug = String(args.data.title)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '');
        const parent = args.parentPath === '/' ? '' : args.parentPath;
        const alias = `${parent}/${slug}`;

        const created = flattenPayload(
          await this.fetchJson(`/jsonapi/node/${this.bundle}`, {
            method: 'POST',
            body: {
              data: {
                type: `node--${this.bundle}`,
                attributes: {
                  title: args.data.title,
                  status: false,
                  path: { alias },
                  field_hydra_blocks: JSON.stringify({
                    v: 1,
                    blocks: args.data.blocks ?? {},
                    blocksLayout: args.data.blocksLayout ?? { items: [] },
                  }),
                },
              },
            },
          }),
        );

        // Give it a place in the tree straight away, under the requested
        // parent — otherwise a newly created document would land in the
        // virtual folder, which is for content that never got filed.
        await this.linkNode(created.id, args.parentPath);
        return this.toDocument(created);
      }

      case 'content.delete': {
        const node = await this.nodeByAlias(args.path);
        await this.fetchJson(`/jsonapi/node/${this.bundle}/${node.id}`, {
          method: 'DELETE',
        });
        return null;
      }

      case 'content.move': {
        if (
          args.targetParentPath === args.path ||
          args.targetParentPath.startsWith(`${args.path}/`)
        ) {
          throw new AdapterError('Cannot move a document inside itself', {
            code: 'INVALID_MOVE',
            status: 400,
          });
        }
        const node = await this.nodeByAlias(args.path);
        await this.linkNode(node.id, args.targetParentPath);
        // The alias is deliberately untouched: in Drupal the URL is not the
        // tree position, and re-filing a document must not break its links.
        return this.toDocument(await this.nodeByUuid(node.id));
      }

      case 'content.copy': {
        if (
          args.targetParentPath === args.path ||
          args.targetParentPath.startsWith(`${args.path}/`)
        ) {
          throw new AdapterError('Cannot copy a document inside itself', {
            code: 'INVALID_MOVE',
            status: 400,
          });
        }
        // A new node, not a second reference to the same one: Drupal has no
        // duplicate operation in JSON:API, so the copy is a create carrying the
        // original's fields. Its alias is derived from the target, and the id
        // gains a suffix when the target already holds that alias — the same
        // problem Plone solves with copy_of_.
        const source = this.toDocument(await this.nodeByAlias(args.path));
        return this.dispatchOnce('content.create', {
          parentPath: args.targetParentPath,
          data: {
            type: source.type,
            title: source.title,
            blocks: source.blocks,
            blocksLayout: source.blocksLayout,
          },
        });
        // Not handled, and deliberately not faked: copying into a container that
        // already holds this alias leaves Drupal with two nodes wanting the same
        // path. Plone renames to copy_of_<id>; doing the equivalent here needs a
        // path_alias lookup this adapter does not have yet, and inventing a
        // suffix that Drupal has not accepted would report a path that does not
        // resolve.
      }

      case 'content.sort': {
        // Persistent, like every other reorder here: the children are read in
        // the order asked for and their menu weights rewritten, so a later
        // listing with no sort returns them this way.
        const children = await this.dispatchOnce('tree.list', {
          parent: args.path,
          sortOn: args.sortOn,
          sortOrder: args.sortOrder,
        });
        for (const [index, child] of children.items.entries()) {
          await this.dispatchOnce('content.order', {
            path: child.path,
            targetIndex: index,
          });
        }
        return null;
      }

      case 'content.order': {
        const node = await this.nodeByAlias(args.path);
        const links = await this.allMenuLinks();
        const link = links.find((l) => l.relationships.node?.id === node.id);
        if (!link) {
          throw new AdapterError(`${args.path} has no menu link to order`, {
            code: 'NOT_FOUND',
            status: 404,
          });
        }

        // Renumber the whole sibling set rather than assigning the target
        // index as a weight. Menu weights start life all-equal, so setting one
        // to 0 among zeroes is a tie and reorders nothing — the operation
        // would appear to succeed and do nothing at all.
        const parentId = link.relationships.parent?.id ?? null;
        const siblings = links
          .filter((l) => (l.relationships.parent?.id ?? null) === parentId)
          .sort((a, b) => (a.attributes.weight ?? 0) - (b.attributes.weight ?? 0));

        const without = siblings.filter((l) => l.id !== link.id);
        const at = resolveOrderPosition({
          targetIndex: args.targetIndex,
          delta: args.delta,
          from: siblings.findIndex((l) => l.id === link.id),
          count: without.length,
        });
        without.splice(at, 0, link);

        for (const [index, sibling] of without.entries()) {
          await this.fetchJson(
            `/jsonapi/menu_link_content/menu_link_content/${sibling.id}`,
            {
              method: 'PATCH',
              body: {
                data: {
                  type: 'menu_link_content--menu_link_content',
                  id: sibling.id,
                  attributes: { weight: index },
                },
              },
            },
          );
        }
        return null;
      }

      case 'search': {
        // Core Drupal has no search index, but JSON:API filter groups do real
        // work: an OR group over the title and the stored block content
        // matches the same documents a title-only filter would miss. No
        // search_api, no contrib module.
        //
        // Note the shorthand filter[title]=x is an EQUALS match in Drupal;
        // substring matching requires the extended condition form below.
        const q = String(args.query ?? '');
        if (!q) return { items: [], total: 0 };

        const params = new URLSearchParams();
        params.set('filter[any][group][conjunction]', 'OR');
        for (const [name, path] of [
          ['t', 'title'],
          ['b', 'field_hydra_blocks'],
        ]) {
          params.set(`filter[${name}][condition][path]`, path);
          params.set(`filter[${name}][condition][operator]`, 'CONTAINS');
          params.set(`filter[${name}][condition][value]`, q);
          params.set(`filter[${name}][condition][memberOf]`, 'any');
        }
        if (args.limit) params.set('page[limit]', String(args.limit));

        const flat = flattenPayload(
          await this.fetchJson(`/jsonapi/node/${this.bundle}?${params}`),
        );
        const items = (flat ?? []).map((n) => this.toDocument(n));
        return { items, total: items.length };
      }

      case 'tree.list': {
        const links = await this.allMenuLinks();

        // The virtual folder: everything with no menu link. Without it a
        // document created outside Hydra would exist and be unreachable.
        if (args.parent === UNFILED_PATH) {
          const filed = new Set(
            links.map((l) => l.relationships.node?.id).filter(Boolean),
          );
          const all = flattenPayload(
            await this.fetchJson(`/jsonapi/node/${this.bundle}`),
          );
          const unfiled = all.filter((n) => !filed.has(n.id));
          return { items: unfiled.map((n) => this.toDocument(n)), total: unfiled.length };
        }

        const parentLinkId =
          args.parent === '/' ? null : await this.linkIdForPath(args.parent);
        const children = links
          .filter((l) => (l.relationships.parent?.id ?? null) === parentLinkId)
          // Menu weight IS the sibling order; without sorting, content.order
          // would appear to do nothing.
          .sort((a, b) => (a.attributes.weight ?? 0) - (b.attributes.weight ?? 0));
        const items = [];
        for (const child of children) {
          const nodeId = child.relationships.node?.id;
          if (!nodeId) continue;
          items.push(this.toDocument(await this.nodeByUuid(nodeId)));
        }
        // Menu weight above is the folder's OWN order, which is what a listing
        // gets when nothing else is asked for. An explicit sort replaces it.
        return {
          items: orderDocuments(items, args.sortOn, args.sortOrder),
          total: items.length,
        };
      }

      case 'breadcrumbs.get': {
        const links = await this.allMenuLinks();
        const byId = new Map(links.map((l) => [l.id, l]));
        let current = links.find(
          async (l) => l.relationships.node?.id === (await this.nodeByAlias(args.path)).id,
        );
        const node = await this.nodeByAlias(args.path);
        current = links.find((l) => l.relationships.node?.id === node.id) ?? null;

        const trail = [];
        while (current) {
          const nodeId = current.relationships.node?.id;
          if (nodeId) trail.unshift(this.toDocument(await this.nodeByUuid(nodeId)));
          const parentId = current.relationships.parent?.id ?? null;
          current = parentId ? byId.get(parentId) : null;
        }
        return { items: trail };
      }

      case 'navigation.get': {
        const links = await this.allMenuLinks();
        const top = links
          .filter(
            (l) =>
              !l.relationships.parent?.id &&
              // A disabled link is Drupal's "keep this out of the menu". The
              // document is untouched and still readable by anyone with its
              // address — it is simply not listed, which is a different claim
              // from being unpublished.
              l.attributes?.enabled !== false,
          )
          // BY WEIGHT, which is the whole point of ordering. tree.list sorted
          // here and this did not, so reordering a page moved it in the contents
          // view and left the menu — the thing being arranged — untouched. Title
          // breaks a tie, as Drupal's own menu tree does, so equal weights are
          // at least stable rather than however JSON:API happened to answer.
          .sort(
            (a, b) =>
              (a.attributes.weight ?? 0) - (b.attributes.weight ?? 0) ||
              String(a.attributes.title ?? '').localeCompare(
                String(b.attributes.title ?? ''),
              ),
          );
        const items = [];
        for (const l of top) {
          const nodeId = l.relationships.node?.id;
          if (!nodeId) continue;
          const doc = this.toDocument(await this.nodeByUuid(nodeId));
          // The LINK's title wins where it has one. Drupal stores it
          // separately precisely so a menu can say "About" while the page says
          // "About our organisation" — Plone has no equivalent at all.
          items.push(
            l.attributes?.title ? { ...doc, title: l.attributes.title } : doc,
          );
        }
        return { items };
      }

      case 'auth.logout':
        return this.logout();

      case 'auth.whoami': {
        const payload = await this.fetchJson('/jsonapi/user/user');
        const flat = (flattenPayload(payload) ?? [])[0];
        if (!flat) {
          throw new AdapterError('No user for this session', {
            code: 'UNAUTHORIZED',
            status: 401,
          });
        }
        return {
          id: flat.id,
          username: flat.attributes.name,
          fullname: flat.attributes.display_name,
          email: flat.attributes.mail,
          roles: flat.attributes.roles ?? [],
        };
      }

      case 'types.list': {
        const flat = flattenPayload(
          await this.fetchJson('/jsonapi/node_type/node_type'),
        );
        return {
          items: (flat ?? []).map((t) => ({
            id: t.attributes.drupal_internal__type,
            title: t.attributes.name,
            addable: true,
          })),
        };
      }

      case 'types.getSchema': {
        // JSON:API exposes no canonical schema, so it is assembled from field
        // config — the static-schema fallback the spec anticipated.
        const flat =
          flattenPayload(await this.fetchJson('/jsonapi/field_config/field_config')) ??
          [];
        const fields = flat.filter((f) => f.attributes.bundle === args.type);
        if (fields.length === 0) {
          throw new AdapterError(`No such content type: ${args.type}`, {
            code: 'NOT_FOUND',
            status: 404,
          });
        }
        const properties = {};
        for (const f of fields) {
          properties[f.attributes.field_name] = {
            title: f.attributes.label,
            type: f.attributes.field_type,
          };
        }
        return {
          properties,
          fieldsets: [
            { id: 'default', title: 'Default', fields: Object.keys(properties) },
          ],
          required: fields
            .filter((f) => f.attributes.required)
            .map((f) => f.attributes.field_name),
        };
      }

      case 'vocabulary.get': {
        const params = new URLSearchParams();
        if (args.title) {
          params.set('filter[name][operator]', 'CONTAINS');
          params.set('filter[name][value]', args.title);
        }
        params.set('page[limit]', String(args.limit ?? 25));
        const payload = await this.fetchJson(
          `/jsonapi/taxonomy_term/${encodeURIComponent(args.name)}`,
          { params: params.toString() },
        );
        const flat = flattenPayload(payload) ?? [];
        return {
          items: flat.map((t) => ({ token: t.id, title: t.attributes.name })),
          total: payload?.meta?.count ?? flat.length,
        };
      }

      case 'state.get': {
        const node = await this.nodeByAlias(args.path);
        const published = node.attributes.status === true;
        return {
          state: {
            name: published ? 'published' : 'draft',
            label: published ? 'Published' : 'Draft',
          },
          transitions: published
            ? [{ id: 'unpublish', label: 'Unpublish', targetState: 'draft' }]
            : [{ id: 'publish', label: 'Publish', targetState: 'published' }],
          effective: {
            canEdit: true,
            canPublish: true,
            canDelete: true,
            canShare: false,
            canComment: false,
          },
          // Core Drupal has no per-node principal grants; that needs the
          // Group module. The sharing half of the panel hides on this.
          shareEntries: null,

          actions: [
            {
              // Your own account belongs to the CMS that holds it. Changing a
              // password or an email is not something to reimplement here, and
              // the admin has no credentials to do it with anyway. /user
              // resolves to whoever is signed in, so this needs no uid.
              id: 'preferences',
              title: 'Your profile',
              url: `${this.cmsBaseUrl}/user`,
              category: 'user',
              // Answers the admin's own Profile screen.
              panel: 'profile',
            },
          ],
        };
      }

      case 'state.getForms':
        return this.transitionForms(args.path);

      case 'state.transition': {
        const node = await this.nodeByAlias(args.path);
        const forms = await this.transitionForms(args.path);
        this.assertDeclared(args.data, forms[args.id]?.schema, args.id);

        const nextAlias = args.data?.path_alias;
        const moved = nextAlias !== undefined && nextAlias !== args.path;
        if (moved) {
          await this.fetchJson(`/jsonapi/node/${this.bundle}/${node.id}`, {
            method: 'PATCH',
            body: {
              data: {
                type: `node--${this.bundle}`,
                id: node.id,
                attributes: { path: { alias: nextAlias } },
              },
            },
          });
        }

        // `update` keeps the document where it is. Flipping status here would
        // make the one entry that promises not to change state the one that
        // silently does.
        if (args.id === 'update') {
          return moved ? { redirect: nextAlias } : null;
        }
        if (args.data?.revision_log) {
          await this.fetchJson(`/jsonapi/node/${this.bundle}/${node.id}`, {
            method: 'PATCH',
            body: {
              data: {
                type: `node--${this.bundle}`,
                id: node.id,
                attributes: { revision_log: args.data.revision_log },
              },
            },
          });
        }
        await this.fetchJson(`/jsonapi/node/${this.bundle}/${node.id}`, {
          method: 'PATCH',
          body: {
            data: {
              type: `node--${this.bundle}`,
              id: node.id,
              attributes: { status: args.id === 'publish' },
            },
          },
        });
        return null;
      }

      case 'asset.upload': {
        // Two steps, because a bare file entity is not something an editor can
        // work with. Uploading to the media bundle's field creates the FILE;
        // the media entity that wraps it is what carries a name, a published
        // state, a bundle (image / document / video) and a place in
        // /admin/content/media. Without it there is no record to browse, rename
        // or relocate — the object browser would list a filename and nothing
        // else, which is what it did while this created files alone.
        //
        // This is why the adapter requires Media (see init): it is the only
        // Drupal construct equivalent to a WordPress attachment or a Plone
        // Image object.
        const binary = Uint8Array.from(atob(args.data), (c) => c.charCodeAt(0));
        const fileRes = await fetch(
          `${this.cmsBaseUrl}/jsonapi/media/${MEDIA_BUNDLE}/${MEDIA_FILE_FIELD}`,
          {
            method: 'POST',
            credentials: this.credentials ? 'omit' : 'include',
            headers: {
              ...this.authHeaders(),
              ...(this.csrfToken ? { 'X-CSRF-Token': this.csrfToken } : {}),
              'Content-Type': args.contentType,
              'Content-Disposition': `file; filename="${args.filename}"`,
            },
            body: binary,
          },
        );
        if (!fileRes.ok) {
          throw new AdapterError(`Upload failed: ${fileRes.status}`, {
            code: 'UPLOAD_FAILED',
            status: fileRes.status,
          });
        }
        const file = flattenPayload(await fileRes.json());

        const mediaRes = await fetch(`${this.cmsBaseUrl}/jsonapi/media/${MEDIA_BUNDLE}`, {
          method: 'POST',
          credentials: this.credentials ? 'omit' : 'include',
          headers: {
            ...this.authHeaders(),
            ...(this.csrfToken ? { 'X-CSRF-Token': this.csrfToken } : {}),
            'Content-Type': 'application/vnd.api+json',
          },
          body: JSON.stringify({
            data: {
              type: `media--${MEDIA_BUNDLE}`,
              attributes: { name: args.filename, status: true },
              relationships: {
                [MEDIA_FILE_FIELD]: {
                  data: { type: 'file--file', id: file.id },
                },
              },
            },
          }),
        });
        if (!mediaRes.ok) {
          throw new AdapterError(`Media create failed: ${mediaRes.status}`, {
            code: 'UPLOAD_FAILED',
            status: mediaRes.status,
          });
        }
        const media = flattenPayload(await mediaRes.json());

        return {
          // The MEDIA entity's uuid is the asset's identity — the thing blocks
          // reference and the editor browses. The file url is a property of it.
          id: media.id,
          path: file.attributes.uri?.url ?? `/${file.attributes.filename}`,
          type: MEDIA_BUNDLE,
          title: media.attributes?.name ?? args.filename,
          blocks: {},
          blocksLayout: { items: [] },
          fields: {
            filename: file.attributes.filename,
            // ABSOLUTE. `path` stays CMS-relative per the Document contract,
            // but this is what gets rendered in an <img>, and a relative URL
            // there is resolved against whatever origin the page came from —
            // which put a Drupal file path on the Plone mock, with Plone's
            // @@images scale suffix appended for good measure. Same reason
            // asset.imageUrl is specified as absolute.
            url: file.attributes.uri?.url
              ? new URL(file.attributes.uri.url, this.cmsBaseUrl).href
              : undefined,
          },
          state: media.attributes?.status === false ? 'draft' : 'published',
          _adapter: { raw: { media, file } },
        };
      }

      case 'asset.imageUrl': {
        // Drupal core serves the original file; named image styles require
        // configuration, so the original is the honest answer rather than a
        // fabricated style URL that would 404.
        return `${this.cmsBaseUrl}${args.path}`;
      }

      // Drupal reports its configured languages through JSON:API when the
      // Language module is on. When it is off there is exactly one language and
      // no endpoint for it, which is not an error — it is the answer.
      //
      // `multilingual` follows the same evidence: more than one configured
      // language is what makes a translation possible here, so it is derived
      // rather than declared, and a single-language Drupal reports false.
      case 'site.get': {
        let languages = [];
        let defaultLanguage = null;
        try {
          const payload = await this.fetchJson(
            '/jsonapi/configurable_language/configurable_language',
          );
          for (const entry of payload?.data ?? []) {
            const code = entry?.attributes?.drupal_internal__id;
            // Drupal lists two pseudo-languages of its own that no content is
            // ever in.
            if (!code || code === 'und' || code === 'zxx') continue;
            languages.push(code);
            if (entry?.attributes?.default) defaultLanguage = code;
          }
        } catch {
          // The Language module is not installed. One language, unnamed here.
          languages = [];
        }
        defaultLanguage = defaultLanguage ?? languages[0] ?? 'en';
        if (!languages.length) languages = [defaultLanguage];
        return {
          defaultLanguage,
          languages,
          features: {
            multilingual: languages.length > 1,
            translations: this.translationsMode,
          },
        };
      }

      case 'querystring.getIndexes': {
        // Discovered from the site's own content types and fields, so the
        // query builder describes THIS Drupal rather than Drupal in general.
        const [types, fields] = await Promise.all([
          this.dispatchOnce('types.list', {}),
          this.fetchJson('/jsonapi/field_config/field_config'),
        ]);
        const flatFields = flattenPayload(fields) ?? [];

        const indexes = {
          node_type: {
            title: 'Type',
            description: 'Content type',
            group: 'Metadata',
            enabled: true,
            sortable: false,
            operations: ['selection.any', 'selection.none'],
            values: Object.fromEntries(
              types.items.map((t) => [t.id, { title: t.title }]),
            ),
          },
          menu_parent: {
            title: 'Location',
            description: 'Parent in the menu tree',
            group: 'Metadata',
            enabled: true,
            sortable: false,
            // Drupal's hierarchy is the menu, so "under this path" means
            // "under this menu item" rather than a path prefix match.
            operations: ['string.absolutePath'],
          },
          status: {
            title: 'State',
            group: 'Metadata',
            enabled: true,
            sortable: false,
            operations: ['selection.any'],
            values: {
              published: { title: 'Published' },
              draft: { title: 'Draft' },
            },
          },
          changed: {
            title: 'Last edited',
            description: 'When the content was last changed',
            group: 'Dates',
            enabled: true,
            // The listing block's "most recently edited first" needs a
            // sortable date, and without one the query builder cannot offer
            // the ordering at all — the index has to exist, not just the sort.
            sortable: true,
            operations: ['date.lessThan', 'date.largerThan'],
          },
          title: {
            title: 'Title',
            group: 'Metadata',
            enabled: true,
            sortable: true,
            operations: ['string.contains'],
          },
        };

        for (const f of flatFields) {
          const name = f.attributes.field_name;
          if (!name?.startsWith('field_') || name === 'field_hydra_blocks') continue;
          indexes[name] = {
            title: f.attributes.label,
            group: 'Fields',
            enabled: true,
            sortable: false,
            operations: ['selection.any'],
          };
        }

        return { indexes };
      }

      case 'querystringSearch': {
        const params = new URLSearchParams();
        let menuParent = null;

        for (const criterion of args.query ?? []) {
          const value = Array.isArray(criterion.v) ? criterion.v : [criterion.v];
          switch (criterion.i) {
            case 'node_type':
              params.set('filter[node_type]', String(value[0]));
              break;
            case 'menu_parent':
              menuParent = String(value[0]);
              break;
            case 'status':
              params.set('filter[status]', value[0] === 'published' ? '1' : '0');
              break;
            case 'title':
              params.set('filter[title][operator]', 'CONTAINS');
              params.set('filter[title][value]', String(value[0]));
              break;
            default:
              // selection.any is multi-value, and Drupal has no comma syntax:
              // filter[x]=a,b is one equality against the literal "a,b" and
              // matches nothing. Every field_config-derived index advertises
              // selection.any, so this branch carries most of them.
              if (value.length > 1) {
                params.set(`filter[${criterion.i}][operator]`, 'IN');
                for (const v of value) {
                  params.append(`filter[${criterion.i}][value][]`, String(v));
                }
              } else {
                params.set(`filter[${criterion.i}]`, String(value[0]));
              }
          }
        }

        // A menu-parent filter is a tree question, not a field one, so it is
        // answered from the menu rather than pushed into the node query.
        if (menuParent) {
          const subtree = await this.dispatchOnce('tree.list', {
            parent: menuParent,
          });

          // Sorted HERE rather than by the CMS, and only on this branch.
          //
          // tree.list answers from the menu, whose order is menu weight — the
          // sibling order an editor arranges by hand. That is the right answer
          // for an unsorted listing and the wrong one the moment a sort is
          // asked for, and because this branch returns early it used to drop
          // `sortOn` on the floor: the contents view offered orderings that
          // did nothing. Pushing the sort into JSON:API is not available here,
          // since the question was answered from menu links rather than a node
          // query; the subtree is already fetched, so ordering it costs
          // nothing and must happen BEFORE the limit is applied.
          const items = orderDocuments(subtree.items, args.sortOn, args.sortOrder);
          const limited = args.limit ? items.slice(0, args.limit) : items;
          return { items: limited, total: subtree.total };
        }

        // Sorting was not implemented at all: JSON:API takes `sort`, with a
        // leading '-' for descending. Advertising a sortable index without
        // this would offer an ordering that silently did nothing.
        if (args.sortOn) {
          const descending = String(args.sortOrder ?? '').startsWith('desc');
          params.set('sort', `${descending ? '-' : ''}${sortFieldFor(args.sortOn)}`);
        }
        if (args.limit) params.set('page[limit]', String(args.limit));
        const payload = await this.fetchJson(`/jsonapi/node/${this.bundle}`, {
          params: params.toString(),
        });
        const flat = flattenPayload(payload) ?? [];
        return {
          items: flat.map((n) => this.toDocument(n)),
          total: payload?.meta?.count ?? flat.length,
        };
      }

      case 'reference.resolve': {
        // A uuid never changes — not when the title changes, not when the
        // document is re-filed under a different menu parent.
        const flat = await this.nodeByUuid(args.id).catch(() => null);
        if (!flat) {
          throw new AdapterError(`No document with id ${args.id}`, {
            code: 'NOT_FOUND',
            status: 404,
          });
        }
        const path = aliasOf(flat);
        return {
          id: flat.id,
          path,
          url: `${this.cmsBaseUrl}${path}`,
          title: flat.attributes.title,
        };
      }

      case 'navigation.setExcluded':
      case 'navigation.setTitle': {
        // Both live on the LINK, not the node — which is what makes them
        // different from anything workflow does. A node with no link is not in
        // the menu to begin with, and saying so beats silently doing nothing.
        const linkId = await this.linkIdForPath(args.path);
        if (!linkId) {
          throw new AdapterError(
            `drupal: ${args.path} has no menu link, so it is not in the menu`,
            { code: 'NOT_FOUND', status: 404 },
          );
        }
        const attributes =
          intent === 'navigation.setExcluded'
            ? { enabled: !args.excluded }
            : { title: args.title };
        await this.fetchJson(
          `/jsonapi/menu_link_content/menu_link_content/${linkId}`,
          {
            method: 'PATCH',
            body: {
              data: {
                type: 'menu_link_content--menu_link_content',
                id: linkId,
                attributes,
              },
            },
          },
        );
        return null;
      }

      default:
        return super.dispatch(intent, args);
    }
  }

  /** Find the menu link id that represents a path, for use as a parent. */
  async linkIdForPath(pathValue) {
    const node = await this.nodeByAlias(pathValue);
    const link = (await this.allMenuLinks()).find(
      (l) => l.relationships.node?.id === node.id,
    );
    return link ? link.id : null;
  }

  /** Put a node under a parent path in the menu tree, creating or re-parenting. */
  async linkNode(nodeId, parentPath) {
    const parentLinkId =
      parentPath === '/' || !parentPath ? null : await this.linkIdForPath(parentPath);
    const existing = (await this.allMenuLinks()).find(
      (l) => l.relationships.node?.id === nodeId,
    );
    const parentRel = parentLinkId
      ? { type: 'menu_link_content--menu_link_content', id: parentLinkId }
      : null;

    if (existing) {
      await this.fetchJson(
        `/jsonapi/menu_link_content/menu_link_content/${existing.id}`,
        {
          method: 'PATCH',
          body: {
            data: {
              type: 'menu_link_content--menu_link_content',
              id: existing.id,
              relationships: { parent: { data: parentRel } },
            },
          },
        },
      );
      return existing.id;
    }

    const created = await this.fetchJson(
      '/jsonapi/menu_link_content/menu_link_content',
      {
        method: 'POST',
        body: {
          data: {
            type: 'menu_link_content--menu_link_content',
            attributes: { weight: 0 },
            relationships: {
              node: { data: { type: `node--${this.bundle}`, id: nodeId } },
              parent: { data: parentRel },
            },
          },
        },
      },
    );
    return created?.data?.id ?? null;
  }
}

export default DrupalAdapter;

/**
 * A JSON:API sort field, from whatever index name the admin sent.
 *
 * INTERIM, and the same story as the WordPress adapter: Volto's contents view
 * hard-codes PLONE index names for its sort menu instead of using
 * querystring.getIndexes, which is what its own query builder uses. `changed`
 * is what this adapter actually advertises as its sortable date.
 *
 * Unrecognised names pass through — they are most likely already field names
 * from the query builder — and JSON:API rejects fields it cannot sort by.
 */
function sortFieldFor(index) {
  const PLONE_TO_DRUPAL = {
    ModificationDate: 'changed',
    CreationDate: 'created',
    EffectiveDate: 'created',
    sortable_title: 'title',
    id: 'drupal_internal__nid',
  };
  return PLONE_TO_DRUPAL[index] ?? index;
}
