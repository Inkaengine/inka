/**
 * An image block that points at its OWN page's lead image.
 *
 * Volto writes exactly this when an author picks the page's own image for an
 * image block: `url: "../../resolveuid/<the page's own UID>"` with
 * `image_field: "image"`. A real backend serialises it without trouble.
 *
 * The mock enriched it by loading the referenced content and running the whole
 * of `enrichContent` over it — which found the same block, loaded the same
 * page, and recursed until the stack gave out:
 *
 *   RangeError: Maximum call stack size exceeded
 *     at resolveUidUrls (mock-plone-api.cjs:2134)
 *
 * The request then 500s. Because `@search` 500s with it, nothing comes up at
 * all: a consumer's whole prerender, block-sanity and SSG suites failed with
 * no page in common, which reads as a content problem and is a server that
 * never started.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SELF = 'selfrefimage00000000000000000001';
const OTHER = 'selfrefimage00000000000000000002';

/** A site with a page whose image block references the page itself. */
function distribution() {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-self-ref-image-'));
  for (const name of ['discussions.json', 'portlets.json', 'principals.json', 'redirects.json']) {
    fs.writeFileSync(path.join(dist, name), '{}');
  }
  const content = path.join(dist, 'content');
  const item = (dir, data, blob) => {
    fs.mkdirSync(path.join(content, dir), { recursive: true });
    fs.writeFileSync(path.join(content, dir, 'data.json'), JSON.stringify(data));
    if (blob) {
      fs.mkdirSync(path.dirname(path.join(content, blob.at)), { recursive: true });
      fs.writeFileSync(path.join(content, blob.at), blob.bytes);
    }
  };
  const image = (blobPath) => ({
    blob_path: blobPath,
    'content-type': 'image/svg+xml',
    filename: path.basename(blobPath),
    width: 1200,
    height: 620,
    size: 64,
  });
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="620"></svg>';

  item('plone_site_root', { '@id': '/Plone', '@type': 'Plone Site', UID: 'selfrefimage00000000000000000000', id: 'Plone', title: 'Site' });
  item('selfie', {
    '@id': '/selfie', '@type': 'News Item', UID: SELF, id: 'selfie',
    title: 'Its own lead image', review_state: 'published',
    image: image('selfie/image/shop-front.svg'),
    blocks: {
      'block-1': { '@type': 'image', url: `../../resolveuid/${SELF}`, image_field: 'image' },
    },
    blocks_layout: { items: ['block-1'] },
  }, { at: 'selfie/image/shop-front.svg', bytes: svg });
  // A page referencing a DIFFERENT image stays the control: enrichment of
  // someone else's image must keep working.
  item('other', {
    '@id': '/other', '@type': 'Document', UID: OTHER, id: 'other',
    title: 'Another page', review_state: 'published',
    blocks: {
      'block-1': { '@type': 'image', url: `../../resolveuid/${SELF}`, image_field: 'image' },
    },
    blocks_layout: { items: ['block-1'] },
  });
  return dist;
}

process.env.CONTENT_MOUNTS = `/:${distribution()}`;
const { app, ready } = require('./mock-plone-api.cjs');

let server;
let baseUrl;

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

/** GET, reading the body ONCE: a failure message needs it as much as a pass does. */
async function get(p) {
  const res = await fetch(`${baseUrl}${p}`, { headers: { Accept: 'application/json' } });
  const body = await res.text();
  let json = null;
  try {
    json = JSON.parse(body);
  } catch {
    // left null; the assertion prints `body`
  }
  return { status: res.status, body, json };
}

describe('an image block referencing its own page', () => {
  it('serves the page rather than exhausting the stack', async () => {
    const res = await get('/selfie');
    assert.equal(res.status, 200, res.body);
    assert.equal(res.json.UID, SELF);
    assert.equal(res.json.blocks['block-1']['@type'], 'image');
  });

  it('still attaches image_scales to that block', async () => {
    const res = await get('/selfie');
    assert.equal(res.status, 200, res.body);
    const block = res.json.blocks['block-1'];
    assert.ok(block.image_scales, `the block carries image_scales: ${JSON.stringify(block)}`);
    // Keyed by the OBJECT's field and shaped as a real catalog brain's
    // image_scales is: measured on a live Plone 6.2.3 catalog, a News Item
    // with a lead image answers {"image": [{width, height, scales, ...}]}.
    // plone.restapi's ResolveUIDSerializerBase takes exactly that from the
    // brain when a block's `url` string resolves to one.
    assert.deepEqual(Object.keys(block.image_scales), ['image']);
    const entry = block.image_scales.image[0];
    assert.equal(entry.width, 1200);
    assert.equal(entry.height, 620);
    assert.ok(entry.scales.preview, 'the scale ladder is there');
  });

  it('does not break @search, which every route discovery needs', async () => {
    const res = await get('/@search?b_size=10000&metadata_fields=portal_type');
    assert.equal(res.status, 200, res.body);
    // The mock builds @id from its own PORT, not the ephemeral listen port,
    // so compare paths rather than whole URLs.
    const ids = res.json.items.map((i) => new URL(i['@id']).pathname);
    assert.ok(ids.includes('/selfie'), `/selfie in ${JSON.stringify(ids)}`);
  });

  it('keeps enriching a block that references ANOTHER page image', async () => {
    const res = await get('/other');
    assert.equal(res.status, 200, res.body);
    assert.ok(res.json.blocks['block-1'].image_scales, 'the control still gets scales');
  });
});
