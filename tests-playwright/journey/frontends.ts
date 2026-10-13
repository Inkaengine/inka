import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORTS, URLS } from '../ports';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Which CMS each journey project's frontend reads, and where.
 *
 * ONE source for two URLs that must agree about the CMS and differ about the
 * credential:
 *
 *   editorFrontendUrl  what the admin loads in its preview iframe — an editor,
 *                      who may see drafts
 *   publicFrontendUrl  what a VISITOR loads, with no credential at all
 *
 * They were one string in global-setup, which is why there was no way to ask
 * for the public site: the only frontend URL the suite knew about carried an
 * editor's credential.
 */
const FRONTENDS: Record<string, { adapter: string; cms: string }> = {
  'journey-plone': { adapter: 'plone', cms: URLS.mockApi },
  'journey-plone-seeded': {
    adapter: 'plone',
    cms: `http://localhost:${PORTS.plonSeeded}`,
  },
  'journey-drupal': {
    adapter: 'drupal',
    cms: `http://127.0.0.1:${PORTS.mockDrupal}`,
  },
  'journey-wordpress': {
    adapter: 'wordpress',
    cms: `http://127.0.0.1:${PORTS.wordpress}`,
  },
  'journey-strapi': { adapter: 'strapi', cms: URLS.strapi },
};

/** The journey Strapi's token file, written by its bootstrap. */
const STRAPI_TOKEN_FILE = path.resolve(
  HERE,
  '../../tests-adapters/fixtures/strapi-app/app/.hydra-journey-token',
);

export function frontendFor(projectName: string) {
  // The auth setup project shares its target's frontend:
  // journey-wordpress-setup -> journey-wordpress.
  const frontend = FRONTENDS[projectName.replace(/-setup$/, '')];
  if (!frontend) {
    throw new Error(
      `No frontend declared for ${projectName}. A journey project must say ` +
        `which CMS its frontend reads, or the admin loads the default one and ` +
        `the proxy builds a Plone adapter for someone else's CMS.`,
    );
  }
  return frontend;
}

/**
 * The frontend an EDITOR loads: the CMS, plus whatever says "this viewer may
 * see drafts" for that CMS.
 *
 * Each one carries it differently, which is a fact about the CMS rather than a
 * choice: WordPress mints a credential into the frontend origin's storage at
 * sign-in, Plone passes an access_token, Strapi has no login at all so its API
 * token rides on the URL, and the Drupal mock takes a username and password.
 */
export function editorFrontendUrl(projectName: string): string {
  const { adapter, cms } = frontendFor(projectName);
  const params = new URLSearchParams({ adapter, cms });
  if (adapter === 'strapi' && fs.existsSync(STRAPI_TOKEN_FILE)) {
    params.set('token', fs.readFileSync(STRAPI_TOKEN_FILE, 'utf8').trim());
  }
  // Drupal's credential is the only one the fixture holds literally, so it is
  // the only one that needs ASKING for. Without this flag the frontend reads
  // Drupal as a visitor — which is what makes a public-site test possible at
  // all; it used to send admin/admin unconditionally and could never be
  // anonymous.
  if (adapter === 'drupal') params.set('editor', '1');
  return `${URLS.testFrontend}/?${params.toString()}`;
}

/** The frontend a VISITOR loads: the CMS, and nothing else. */
export function publicFrontendUrl(
  projectName: string,
  contentPath = '/',
): string {
  const { adapter, cms } = frontendFor(projectName);
  const params = new URLSearchParams({ adapter, cms });
  return `${URLS.testFrontend}${contentPath}?${params.toString()}`;
}
