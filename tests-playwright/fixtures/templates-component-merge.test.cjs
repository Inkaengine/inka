/**
 * The @templates response, fed to the real merge.
 *
 * templates-component.test.cjs stops at the JSON: it pins the response SHAPE. That proves
 * the endpoint returns what I designed, not that the design is right — a wrong idField
 * or a template keyed by the wrong spelling produces perfectly well-shaped JSON and a
 * blank page. So this suite closes the loop: take what the endpoint actually serves, hand
 * it to expandTemplatesSync exactly as a frontend would, and assert the page renders.
 *
 * These are the assertions a Plone addon must also satisfy — the merge is the consumer,
 * and it does not care which backend answered.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { app } = require('./mock-api-server.cjs');

let server;
let baseUrl;
let expandTemplatesSync;
let idFieldMap;

before(async () => {
  // ESM helper from a CJS test.
  ({ expandTemplatesSync } = await import('../../packages/helpers/index.js'));
  // The object_list id fields, derived from the block schemas the way a frontend does it —
  // the endpoint carries templates only. Same registry the frontends register from.
  const { buildIdFieldMap } = await import('../../packages/hydra-js/buildBlockPathMap.js');
  const { sharedBlocksConfig } = await import('./shared-block-schemas.js');
  const { coreBlocksConfig } = await import('./core-block-schemas.js');
  idFieldMap = buildIdFieldMap({ ...coreBlocksConfig, ...sharedBlocksConfig });
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

const PAGE = '/_test_data/template-test-page';

/** Fetch a page with its templates, the way a frontend would. */
async function fetchPage(contentPath, extra = null) {
  const qs = new URLSearchParams({ expand: 'templates' });
  if (extra) qs.set('expand.templates.extra', extra);
  const res = await fetch(`${baseUrl}${contentPath}?${qs}`, {
    headers: { Accept: 'application/json' },
  });
  assert.equal(res.status, 200);
  return res.json();
}

/**
 * Render a page through the merge the way a frontend does: templates ONLY from what the
 * endpoint returned (no separately fetched template), and the idFieldMap derived from the
 * block schemas. If the endpoint under-delivers, this throws or renders empty, which is
 * the point.
 *
 * editMode: false because expandTemplatesSync otherwise passes blocks through untouched
 * (the admin owns merging in edit mode) — and a pass-through would make every assertion
 * below vacuously true.
 */
function render(page, allowedLayouts) {
  const { templates } = page['@components'].templates;
  return expandTemplatesSync(page.blocks_layout.items, {
    blocks: page.blocks,
    templates,
    idFieldMap,
    templateState: {},
    editMode: false,
    ...(allowedLayouts ? { allowedLayouts } : {}),
  });
}

describe('@templates feeds the merge', () => {
  it('renders a page using only what the endpoint served', async () => {
    const page = await fetchPage(PAGE);
    const items = render(page);

    assert.ok(items.length > 0, 'the merge produced blocks');
    for (const item of items) {
      assert.ok(item['@uid'], 'every rendered block carries a @uid');
    }

    // The fixture's own content survives the merge.
    const text = JSON.stringify(items);
    assert.match(text, /Template Header - From Template/, "the template's fixed header rendered");
    assert.match(text, /Template Footer - From Template/, "the template's fixed footer rendered");
  });

  it('places page content into the template slots', async () => {
    // The page's two `primary`-slot blocks must land between the template's fixed header
    // and footer — that is the merge doing its job, not the blocks merely surviving.
    const page = await fetchPage(PAGE);
    const items = render(page);
    const plain = items.map((i) => JSON.stringify(i.value ?? ''));

    const header = plain.findIndex((t) => t.includes('Template Header'));
    const footer = plain.findIndex((t) => t.includes('Template Footer'));
    assert.ok(header !== -1 && footer !== -1, 'fixed blocks present');
    assert.ok(header < footer, 'header precedes footer');

    const userBlocks = plain
      .map((t, i) => (/User content|user content block/i.test(t) ? i : -1))
      .filter((i) => i !== -1);
    assert.ok(userBlocks.length > 0, 'page content rendered');
    for (const i of userBlocks) {
      assert.ok(i > header && i < footer, 'page content sits inside the template');
    }
  });

  it('renders a template reached only by resolveuid', async () => {
    // The page references its template as `resolveuid/<uid>`. If the endpoint keyed it by
    // the resolved PATH instead, the merge would look up the uid spelling, miss, and drop
    // the template — well-shaped JSON, blank page. This is the test that catches that.
    const page = await fetchPage(PAGE);
    const { templates } = page['@components'].templates;
    const referenced = new Set();
    JSON.stringify(page.blocks, (k, v) => (k === 'templateId' && referenced.add(v), v));
    assert.ok(referenced.size > 0, 'fixture references a template');
    for (const id of referenced) {
      assert.ok(templates[id], `merge can look up ${id} by the spelling the block carries`);
    }
  });

  it('expands an object_list container inside a template', async () => {
    // The template's slider holds its slides as an inline array — the storage the
    // idFieldMap exists for. Its items must survive with ids intact.
    const page = await fetchPage(PAGE);
    const items = render(page);
    const slider = items.find((i) => i['@type'] === 'slider');
    assert.ok(slider, 'slider rendered');
    assert.ok(Array.isArray(slider.slides) && slider.slides.length > 0, 'slides survived');
    for (const slide of slider.slides) {
      assert.ok(slide['@id'], 'each slide kept an id the next merge can key on');
    }
  });

  it('applies a forced layout served via expand.templates.extra', async () => {
    // The frontend owns the rule and names the layout; the merge is handed the result.
    // End to end this is the case that used to need a hand-maintained preloadTemplates —
    // if the endpoint failed to resolve it, expandTemplatesSync throws "not found in
    // pre-loaded templates".
    const LAYOUT = '/_test_data/templates/header-footer-layout';
    const page = await fetchPage('/_test_data/another-page', LAYOUT);
    const items = render(page, [LAYOUT]);

    const text = JSON.stringify(items);
    assert.match(text, /Layout Header/, 'forced layout header rendered');
    assert.match(text, /Layout Footer/, 'forced layout footer rendered');
  });

  it('throws the recognisable error when a forced layout was NOT served', async () => {
    // The failure mode this endpoint exists to remove: force a layout the backend was
    // never told to resolve, and the merge cannot find it. Pinned so the error stays the
    // one the docs name, rather than silently rendering an unlaid-out page.
    const page = await fetchPage('/_test_data/another-page'); // no extra
    assert.throws(
      () => render(page, ['/_test_data/templates/header-footer-layout']),
      /not found in pre-loaded templates/,
    );
  });
});
