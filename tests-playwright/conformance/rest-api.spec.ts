import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

/**
 * Every endpoint the mock implements, diffed against the same endpoint on a real Plone.
 *
 * Both servers are started by the infra (see playwright-conformance.config.ts) — these
 * tests only make HTTP calls and compare.
 *
 * What is compared is SHAPE, not content: the two servers hold different content, so
 * comparing values would only ever report that difference. What must match is the
 * structure a client destructures — which is precisely where the three bugs in
 * checking-against-plone.md lived (`url` vs `@id`, `object` vs `object_buttons`, invented
 * action ids).
 */

const PLONE_URL = process.env.PLONE_URL || 'http://localhost:8080/Plone';
const MOCK_URL = `http://localhost:${process.env.HYDRA_MOCK_API_PORT || 8888}`;

/** Admin on the dev image. Widens coverage to the endpoints that 401 anonymously. */
const PLONE_USER = process.env.PLONE_USER || 'admin';
const PLONE_PASSWORD = process.env.PLONE_PASSWORD || 'admin';

let ploneToken = '';

test.beforeAll(async ({ request }) => {
  const res = await request.post(`${PLONE_URL}/++api++/@login`, {
    headers: { Accept: 'application/json' },
    data: { login: PLONE_USER, password: PLONE_PASSWORD },
  });
  expect(res.ok(), `@login failed on ${PLONE_URL}`).toBeTruthy();
  ploneToken = (await res.json()).token;
  expect(ploneToken, '@login returned no token').toBeTruthy();
});

/**
 * The shape of a value: keys and types, never content.
 *
 * Arrays collapse to their FIRST element's shape — the two servers hold different numbers
 * of things, and what matters is the shape of an entry.
 */
function shapeOf(value: unknown, depth = 3): unknown {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return depth <= 0 || value.length === 0 ? 'array' : { array: shapeOf(value[0], depth - 1) };
  }
  if (typeof value !== 'object') return typeof value;
  if (depth <= 0) return 'object';
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as object).sort()) {
    out[key] = shapeOf((value as Record<string, unknown>)[key], depth - 1);
  }
  return out;
}

/** GET the same api path from both servers. */
async function both(request: any, apiPath: string, auth = false) {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const ploneHeaders = auth ? { ...headers, Authorization: `Bearer ${ploneToken}` } : headers;
  const [plone, mock] = await Promise.all([
    request.get(`${PLONE_URL}/++api++${apiPath}`, { headers: ploneHeaders }),
    request.get(`${MOCK_URL}/++api++${apiPath}`, { headers }),
  ]);
  return {
    plone: { status: plone.status(), body: plone.ok() ? await plone.json() : null },
    mock: { status: mock.status(), body: mock.ok() ? await mock.json() : null },
  };
}

/**
 * Keys Plone emits that the mock must emit too.
 *
 * Deliberately one-directional: EXTRA keys on the mock are fine (it models fixtures Plone
 * has no reason to carry), but a key Plone emits and the mock does not is a key a client
 * may destructure to undefined.
 */
function expectNoMissingKeys(mockBody: object, ploneBody: object, label: string) {
  const missing = Object.keys(ploneBody).filter((k) => !(k in mockBody));
  expect(missing, `${label}: mock is missing keys Plone emits`).toEqual([]);
}

/**
 * The endpoints the mock implements as GETs, and whether Plone needs auth for them.
 * `@contents` is absent because it 404s on the site root on both sides — it is a
 * folder-listing endpoint, covered by the per-content test below instead.
 */
const GET_ENDPOINTS: Array<{ path: string; auth?: boolean }> = [
  { path: '/@actions' },
  { path: '/@breadcrumbs' },
  { path: '/@navigation' },
  { path: '/@navroot' },
  { path: '/@querystring' },
  { path: '/@search' },
  { path: '/@site' },
  { path: '/@vocabularies' },
  { path: '/@workflow' },
  { path: '/@aliases', auth: true },
  { path: '/@types', auth: true },
  { path: '/@history', auth: true },
];

test.describe('GET endpoints', () => {
  for (const { path: apiPath, auth } of GET_ENDPOINTS) {
    test(`${apiPath} has the same shape as Plone`, async ({ request }) => {
      const { plone, mock } = await both(request, apiPath, auth);
      expect(plone.status, `Plone did not serve ${apiPath}`).toBe(200);
      expect(mock.status, `mock did not serve ${apiPath}`).toBe(200);
      if (Array.isArray(plone.body)) {
        expect(Array.isArray(mock.body), `${apiPath}: Plone returns an array`).toBeTruthy();
        if (plone.body.length && (mock.body as unknown[]).length) {
          expect(shapeOf((mock.body as unknown[])[0], 2), apiPath).toEqual(
            shapeOf(plone.body[0], 2),
          );
        }
      } else {
        expectNoMissingKeys(mock.body as object, plone.body as object, apiPath);
      }
    });
  }
});

test.describe('content GET', () => {
  test('site root carries the keys Plone emits', async ({ request }) => {
    const { plone, mock } = await both(request, '/');
    expect(plone.status).toBe(200);
    expect(mock.status).toBe(200);
    expectNoMissingKeys(mock.body as object, plone.body as object, 'content GET');
  });

  test('@components are @id stubs when not expanded', async ({ request }) => {
    const { plone, mock } = await both(request, '/');
    const ploneComponents = (plone.body as any)['@components'] ?? {};
    const mockComponents = (mock.body as any)['@components'] ?? {};
    for (const name of Object.keys(ploneComponents)) {
      expect(Object.keys(ploneComponents[name]), `Plone's ${name}`).toEqual(['@id']);
      if (!mockComponents[name]) continue; // the mock need not model every component
      expect(Object.keys(mockComponents[name]), `mock's ${name} must be a stub too`).toEqual([
        '@id',
      ]);
    }
  });

  test('?expand= inlines a component', async ({ request }) => {
    const { plone, mock } = await both(request, '/?expand=breadcrumbs');
    const p = (plone.body as any)['@components'].breadcrumbs;
    const m = (mock.body as any)['@components'].breadcrumbs;
    expect(p.items, 'Plone expands breadcrumbs inline').toBeDefined();
    expect(m.items, 'mock expands breadcrumbs inline').toBeDefined();
    expect(shapeOf(m, 2)).toEqual(shapeOf(p, 2));
  });

  test('a component route matches its inline expansion', async ({ request }) => {
    // Two paths to one component drift when only one is maintained — this mock has been
    // bitten by exactly that (a session-aware @navigation route vs an expansion that was
    // not). Assert the identity holds on BOTH servers.
    const inline = await both(request, '/?expand=breadcrumbs');
    const route = await both(request, '/@breadcrumbs');
    for (const side of ['plone', 'mock'] as const) {
      expect(
        shapeOf((route[side].body as any).items, 2),
        `${side}: @breadcrumbs route and inline expansion differ`,
      ).toEqual(shapeOf((inline[side].body as any)['@components'].breadcrumbs.items, 2));
    }
  });
});

test.describe('expand.<component>.<param>', () => {
  // The option spelling @templates follows (expand.templates.extra). If Plone reads these
  // differently, @templates is wrong the same way — so assert against Plone FIRST: if the
  // real server ignores the param, the premise is wrong and the mock is not what to fix.
  const nests = (body: any) =>
    (body['@components'].navigation.items || []).some(
      (i: any) => Array.isArray(i.items) && i.items.length > 0,
    );

  test('expand.navigation.depth nests children', async ({ request }) => {
    const deep = await both(request, '/?expand=navigation&expand.navigation.depth=2');
    expect(nests(deep.plone.body), 'Plone nests at depth=2').toBe(true);
    expect(nests(deep.mock.body), 'mock must nest at depth=2').toBe(true);
  });

  test('expand.navigation.depth=1 does not nest', async ({ request }) => {
    const shallow = await both(request, '/?expand=navigation&expand.navigation.depth=1');
    expect(nests(shallow.plone.body), 'Plone does not nest at depth=1').toBe(false);
    expect(nests(shallow.mock.body), 'mock must not nest at depth=1').toBe(false);
  });
});

/**
 * @templates — the mock's reference implementation, diffed against the inkaengine.inka
 * addon running on a real Plone (`make backend-start`; the stock image has no addon).
 *
 * Unlike the endpoints above, this one CAN be compared on identical content: the mock's
 * stored fixtures (a page and the template it uses) are copied into Plone before these
 * tests run, so both servers answer for the same page and the same template.
 *
 * What is compared is what the MERGE consumes, not byte equality. The two servers spell
 * one template reference differently — the mock rewrites a stored `resolveuid/<uid>` to a
 * path when it serves content, Plone serves it as stored — so the key SETS of `templates`
 * legitimately differ. What must hold on both is the invariant the merge depends on:
 * every templateId a page serves is a key in `templates`.
 *
 * The mock has no permission model, so the "unauthorized" behaviour (a template the
 * requester cannot view is reported, not served) is tested only in the addon's own suite.
 */

// The mock's fixtures, read AS STORED — before the mock's read-time rewriting — which is
// the form Plone stores too.
const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'content',
);
const TEMPLATE_FIXTURE = path.join(FIXTURES, 'templates', 'test-layout', 'data.json');
const PAGE_FIXTURE = path.join(FIXTURES, 'template-test-page', 'data.json');
const FIXTURE_TEMPLATE_UID = 'test-layout-template-uid';

// Where each server holds the pair.
const SEED = '/inka-conformance';
const PLONE = { page: `${SEED}/template-test-page`, template: `${SEED}/test-layout` };
const MOCK = {
  page: '/_test_data/template-test-page',
  template: '/_test_data/templates/test-layout',
};

async function ploneCall(request: any, method: string, apiPath: string, data?: object) {
  return request.fetch(`${PLONE_URL}/++api++${apiPath}`, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ploneToken}`,
    },
    ...(data ? { data } : {}),
  });
}

/** GET a pair of paths — one per server, since the seeded content lives at different paths. */
async function pair(request: any, plonePath: string, mockPath: string) {
  const [plone, mock] = await Promise.all([
    request.get(`${PLONE_URL}/++api++${plonePath}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${ploneToken}` },
    }),
    request.get(`${MOCK_URL}/++api++${mockPath}`, { headers: { Accept: 'application/json' } }),
  ]);
  return {
    plone: { status: plone.status(), body: plone.ok() ? await plone.json() : null },
    mock: { status: mock.status(), body: mock.ok() ? await mock.json() : null },
  };
}

/** The @templates component off an expanded page read, per server. */
async function expandedPair(request: any, extra?: { plone: string; mock: string }) {
  const q = (p: string) =>
    `?expand=templates${p ? `&expand.templates.extra=${encodeURIComponent(p)}` : ''}`;
  const { plone, mock } = await pair(
    request,
    `${PLONE.page}${q(extra?.plone ?? '')}`,
    `${MOCK.page}${q(extra?.mock ?? '')}`,
  );
  expect(plone.status, 'Plone page read').toBe(200);
  expect(mock.status, 'mock page read').toBe(200);
  return {
    plone: { page: plone.body, templates: plone.body['@components'].templates },
    mock: { page: mock.body, templates: mock.body['@components'].templates },
  };
}

/** Every templateId a served page carries, at any depth. */
function servedTemplateIds(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => servedTemplateIds(v, found));
  else if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.templateId === 'string') found.add(obj.templateId);
    Object.values(obj).forEach((v) => servedTemplateIds(v, found));
  }
  return found;
}

test.describe('@templates', () => {
  test.beforeAll(async ({ request }) => {
    const probe = await ploneCall(request, 'GET', '/@templates');
    expect(
      probe.ok(),
      `Plone does not serve @templates (HTTP ${probe.status()}) — the inkaengine.inka addon ` +
        'is not installed. Start the backend with `make backend-start`, not ' +
        '`make backend-docker-start`.',
    ).toBeTruthy();

    // Start clean: a previous run that died before afterAll leaves its seed behind.
    await ploneCall(request, 'DELETE', SEED);
    const folder = await ploneCall(request, 'POST', '/', {
      '@type': 'Document',
      id: SEED.slice(1),
      title: 'Inka conformance seed',
    });
    expect(folder.status(), 'create seed folder').toBe(201);

    // The template first, empty: its UID is Plone's to assign, and the fixture's blocks
    // reference the fixture's UID — so the blocks go in once the real one is known.
    const templateData = JSON.parse(fs.readFileSync(TEMPLATE_FIXTURE, 'utf8'));
    const created = await ploneCall(request, 'POST', SEED, {
      '@type': 'Document',
      id: 'test-layout',
      title: templateData.title,
    });
    expect(created.status(), 'create template').toBe(201);
    const ploneUid: string = (await created.json()).UID;
    const rewriteUid = (value: object) =>
      JSON.parse(JSON.stringify(value).split(FIXTURE_TEMPLATE_UID).join(ploneUid));

    const patched = await ploneCall(request, 'PATCH', PLONE.template, {
      blocks: rewriteUid(templateData.blocks),
      blocks_layout: templateData.blocks_layout,
    });
    expect(patched.status(), 'fill template blocks').toBe(204);

    const pageData = JSON.parse(fs.readFileSync(PAGE_FIXTURE, 'utf8'));
    const page = await ploneCall(request, 'POST', SEED, {
      '@type': 'Document',
      id: 'template-test-page',
      title: pageData.title,
      blocks: rewriteUid(pageData.blocks),
      blocks_layout: pageData.blocks_layout,
    });
    expect(page.status(), 'create page').toBe(201);
  });

  test.afterAll(async ({ request }) => {
    await ploneCall(request, 'DELETE', SEED);
  });

  test('is an @id stub unless expanded', async ({ request }) => {
    const { plone, mock } = await pair(request, PLONE.page, MOCK.page);
    for (const [side, body] of [['plone', plone.body], ['mock', mock.body]] as const) {
      const stub = body['@components'].templates;
      expect(Object.keys(stub), `${side}: unexpanded templates`).toEqual(['@id']);
      expect(stub['@id'], `${side}: stub @id`).toMatch(/\/@templates$/);
    }
  });

  test('the expanded component has the same keys', async ({ request }) => {
    const { plone, mock } = await expandedPair(request);
    expect(Object.keys(mock.templates).sort()).toEqual(Object.keys(plone.templates).sort());
  });

  test('every templateId the page serves is a key in templates', async ({ request }) => {
    // THE invariant: the merge looks each template up by the literal string on the block.
    // Checked per server because the two spell references differently (see above).
    const { plone, mock } = await expandedPair(request);
    for (const [side, s] of [['plone', plone], ['mock', mock]] as const) {
      const ids = servedTemplateIds(s.page.blocks);
      expect(ids.size, `${side}: the page references a template`).toBeGreaterThan(0);
      for (const id of ids) {
        expect(Object.keys(s.templates.templates), `${side}: lookup of ${id}`).toContain(id);
      }
    }
  });

  test('a template entry has the shape the merge reads', async ({ request }) => {
    const { plone, mock } = await expandedPair(request);
    const entryOf = (t: any) => Object.values(t.templates)[0] as any;
    const p = entryOf(plone.templates);
    const m = entryOf(mock.templates);
    // Entry-level: only what the merge and a renderer read. The full content-GET shape
    // is diffed (and currently differs) under "content GET" above — not repeated here.
    for (const key of ['@id', '@type', 'UID', 'title', 'blocks', 'blocks_layout']) {
      expect(p, `Plone entry has ${key}`).toHaveProperty([key]);
      expect(m, `mock entry has ${key}`).toHaveProperty([key]);
    }
    expect(m.blocks_layout).toEqual(p.blocks_layout);
    expect(Object.keys(m.blocks).sort()).toEqual(Object.keys(p.blocks).sort());
    for (const id of Object.keys(p.blocks)) {
      expect(shapeOf(m.blocks[id], 4), `block ${id}`).toEqual(shapeOf(p.blocks[id], 4));
    }
  });

  test('a template entry does not carry its own @components', async ({ request }) => {
    // A template's own components are links nobody asked for — and on Plone, expanding
    // them re-enters @templates and recurses. The addon serializes without them.
    const { plone, mock } = await expandedPair(request);
    for (const [side, s] of [['plone', plone], ['mock', mock]] as const) {
      for (const [key, entry] of Object.entries<any>(s.templates.templates)) {
        expect(entry, `${side}: ${key}`).not.toHaveProperty(['@components']);
      }
    }
  });

  test('extra resolves a template the page does not reference', async ({ request }) => {
    const r = await pair(
      request,
      `/@templates?expand.templates.extra=${PLONE.template}`,
      `/@templates?expand.templates.extra=${MOCK.template}`,
    );
    // Contains, not equals: the test-layout fixture references ITSELF in its own blocks,
    // so resolving it also follows that self-reference. Plone serves it as resolveuid
    // (a second key); the mock serves it as the path (the same key). Both are correct.
    expect(Object.keys(r.plone.body.templates)).toContain(PLONE.template);
    expect(Object.keys(r.mock.body.templates)).toContain(MOCK.template);
    expect(r.plone.body.errors).toBeUndefined();
    expect(r.mock.body.errors).toBeUndefined();
  });

  test('a template reached two ways is keyed under both, identically', async ({
    request,
  }) => {
    const { plone, mock } = await expandedPair(request, {
      plone: PLONE.template,
      mock: MOCK.template,
    });
    for (const [side, s, tplPath] of [
      ['plone', plone, PLONE.template],
      ['mock', mock, MOCK.template],
    ] as const) {
      const keys = Object.keys(s.templates.templates);
      expect(keys, `${side}: path spelling`).toContain(tplPath);
      const uidKey = keys.find((k) => k.startsWith('resolveuid/'));
      expect(uidKey, `${side}: uid spelling`).toBeDefined();
      expect(s.templates.templates[uidKey!], `${side}: same template`).toEqual(
        s.templates.templates[tplPath],
      );
    }
  });

  for (const missing of ['/templates/does-not-exist', 'resolveuid/no-such-uid']) {
    test(`a missing template is reported the same way (${missing})`, async ({ request }) => {
      const { plone, mock } = await expandedPair(request, { plone: missing, mock: missing });
      expect(shapeOf(mock.templates.errors, 3)).toEqual(shapeOf(plone.templates.errors, 3));
      for (const [side, s] of [['plone', plone], ['mock', mock]] as const) {
        // The error names the id AS REQUESTED — the string the frontend has to match up.
        expect(s.templates.errors, side).toEqual([
          { templateId: missing, error: `not found: ${missing}` },
        ]);
        expect(
          Object.keys(s.templates.templates).length,
          `${side}: the rest are still served`,
        ).toBeGreaterThan(0);
      }
    });
  }

  test('idFieldMap agrees', async ({ request }) => {
    // The mock DERIVES this from the block schemas; the addon hardcodes it, having no
    // registry of frontend block schemas to read. So this is the tripwire for the static
    // map going stale: when a block gains a non-@id object_list, the mock's map grows,
    // this fails, and the addon's build_id_field_map needs the same entry.
    const { plone, mock } = await expandedPair(request);
    expect(plone.templates.idFieldMap).toEqual(mock.templates.idFieldMap);
  });

  test('the @templates route matches the inline expansion', async ({ request }) => {
    const inline = await expandedPair(request);
    const route = await pair(request, `${PLONE.page}/@templates`, `${MOCK.page}/@templates`);
    for (const side of ['plone', 'mock'] as const) {
      expect(route[side].body.templates, side).toEqual(inline[side].templates.templates);
      expect(route[side].body.idFieldMap, side).toEqual(inline[side].templates.idFieldMap);
    }
  });
});
