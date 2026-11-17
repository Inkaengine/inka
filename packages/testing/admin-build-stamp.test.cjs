/**
 * The admin build carries a stamp of the source it was built from, so a test
 * run can tell a built admin that is behind its checkout from one that is not.
 *
 * Run: node --test packages/testing/admin-build-stamp.test.cjs
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { adminStamp, inAdminBuild, writeBuildStamp, checkBuild, StaleAdmin } = require('./admin-build-stamp.cjs');

/** A small Inka-shaped checkout: an add-on, a fixture the admin imports, docs it does not. */
function checkout() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-stamp-'));
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  write('packages/volto-hydra/src/index.js', 'export default 1;\n');
  write('tests-playwright/fixtures/shared-block-schemas.js', 'export const s = {};\n');
  write('tests-playwright/editing.spec.ts', 'test();\n');
  write('docs/guide.md', '# Guide\n');
  write('mrs.developer.json', '{"core":{"tag":"19.5.1"}}\n');
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init', '-q');
  git('-c', 'user.email=t@example.org', '-c', 'user.name=t', 'add', '.');
  git('-c', 'user.email=t@example.org', '-c', 'user.name=t', 'commit', '-qm', 'start');
  return { root, write };
}

test('the admin build takes its code from the add-on and the fixtures it imports, not the docs or the specs', () => {
  assert.equal(inAdminBuild('packages/volto-hydra/src/index.js'), true);
  assert.equal(inAdminBuild('tests-playwright/fixtures/shared-block-schemas.js'), true);
  assert.equal(inAdminBuild('mrs.developer.json'), true);
  assert.equal(inAdminBuild('tests-playwright/editing.spec.ts'), false);
  assert.equal(inAdminBuild('docs/guide.md'), false);
  assert.equal(inAdminBuild('README.md'), false);
  assert.equal(inAdminBuild('examples/nuxt-blog-starter/app.vue'), false);
  assert.equal(inAdminBuild('.github/workflows/test.yaml'), false);
});

test('a change the admin builds from changes the stamp; one it does not, does not', () => {
  const { root, write } = checkout();
  const before = adminStamp(root);
  assert.equal(adminStamp(root), before, 'the same checkout gives the same stamp');

  write('docs/guide.md', '# Guide, revised\n');
  write('tests-playwright/editing.spec.ts', 'test(); test();\n');
  assert.equal(adminStamp(root), before, 'docs and specs are not built into the admin');

  write('packages/volto-hydra/src/index.js', 'export default 2;\n');
  const edited = adminStamp(root);
  assert.notEqual(edited, before, 'an uncommitted edit to the add-on counts');

  write('packages/volto-hydra/src/new.js', 'export const n = 1;\n');
  assert.notEqual(adminStamp(root), edited, 'so does a new file');
});

test('a build is checked against its checkout: missing, stale, or current', () => {
  const { root, write } = checkout();
  assert.throws(() => checkBuild(root), (e) => e instanceof StaleAdmin && /no admin build/.test(e.message) && /pnpm build:test/.test(e.message));

  writeBuildStamp(root);
  const stampFile = path.join(root, 'build', 'public', 'inka-build.json');
  assert.equal(JSON.parse(fs.readFileSync(stampFile, 'utf8')).stamp, adminStamp(root), 'served beside the admin');
  assert.doesNotThrow(() => checkBuild(root));

  write('packages/volto-hydra/src/index.js', 'export default 3;\n');
  assert.throws(() => checkBuild(root), (e) => e instanceof StaleAdmin && /older than this checkout/.test(e.message) && /pnpm build:test/.test(e.message));
});
