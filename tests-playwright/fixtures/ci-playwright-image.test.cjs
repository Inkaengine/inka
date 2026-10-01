/**
 * The CI browser jobs run in Playwright's image, whose baked-in browsers are
 * the ones THAT Playwright version drives. If @playwright/test moves on and the
 * image tag doesn't, every browser test asks for browsers the image hasn't got.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

test("the CI Playwright image matches @playwright/test's version", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const version = (pkg.devDependencies?.['@playwright/test'] ?? pkg.dependencies?.['@playwright/test'])?.replace(/^[^\d]*/, '');
  assert.ok(version, 'package.json declares @playwright/test');
  const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/test.yaml'), 'utf8');
  const tags = [...workflow.matchAll(/mcr\.microsoft\.com\/playwright:v([\d.]+)/g)].map((m) => m[1]);
  assert.ok(tags.length > 0, 'the browser jobs run in the Playwright image');
  for (const tag of tags) assert.equal(tag, version, `image v${tag} vs @playwright/test ${version}`);
});
