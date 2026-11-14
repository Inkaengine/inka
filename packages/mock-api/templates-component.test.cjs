/**
 * The @templates component: every template a page needs, resolved in one request.
 *
 * What is under test is the CONTRACT, not this implementation — these assertions are what
 * a Plone addon serving @templates will have to satisfy when this is ported, so they are
 * written against the response shape rather than against internals.
 *
 * The contract deliberately carries NO allowedTemplates / allowedLayouts: layouts are a
 * design system's artifacts, so the layout rules stay frontend-owned and arrive here only
 * as `expand.templates.extra`.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { app } = require('./mock-api-server.cjs');

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
  if (server) await new Promise((resolve) => server.close(resolve));
});

/** The @templates component off a page read, via ?expand=templates. */
async function expandTemplates(contentPath, extra = null) {
  const qs = new URLSearchParams({ expand: 'templates' });
  if (extra) qs.set('expand.templates.extra', extra);
  const res = await fetch(`${baseUrl}${contentPath}?${qs}`, {
    headers: { Accept: 'application/json' },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  return body['@components'].templates;
}

/** The same component off its own route. */
async function routeTemplates(contentPath, extra = null) {
  const qs = extra ? `?${new URLSearchParams({ 'expand.templates.extra': extra })}` : '';
  const res = await fetch(`${baseUrl}${contentPath}/@templates${qs}`, {
    headers: { Accept: 'application/json' },
  });
  assert.equal(res.status, 200);
  return res.json();
}

const PAGE = '/_test_data/template-test-page';

describe('@templates component', () => {
  it('resolves the templates a page references', async () => {
    const { templates, errors } = await expandTemplates(PAGE);
    assert.equal(errors, undefined, 'a page whose templates all exist reports no errors');
    // The fixture's blocks carry `resolveuid/test-layout-template-uid`.
    assert.ok(
      Object.keys(templates).length > 0,
      'page referencing a template resolves at least one',
    );
    const tpl = templates['resolveuid/test-layout-template-uid'];
    assert.ok(tpl, 'template is keyed by the reference the block actually carries');
    assert.equal(tpl['@type'], 'Document');
    assert.ok(tpl.blocks, 'template arrives with its blocks');
    assert.ok(tpl.blocks_layout, 'and its blocks_layout');
  });

  it('keys a template by EVERY spelling that reached it', async () => {
    // expandTemplatesSync looks a template up by the literal string on the block, so a
    // block carrying `resolveuid/abc` must find an entry at `resolveuid/abc` — not at the
    // path it happens to resolve to. One template reached both ways appears under both,
    // or the merge misses it and the page renders empty.
    const { templates } = await expandTemplates(PAGE, '/_test_data/templates/test-layout');
    assert.ok(templates['resolveuid/test-layout-template-uid'], 'uid spelling present');
    assert.ok(templates['/_test_data/templates/test-layout'], 'path spelling present');
    assert.deepEqual(
      templates['resolveuid/test-layout-template-uid'],
      templates['/_test_data/templates/test-layout'],
      'both spellings resolve to the same template',
    );
  });

  it('resolves forced layouts named in expand.templates.extra', async () => {
    // A forced layout is never referenced from page content — that is exactly why the
    // frontend had to pre-load it by hand. The frontend owns the rule and names the
    // layout; the backend resolves it.
    const { templates, errors } = await expandTemplates(
      PAGE,
      '/_test_data/templates/footer-layout,/_test_data/templates/header-only-layout',
    );
    assert.equal(errors, undefined);
    assert.ok(templates['/_test_data/templates/footer-layout'], 'first extra resolved');
    assert.ok(templates['/_test_data/templates/header-only-layout'], 'second extra resolved');
    assert.ok(
      templates['resolveuid/test-layout-template-uid'],
      'extras do not displace what the page itself references',
    );
  });

  it('reports a missing template instead of failing the read', async () => {
    // One missing template must not fail the page. The frontend decides whether that is
    // fatal (ploneApi has `ignoreTemplateErrors` for exactly this).
    const { templates, errors } = await expandTemplates(PAGE, '/templates/does-not-exist');
    assert.ok(Array.isArray(errors), 'errors are named');
    assert.equal(errors.length, 1);
    assert.equal(errors[0].templateId, '/templates/does-not-exist');
    assert.match(errors[0].error, /not found/);
    assert.ok(
      templates['resolveuid/test-layout-template-uid'],
      'the templates that DO resolve still arrive',
    );
  });

  it('returns an empty set for a page with no templates', async () => {
    const { templates, errors } = await expandTemplates('/_test_data/another-page');
    assert.deepEqual(templates, {}, 'no references means no templates');
    assert.equal(errors, undefined, 'and nothing failed');
  });

  it('is a stub unless asked for', async () => {
    // Resolving templates walks references and reads each from disk. An unexpanded read
    // must not pay for it — and must still emit the @id stub, so a client that follows
    // the stub reaches the same data.
    const res = await fetch(`${baseUrl}${PAGE}`, { headers: { Accept: 'application/json' } });
    const body = await res.json();
    const stub = body['@components'].templates;
    assert.deepEqual(
      Object.keys(stub),
      ['@id'],
      'unexpanded, templates is an @id stub like every other component',
    );
    assert.match(stub['@id'], /\/@templates$/);
  });

  it('serves the same data from the @templates route as from the expansion', async () => {
    // Two paths to one component drift when only one is maintained — the mock has been
    // bitten by exactly that (the session-aware @navigation route vs the expansion that
    // was not). Pin them together.
    const viaRoute = await routeTemplates(PAGE, '/_test_data/templates/footer-layout');
    const viaExpand = await expandTemplates(PAGE, '/_test_data/templates/footer-layout');
    assert.deepEqual(viaRoute, viaExpand);
  });
});

describe('@templates carries templates only', () => {
  it('has no idFieldMap', async () => {
    // Which object_list field a block keys by field_id rather than @id is a fact about the
    // FRONTEND's block schemas, which a Plone backend never sees — the addon could only
    // hardcode it, and a hardcoded copy drifts. Frontends derive it from their own block
    // config with buildIdFieldMap(blocksConfig), as the admin does.
    const component = await expandTemplates(PAGE);
    assert.deepEqual(Object.keys(component).sort(), ['@id', 'templates']);
  });
});
