import { test, expect } from '@playwright/test';

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

test.describe('@templates', () => {
  test('is not yet served by Plone', async ({ request }) => {
    // The addon does not exist yet. This is the port's tripwire: when Plone starts
    // answering @templates, this test FAILS, and the diff below becomes a real shape
    // comparison instead of a not-implemented marker.
    const res = await request.get(`${PLONE_URL}/++api++/@templates`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${ploneToken}` },
    });
    expect(
      res.ok(),
      'Plone now serves @templates — replace this test with a shape diff against the mock',
    ).toBeFalsy();
  });

  test('the mock serves the contract the addon must satisfy', async ({ request }) => {
    const res = await request.get(`${MOCK_URL}/++api++/@templates`, {
      headers: { Accept: 'application/json' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['@id', 'idFieldMap', 'templates']);
  });
});
