import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Adapters run in the BROWSER — that is the point of the inversion, so
 * credentials stay on the frontend's origin and never reach the admin.
 *
 * The contract suite drives them under Node, where Node globals resolve
 * happily. A Node-only global therefore passes every one of the 47 contract
 * assertions and then throws the moment a real frontend loads the adapter,
 * where it surfaces as a failed handshake and an editor that waits forever for
 * an ADAPTER_READY that never comes. That is exactly what `Buffer` did.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGES = path.resolve(HERE, '..');

const NODE_ONLY = [
  ['Buffer', /\bBuffer\s*\./],
  ['process', /\bprocess\s*\.(?!env\b)/],
  ['require', /\brequire\s*\(/],
  ['__dirname', /\b__dirname\b/],
  ['node: import', /from\s+['"]node:/],
];

function adapterSources() {
  return fs
    .readdirSync(PACKAGES)
    .filter((d) => d.startsWith('hydra-adapters-'))
    .map((d) => path.join(PACKAGES, d, 'index.js'))
    .filter((f) => fs.existsSync(f));
}

test('adapter sources use no Node-only globals', () => {
  const offenders = [];
  for (const file of adapterSources()) {
    const source = fs
      .readFileSync(file, 'utf8')
      // Comments explaining why we avoid these must not trip the check.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const [name, pattern] of NODE_ONLY) {
      if (pattern.test(source)) {
        offenders.push(`${path.basename(path.dirname(file))}: ${name}`);
      }
    }
  }
  expect(offenders).toEqual([]);
});

test('there is at least one adapter to check', () => {
  expect(adapterSources().length).toBeGreaterThan(0);
});
