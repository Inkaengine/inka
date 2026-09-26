/**
 * Every endpoint this mock serves must exist somewhere real.
 *
 * The @order endpoint is why this test exists. It was invented in this file, an
 * adapter was written against it in the same commit, and the contract suite went
 * green: a contract proves the adapter and the mock AGREE, and when both halves
 * are authored from one assumption, agreement is a tautology. It passed for two
 * weeks while every reorder against a real Plone 404'd. A later fix found the
 * truth from Volto's side, wrote "the mock implemented an @order endpoint,
 * nothing calls it" — and corrected only the mock, leaving the adapter calling
 * the invention.
 *
 * So each route is sorted into one of three buckets, and a route in none of them
 * fails this test. The point is not to forbid extensions: it is that adding one
 * has to be a sentence someone wrote down, rather than a plausible-looking
 * route that the next reader takes for Plone's.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CORE = new Set(
  JSON.parse(
    fs.readFileSync(path.join(__dirname, 'api', 'plone-restapi-endpoints.json'), 'utf-8'),
  ).endpoints,
);

/**
 * Real, but not from plone.restapi core. Each says WHERE it comes from, so a
 * reader can check it — which is the step that was missing for @order.
 */
const DECLARED = {
  // Plone views (traversers), not REST services.
  '@@images': 'Plone core: plone.namedfile image scales',
  '@@download': 'Plone core: plone.namedfile download view',
  // Add-ons this project expects on the backend.
  '@submit-form': 'addon: collective.volto.formsupport',
  '@form-data': 'addon: collective.volto.formsupport (stored submissions)',
  '@export': 'addon: plone.exportimport (our --markdown flavour extends it; see docs)',
  // Ours, implemented by the Plone addon in backend/.
  '@templates': 'ours: the templates feature — see backend/README.md',
  // Mock-only, and named so nobody mistakes it for an API.
  '@mock-site-features': 'test-only: control plane for per-session site features',
};

/**
 * Served deliberately to FAIL, because the API does not have them. A 404 that
 * names the right call teaches the next caller; silence just moves the guess.
 */
const REFUSALS = {
  '@order': 'refused: plone.restapi orders with a PATCH on the container',
};

function routesOf(source) {
  const found = new Set();
  // app.get('*/@foo'), app.post(/.*\/@foo$/), app.all(...) — literal or regex.
  const registration = /app\.(?:get|post|patch|put|delete|all)\(\s*(?:'([^']*)'|\/([^,]*?)\/[gimsuy]*)\s*,/g;
  let match;
  while ((match = registration.exec(source)) !== null) {
    const pattern = match[1] ?? match[2] ?? '';
    for (const endpoint of pattern.match(/@+[a-zA-Z0-9_.-]+/g) ?? []) {
      found.add(endpoint);
    }
  }
  return found;
}

describe('the mock serves no invented endpoints', () => {
  const source = fs.readFileSync(
    path.join(__dirname, 'mock-plone-api.cjs'),
    'utf-8',
  );

  it('every route is core plone.restapi, declared, or a deliberate refusal', () => {
    const unexplained = [...routesOf(source)].filter(
      (endpoint) =>
        !CORE.has(endpoint) && !(endpoint in DECLARED) && !(endpoint in REFUSALS),
    );
    assert.deepEqual(
      unexplained,
      [],
      `These routes exist in the mock and nowhere else.\n` +
        `Check each against plone.restapi (its configure.zcml registers a name="@..."\n` +
        `for every service). If it is real, add it to api/plone-restapi-endpoints.json\n` +
        `or to DECLARED with where it comes from. If it is not, do not serve it: an\n` +
        `adapter written against it will pass its contract and fail against the CMS.\n` +
        `Unexplained: ${unexplained.join(', ')}`,
    );
  });

  it('records where the core list came from, so it can be checked again', () => {
    // A list nobody can regenerate is a list nobody will trust in a year.
    const fixture = JSON.parse(
      fs.readFileSync(path.join(__dirname, 'api', 'plone-restapi-endpoints.json'), 'utf-8'),
    );
    assert.match(fixture._source, /plone\.restapi/);
    assert.ok(fixture._regenerate.length > 0);
    assert.ok(fixture.endpoints.includes('@search'));
    // The one that started this.
    assert.ok(!fixture.endpoints.includes('@order'));
  });
});
