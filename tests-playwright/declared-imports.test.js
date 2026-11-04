/**
 * Every package Inka's workspace packages import is declared in that package's
 * own package.json, and they reach each other by package name.
 *
 * Frontends install these as workspace packages from their Inka checkout and
 * get only what each package declares. An import that only resolves here
 * because Inka's root installs (and hoists) it works in this repo and fails
 * there: gds-inka-docs' mock exited with ERR_MODULE_NOT_FOUND for `ignore`.
 *
 * A relative import that leaves its package hides the dependency from anyone
 * installing it, and breaks whenever the target moves, so only the ones listed
 * in OUTSIDE (each with its reason) are allowed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join, dirname, resolve, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Packages whose bare imports must all be in their own package.json. */
const DECLARING = ['packages/blockmd', 'packages/content-validator', 'packages/mock-api', 'packages/helpers', 'packages/inka-mcp'];
/** Packages whose relative imports must stay inside the package. */
const CONTAINED = [...DECLARING, 'packages/hydra-js', 'packages/volto-hydra'];

/** Build and test tooling inside a package, which may use its devDependencies. */
const DEV_TOOLING = /^packages\/inka-mcp\/(bundle\.mjs$|journeys\/)/;

/** Relative imports that leave their package, and why each may. */
const OUTSIDE = {
  'packages/content-validator/plone-content-validator.cjs -> packages/helpers/index.js':
    'runs with no install: Dockerfile.api copies the validator beside helpers, and pretagov-site CI runs bin/plone-content.cjs from a bare checkout',
  'packages/content-validator/plone-content-validator.cjs -> packages/helpers/buildBlockPathMap.js':
    'runs with no install (see above)',
  'packages/hydra-js/mergeTemplates.js -> packages/volto-hydra/src/utils/mergeTemplates.mjs':
    'the bridge re-exports the admin add-on\'s template merge; to move into helpers',
};

// A bare specifier is a package name (optionally scoped, optionally a subpath):
// it can't hold `$`, braces or spaces, which keeps prose such as
// `from '${state}'` in an error message from reading as an import.
const IMPORT = /(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]((?:@[\w.-]+\/)?[\w][\w.-]*(?:\/[\w.-]+)*)['"]/g;
const RELATIVE = /(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*)['"](\.\.?\/[^'"]+)['"]/g;

/** `@scope/name/sub` -> `@scope/name`; `name/sub` -> `name`. */
function packageOf(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

const manifest = (dir) => JSON.parse(readFileSync(join(ROOT, dir, 'package.json'), 'utf8'));

/** The package's own source: every module file, tests and build output excluded. */
function sourceFiles(dir) {
  const out = [];
  const walk = (rel) => {
    for (const e of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
      const p = join(rel, e.name);
      if (e.isDirectory()) {
        if (!['node_modules', 'dist', 'build'].includes(e.name)) walk(p);
      } else if (/\.(mjs|cjs|js|jsx)$/.test(e.name) && !/\.(test|spec)\./.test(e.name) && e.name !== 'hydra.js') {
        out.push(p);
      }
    }
  };
  walk(dir);
  return out;
}

describe('imports are declared', () => {
  it('finds the files it checks', () => {
    const files = CONTAINED.flatMap(sourceFiles);
    expect(files).toContain('packages/blockmd/markdown-mount.mjs');
    expect(files).toContain('packages/content-validator/plone-content-validator.cjs');
    expect(files).toContain('packages/mock-api/mock-api-server.cjs');
    expect(files).toContain('packages/volto-hydra/src/utils/blockSync.js');
  });

  it.each(DECLARING)('every bare import in %s is in its package.json', (dir) => {
    const pkg = manifest(dir);
    const runtime = [pkg.name, ...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {})];
    const undeclared = [];
    for (const file of sourceFiles(dir)) {
      const declared = new Set(DEV_TOOLING.test(file) ? [...runtime, ...Object.keys(pkg.devDependencies ?? {})] : runtime);
      for (const [, specifier] of readFileSync(join(ROOT, file), 'utf8').matchAll(IMPORT)) {
        const name = packageOf(specifier);
        if (isBuiltin(name) || declared.has(name)) continue;
        undeclared.push(`${file}: ${name}`);
      }
    }
    expect(undeclared).toEqual([]);
  });

  it.each(CONTAINED)('no relative import leaves %s', (dir) => {
    const leaving = [];
    for (const file of sourceFiles(dir)) {
      for (const [, specifier] of readFileSync(join(ROOT, file), 'utf8').matchAll(RELATIVE)) {
        const target = relative(ROOT, resolve(ROOT, dirname(file), specifier));
        if (target.startsWith(dir + '/') || `${file} -> ${target}` in OUTSIDE) continue;
        leaving.push(`${file} -> ${target}`);
      }
    }
    expect(leaving).toEqual([]);
  });
});
