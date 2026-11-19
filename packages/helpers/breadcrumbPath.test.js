/**
 * A Relative path location can name a step of the current page's breadcrumb
 * from the top: `/*` is the page's level-1 section (the navigation root's
 * child it is under), `/*\/*` its level-2 section, and so on, with Plone's
 * `::depth` after it. One stored query then serves pages at every depth (a
 * section nav in a layout many pages share), which `..` can't: `..` counts
 * from the page, so it lands somewhere different for each depth.
 *
 * Plone has no such operation: Inka resolves it, for the page it fetches for,
 * into an ordinary Absolute path, so Plone only ever receives a path.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

import { ploneFetchItems, resolveBreadcrumbPath } from './index.js';

const RELATIVE = 'plone.app.querystring.operation.string.relativePath';
const ABSOLUTE = 'plone.app.querystring.operation.string.absolutePath';

describe('resolveBreadcrumbPath', () => {
  test('each * is the page path segment at that step', () => {
    expect(resolveBreadcrumbPath('/*', '/our-reports/operation-askern')).toBe('/our-reports');
    expect(resolveBreadcrumbPath('/*/*', '/about/careers/graduates/apply')).toBe('/about/careers');
  });

  test('the depth is kept', () => {
    expect(resolveBreadcrumbPath('/*::2', '/our-reports/operation-askern')).toBe('/our-reports::2');
  });

  test('a page above the level resolves to itself', () => {
    expect(resolveBreadcrumbPath('/*/*', '/our-reports')).toBe('/our-reports');
    expect(resolveBreadcrumbPath('/*', '/')).toBe('/');
  });

  test('anything but * steps is refused, not guessed', () => {
    expect(() => resolveBreadcrumbPath('/our-reports/*', '/our-reports/x')).toThrow(/only \* steps/);
    expect(() => resolveBreadcrumbPath('/*/', '/a/b')).toThrow(/only \* steps/);
  });

  test('a relative value that is not a breadcrumb step is not one', () => {
    expect(resolveBreadcrumbPath('..', '/a/b')).toBeNull();
    expect(resolveBreadcrumbPath('.::1', '/a/b')).toBeNull();
  });
});

describe('ploneFetchItems sends a breadcrumb step as an Absolute path', () => {
  let bodies;
  beforeEach(() => {
    bodies = [];
    globalThis.fetch = vi.fn(async (url, init) => {
      bodies.push({ url, body: JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => ({ items: [], items_total: 0 }) };
    });
  });
  afterEach(() => vi.restoreAllMocks());

  test('for the page it fetches for, whatever depth it is at', async () => {
    const block = {
      querystring: {
        query: [
          { i: 'portal_type', o: 'plone.app.querystring.operation.selection.any', v: ['Document'] },
          { i: 'path', o: RELATIVE, v: '/*' },
        ],
      },
    };
    for (const page of ['/our-reports/operation-askern', '/our-reports/archive/2019/report']) {
      await ploneFetchItems({ apiUrl: 'http://api', contextPath: page })(block, { start: 0, size: 10 });
    }
    expect(bodies.map((b) => b.body.query.find((c) => c.i === 'path'))).toEqual([
      { i: 'path', o: ABSOLUTE, v: '/our-reports' },
      { i: 'path', o: ABSOLUTE, v: '/our-reports' },
    ]);
    // The other criteria go as they were.
    expect(bodies[0].body.query[0]).toEqual(block.querystring.query[0]);
  });

  test('an ordinary relative path is sent unchanged', async () => {
    const block = { querystring: { query: [{ i: 'path', o: RELATIVE, v: '..' }] } };
    await ploneFetchItems({ apiUrl: 'http://api', contextPath: '/a/b' })(block, { start: 0, size: 10 });
    expect(bodies[0].body.query).toEqual([{ i: 'path', o: RELATIVE, v: '..' }]);
  });
});
