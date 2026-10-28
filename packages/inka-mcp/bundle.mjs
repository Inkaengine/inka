#!/usr/bin/env node
/**
 * Bundle the hosted MCP server into one file, for its image (Dockerfile):
 * everything it imports — the MCP SDK, the markdown libraries, the repo's
 * lib/slate-md.mjs — except Playwright, which the image's base provides with
 * its browser. Run from the repo, with its dependencies installed:
 *
 *   node packages/inka-mcp/bundle.mjs   → packages/inka-mcp/dist/inka-mcp-http.mjs
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));

await build({
  entryPoints: [here('./http.mjs')],
  outfile: here('./dist/inka-mcp-http.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  external: ['playwright'],
  // Bundled CommonJS (express, inside the SDK) still calls require() for
  // Node's own modules; an ES module has no require of its own.
  banner: { js: "import { createRequire as __inkaRequire } from 'node:module'; const require = __inkaRequire(import.meta.url);" },
  logLevel: 'warning',
});
console.log(`bundled ${here('./dist/inka-mcp-http.mjs')}`);
