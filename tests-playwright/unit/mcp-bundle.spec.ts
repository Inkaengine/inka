/**
 * What the hosted MCP server's bundle (packages/inka-mcp/bundle.mjs) carries.
 * It is one file, so every module in it shares the bundle's import.meta.url: a
 * module that starts itself when it is the program being run (server.mjs's
 * stdio server did) starts inside the hosted server too. And it ships, so it
 * carries the code it runs, not the repo's tests.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { bundling } from '../../packages/inka-mcp/bundle.mjs';

const mcp = (path: string) => fileURLToPath(new URL(`../../packages/inka-mcp/${path}`, import.meta.url));

/** The files the bundle of the hosted entry (start.mjs) is made from. */
const inputs = build({ ...bundling(mcp('start.mjs'), mcp('dist/unwritten.mjs')), write: false, metafile: true, logLevel: 'silent' })
  .then(({ metafile }) => Object.keys(metafile.inputs));

test('the hosted bundle carries nothing from the tests', async () => {
  expect((await inputs).filter((input) => input.includes('tests-playwright/'))).toEqual([]);
});

test('the hosted bundle carries no stdio server', async () => {
  expect((await inputs).filter((input) => /server[\\/]stdio\.js$/.test(input))).toEqual([]);
});

test('the hosted bundle leaves @sentry/node to the image', async () => {
  // Its instrumentation patches modules as they are loaded, which bundling it
  // would defeat, so it is external (bundle.mjs) -- and nothing of it is here.
  expect(bundling(mcp('start.mjs'), mcp('dist/unwritten.mjs')).external).toContain('@sentry/node');
  expect((await inputs).filter((input) => input.includes('@sentry/'))).toEqual([]);
});

test('the image installs every module the bundle leaves external', () => {
  // An external module is one the IMAGE must provide. Leaving one out of the
  // Dockerfile installs nothing and fails nothing: the server crashes when it
  // first imports it, in production.
  const dockerfile = readFileSync(mcp('Dockerfile'), 'utf8');
  const added = dockerfile.match(/^RUN .*\bpnpm add ([^\n]*)$/m);
  expect(added, 'the Dockerfile installs nothing with `pnpm add`').not.toBe(null);
  // The specs are written with ARGs now that consumers build this same file
  // (PLAYWRIGHT is theirs to pass, SENTRY is pinned here), so resolve each
  // ARG's default before reading them -- otherwise this asserts against
  // "${SENTRY}" and passes for the wrong reason.
  const defaults = new Map(
    [...dockerfile.matchAll(/^ARG\s+([A-Z_]+)=(\S+)$/gm)].map((m) => [m[1], m[2]]),
  );
  const resolved = added![1].replace(/\$\{([A-Z_]+)\}/g, (whole, name) => {
    const value = defaults.get(name);
    expect(value, `ARG ${name} has no default, so this test cannot resolve it`).toBeTruthy();
    return value!;
  });
  expect(resolved, 'every ${ARG} resolved').not.toContain('${');
  const installed = resolved.split(/\s+/).map((spec) => spec.replace(/@[^@]*$/, ''));
  const external = bundling(mcp('start.mjs'), mcp('dist/unwritten.mjs')).external as string[];
  expect([...external].sort()).toEqual([...installed].sort());
});
