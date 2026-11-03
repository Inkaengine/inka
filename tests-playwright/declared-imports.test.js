/**
 * Every package the blockmd engine, the content validator and the mock API
 * import is declared in that package's own package.json.
 *
 * Frontends install these as workspace packages from their Inka checkout and
 * get only what each package declares. An import that only resolves here
 * because Inka's root installs (and hoists) it works in this repo and fails
 * there: gds-inka-docs' mock exited with ERR_MODULE_NOT_FOUND for `ignore`.
 *
 * The same goes for a relative import that leaves the package: it must land in
 * a workspace package the importer depends on, or the dependency is invisible
 * to anyone installing it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join, dirname, resolve, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES = ['packages/blockmd', 'packages/content-validator', 'packages/mock-api', 'packages/helpers'];

/** Relative imports that leave their package without a package behind them. */
const OUTSIDE = {
  'packages/mock-api/mock-plone-api.cjs -> tests-playwright/fixtures/shared-block-schemas.js':
    "Inka's own test-frontend block schemas, which judge only content that ships in the Inka checkout",
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
const nameOf = Object.fromEntries(PACKAGES.map((dir) => [dir, manifest(dir).name]));

function sourceFiles(dir) {
  return readdirSync(join(ROOT, dir))
    .filter((name) => /\.(mjs|cjs|js)$/.test(name) && !/\.(test|spec)\./.test(name))
    .map((name) => join(dir, name));
}

describe('imports are declared', () => {
  it('finds the files it checks', () => {
    const files = PACKAGES.flatMap(sourceFiles);
    expect(files).toContain('packages/blockmd/markdown-mount.mjs');
    expect(files).toContain('packages/content-validator/plone-content-validator.cjs');
    expect(files).toContain('packages/mock-api/mock-api-server.cjs');
  });

  it.each(PACKAGES)('every bare import in %s is in its package.json', (dir) => {
    const declared = new Set(Object.keys(manifest(dir).dependencies ?? {}));
    const undeclared = [];
    for (const file of sourceFiles(dir)) {
      for (const [, specifier] of readFileSync(join(ROOT, file), 'utf8').matchAll(IMPORT)) {
        const name = packageOf(specifier);
        if (isBuiltin(name) || declared.has(name)) continue;
        undeclared.push(`${file}: ${name}`);
      }
    }
    expect(undeclared).toEqual([]);
  });

  it.each(PACKAGES)('every relative import leaving %s lands in a package it depends on', (dir) => {
    const declared = new Set(Object.keys(manifest(dir).dependencies ?? {}));
    const undeclared = [];
    for (const file of sourceFiles(dir)) {
      for (const [, specifier] of readFileSync(join(ROOT, file), 'utf8').matchAll(RELATIVE)) {
        const target = relative(ROOT, resolve(ROOT, dirname(file), specifier));
        if (target.startsWith(dir + '/')) continue;
        const owner = PACKAGES.find((p) => target.startsWith(p + '/'));
        if (owner && declared.has(nameOf[owner])) continue;
        if (`${file} -> ${target}` in OUTSIDE) continue;
        undeclared.push(`${file} -> ${target}`);
      }
    }
    expect(undeclared).toEqual([]);
  });
});
