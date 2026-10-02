/**
 * Mock Drupal JSON:API.
 *
 * Response SHAPES come from tests-adapters/fixtures/drupal/, captured from a
 * real drupal:11 by capture/capture-drupal.sh — a static replay cannot serve
 * writes, so behaviour is simulated while the shape stays honest. The
 * normalizer's tests run against the raw capture, so drift between the two
 * shows up there.
 *
 * Two Drupal facts drive the design:
 *
 *  - Nodes are FLAT. Hierarchy comes from menu_link_content, per the design
 *    decision recorded in the spec (§8b). A node with no menu link has no
 *    place in the tree, so it surfaces in a virtual folder instead of
 *    vanishing.
 *  - A path alias is the document's URL and carries no structure. Moving a
 *    document re-parents its MENU LINK and must not rewrite the alias.
 */
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 8791;
const BASE = () => `http://127.0.0.1:${PORT}`;

const SEED_PATH =
  process.env.SEED_PATH ||
  path.join(__dirname, '..', '..', 'tests-adapters', 'fixtures', 'seed.json');

/** The virtual folder holding content that has no menu link yet. */
const UNFILED_PATH = '/_unfiled';

app.use(cors());
app.use(express.json({ type: ['application/json', 'application/vnd.api+json'], limit: '50mb' }));

// --- per-session state ---------------------------------------------------
//
// Playwright runs specs in parallel workers, and a single shared store would
// let one test's move or delete surface in another's listing. The Plone mock
// solves this by keying state on the caller's token; this does the same,
// preferring a session cookie because that is what Drupal itself uses and it
// gives every browser context its own world for free.
const sessions = new Map(); // sessionId -> {nodes, menuLinks, files, nextNid}
let terms = new Map(); // vocabularies are read-only, so they stay shared

const uuid = () => crypto.randomUUID();

const SESSION_COOKIE = 'HYDRASESS';

function sessionIdFor(req) {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  if (match) return match[1];
  // Node callers (the contract suite) have no cookie jar; the credentials
  // they present are stable and unique enough to key on.
  return `auth:${req.headers.authorization || 'anonymous'}`;
}

function stateFor(req) {
  const id = sessionIdFor(req);
  if (!sessions.has(id)) sessions.set(id, buildState());
  return sessions.get(id);
}

function buildState() {
  const state = {
    nodes: new Map(),
    menuLinks: new Map(),
    files: new Map(),
    // The asset RECORD, distinct from the file bytes — what the editor browses.
    media: new Map(),
    nextNid: 1,
  };

  const spec = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
  const byPath = new Map();

  for (const doc of spec.documents) {
    if (doc.path === '/') continue; // Drupal has no root document
    const id = uuid();
    state.nodes.set(id, {
      uuid: id,
      nid: state.nextNid++,
      type: 'page',
      title: doc.title,
      alias: doc.path,
      blocks: JSON.stringify({
        v: 1,
        blocks: doc.blocks ?? {},
        blocksLayout: doc.blocksLayout ?? { items: [] },
      }),
      status: doc.state === 'published',
    });
    byPath.set(doc.path, id);
  }

  // Menu links mirror the seed's path nesting — that is what makes the seed's
  // hierarchy expressible in a CMS that has none of its own.
  const linkByNode = new Map();
  const sorted = [...byPath.keys()].sort(
    (a, b) => a.split('/').length - b.split('/').length,
  );
  for (const p of sorted) {
    const parentPath = '/' + p.split('/').filter(Boolean).slice(0, -1).join('/');
    const parentNode = parentPath === '/' ? null : byPath.get(parentPath);
    const id = uuid();
    state.menuLinks.set(id, {
      uuid: id,
      nodeUuid: byPath.get(p),
      parentUuid: parentNode ? linkByNode.get(parentNode) : null,
      weight: 0,
    });
    linkByNode.set(byPath.get(p), id);
  }

  return state;
}

function seedTerms() {
  const spec = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
  const vocab = spec.vocabularies?.categories;
  terms.set(
    'categories',
    Array.from({ length: vocab?.generate ?? 0 }, (_, i) => ({
      uuid: uuid(),
      name: `${vocab.titlePrefix}${i}`,
      slug: `${vocab.tokenPrefix}${i}`,
    })),
  );
}

// --- helpers -------------------------------------------------------------
// (lookup helpers are inlined per-request now that state is session-scoped)

/** Serialise one node in the captured JSON:API shape. */
function toResource(n) {
  return {
    type: `node--${n.type}`,
    id: n.uuid,
    links: { self: { href: `${BASE()}/jsonapi/node/${n.type}/${n.uuid}` } },
    attributes: {
      drupal_internal__nid: n.nid,
      title: n.title,
      status: n.status,
      created: '2026-01-01T00:00:00+00:00',
      // DISTINCT per node. Every node sharing one timestamp made any ordering
      // by date vacuously correct — a sort test could not tell a working sort
      // from an ignored one.
      changed: new Date(Date.UTC(2026, 0, 1, 0, n.nid ?? 0)).toISOString(),
      path: { alias: n.alias, pid: n.nid, langcode: 'en' },
      field_hydra_blocks: n.blocks,
    },
    relationships: {
      node_type: {
        data: { type: 'node_type--node_type', id: `type-${n.type}` },
      },
      uid: { data: { type: 'user--user', id: 'user-admin' } },
    },
  };
}

const collection = (items) => ({
  jsonapi: { version: '1.0' },
  data: items,
  links: { self: { href: BASE() } },
  meta: { count: items.length },
});

const single = (item) => ({ jsonapi: { version: '1.0' }, data: item });

/**
 * Express parses `filter[title][value]=x` into a NESTED object, so looking up
 * the literal bracketed string never matches. Read the parsed shape and
 * accept the shorthand `filter[title]=x` too, which is what JSON:API allows.
 */
function filterValue(req, field) {
  const filter = req.query.filter;
  if (!filter) return undefined;
  const entry = filter[field];
  if (entry === undefined) return undefined;
  return typeof entry === 'object' ? entry.value : entry;
}

/**
 * Evaluate JSON:API filter groups the way Drupal does.
 *
 * Shorthand `filter[title]=x` is an EQUALS match — not a substring one. Any
 * other operator needs the extended form, and combining conditions needs an
 * explicit group:
 *
 *   filter[t][condition][path]=title
 *   filter[t][condition][operator]=CONTAINS
 *   filter[t][condition][value]=First
 *   filter[t][condition][memberOf]=any
 *   filter[any][group][conjunction]=OR
 *
 * The mock previously treated the shorthand as a substring match, which no
 * real Drupal does; an adapter written against that would have searched
 * correctly here and returned nothing in production.
 */
function valueAtPath(node, path) {
  switch (path) {
    case 'title':
      return node.title;
    case 'status':
      return node.status;
    case 'path.alias':
      return node.alias;
    case 'node_type':
    case 'node_type.meta.drupal_internal__target_id':
      return node.type;
    case 'field_hydra_blocks':
      return node.blocks;
    default:
      return undefined;
  }
}

function matchesCondition(node, { path, operator = '=', value }) {
  const actual = valueAtPath(node, path);
  const wanted = value;
  switch (String(operator).toUpperCase()) {
    case 'CONTAINS':
      return String(actual ?? '')
        .toLowerCase()
        .includes(String(wanted ?? '').toLowerCase());
    case 'STARTS_WITH':
      return String(actual ?? '').startsWith(String(wanted ?? ''));
    case 'ENDS_WITH':
      return String(actual ?? '').endsWith(String(wanted ?? ''));
    case '<>':
      return String(actual) !== String(wanted);
    case 'IN':
      return [].concat(wanted ?? []).some((w) => String(actual) === String(w));
    case 'NOT IN':
      return ![].concat(wanted ?? []).some((w) => String(actual) === String(w));
    case '=':
    default:
      if (typeof actual === 'boolean') {
        return actual === (wanted === '1' || wanted === 'true' || wanted === true);
      }
      return String(actual) === String(wanted);
  }
}

function applyFilters(list, req) {
  const filter = req.query.filter;
  if (!filter || typeof filter !== 'object') return list;

  const groups = {}; // name -> conjunction
  const conditions = []; // {path, operator, value, memberOf}

  for (const [key, entry] of Object.entries(filter)) {
    if (entry && typeof entry === 'object' && entry.group) {
      groups[key] = String(entry.group.conjunction ?? 'AND').toUpperCase();
      continue;
    }
    if (entry && typeof entry === 'object' && entry.condition) {
      conditions.push({ ...entry.condition });
      continue;
    }
    // Shorthand: filter[field]=value, or the keyed form
    // filter[field][value]=x&filter[field][operator]=CONTAINS, where the key
    // doubles as the path. Ignoring the operator here would silently downgrade
    // every such filter to an equality match.
    if (entry && typeof entry === 'object') {
      conditions.push({
        path: entry.path ?? key,
        operator: entry.operator ?? '=',
        value: entry.value,
      });
    } else {
      conditions.push({ path: key, operator: '=', value: entry });
    }
  }

  return list.filter((node) => {
    const grouped = {};
    let ok = true;
    for (const cond of conditions) {
      const result = matchesCondition(node, cond);
      if (cond.memberOf) {
        (grouped[cond.memberOf] ??= []).push(result);
      } else if (!result) {
        ok = false;
      }
    }
    if (!ok) return false;
    for (const [name, results] of Object.entries(grouped)) {
      const conjunction = groups[name] ?? 'AND';
      const satisfied =
        conjunction === 'OR' ? results.some(Boolean) : results.every(Boolean);
      if (!satisfied) return false;
    }
    return true;
  });
}

function pageLimit(req) {
  const page = req.query.page;
  const limit = page && typeof page === 'object' ? page.limit : undefined;
  return limit === undefined ? undefined : Number(limit);
}

const notFound = (res, what) =>
  res.status(404).json({ errors: [{ status: '404', detail: `Not found: ${what}` }] });

// --- auth ----------------------------------------------------------------
// Drupal writes need a CSRF token; the contract's expireSession invalidates it.
const VALID_TOKEN = 'drupal-csrf-token';

function authed(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Basic ')) return false;
  const [user, pass] = Buffer.from(auth.slice(6), 'base64').toString().split(':');
  // Bad credentials fail everything, reads included — that is what an expired
  // session actually looks like.
  if (user !== 'admin' || pass !== 'admin') return false;
  // Writes additionally need the CSRF token, as real Drupal requires.
  if (req.method === 'GET') return true;
  return req.headers['x-csrf-token'] === VALID_TOKEN;
}

app.use((req, res, next) => {
  if (req.path.startsWith('/jsonapi') && !authed(req)) {
    return res.status(401).json({ errors: [{ status: '401', detail: 'Unauthorized' }] });
  }
  next();
});

// Hand out a session cookie on first contact, the way Drupal does. Each
// Playwright browser context then gets its own isolated content automatically.
app.use((req, res, next) => {
  if (!(req.headers.cookie || '').includes(`${SESSION_COOKIE}=`)) {
    res.cookie?.(SESSION_COOKIE, uuid(), { path: '/', httpOnly: true });
  }
  next();
});

app.get('/session/token', (req, res) => res.type('text').send(VALID_TOKEN));
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// --- root ----------------------------------------------------------------
app.get('/jsonapi', (req, res) =>
  res.json({ jsonapi: { version: '1.0' }, data: [], links: { self: { href: `${BASE()}/jsonapi` } } }),
);

// --- users ---------------------------------------------------------------
app.get('/jsonapi/user/user', (req, res) =>
  res.json(
    collection([
      {
        type: 'user--user',
        id: 'user-admin',
        attributes: {
          display_name: 'admin',
          name: 'admin',
          mail: 'admin@example.com',
          roles: ['authenticated', 'administrator'],
        },
      },
    ]),
  ),
);

// --- types & schema ------------------------------------------------------
// Media: the asset record an editor browses. Bare file entities have no name,
// no published state and no listing, so the adapter requires media and this
// mock has to model it or the contract would pass against something Drupal
// users would not recognise.
app.get('/jsonapi/media_type/media_type', (req, res) =>
  res.json(
    collection(
      ['image', 'document'].map((t) => ({
        type: 'media_type--media_type',
        id: `mediatype-${t}`,
        attributes: { drupal_internal__id: t, name: t === 'image' ? 'Image' : 'Document' },
      })),
    ),
  ),
);

app.post('/jsonapi/media/:bundle/:field', (req, res) => {
  const { files } = stateFor(req);
  const disposition = req.headers['content-disposition'] || '';
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'upload.bin';
  const id = `file-${files.size + 1}`;
  const file = {
    id,
    filename,
    url: `/sites/default/files/${filename}`,
    mime: req.headers['content-type'] || 'application/octet-stream',
  };
  files.set(id, file);
  res.status(201).json(
    single({
      type: 'file--file',
      id,
      attributes: {
        filename,
        uri: { value: `public://${filename}`, url: file.url },
        filemime: file.mime,
      },
    }),
  );
});

app.post('/jsonapi/media/:bundle', (req, res) => {
  const { media } = stateFor(req);
  const attrs = req.body?.data?.attributes ?? {};
  const fileRel = Object.values(req.body?.data?.relationships ?? {})[0]?.data;
  const id = `media-${media.size + 1}`;
  const entity = {
    id,
    bundle: req.params.bundle,
    name: attrs.name ?? 'Untitled',
    status: attrs.status !== false,
    fileId: fileRel?.id ?? null,
  };
  media.set(id, entity);
  res.status(201).json(
    single({
      type: `media--${entity.bundle}`,
      id,
      attributes: { name: entity.name, status: entity.status },
      relationships: {
        field_media_image: { data: fileRel ?? null },
      },
    }),
  );
});

app.get('/jsonapi/node_type/node_type', (req, res) =>
  res.json(
    collection(
      ['page', 'article'].map((t) => ({
        type: 'node_type--node_type',
        id: `type-${t}`,
        attributes: { drupal_internal__type: t, name: t === 'page' ? 'Basic page' : 'Article' },
      })),
    ),
  ),
);

app.get('/jsonapi/field_config/field_config', (req, res) =>
  res.json(
    collection(
      [
        ['title', 'Title', 'string', true],
        ['field_hydra_blocks', 'Hydra blocks', 'string_long', false],
        ['status', 'Published', 'boolean', false],
      ].map(([name, label, type, required]) => ({
        type: 'field_config--field_config',
        id: `field-${name}`,
        attributes: {
          field_name: name,
          label,
          field_type: type,
          required,
          bundle: 'page',
          entity_type: 'node',
        },
      })),
    ),
  ),
);

// --- taxonomy ------------------------------------------------------------
app.get('/jsonapi/taxonomy_term/:vocab', (req, res) => {
  const all = terms.get(req.params.vocab);
  if (!all) return notFound(res, req.params.vocab);
  const nameFilter = filterValue(req, 'name');
  const limit = pageLimit(req) ?? 25;
  const matched = nameFilter
    ? all.filter((t) => t.name.includes(String(nameFilter)))
    : all;
  res.json({
    jsonapi: { version: '1.0' },
    data: matched.slice(0, limit).map((t) => ({
      type: `taxonomy_term--${req.params.vocab}`,
      id: t.uuid,
      attributes: { name: t.name, drupal_internal__tid: 1 },
    })),
    meta: { count: matched.length },
  });
});

// --- menu links (the hierarchy) -----------------------------------------
app.get('/jsonapi/menu_link_content/menu_link_content', (req, res) => {
  const { menuLinks } = stateFor(req);
  const parent = filterValue(req, 'parent');
  const list = [...menuLinks.values()].filter((l) =>
    parent === undefined ? true : (l.parentUuid ?? '') === (parent === 'null' ? '' : parent),
  );
  res.json(
    collection(
      list.map((l) => ({
        type: 'menu_link_content--menu_link_content',
        id: l.uuid,
        // A Drupal menu link carries its OWN title and an enabled flag,
        // independent of the node it points at. That is how Drupal expresses
        // "call it something shorter in the menu" and "keep this out of the
        // menu" — neither of which the node knows about.
        attributes: {
          weight: l.weight,
          enabled: l.enabled !== false,
          title: l.title ?? null,
        },
        relationships: {
          node: { data: { type: 'node--page', id: l.nodeUuid } },
          parent: {
            data: l.parentUuid
              ? { type: 'menu_link_content--menu_link_content', id: l.parentUuid }
              : null,
          },
        },
      })),
    ),
  );
});

app.patch('/jsonapi/menu_link_content/menu_link_content/:uuid', (req, res) => {
  const { menuLinks } = stateFor(req);
  const link = menuLinks.get(req.params.uuid);
  if (!link) return notFound(res, req.params.uuid);
  // PATCH is a PARTIAL update: a field that is absent means "leave it alone",
  // not "set it to null". Treating absence as null made a weight-only PATCH
  // silently detach the link from its parent and flatten the whole tree.
  const relationships = req.body?.data?.relationships;
  if (relationships && 'parent' in relationships) {
    const rel = relationships.parent?.data;
    link.parentUuid = rel ? rel.id : null;
  }
  const attrs = req.body?.data?.attributes ?? {};
  if (attrs.weight !== undefined) link.weight = attrs.weight;
  if (attrs.enabled !== undefined) link.enabled = attrs.enabled;
  if (attrs.title !== undefined) link.title = attrs.title;
  res.json(single({ type: 'menu_link_content--menu_link_content', id: link.uuid }));
});

app.post('/jsonapi/menu_link_content/menu_link_content', (req, res) => {
  const { menuLinks } = stateFor(req);
  const rel = req.body?.data?.relationships ?? {};
  const id = uuid();
  menuLinks.set(id, {
    uuid: id,
    nodeUuid: rel.node?.data?.id ?? null,
    parentUuid: rel.parent?.data?.id ?? null,
    weight: req.body?.data?.attributes?.weight ?? 0,
    enabled: req.body?.data?.attributes?.enabled ?? true,
    title: req.body?.data?.attributes?.title ?? null,
  });
  res.status(201).json(single({ type: 'menu_link_content--menu_link_content', id }));
});

// --- files ---------------------------------------------------------------
app.post('/jsonapi/:entity/:bundle/field_media_image', (req, res) => {
  const { files } = stateFor(req);
  const id = uuid();
  const filename = String(req.headers['content-disposition'] || 'file="upload.png"')
    .split('filename=')
    .pop()
    .replace(/["']/g, '')
    .trim();
  files.set(id, {
    uuid: id,
    filename,
    mime: req.headers['content-type'] || 'application/octet-stream',
    bytes: Buffer.isBuffer(req.body) ? req.body : Buffer.from(''),
  });
  res.status(201).json(
    single({
      type: 'file--file',
      id,
      attributes: {
        filename,
        uri: { url: `/sites/default/files/${filename}` },
        filemime: files.get(id).mime,
      },
    }),
  );
});

app.get('/sites/default/files/:name', (req, res) => {
  const { files } = stateFor(req);
  const file = [...files.values()].find((f) => f.filename === req.params.name);
  if (!file) return notFound(res, req.params.name);
  res.set('Content-Type', file.mime).send(file.bytes);
});

// --- nodes ---------------------------------------------------------------
app.get('/jsonapi/node/:bundle/:uuid', (req, res) => {
  const { nodes } = stateFor(req);
  const n = nodes.get(req.params.uuid);
  if (!n) return notFound(res, req.params.uuid);
  res.json(single(toResource(n)));
});

app.get('/jsonapi/node/:bundle', (req, res) => {
  const { nodes } = stateFor(req);
  let list = [...nodes.values()].filter((n) => n.type === req.params.bundle);

  list = applyFilters(list, req);

  // JSON:API sorting: `sort=field` ascending, `sort=-field` descending. The
  // mock ignored it entirely, so an adapter that dropped the sort parameter
  // would still have looked correct here.
  const sort = req.query.sort;
  if (typeof sort === 'string' && sort) {
    const descending = sort.startsWith('-');
    const field = descending ? sort.slice(1) : sort;
    const keyOf = (n) => {
      if (field === 'changed' || field === 'created') {
        return new Date(Date.UTC(2026, 0, 1, 0, n.nid ?? 0)).toISOString();
      }
      if (field === 'title') return n.title ?? '';
      return String(valueAtPath(n, field) ?? '');
    };
    list = [...list].sort((a, b) => {
      const x = keyOf(a);
      const y = keyOf(b);
      return descending ? (x < y ? 1 : x > y ? -1 : 0) : x < y ? -1 : x > y ? 1 : 0;
    });
  }

  const total = list.length;
  const limit = pageLimit(req);
  if (limit !== undefined) list = list.slice(0, limit);

  res.json({ ...collection(list.map(toResource)), meta: { count: total } });
});

app.post('/jsonapi/node/:bundle', (req, res) => {
  const state = stateFor(req);
  const attrs = req.body?.data?.attributes ?? {};
  const id = uuid();
  const n = {
    uuid: id,
    nid: state.nextNid++,
    type: req.params.bundle,
    title: attrs.title ?? 'Untitled',
    alias: attrs.path?.alias || '',
    blocks: attrs.field_hydra_blocks ?? '{"v":1,"blocks":{},"blocksLayout":{"items":[]}}',
    status: attrs.status ?? false,
  };
  state.nodes.set(id, n);
  res.status(201).json(single(toResource(n)));
});

app.patch('/jsonapi/node/:bundle/:uuid', (req, res) => {
  const { nodes } = stateFor(req);
  const n = nodes.get(req.params.uuid);
  if (!n) return notFound(res, req.params.uuid);
  const attrs = req.body?.data?.attributes ?? {};
  if (attrs.title !== undefined) n.title = attrs.title;
  if (attrs.status !== undefined) n.status = attrs.status;
  if (attrs.field_hydra_blocks !== undefined) n.blocks = attrs.field_hydra_blocks;
  if (attrs.path?.alias !== undefined) n.alias = attrs.path.alias;
  res.json(single(toResource(n)));
});

app.delete('/jsonapi/node/:bundle/:uuid', (req, res) => {
  const { nodes, menuLinks } = stateFor(req);
  if (!nodes.has(req.params.uuid)) return notFound(res, req.params.uuid);
  nodes.delete(req.params.uuid);
  for (const [id, l] of menuLinks) {
    if (l.nodeUuid === req.params.uuid) menuLinks.delete(id);
  }
  res.status(204).send();
});

// --- test control --------------------------------------------------------
app.post('/_reset', (req, res) => {
  // Resets only the caller's world, so a parallel worker's reset cannot pull
  // content out from under another test mid-run.
  sessions.set(sessionIdFor(req), buildState());
  const { nodes, menuLinks } = stateFor(req);
  res.json({ status: 'reseeded', nodes: nodes.size, links: menuLinks.size });
});

seedTerms();
app.listen(PORT, () => {
  console.log(`Mock Drupal JSON:API on ${BASE()} (per-session content)`);
});

module.exports = { app, UNFILED_PATH };
