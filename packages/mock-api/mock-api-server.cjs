#!/usr/bin/env node
/**
 * Mock Plone API server — REST endpoints, content from disk.
 *
 *   inka-mock-api           serve the content CONTENT_MOUNTS names on PORT
 *   inka-mock-api --check   check that content (what stops the mock starting)
 *                           and exit: 0 when it is valid, 1 listing the problems
 *
 * CONTENT_MOUNTS comes from the environment or a mock-api.env in the working
 * directory.
 */

// Start the mock Plone API (imports and initializes on require)
const { app: apiApp, ready } = require('./mock-plone-api.cjs');

const { requiredPort } = require('./env-port.cjs');

// ── Server startup ────────────────────────────────────────────────────────
// Test frontend is now a separate Vite dev server (tests-playwright/fixtures/test-frontend/)

let apiServer;
if (require.main === module && process.argv.includes('--check')) {
  // The check that stops the mock starting, on its own: the whole site
  // CONTENT_MOUNTS describes, every mount together, and nothing listens. Loading
  // the content runs it; `ready` rejects with the problems already listed on
  // stderr. Exit explicitly: the content watchers would keep the process alive.
  ready.then(
    () => { console.log('[content-check] served content is valid'); process.exit(0); },
    (err) => { console.error(`[content-check] ${err.message}`); process.exit(1); },
  );
} else if (require.main === module) {
  // Read only when this file IS the program. Importers — the node:test suites
  // in this directory — call `app.listen(0)` and let the OS pick a port, so
  // requiring one of them to name a port would be asking for a number nobody
  // uses. (The default this replaced was worse than unused: `|| 8888` meant
  // every `pnpm test:api` run bound the historical port, taking it from any
  // other checkout that happened to be serving on it.)
  const API_PORT = requiredPort('PORT');
  // A markdown mount is read at startup via a dynamic import, so listen only
  // once it is in memory -- otherwise the first request races the load.
  ready.then(() => {
    apiServer = apiApp.listen(API_PORT, () => {
      console.log(`Mock Plone API running on http://localhost:${API_PORT}`);
      console.log(`Health: http://localhost:${API_PORT}/health`);
    });

    process.on('SIGTERM', () => {
      console.log('SIGTERM received, shutting down');
      apiServer.close(() => process.exit(0));
    });
  }).catch((err) => {
    console.error('Failed to load content:', err);
    process.exit(1);
  });
}

module.exports = { app: apiApp };
