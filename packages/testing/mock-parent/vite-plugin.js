/**
 * mock-parent.html, served by any Vite dev server.
 *
 * mock-parent is a stand-in for the admin: it frames a frontend, speaks the
 * bridge protocol to it, and runs the admin's own merge and region code on the
 * page it hands over, so a frontend can be tested without Volto running.
 *
 *   // vite.config.js
 *   import { mockParent } from '@inka/testing/mock-parent';
 *   export default defineConfig({ plugins: [mockParent({ apiOrigin, frontendOrigin })] });
 *
 * The page is served at /mock-parent.html. It takes `?frontend=` (the frontend
 * to frame) and `?api_path=` (a Plone API URL to load the page from) — see the
 * page itself for the rest.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const PAGE = path.join(import.meta.dirname, 'mock-parent.html');

/** The admin's own code mock-parent runs, under a prefix of its own. */
const PREFIX = '/inka-mock-parent';
const modules = () => ({
  [`${PREFIX}/helpers.js`]: require.resolve('@volto-hydra/helpers'),
  [`${PREFIX}/build-block-path-map.js`]: require.resolve('@volto-hydra/helpers/buildBlockPathMap.js'),
  // The same merge the admin runs before it posts INITIAL_DATA (View.jsx), so
  // the mock parent hands the bridge a page with its forced layouts and
  // templates already stamped on — see mock-parent.html's INIT handler.
  [`${PREFIX}/merge-templates.js`]: require.resolve('@volto-hydra/helpers/mergeTemplates.js'),
  [`${PREFIX}/merge-frontend-block.js`]: require.resolve('@volto-hydra/hydra-js/mergeFrontendBlock.js'),
  // The admin's region helpers, so block-sanity can empty a region exactly as an
  // editor's delete does.
  [`${PREFIX}/block-path.js`]: require.resolve('@volto-hydra/helpers/blockPath.js'),
  // The admin's delete (View.jsx's Remove and multi-select delete both call it):
  // it refuses a block an editor can't remove and re-seeds what it empties.
  [`${PREFIX}/block-sync.js`]: require.resolve('@volto-hydra/helpers/blockSync.js'),
});

/**
 * @param {object} [options]
 * @param {string} [options.apiOrigin] The mock API the page loads content from
 *   when no ?api_path= is given. Without it the page falls back to
 *   `window._apiOrigin`, which the host can inject itself.
 * @param {string} [options.frontendOrigin] The frontend framed when no
 *   ?frontend= is given. Default: `window._frontendOrigin`, else the origin the
 *   page is served from.
 */
export function mockParent(options = {}) {
  const injected = [
    options.apiOrigin && `window._apiOrigin = ${JSON.stringify(options.apiOrigin)};`,
    options.frontendOrigin && `window._frontendOrigin = ${JSON.stringify(options.frontendOrigin)};`,
  ].filter(Boolean).join('');
  return {
    name: 'inka-mock-parent',
    config() {
      return { resolve: { alias: modules() } };
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.split('?')[0] !== '/mock-parent.html') return next();
        try {
          let html = fs.readFileSync(PAGE, 'utf8');
          if (injected) html = html.replace('<head>', `<head><script>${injected}</script>`);
          html = await server.transformIndexHtml(req.url, html, req.originalUrl);
          res.setHeader('Content-Type', 'text/html');
          res.end(html);
        } catch (err) {
          next(err);
        }
      });
    },
  };
}
