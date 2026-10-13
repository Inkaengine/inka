/**
 * The mock resolves redirects.json the way Plone does: its paths are PHYSICAL
 * (/Plone/old), as plone.exportimport writes and imports them, under the site
 * root's @id. The mock used to read them site-relative, so a distribution's
 * redirects passed every test against the mock and then never fired on a real
 * site — the importer stored "/old" where no request looks.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const MODULE = path.join(__dirname, 'mock-plone-api.cjs');

/** A distribution whose site root is /Plone, holding /new, with `redirects`. */
function distribution(redirects) {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-redirects-'));
  for (const name of ['discussions.json', 'portlets.json', 'principals.json']) {
    fs.writeFileSync(path.join(dist, name), '{}');
  }
  fs.writeFileSync(path.join(dist, 'redirects.json'), JSON.stringify(redirects));
  const content = path.join(dist, 'content');
  const item = (dir, data) => {
    fs.mkdirSync(path.join(content, dir), { recursive: true });
    fs.writeFileSync(path.join(content, dir, 'data.json'), JSON.stringify(data));
  };
  item('plone_site_root', { '@id': '/Plone', '@type': 'Plone Site', UID: 'redirects-root-0001', id: 'Plone', title: 'Site' });
  item('new', { '@id': '/new', '@type': 'Document', UID: 'redirects-new-0001', id: 'new', title: 'New' });
  return content;
}

/** Load the mock with `mounts` and print what `expr` (over its exports) gives. */
function evaluate(mounts, expr) {
  const run = spawnSync(
    process.execPath,
    ['-e', `const m = require(${JSON.stringify(MODULE)});
      m.ready.then(() => {
        try { console.log('RESULT ' + JSON.stringify(${expr})); process.exit(0); }
        catch (e) { console.log('THREW ' + e.message); process.exit(0); }
      });`],
    {
      env: { ...process.env, CONTENT_MOUNTS: mounts, PORT: '0', SKIP_CONTENT_VALIDATION: 'true' },
      encoding: 'utf8',
      timeout: 60_000,
    },
  );
  assert.equal(run.status, 0, run.stderr.slice(-2000));
  const line = run.stdout.split('\n').find((l) => l.startsWith('RESULT ') || l.startsWith('THREW '));
  assert.ok(line, run.stdout.slice(-2000));
  return line.startsWith('RESULT ') ? { value: JSON.parse(line.slice(7)) } : { threw: line.slice(6) };
}

describe('mock API: redirects.json holds physical paths', () => {
  it('redirects /old to /new from {"/Plone/old": "/Plone/new"}', () => {
    const content = distribution({ '/Plone/old': '/Plone/new' });
    assert.deepEqual(evaluate(`/:${content}`, `m.getRedirectTarget('/old')`), { value: '/new' });
  });

  it('lists the alias site-relative in @aliases', () => {
    const content = distribution({ '/Plone/old': '/Plone/new' });
    assert.deepEqual(evaluate(`/:${content}`, `m.getAllRedirects()`), {
      value: [{ path: '/old', 'redirect-to': '/new' }],
    });
  });

  it('puts a mount prefix in front of the site-relative path', () => {
    const content = distribution({ '/Plone/old': '/Plone/new' });
    assert.deepEqual(evaluate(`/site:${content}`, `m.getRedirectTarget('/site/old')`), { value: '/site/new' });
  });

  it('fails on a site-relative entry, which Plone would never fire', () => {
    const content = distribution({ '/old': '/new' });
    const result = evaluate(`/:${content}`, `m.getRedirectTarget('/old')`);
    assert.match(result.threw ?? '', /"\/old".*\/Plone/);
  });
});
