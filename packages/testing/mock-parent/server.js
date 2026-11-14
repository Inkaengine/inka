#!/usr/bin/env node
/**
 * `inka-mock-parent`: serves mock-parent.html, the stand-in admin a frontend's
 * editing is tested against (block discovery and the sanity suites), at
 * /mock-parent.html.
 *
 *   PORT=8991 API_URL=http://localhost:8990 FRONTEND_URL=http://localhost:4321 inka-mock-parent
 *
 * PORT is required, as it is for the mock API: test ports have no defaults.
 * API_URL is the mock API the page loads content from when no ?api_path= is
 * given, and FRONTEND_URL the frontend it frames when no ?frontend= is given.
 * Both are optional: the sanity suites pass both in the page's URL.
 *
 * To serve the page from a Vite server of your own instead, add the plugin:
 * `mockParent()` from `@inka/testing/mock-parent`.
 */
import { createServer } from 'vite';
import { mockParent } from './vite-plugin.js';

const port = Number(process.env.PORT);
if (!Number.isInteger(port) || port <= 0) {
  console.error(
    `inka-mock-parent: PORT is required (a positive integer), got ${JSON.stringify(process.env.PORT)}. ` +
      'Test ports have no defaults.',
  );
  process.exit(1);
}

const server = await createServer({
  configFile: false,
  // The page comes from the plugin; nothing else is served from here.
  root: import.meta.dirname,
  plugins: [mockParent({ apiOrigin: process.env.API_URL, frontendOrigin: process.env.FRONTEND_URL })],
  server: { port, strictPort: true },
});
await server.listen();
console.log(`Mock parent running on http://localhost:${port}/mock-parent.html`);
