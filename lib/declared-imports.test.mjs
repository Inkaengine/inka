/**
 * Every package the blockmd engine and the mock API import is declared in
 * Inka's package.json.
 *
 * Frontends run these files from their own checkouts (the docs repos mount
 * markdown through lib/markdown-mount.mjs and serve it with the mock API), and
 * install what Inka declares. An import that only resolves here because some
 * other package's dependency was hoisted works in this repo and fails there:
 * gds-inka-docs' mock exited with ERR_MODULE_NOT_FOUND for `ignore`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHIPPED = ['lib', 'tests-playwright/fixtures'];

// A bare specifier is a package name (optionally scoped, optionally a subpath):
// it can't hold `$`, braces or spaces, which keeps prose such as
// `from '${state}'` in an error message from reading as an import.
const IMPORT = /(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]((?:@[\w.-]+\/)?[\w][\w.-]*(?:\/[\w.-]+)*)['"]/g;

/** `@scope/name/sub` -> `@scope/name`; `name/sub` -> `name`. */
function packageOf(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function shippedFiles() {
  return SHIPPED.flatMap((dir) =>
    readdirSync(join(ROOT, dir))
      .filter((name) => /\.(mjs|cjs|js)$/.test(name) && !/\.(test|spec)\./.test(name))
      .map((name) => join(dir, name)),
  );
}

describe('imports are declared', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const declared = new Set([...Object.keys(pkg.dependencies), ...Object.keys(pkg.devDependencies)]);

  it('finds the files it checks', () => {
    expect(shippedFiles()).toContain('lib/markdown-mount.mjs');
    expect(shippedFiles()).toContain('tests-playwright/fixtures/mock-api-server.cjs');
  });

  it('every bare import in the engine and the mock API is in package.json', () => {
    const undeclared = [];
    for (const file of shippedFiles()) {
      for (const [, specifier] of readFileSync(join(ROOT, file), 'utf8').matchAll(IMPORT)) {
        const name = packageOf(specifier);
        if (isBuiltin(name) || declared.has(name)) continue;
        undeclared.push(`${file}: ${name}`);
      }
    }
    expect(undeclared).toEqual([]);
  });
});
