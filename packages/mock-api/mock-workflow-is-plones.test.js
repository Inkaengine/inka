/**
 * What a new page's state is, and what a File's state is at all.
 *
 * This mock answered `published` to both, which is two different fictions.
 *
 * Plone's default binding is simple_publication_workflow, whose
 * initial_state is `private` (Products/CMFPlone/profiles/default/workflows/
 * simple_publication_workflow/definition.xml) — so a page a frontend has just
 * created is NOT visible to the public, and anything built against this mock
 * never had to deal with that.
 *
 * And workflows.xml binds File, Image and Plone Site to no workflow at all, so
 * they have no review_state: a real Plone answers `null`, and their @workflow
 * is empty. Verified against a live Plone: every one of its 42 images reports
 * review_state null, and @workflow on one answers
 * {history: [], state: {id: "", title: ""}, transitions: []}.
 *
 * An unworkflowed object takes its permissions from its parent by acquisition,
 * which this mock does not model: it treats a stateless item as viewable, the
 * same as it did when it called them published. That is a deviation, and it is
 * the conservative direction — it cannot hide fixture content that tests expect
 * to read.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { mintToken } from './mock-tokens.js';

process.env.SKIP_CONTENT_VALIDATION = 'true';
const { app, ready } = await import('./mock-plone-api.js');

const TOKEN = mintToken('admin');
let server, baseUrl;

const post = (path, body) =>
  fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify(body),
  });

/** The path of what a create answered with, since an upload names itself. */
const pathOf = (created) => new URL(created['@id']).pathname;

const get = (path) =>
  fetch(`${baseUrl}${path}`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${TOKEN}` },
  });

before(async () => {
  await ready;
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://localhost:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

describe('a newly created page', () => {
  it("starts in the workflow's initial state, which is private", async () => {
    const res = await post('/', { '@type': 'Document', title: 'Fresh Page', id: 'fresh-page' });
    assert.equal(res.status, 201);
    const created = await res.json();
    assert.equal(
      created.review_state,
      'private',
      'a page a frontend just created is not published until someone publishes it',
    );
  });

  it('is still private when read back', async () => {
    await post('/', { '@type': 'Document', title: 'Read Back', id: 'read-back' });
    const page = await (await get('/read-back')).json();
    assert.equal(page.review_state, 'private');
  });

  it('can be published, and then says so', async () => {
    await post('/', { '@type': 'Document', title: 'To Publish', id: 'to-publish' });
    const res = await post('/to-publish/@workflow/publish', {});
    assert.equal(res.status, 200, await res.text());
    const page = await (await get('/to-publish')).json();
    assert.equal(page.review_state, 'published');
  });
});

describe('a File and an Image have no workflow', () => {
  it('reports review_state null for a created Image, as Plone does', async () => {
    const res = await post('/', {
      '@type': 'Image',
      title: 'Stateless Image',
      id: 'stateless-image',
      image: { data: 'iVBORw0KGgo=', encoding: 'base64', filename: 'x.png', 'content-type': 'image/png' },
    });
    assert.equal(res.status, 201);
    const created = await res.json();
    assert.ok('review_state' in created, 'the key is present; Plone sends it as null');
    assert.equal(created.review_state, null);
  });

  it('reports review_state null for a created File', async () => {
    const res = await post('/', {
      '@type': 'File',
      title: 'Stateless File',
      id: 'stateless-file',
      file: { data: 'aGVsbG8=', encoding: 'base64', filename: 'x.txt', 'content-type': 'text/plain' },
    });
    assert.equal(res.status, 201);
    assert.equal((await res.json()).review_state, null);
  });

  it('answers an empty @workflow for one, exactly as a real Plone does', async () => {
    const created = await (await post('/', {
      '@type': 'Image',
      title: 'No Workflow',
      image: { data: 'iVBORw0KGgo=', encoding: 'base64', filename: 'x.png', 'content-type': 'image/png' },
    })).json();
    const wf = await (await get(`${pathOf(created)}/@workflow`)).json();
    assert.deepEqual(wf.history, []);
    assert.deepEqual(wf.state, { id: '', title: '' });
    assert.deepEqual(wf.transitions, []);
  });

  it('still lets a reader see it: acquisition is not modelled', async () => {
    const created = await (await post('/', {
      '@type': 'Image',
      title: 'Readable',
      image: { data: 'iVBORw0KGgo=', encoding: 'base64', filename: 'x.png', 'content-type': 'image/png' },
    })).json();
    assert.equal((await get(pathOf(created))).status, 200);
  });
});
