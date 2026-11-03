/**
 * The contract, against a REAL Plone.
 *
 * Every other Plone test in this repo runs against our own mock
 * (tests-playwright/fixtures/mock-plone-api.cjs): the contract suite's `plone`
 * target, the admin suites, the seeded journey. The mock is careful — 370
 * fidelity tests, and a guard that refuses a route plone.restapi does not have
 * — but it is still ours, and a contract that proves the adapter and the mock
 * AGREE proves nothing when the same hands wrote both. This repo has already
 * paid for that once: an `@order` endpoint was invented in the mock, an adapter
 * written against it in the same commit, and the contract stayed green for two
 * weeks while every reorder against a real Plone 404'd.
 *
 * So this target starts the Plone the backend addon already installs — 6.2.2,
 * plone.restapi, inkaengine.inka, via uv and no Docker — and runs the identical
 * contract against it. Where it disagrees with the `plone` target, one of the
 * two is wrong about Plone, and that is the finding.
 *
 * It is a SECOND target rather than a replacement. The mock stays because it is
 * seconds to start and is what the admin suites need; this one is the proof.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { PloneAdapter } from '@volto-hydra/hydra-adapters-plone';
import { createPublicReader } from '@volto-hydra/hydra-adapters-plone/public';
import type { Target } from './index';
import { PORTS } from '../../tests-playwright/ports';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const ADDON = path.join(REPO_ROOT, 'backend/inkaengine.inka');

// The same port the mock target uses. They are never up together: the matrix
// runs one target per job, and `assertPortFree` refuses to reuse a server this
// process did not start.
const PORT = PORTS.contractPlone;
const SITE = process.env.PLONE_SITE_ID ?? 'Plone';
const BASE = `http://localhost:${PORT}/${SITE}`;

const ADMIN = { login: 'admin', password: process.env.PLONE_ADMIN_PASSWORD ?? 'admin' };

let proc: ChildProcess | null = null;
let token: string | null = null;

const adapter = new PloneAdapter({
  cmsBaseUrl: BASE,
  getAuthToken: () => token,
});

const publicFetch: typeof fetch = (input, init) => fetch(input, init);
const publicReader = createPublicReader({ cmsBaseUrl: BASE, fetch: publicFetch });

const seed = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'tests-adapters/fixtures/seed.json'), 'utf-8'),
);

/**
 * How many Keywords terms the vocabulary tests expect.
 *
 * Plone's vocabularies are registered Python, not content, so the mock's
 * 10 000 generated terms have no equivalent here. `plone.app.vocabularies.Keywords`
 * IS a real vocabulary and is fed by the Subject field, so the seed writes the
 * terms the contract looks for ("Category 0" … "Category N-1") onto one
 * document. N only has to be bigger than a page of results for the
 * server-side-filtering assertions to mean anything.
 */
const KEYWORDS = 60;

function req(urlPath: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${urlPath}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
}

async function login(): Promise<void> {
  // A real token from @login, not a minted one: this Plone verifies it, which
  // is the whole point of running against the real thing.
  const res = await fetch(`${BASE}/@login`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(ADMIN),
  });
  if (!res.ok) {
    throw new Error(`@login refused the contract's credentials: ${res.status}`);
  }
  token = (await res.json()).token;
}

async function assertPortFree(): Promise<void> {
  try {
    const res = await fetch(`http://localhost:${PORT}/`, {
      signal: AbortSignal.timeout(1500),
    });
    throw new Error(
      `Port ${PORT} is already serving (status ${res.status}). Stop it before ` +
        `running the contract suite: a server this process did not start is ` +
        `serving content nobody here chose, so the suite would pass or fail ` +
        `for reasons that have nothing to do with the adapter.`,
    );
  } catch (error) {
    if (error instanceof Error && /already serving/.test(error.message)) throw error;
    // Anything else means nothing answered, which is what we want.
  }
}

async function waitForSite(timeoutMs = 180_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(BASE, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) return;
      last = `status ${res.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(
    `Plone never served ${BASE} within ${timeoutMs}ms (last: ${last}). ` +
      `A first run has to build the venv and create the site — see ` +
      `backend/inkaengine.inka/Makefile (install, create-site).`,
  );
}

/** Everything the site holds that this suite put there. */
async function wipe(): Promise<void> {
  const res = await req('/@search?depth=1&metadata_fields=UID&b_size=200');
  if (!res.ok) throw new Error(`@search failed while wiping: ${res.status}`);
  const { items = [] } = await res.json();
  for (const item of items) {
    const at = new URL(item['@id']).pathname.replace(`/${SITE}`, '') || '/';
    if (at === '/') continue;
    await req(at, { method: 'DELETE' });
  }
}

/** The Plone type for a seed document's `type`. */
function ploneType(doc: { type?: string | null }): string {
  // Plone 6 has no separate folder type in a default site: a Document is
  // folderish, which is what the seed's `folder` means here.
  return doc.type === 'image' ? 'Image' : 'Document';
}

async function create(doc: Record<string, any>): Promise<void> {
  const at = String(doc.path);
  if (at === '/') return; // the site root exists already
  const segments = at.split('/').filter(Boolean);
  const id = segments.pop()!;
  const parent = `/${segments.join('/')}`;
  const body: Record<string, unknown> = {
    '@type': ploneType(doc),
    id,
    title: doc.title ?? id,
  };
  if (doc.blocks) body.blocks = doc.blocks;
  if (doc.blocksLayout) body.blocks_layout = doc.blocksLayout;
  // One document carries the Keywords the vocabulary tests look for. Plone's
  // Subject field is what feeds plone.app.vocabularies.Keywords.
  if (at === '/about') {
    body.subjects = Array.from({ length: KEYWORDS }, (_, n) => `Category ${n}`);
  }
  const res = await req(parent === '/' ? '/' : parent, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`creating ${at} failed: ${res.status} ${await res.text()}`);
  }
  // Plone creates private; the seed says which are published.
  if (doc.state === 'published') {
    await req(`${at}/@workflow/publish`, { method: 'POST' });
  }
}

const target: Target = {
  name: 'plone-real',
  capabilities: [
    'content',
    'search-fulltext',
    'search-filter',
    'vocabulary',
    'schema',
    'asset',
  ],
  types: { folder: 'Document', page: 'Document', image: 'Image' },
  vocabularies: { categories: 'plone.app.vocabularies.Keywords' },
  vocabularySize: KEYWORDS,
  imageScale: 'preview',
  queryIndexes: {
    type: 'portal_type',
    path: 'path',
    title: 'Title',
    state: 'review_state',
    modified: 'modified',
  },
  queryOps: {
    typeIsAnyOf: 'plone.app.querystring.operation.selection.any',
    titleContains: 'plone.app.querystring.operation.string.contains',
    under: 'plone.app.querystring.operation.string.absolutePath',
  },
  adapter,

  async start() {
    // Reuse an instance this developer already has up, rather than refusing or
    // starting a second one: a real Plone takes minutes to install and seconds
    // to seed, so the usual loop is `make start` once and the suite many times.
    // PLONE_ALREADY_RUNNING says so explicitly — nothing is guessed.
    if (!process.env.PLONE_ALREADY_RUNNING) {
      await assertPortFree();
      const ini = path.join(ADDON, 'instance/etc/zope.ini');
      if (!fs.existsSync(ini)) {
        throw new Error(
          `No Plone instance at ${ini}. Build it first:\n` +
            `  cd backend/inkaengine.inka && make install && make create-site`,
        );
      }
      proc = spawn(path.join(ADDON, '.venv/bin/runwsgi'), [ini], {
        cwd: ADDON,
        env: { ...process.env, ZOPE_PORT: String(PORT) },
        stdio: 'pipe',
      });
      proc.stderr?.on('data', (d) => process.stderr.write(`[plone] ${d}`));
    }
    await waitForSite();
    await login();
    await this.seed();
  },

  async stop() {
    proc?.kill('SIGTERM');
    proc = null;
  },

  /**
   * A real reset: delete what the last test left and create the seed again.
   *
   * Slower than the mock's (which resets by handing out a fresh token) and
   * slower than WordPress's (one PHP pass through its test plugin). If this
   * proves too slow for the whole contract, the answer is the same shape as
   * WordPress's: one endpoint in inkaengine.inka that does it in a single
   * transaction. Measured first, before being optimised.
   */
  async seed() {
    if (!token) await login();
    await wipe();
    const documents = [...seed.documents].sort(
      (a: any, b: any) => a.path.split('/').length - b.path.split('/').length,
    );
    for (const doc of documents) await create(doc);
  },

  async publicBlocks(at: string) {
    const doc = await publicReader.content(at);
    return (doc as any)?.blocks ?? null;
  },

  async publicNavigation() {
    const nav = await publicReader.navigation();
    return (nav as any)?.items ?? null;
  },

  async publicMenuEntries() {
    // Plone has no separate menu store: a navigation IS the content tree, so
    // there is nothing here the navigation above does not already answer.
    return null;
  },

  async expireSession(onEvent) {
    // A token this Plone will not accept. Real verification is the point: the
    // mock recognises a magic string, whereas here the signature simply fails.
    token = 'not.a.valid.token';
    await adapter.init({ cmsBaseUrl: BASE, emit: (event, payload) => onEvent(event, payload) });
  },

  async fetchAsSession(url: string) {
    return fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  },
};

export default target;
