#!/usr/bin/env node
/**
 * Bundle Volto's field validation for the offline content check.
 *
 * The editor's save refuses a block whose fields fail Volto's validators
 * (required, minLength/maxLength, pattern, url, email, number limits, item
 * counts — core's config/validation.ts). The content check
 * (lib/plone-content-validator.cjs) runs where Volto is not installed — a bare
 * Node with no npm packages — so it gets the same code as one dependency-free
 * file, built from Volto's source rather than copied from it:
 *
 *   node scripts/build-volto-validation.mjs [--volto <dir>] [--registry <entry>]
 *
 *   --volto     Volto's package root (holding src/). Default: core/packages/volto,
 *               the version mrs.developer.json pins.
 *   --registry  @plone/registry's entry module. Default: core/packages/registry/src/index.ts.
 *
 * Writes lib/volto-validation.cjs (not committed: it is built, like core is
 * fetched). Five Volto files and a few lodash helpers; the pop-up messages and
 * react-intl, which field validation does not use, are stubs
 * (scripts/volto-validation/).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stubs = path.join(root, 'scripts', 'volto-validation');
const { values } = parseArgs({
  options: {
    volto: { type: 'string', default: path.join(root, 'core', 'packages', 'volto') },
    registry: { type: 'string', default: path.join(root, 'core', 'packages', 'registry', 'src', 'index.ts') },
    out: { type: 'string', default: path.join(root, 'lib', 'volto-validation.cjs') },
  },
});

await build({
  entryPoints: [path.join(stubs, 'entry.js')],
  outfile: path.resolve(values.out),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  logLevel: 'warning',
  // lodash (and esbuild itself) resolve from the install: Inka's .npmrc hoists
  // every dependency to the top node_modules, as Volto's build relies on too.
  nodePaths: [path.join(path.resolve(values.volto), 'node_modules'), path.join(root, 'node_modules')],
  alias: {
    '@plone/volto/components/manage/Toast/Toast': path.join(stubs, 'toast.js'),
    '@plone/volto': path.join(path.resolve(values.volto), 'src'),
    '@plone/registry': path.resolve(values.registry),
    'react-intl': path.join(stubs, 'react-intl.js'),
    'react-toastify': path.join(stubs, 'toast.js'),
  },
  resolveExtensions: ['.ts', '.tsx', '.js', '.jsx'],
  loader: { '.js': 'jsx' },
  jsx: 'automatic',
  jsxImportSource: stubs,
  banner: { js: '// Built by scripts/build-volto-validation.mjs from Volto\'s source. Do not edit.' },
});
console.log(`wrote ${path.relative(process.cwd(), path.resolve(values.out))}`);
