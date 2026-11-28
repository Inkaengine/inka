/**
 * The links a page may carry that a visitor can't open. A site keeps its
 * layouts in a private folder and publishes the layouts themselves, so a layout
 * page's breadcrumbs link to a folder that answers 401 (#851). The run that
 * knows that says so; every other link must open.
 */
import { describe, test, expect } from 'vitest';
import { isExemptLink } from './PageIntegrityHelper';

describe('links a run exempts from the dead link check', () => {
  test('none unless the run names them', () => {
    expect(isExemptLink('/templates', [])).toBe(false);
  });

  test('the path named', () => {
    expect(isExemptLink('/templates', ['/templates'])).toBe(true);
  });

  test("not what's under it: a dead link to a page in the folder is still dead", () => {
    expect(isExemptLink('/templates/site-footer', ['/templates'])).toBe(false);
  });

  test('a glob for a whole tree', () => {
    expect(isExemptLink('/templates/site-footer', ['/templates/**'])).toBe(true);
    expect(isExemptLink('/news/templates', ['/templates/**'])).toBe(false);
  });

  test('the path, whatever the query', () => {
    expect(isExemptLink('/templates?b_start=20', ['/templates'])).toBe(true);
  });
});
