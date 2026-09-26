/**
 * The mock API must LOAD with a content mount that has a __metadata__.json.
 *
 * Startup content validation runs at module load for every mount that is an
 * exportimport tree (it has __metadata__.json) — and it read `mdRuntime`
 * seventy lines before `let mdRuntime` was declared. A `let` read before its
 * declaration throws (the temporal dead zone), so the server died with
 * "Cannot access 'mdRuntime' before initialization" before serving a request.
 *
 * Only mounts WITH __metadata__.json reach that line, and this repo's own test
 * mounts had none, so every CI job stayed green while a consumer whose content
 * is an exportimport distribution could not start the mock at all. Loading in a
 * fresh process is the point: the crash happens at require time, and the
 * in-process tests load the module once with the default mounts.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const MODULE = path.join(__dirname, 'mock-plone-api.cjs');

/**
 * The smallest exportimport tree: a __metadata__.json and one item. Built here
 * rather than borrowed — the docs site's old content tree is a leftover since
 * the docs moved to markdown, and a test should not break the day someone
 * deletes it.
 */
function exportTree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-startup-'));
  fs.writeFileSync(
    path.join(dir, '__metadata__.json'),
    JSON.stringify({ __version__: '1.0.0', _data_files_: ['page/data.json'], _blob_files_: [] }),
  );
  fs.mkdirSync(path.join(dir, 'page'));
  fs.writeFileSync(
    path.join(dir, 'page', 'data.json'),
    JSON.stringify({ '@id': '/page', '@type': 'Document', UID: 'startup-page-0001', id: 'page', title: 'Page' }),
  );
  return dir;
}

describe('mock API startup', () => {
  it('loads with a mount that is an exportimport tree (has __metadata__.json)', () => {
    const run = spawnSync(
      process.execPath,
      ['-e', `require(${JSON.stringify(MODULE)}); process.exit(0);`],
      {
        env: {
          ...process.env,
          CONTENT_MOUNTS: `/:${exportTree()}`,
          SKIP_CONTENT_VALIDATION: '',
        },
        encoding: 'utf8',
        timeout: 60_000,
      },
    );
    assert.doesNotMatch(run.stderr, /before initialization/);
    assert.equal(run.status, 0, `module failed to load:\n${run.stderr.slice(-2000)}`);
  });
});

/**
 * A plain JSON mount (no __metadata__.json — how the test fixtures are laid
 * out) holding one page, with `extra` merged into its data.
 */
function jsonMount(extra) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-validate-'));
  fs.mkdirSync(path.join(dir, 'page'));
  fs.writeFileSync(
    path.join(dir, 'page', 'data.json'),
    JSON.stringify({ '@id': '/page', '@type': 'Document', UID: `validate-${path.basename(dir)}`, id: 'page', title: 'Page', ...extra }),
  );
  return dir;
}

const teaserTo = (href) => ({
  blocks: { t1: { '@type': 'teaser', href: [{ '@id': href }] } },
  blocks_layout: { items: ['t1'] },
});

/** Wait for the module's `ready`, then report how it settled. */
function loadAndAwaitReady(mounts, env = {}) {
  return spawnSync(
    process.execPath,
    ['-e', `require(${JSON.stringify(MODULE)}).ready.then(
      () => process.exit(0),
      (e) => { console.error('READY REJECTED: ' + e.message); process.exit(3); })`],
    {
      env: { ...process.env, CONTENT_MOUNTS: mounts, SKIP_CONTENT_VALIDATION: '', ...env },
      encoding: 'utf8',
      timeout: 60_000,
    },
  );
}

describe('mock API content validation', () => {
  it('refuses to become ready when served content links to nothing', () => {
    const run = loadAndAwaitReady(`/:${jsonMount(teaserTo('/no-such-page'))}`);
    assert.equal(run.status, 3, `expected ready to reject:\n${run.stdout.slice(-2000)}${run.stderr.slice(-2000)}`);
    assert.match(run.stderr, /\/page: block t1 \(teaser\) href: path not in content: \/no-such-page/);
  });

  it('checks every mount, not only exportimport trees', () => {
    // No __metadata__.json anywhere — the old startup check skipped these.
    const run = loadAndAwaitReady(`/:${jsonMount(teaserTo('/gone'))}`);
    assert.match(run.stderr, /path not in content: \/gone/);
  });

  it('resolves a link across mounts, as the served site does', () => {
    const other = jsonMount({});
    const run = loadAndAwaitReady(
      `/other:${other},/:${jsonMount(teaserTo('/other/page'))}`,
    );
    assert.equal(run.status, 0, `valid cross-mount link rejected:\n${run.stderr.slice(-2000)}`);
  });

  it('becomes ready on clean content', () => {
    const run = loadAndAwaitReady(`/:${jsonMount(teaserTo('/page'))}`);
    assert.equal(run.status, 0, `clean content rejected:\n${run.stderr.slice(-2000)}`);
  });

  for (const server of ['mock-plone-api.cjs', 'mock-api-server.cjs']) it(`${server} exits non-zero on invalid content`, () => {
    const run = spawnSync(process.execPath, [path.join(__dirname, server)], {
      env: {
        ...process.env,
        CONTENT_MOUNTS: `/:${jsonMount(teaserTo('/no-such-page'))}`,
        SKIP_CONTENT_VALIDATION: '',
        PORT: '0',
      },
      encoding: 'utf8',
      timeout: 60_000,
    });
    assert.equal(run.status, 1, `server kept running or exited ${run.status}:\n${run.stderr.slice(-2000)}`);
    assert.match(run.stderr, /path not in content: \/no-such-page/);
  });

  it("does not judge a consumer's blocks by hydra's test schemas", () => {
    // hydra's shared-block-schemas describe ITS test frontend. A frontend that
    // mounts its own content has its own `hero` — here one whose description is
    // plain text, where hydra's test hero declares a slate field.
    const run = loadAndAwaitReady(`/:${jsonMount({
      blocks: { h: { '@type': 'hero', description: 'plain text' } },
      blocks_layout: { items: ['h'] },
    })}`);
    assert.equal(run.status, 0, run.stderr.slice(-2000));
  });

  it("judges content shipped in this checkout by hydra's schemas", () => {
    // The same block, mounted from inside hydra, IS hydra's test content.
    const dir = fs.mkdtempSync(path.join(__dirname, '.content-check-'));
    try {
      fs.mkdirSync(path.join(dir, 'page'));
      fs.writeFileSync(path.join(dir, 'page', 'data.json'), JSON.stringify({
        '@id': '/page', '@type': 'Document', UID: 'owned-page', id: 'page', title: 'Page',
        blocks: { h: { '@type': 'hero', description: 'plain text' } },
        blocks_layout: { items: ['h'] },
      }));
      const run = loadAndAwaitReady(`/:${dir}`);
      assert.equal(run.status, 3, run.stderr.slice(-2000));
      assert.match(run.stderr, /block h \(hero\) field "description" is widget:slate but its value is string/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a problem the mount declares in expected-errors.json does not stop it', () => {
    // A fixture that is broken ON PURPOSE (it tests how the frontend copes).
    const dir = jsonMount(teaserTo('/no-such-page'));
    fs.writeFileSync(
      path.join(dir, 'expected-errors.json'),
      JSON.stringify({ '/page': ['href: path not in content: /no-such-page'] }),
    );
    const run = loadAndAwaitReady(`/mnt:${dir},/:${jsonMount({})}`);
    assert.equal(run.status, 0, `declared problem rejected:\n${run.stderr.slice(-2000)}`);
  });

  it('a declared problem that no longer occurs is itself an error', () => {
    const dir = jsonMount(teaserTo('/page'));
    fs.writeFileSync(
      path.join(dir, 'expected-errors.json'),
      JSON.stringify({ '/page': ['href: path not in content: /no-such-page'] }),
    );
    const run = loadAndAwaitReady(`/:${dir}`);
    assert.equal(run.status, 3, run.stderr.slice(-2000));
    assert.match(run.stderr, /\/page: expected-errors\.json expects "href: path not in content: \/no-such-page", which no longer occurs/);
  });

  it('a declared problem excuses only itself', () => {
    const dir = jsonMount({
      blocks: {
        t1: { '@type': 'teaser', href: [{ '@id': '/no-such-page' }] },
        t2: { '@type': 'teaser', href: [{ '@id': '/also-gone' }] },
      },
      blocks_layout: { items: ['t1', 't2'] },
    });
    fs.writeFileSync(
      path.join(dir, 'expected-errors.json'),
      JSON.stringify({ '/page': ['href: path not in content: /no-such-page'] }),
    );
    const run = loadAndAwaitReady(`/:${dir}`);
    assert.equal(run.status, 3);
    assert.match(run.stderr, /path not in content: \/also-gone/);
    assert.doesNotMatch(run.stderr, /block t1 .*no-such-page/);
  });

  it('SKIP_CONTENT_VALIDATION=true still starts', () => {
    const run = loadAndAwaitReady(`/:${jsonMount(teaserTo('/no-such-page'))}`, { SKIP_CONTENT_VALIDATION: 'true' });
    assert.equal(run.status, 0, run.stderr.slice(-2000));
  });
});

describe('plone-content served', () => {
  const CLI = path.join(__dirname, '..', '..', 'bin', 'plone-content.cjs');
  const served = (mounts) =>
    spawnSync(process.execPath, [CLI, 'served'], {
      env: { ...process.env, CONTENT_MOUNTS: mounts, SKIP_CONTENT_VALIDATION: '' },
      encoding: 'utf8',
      timeout: 60_000,
    });

  it('fails, listing the problems, on the site CONTENT_MOUNTS describes', () => {
    const run = served(`/:${jsonMount(teaserTo('/no-such-page'))}`);
    assert.equal(run.status, 1, run.stderr.slice(-2000));
    assert.match(run.stderr, /path not in content: \/no-such-page/);
  });

  it('passes a clean site', () => {
    const run = served(`/:${jsonMount(teaserTo('/page'))}`);
    assert.equal(run.status, 0, run.stderr.slice(-2000));
  });
});
