// @relations as plone.restapi answers it for a content relation field asked
// by its target: the pages whose field names that page, each relation as
// {source, target} summaries (with UID). Plone keeps a relation on the page
// that makes it, so this is how a page finds the pages relating to it.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { app } from './mock-api-server.js';
import { mintToken } from './mock-tokens.js';

let server;
let baseUrl;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://localhost:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function relations(query) {
  const res = await fetch(`${baseUrl}/@relations?${new URLSearchParams(query)}`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${mintToken('admin')}` },
  });
  return { status: res.status, body: res.status === 200 ? await res.json() : null };
}

describe('@relations by target', () => {
  it('lists the pages whose relation field names the target, by its UID', async () => {
    // deep-link-page-b's relatedItems names example-listings-page (written for
    // the site root; both are mounted at /_test_data).
    const { status, body } = await relations({ target: 'example-listings-page-uid', relation: 'relatedItems' });
    assert.equal(status, 200);
    const found = body.relations.relatedItems;
    assert.deepEqual(found.items.map((r) => new URL(r.source['@id']).pathname), ['/_test_data/deep-link-page-b']);
    assert.equal(found.items[0].source.UID, 'deep-link-page-b-uid');
    assert.equal(found.items_total, 1);
  });

  it('a field nothing names the target in answers with no relations', async () => {
    const { body } = await relations({ target: 'example-listings-page-uid', relation: 'seeAlso' });
    assert.deepEqual(body.relations.seeAlso, { items: [], items_total: 0 });
  });

  it('a target that is not on the site is not found', async () => {
    const { status } = await relations({ target: 'no-such-uid', relation: 'relatedItems' });
    assert.equal(status, 404);
  });
});
