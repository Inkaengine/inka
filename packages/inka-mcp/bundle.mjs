#!/usr/bin/env node
/**
 * Bundle the hosted MCP server into one file, for its image (Dockerfile):
 * everything it imports — the MCP SDK, the markdown libraries, the repo's
 * lib/slate-md.mjs — except Playwright, which the image's base provides with
 * its browser. Run from the repo, with its dependencies installed:
 *
 *   node packages/inka-mcp/bundle.mjs   → packages/inka-mcp/dist/inka-mcp-http.mjs
 *
 * A deployment with an entry of its own (passing main a code store or a
 * route) bundles that instead: node packages/inka-mcp/bundle.mjs <entry> <outfile>
 */
import { build } from 'esbuild';
import { realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));

/**
 * The screenshot view's ext-apps client is read from node_modules when run
 * from source (appClient.mjs); the image has none, so the bundle carries the
 * text, read here the same way.
 */
const inlineAppClient = {
  name: 'inline-app-client',
  setup(build) {
    build.onLoad({ filter: /inka-mcp[\\/]appClient\.mjs$/ }, async ({ path }) => {
      const { appClientSource } = await import(path);
      return { contents: `export const appClientSource = ${JSON.stringify(appClientSource)};`, loader: 'js' };
    });
  },
};

/** esbuild's options for bundling `entry` into `outfile` (bundle.test.mjs asks what they take in). */
export function bundling(entry, outfile) {
  return {
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    external: ['playwright'],
    plugins: [inlineAppClient],
    // Bundled CommonJS (express, inside the SDK) still calls require() for
    // Node's own modules; an ES module has no require of its own.
    banner: { js: "import { createRequire as __inkaRequire } from 'node:module'; const require = __inkaRequire(import.meta.url);" },
    logLevel: 'warning',
  };
}

if (import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const [entry, outfile] = process.argv.length > 2
    ? [resolve(process.argv[2]), resolve(process.argv[3] ?? '')]
    : [here('./start.mjs'), here('./dist/inka-mcp-http.mjs')];
  if (process.argv.length > 2 && !process.argv[3]) throw new Error('bundle.mjs <entry> <outfile>: name the file to write');
  await build(bundling(entry, outfile));
  console.log(`bundled ${outfile}`);
}
