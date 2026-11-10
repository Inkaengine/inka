/**
 * The two scripts the admin image uses to take a site's plugin list.
 *
 * They are small, and they are the only moving parts of docker/admin.Dockerfile
 * other than the install itself, so the image's ONE RULE -- exactly one
 * `pnpm install`, nothing re-resolving after it -- rests on them doing their
 * jobs on the right side of that install:
 *
 *   add-plugins    BEFORE the install, writing package.json, so a plugin Inka
 *                  does not declare still costs only one resolution pass.
 *   enable-plugins AFTER it, writing volto.config.js, which cannot touch the
 *                  dependency graph at all.
 *
 * The happy path was verified by a real image build. These cover what a build
 * does not: the empty lists (the default for every consumer that enables
 * nothing), the refusals, and that an existing config survives.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ADD = path.join(__dirname, 'add-plugins.cjs');
const ENABLE = path.join(__dirname, 'enable-plugins.cjs');

/** A throwaway cwd holding `files`, since both scripts write relative paths. */
function sandbox(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inka-plugins-'));
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), body);
  }
  return dir;
}

function run(script, arg, cwd) {
  try {
    return {
      code: 0,
      out: execFileSync(process.execPath, [script, arg], { cwd, encoding: 'utf8' }),
    };
  } catch (e) {
    return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

const PKG = JSON.stringify(
  { name: 'volto-hydra', dependencies: { react: '18.2.0' } },
  null,
  2,
);
const CONFIG = "module.exports = { addons: ['volto-hydra'], theme: 'mine' };\n";

const pkgOf = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));

/** The addons volto.config.js resolves to, loaded as the build would load it. */
function addonsOf(dir) {
  return require(path.join(dir, 'volto.config.js')).addons;
}

// ---------------------------------------------------------------- add-plugins

test('a pinned plugin is added to dependencies', () => {
  const dir = sandbox({ 'package.json': PKG });
  const { code } = run(ADD, '@plone-collective/volto-sentry@1.0.1', dir);
  assert.equal(code, 0);
  assert.equal(pkgOf(dir).dependencies['@plone-collective/volto-sentry'], '1.0.1');
});

test('a scoped name is not split on its LEADING @', () => {
  // Splitting at index 0 would name the dependency '' and pin it to
  // 'scope/name@2.3.4'. (Splitting at the last @ or at the first one after
  // index 0 are the same thing for a `@scope/name@version`, so this asserts
  // only what matters: the leading @ is not the separator.)
  const dir = sandbox({ 'package.json': PKG });
  run(ADD, '@scope/name@2.3.4', dir);
  const deps = pkgOf(dir).dependencies;
  assert.equal(deps['@scope/name'], '2.3.4');
  assert.ok(!('@scope' in deps), 'split on the leading @');
});

test('existing dependencies survive', () => {
  const dir = sandbox({ 'package.json': PKG });
  run(ADD, '@scope/a@1.0.0 @scope/b@2.0.0', dir);
  const deps = pkgOf(dir).dependencies;
  assert.equal(deps.react, '18.2.0');
  assert.equal(deps['@scope/a'], '1.0.0');
  assert.equal(deps['@scope/b'], '2.0.0');
});

test('an UNPINNED plugin is refused, and package.json is left alone', () => {
  // An unpinned plugin resolves to whatever is latest at build time, so two
  // builds of one commit would differ. Refusing is the point.
  const dir = sandbox({ 'package.json': PKG });
  const { code, out } = run(ADD, '@scope/name', dir);
  assert.equal(code, 1);
  assert.match(out, /no version/);
  assert.deepEqual(pkgOf(dir).dependencies, { react: '18.2.0' });
});

test('one bad entry refuses the whole list', () => {
  const dir = sandbox({ 'package.json': PKG });
  const { code } = run(ADD, '@scope/good@1.0.0 @scope/bad', dir);
  assert.equal(code, 1);
  assert.ok(!('@scope/bad' in pkgOf(dir).dependencies));
});

test('an empty list touches nothing: the frozen install stays frozen', () => {
  const dir = sandbox({ 'package.json': PKG });
  const before = fs.readFileSync(path.join(dir, 'package.json'), 'utf8');
  const { code } = run(ADD, '   ', dir);
  assert.equal(code, 0);
  assert.equal(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'), before);
});

// ------------------------------------------------------------- enable-plugins

test('named plugins are appended to the base addons', () => {
  const dir = sandbox({ 'volto.config.js': CONFIG });
  const { code } = run(ENABLE, '@plone-collective/volto-authomatic @plone-collective/volto-sentry', dir);
  assert.equal(code, 0);
  assert.deepEqual(addonsOf(dir), [
    'volto-hydra',
    '@plone-collective/volto-authomatic',
    '@plone-collective/volto-sentry',
  ]);
});

test('the rest of an upstream config survives', () => {
  const dir = sandbox({ 'volto.config.js': CONFIG });
  run(ENABLE, '@scope/name', dir);
  assert.equal(require(path.join(dir, 'volto.config.js')).theme, 'mine');
});

test('a version is stripped: volto.config wants package names', () => {
  const dir = sandbox({ 'volto.config.js': CONFIG });
  run(ENABLE, '@scope/name@1.2.3 plain@4.5.6', dir);
  assert.deepEqual(addonsOf(dir), ['volto-hydra', '@scope/name', 'plain']);
});

test('VOLTO_PLUGINS="" leaves volto.config.js byte-identical', () => {
  // The default for every consumer that enables nothing. The Dockerfile calls
  // this as `"$VOLTO_PLUGINS $EXTRA_PLUGINS"`, so with both unset the argument
  // is a single space, not an empty string.
  const dir = sandbox({ 'volto.config.js': CONFIG });
  const { code, out } = run(ENABLE, ' ', dir);
  assert.equal(code, 0);
  assert.match(out, /nothing to enable/);
  assert.equal(fs.readFileSync(path.join(dir, 'volto.config.js'), 'utf8'), CONFIG);
  assert.equal(
    fs.existsSync(path.join(dir, 'volto.config.base.js')),
    false,
    'wrote a base copy for a no-op, leaving a file the image did not need',
  );
});

test('enabling nothing still leaves Inka enabling nothing of its own', () => {
  const dir = sandbox({ 'volto.config.js': "module.exports = { addons: [] };\n" });
  run(ENABLE, ' ', dir);
  assert.deepEqual(addonsOf(dir), []);
});
