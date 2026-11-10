/**
 * The mock's @submit-form keeps an unpublished page's form from an anonymous
 * caller, as Plone does.
 *
 * collective.volto.formsupport's @submit-form is a service on the page, so it
 * needs View there: on a page the public may not view (`private`, where every
 * new page starts, and `pending`) an anonymous submission is refused 401. The
 * mock accepted it, so a frontend that submitted WITHOUT the editor's token
 * passed every test here and failed on a real site the first time an author
 * tried a form before publishing it.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mintToken } = require('./mock-tokens.cjs');

const MODULE = path.join(__dirname, 'mock-plone-api.cjs');
const BLOCK = 'form-block-0001';

/** A distribution whose site root holds a page with a form in each workflow state. */
function distribution() {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-submit-private-'));
  for (const name of ['discussions.json', 'portlets.json', 'principals.json', 'redirects.json']) {
    fs.writeFileSync(path.join(dist, name), '{}');
  }
  const content = path.join(dist, 'content');
  const item = (dir, data) => {
    fs.mkdirSync(path.join(content, dir), { recursive: true });
    fs.writeFileSync(path.join(content, dir, 'data.json'), JSON.stringify(data));
  };
  item('plone_site_root', { '@id': '/Plone', '@type': 'Plone Site', UID: 'submit-root-0001', id: 'Plone', title: 'Site' });
  for (const state of ['private', 'pending', 'published']) {
    item(state, {
      '@id': `/${state}`, '@type': 'Document', UID: `submit-${state}-0001`,
      id: state, title: state, review_state: state,
      blocks: {
        [BLOCK]: {
          '@type': 'form', store: true,
          subblocks: [{ field_id: 'name', field_type: 'text', label: 'Name' }],
        },
      },
      blocks_layout: { items: [BLOCK] },
    });
  }
  return content;
}

/** POST a one-field submission to each of `paths`' @submit-form, with `headers`; their statuses. */
function statuses(paths, headers) {
  const content = distribution();
  const body = { block_id: BLOCK, data: [{ field_id: 'name', label: 'Name', value: 'Ann' }] };
  const run = spawnSync(
    process.execPath,
    ['-e', `const m = require(${JSON.stringify(MODULE)});
      m.ready.then(async () => {
        const srv = m.app.listen(0);
        await require('events').once(srv, 'listening');
        const port = srv.address().port;
        const out = {};
        for (const p of ${JSON.stringify(paths)}) {
          const res = await fetch('http://localhost:' + port + '/++api++' + p + '/@submit-form', {
            method: 'POST',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...${JSON.stringify(headers)} },
            body: ${JSON.stringify(JSON.stringify(body))},
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

describe('mock API: @submit-form on unpublished content needs a login', () => {
  it('answers 401 to an anonymous submission on a private or pending page', () => {
    assert.deepEqual(statuses(['/private', '/pending'], {}), { '/private': 401, '/pending': 401 });
  });

  it('still takes an anonymous submission on a published page', () => {
    assert.deepEqual(statuses(['/published'], {}), { '/published': 204 });
  });

  it("takes a submission on every page with the editor's token", () => {
    assert.deepEqual(
      statuses(['/private', '/pending', '/published'], { Authorization: `Bearer ${mintToken('editor')}` }),
      { '/private': 204, '/pending': 204, '/published': 204 },
    );
  });
});
