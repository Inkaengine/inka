/**
 * The mock keeps an unpublished page from an anonymous reader, as Plone does.
 *
 * Plone answers 401 to an anonymous GET of content whose workflow state the
 * public may not view: under simple_publication_workflow that is `private` (the
 * state a new page starts in) and `pending`. The mock served every page to
 * everyone, so a frontend that fetched a private page WITHOUT the editor's token
 * passed every test against the mock and showed "Sign in to view this page" to
 * the editor on a real site.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mintToken } = require('./mock-tokens.cjs');

const MODULE = path.join(__dirname, 'mock-plone-api.cjs');

/** A distribution whose site root holds one page in each workflow state. */
function distribution() {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-private-'));
  for (const name of ['discussions.json', 'portlets.json', 'principals.json', 'redirects.json']) {
    fs.writeFileSync(path.join(dist, name), '{}');
  }
  const content = path.join(dist, 'content');
  const item = (dir, data) => {
    fs.mkdirSync(path.join(content, dir), { recursive: true });
    fs.writeFileSync(path.join(content, dir, 'data.json'), JSON.stringify(data));
  };
  item('plone_site_root', { '@id': '/Plone', '@type': 'Plone Site', UID: 'private-root-0001', id: 'Plone', title: 'Site' });
  for (const state of ['private', 'pending', 'published']) {
    item(state, {
      '@id': `/${state}`, '@type': 'Document', UID: `private-${state}-0001`,
      id: state, title: state, review_state: state,
    });
  }
  return content;
}

/** GET each of `paths` from the mock, with `headers`; their statuses. */
function statuses(paths, headers) {
  const content = distribution();
  const run = spawnSync(
    process.execPath,
    ['-e', `const m = require(${JSON.stringify(MODULE)});
      m.ready.then(async () => {
        const srv = m.app.listen(0);
        await require('events').once(srv, 'listening');
        const port = srv.address().port;
        const out = {};
        for (const p of ${JSON.stringify(paths)}) {
          const res = await fetch('http://localhost:' + port + '/++api++' + p, {
            headers: { Accept: 'application/json', ...${JSON.stringify(headers)} },
          });
          out[p] = res.status;
        }
        console.log('RESULT ' + JSON.stringify(out));
        process.exit(0);
      });`],
    {
      env: { ...process.env, CONTENT_MOUNTS: `/:${content}`, PORT: '0' },
      encoding: 'utf8',
      timeout: 60_000,
    },
  );
  assert.equal(run.status, 0, run.stderr.slice(-2000));
  const line = run.stdout.split('\n').find((l) => l.startsWith('RESULT '));
  assert.ok(line, run.stdout.slice(-2000));
  return JSON.parse(line.slice(7));
}

describe('mock API: unpublished content is not for anonymous readers', () => {
  it('answers 401 to an anonymous GET of a private or pending page', () => {
    assert.deepEqual(statuses(['/private', '/pending'], {}), { '/private': 401, '/pending': 401 });
  });

  it('still serves a published page to an anonymous reader', () => {
    assert.deepEqual(statuses(['/published'], {}), { '/published': 200 });
  });

  it('serves every page to a logged-in reader', () => {
    assert.deepEqual(
      statuses(['/private', '/pending', '/published'], { Authorization: `Bearer ${mintToken('editor')}` }),
      { '/private': 200, '/pending': 200, '/published': 200 },
    );
  });
});
