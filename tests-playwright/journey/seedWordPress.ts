import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORTS } from '../ports';

/**
 * Put the canonical fixture into WordPress before a journey runs.
 *
 * The other two targets arrive seeded: the Plone mock serves the repo's own
 * content tree and the Drupal mock builds the canonical set per session. Real
 * WordPress starts empty — the blueprint only installs the reset endpoint — so
 * without this the journey has nothing to browse and fails at the first step
 * for a reason that has nothing to do with the bridge.
 *
 * Seeds through the SAME mu-plugin route the contract suite uses, from the
 * same seed.json, so the two suites cannot drift into testing different
 * worlds.
 */

const BASE = `http://127.0.0.1:${PORTS.wordpress}`;

// Read rather than imported: Playwright's ESM loader requires an import
// attribute for JSON that vitest (which the contract suite runs under) does
// not, and the same fixture has to load in both.
const seed = JSON.parse(
  readFileSync(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../tests-adapters/fixtures/seed.json',
    ),
    'utf8',
  ),
) as { documents: Array<Record<string, unknown>> };

export async function seedWordPress(): Promise<void> {
  // Prime once WITHOUT following redirects, and keep the cookies.
  //
  // Playground answers a cookie-less client with a 302 to the same URL so it
  // can retry carrying an auto-login cookie, and a client with no cookie jar
  // follows that forever. This used to be masked by a mu-plugin that treated
  // every request as the admin; that fake is gone, so the handshake is real
  // again. Authorisation still comes from the test header — seeding is fixture
  // setup, not something the sign-in flow should have to perform.
  const prime = await fetch(`${BASE}/`, { redirect: 'manual' });
  const cookie = [
    ...new Map(
      (prime.headers.getSetCookie?.() ?? [])
        .map((c) => c.split(';')[0])
        .map((c) => [c.split('=')[0], c]),
    ).values(),
  ].join('; ');

  // Parents before children: the reset endpoint resolves each document's
  // parent by path as it inserts, so a child seeded first would be orphaned.
  const documents = seed.documents
    .filter((d: any) => d.path !== '/')
    .sort(
      (a: any, b: any) => a.path.split('/').length - b.path.split('/').length,
    )
    .map((doc: any) => ({
      path: doc.path,
      title: doc.title,
      state: doc.state,
      content:
        '<!-- wp:hydra-blocks/document ' +
        JSON.stringify({
          v: 1,
          blocks: (doc as any).blocks ?? {},
          blocksLayout: (doc as any).blocksLayout ?? { items: [] },
        }) +
        ' /-->',
    }));

  const res = await fetch(`${BASE}/?rest_route=/hydra-test/v1/reset`, {
    method: 'POST',
    // Never follow: a redirect here means the request was not recognised, and
    // following it just loops.
    redirect: 'manual',
    headers: {
      Cookie: cookie,
      'X-Hydra-Test': 'seed',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ documents }),
  });
  if (res.status !== 200) {
    throw new Error(
      `WordPress seed failed: ${res.status} ${(await res.text()).slice(0, 300)}`,
    );
  }
}
