/**
 * Mock Plone API server — REST endpoints, content from disk.
 * Test frontend lives in tests-playwright/fixtures/test-frontend/ and is
 * served separately by its own Vite dev server on port 8889.
 *
 * Port 8888: Mock Plone API (this server)
 *
 * Run directly: node mock-api-server.cjs
 * Or started automatically by Playwright config webServer
 */

// Start the mock Plone API (imports and initializes on require)
const { app: apiApp, ready } = require('./mock-plone-api.cjs');

const API_PORT = process.env.PORT || 8888;

// ── Server startup ────────────────────────────────────────────────────────
// Test frontend is now a separate Vite dev server (tests-playwright/fixtures/test-frontend/)

let apiServer;
if (require.main === module) {
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

module.exports = { app: apiApp, apiServer };
