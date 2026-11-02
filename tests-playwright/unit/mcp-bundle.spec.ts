/**
 * What the hosted MCP server's bundle (packages/inka-mcp/bundle.mjs) carries.
 * It is one file, so every module in it shares the bundle's import.meta.url: a
 * module that starts itself when it is the program being run (server.mjs's
 * stdio server did) starts inside the hosted server too. And it ships, so it
 * carries the code it runs, not the repo's tests.
 */
import { test, expect } from '@playwright/test';
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
