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
const HOST = `localhost:${PORT}`;

/**
 * The site through a VIRTUAL HOST MONSTER, not at /Plone directly.
 *
 * This is how every Plone deployment is addressed — Volto's proxy does exactly
 * this, and so does inkasite-api — because it is what makes the site answer as
 * if it were at the root: `@id` comes back `http://host/news/first-post`
 * instead of `http://host/Plone/news/first-post`, and every path the adapter
 * derives from it is site-relative.
 *
 * Addressed directly, this target made twelve specs fail on paths with `/Plone`
 * in them, and I read that as an adapter bug. It is not: the adapter was
 * correct about what it was given. A VHM is the answer, and leaving it out is
 * simply not how a Plone site is served.
 */
const BASE = `http://${HOST}/VirtualHostBase/http/${HOST}/${SITE}/VirtualHostRoot`;

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


/**
 * A site with at least one MEMBER.
 *
 * `admin` here is the Zope root user from the instance's inituser, not a member
 * of the Plone site, so a site created by `make create-site` has no members at
 * all — and plone.app.vocabularies.Users enumerates the site's membership.
 * The contract asks every index that names a vocabulary to offer terms from
 * it, and Creator names that one, so it answered with nothing: 0 terms, on a
 * site that plainly has an author for every document.
 *
 * Not a failing of the vocabulary and not something a query would have found
 * (checked: `?title=admin` is empty too) — just a site nobody has joined.
 */
async function ensureAMember(): Promise<void> {
  const created = await req('/@users', {
    method: 'POST',
    body: JSON.stringify({
      username: 'editor',
      email: 'editor@example.com',
      password: 'editor-secret-1',
      roles: ['Member'],
    }),
  });
  // 400 is Plone saying the login is already in use, which is this function
  // having run before — every other refusal is one to hear about.
  if (!created.ok && created.status !== 400) {
    throw new Error(`creating a member failed: ${created.status} ${await created.text()}`);
  }
}

/**
 * The site the CONTRACT needs, not the site a fresh Plone gives you.
 *
 * A default Plone 6 has plone.app.multilingual in its dependency pins but does
 * not activate it on the site, and offers one language. The adapter advertises
 * `multilingual` because it can SERVE those calls (site.get's
 * `features.multilingual` is what says whether a given site has languages), so
 * the contract runs the translation group against it — and against a site with
 * no multilingual support @translations and @translation-locator simply 404.
 *
 * Installing it here rather than skipping those specs, for two reasons. The
 * package is already in the venv and inkaengine.inka pins it, so a deployed
 * Inka site is a multilingual-capable one; and a target that skips what it
 * finds inconvenient stops being the proof it exists to be. Same shape as the
 * WordPress target, which installs its companion plugin before the contract
 * runs rather than asserting a site without it.
 *
 * German is added because the specs translate into `de` — one language is not
 * a multilingual site, whatever is installed. Idempotent: run on every start,
 * including against an instance left up between runs.
 *
 * This takes two of the three translation specs from failing to passing. The
 * third cannot pass against content at the site root, and the reason is worth
 * writing down because it is not a fixture this target is missing. Reading a
 * group back goes through plone.restapi's Translations adapter, which does
 * this (services/multilingual/pam.py):
 *
 *     current_lang_nav_root = portal_state.navigation_root()
 *     if IPloneSiteRoot.providedBy(current_lang_nav_root):
 *         # We are not inside a LRF, bail off
 *         return result            # no `items` key at all
 *     result["translations"]["items"] = translations
 *
 * So `@translations` reports a group ONLY for content inside a Language Root
 * Folder. Linking a translation of a root-level document succeeds — POST
 * @translations answers 201, and a second attempt is refused with "Source
 * already translated into language de", so the registration is certainly
 * there — and the group still reads back empty. Verified by hand against this
 * instance, with both ends carrying their languages ('en' and 'de') and the
 * site offering both.
 *
 * Which makes `multilingual` and `features.multilingual` insufficient as a
 * promise: a Plone site can have the addon installed, two languages
 * configured, and still be unable to report what a document is translated
 * into. Seeding this target under /en instead would make the spec pass and
 * would also make its paths differ from every other target's, which is the
 * one thing a shared contract cannot have. Left failing deliberately, because
 * what to do about it is a contract decision — whether site.get should report
 * multilingual only for a site whose navigation root IS a language folder —
 * and not something to settle inside a test fixture.
 */
async function prepareSite(): Promise<void> {
  await ensureAMember();
  const addon = '/@addons/plone.app.multilingual';
  const state = await req(addon);
  if (!state.ok) {
    throw new Error(`@addons could not be read: ${state.status} ${await state.text()}`);
  }
  if (!(await state.json()).is_installed) {
    const installed = await req(`${addon}/install`, { method: 'POST' });
    if (!installed.ok) {
      throw new Error(
        `installing plone.app.multilingual failed: ${installed.status} ${await installed.text()}`,
      );
    }
  }
  const languages = await req('/@controlpanels/language', {
    method: 'PATCH',
    body: JSON.stringify({ available_languages: ['en', 'de'] }),
  });
  if (!languages.ok) {
    throw new Error(
      `offering en and de failed: ${languages.status} ${await languages.text()}`,
    );
  }
}

/** Everything the site holds that this suite put there. */
async function wipe(): Promise<void> {
  const res = await req('/@search?depth=1&metadata_fields=UID&b_size=200');
  if (!res.ok) throw new Error(`@search failed while wiping: ${res.status}`);
  const { items = [] } = await res.json();
  for (const item of items) {
    const at = new URL(item['@id']).pathname || '/';
    if (at === '/') continue;
    // Break the lock first. A real Plone refuses to delete a locked object —
    // 423 — and the lock contract leaves locks behind by design, so without
    // this the wipe silently did nothing and every later seed failed with
    // `The id "about" is invalid - it is already in use`. The mock does not
    // enforce locks on delete, which is why this only showed up here.
    await req(`${at}/@lock`, {
      method: 'DELETE',
      body: JSON.stringify({ force: true }),
    });
    const res = await req(at, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) {
      throw new Error(`wiping ${at} failed: ${res.status} ${await res.text()}`);
    }
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
    await prepareSite();
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
    // ALWAYS, not just when there is no token. expireSession poisons it on
    // purpose, and a poisoned token is not an absent one — without this the
    // test after that one wiped with a dead session and died on a 401. The
    // WordPress target carries the same note about its nonce.
    await login();
    await wipe();
    const documents = [...seed.documents].sort(
      (a: any, b: any) => a.path.split('/').length - b.path.split('/').length,
    );
    for (const doc of documents) await create(doc);
  },

  async publicBlocks(at: string) {
    return publicReader.blocks(at);
  },

  async publicNavigation() {
    return publicReader.navigation();
  },

  async publicMenuEntries() {
    // Plone's @navigation, which already honours exclude_from_nav — so the
    // visitor's menu and the one the adapter manages come from one source.
    const items = await publicReader.navigation();
    return items ? items.map((i: any) => ({ label: i.title, path: i.path })) : null;
  },

  async expireSession(onEvent) {
    // A token this Plone will not accept. Real verification is the point: the
    // mock recognises a magic string, whereas here the signature simply fails.
    token = 'not.a.valid.token';
    await adapter.init({ cmsBaseUrl: BASE, emit: (event, payload) => onEvent(event, payload) });
  },

  async fetchAsSession(url: string) {
    // Back through the VHM, which is the only way this host serves the site.
    //
    // Plone publishes absolute URLs built from what the VHM tells it it is —
    // `http://localhost:PORT/news/scaled.png/@@images/...` — and that is the
    // right URL for a site served at the root of that host, which is how every
    // deployment serves it. Here the root of the host is ZOPE, and the site is
    // one object down, so fetching what Plone published lands on nothing: the
    // image scale came back 404 and read as the adapter publishing a bad URL.
    // It is publishing the right one; this target is the thing reaching Plone
    // by an address no deployment uses.
    const at = new URL(url);
    const through =
      at.host === HOST && !at.pathname.startsWith('/VirtualHostBase/')
        ? `${BASE}${at.pathname}${at.search}`
        : url;
    return fetch(through, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  },
};

export default target;
