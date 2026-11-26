/**
 * The proxy frame: this frontend's CMS adapter, and nothing else.
 *
 * The admin holds no CMS credentials and never talks to the CMS itself. It
 * mounts this page once, in a hidden iframe named `hydra-proxy:<admin origin>`,
 * and sends every CMS request here; the adapter answers them. It stays mounted
 * for the whole session, whatever the editor is looking at — which is why it is
 * a page of its own rather than part of the page being edited.
 *
 * This site is backed by Plone, so it hosts a PloneAdapter. The admin hands over
 * the session it already has as ?access_token=, read on every request so a
 * renewed token is picked up. A frontend on another CMS would construct that
 * CMS's adapter here instead; nothing in the admin changes.
 */
import { connectProxy } from '@hydra-js/hydra.js';
import { PloneAdapter } from '@volto-hydra/hydra-adapters-plone';
import { CMS_BASE_URL } from './cms.js';

const token = new URLSearchParams(window.location.search).get('access_token');

connectProxy(
  new PloneAdapter({ cmsBaseUrl: CMS_BASE_URL, getAuthToken: () => token }),
  { cmsBaseUrl: CMS_BASE_URL },
);
