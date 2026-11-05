/**
 * Which page the empty-region sweep empties as a whole: an ordinary page, not a
 * template's (whose blocks are locked) and not the site root. Wherever a
 * project's content is mounted — under a prefix beside other content, as
 * Inka's own fixtures are at /_test_data, or at the root, as a frontend's
 * fixtures usually are.
 */
import { describe, test, expect } from 'vitest';
import { buildEmptyRegionCases } from './discover-blocks.cjs';

const block = (pagePath, blockData = {}) => ({ blockType: 'slate', pagePath, blockId: 'b1', blockData });
const pageCase = (blocks) => buildEmptyRegionCases({}, blocks).find((c) => c.parentType === 'page');

describe('the page case of the empty-region sweep', () => {
  test('fixtures under /_test_data beside a site root and docs: the first fixture page', () => {
    const blocks = [
      block('/'),
      block('/docs/intro'),
      block('/_test_data/templates/layout', { templateId: '/_test_data/templates/layout' }),
      block('/_test_data/test-page'),
      block('/_test_data/another-page'),
    ];
    expect(pageCase(blocks)).toMatchObject({ field: '*', pagePath: '/_test_data/another-page', blockId: '_page' });
  });

  test('fixtures at the root: the first ordinary page', () => {
    const blocks = [
      block('/'),
      block('/templates/site-footer', { templateId: '/templates/site-footer' }),
      block('/dev/blocks/accordion'),
      block('/dev/blocks/callout'),
    ];
    expect(pageCase(blocks)).toMatchObject({ field: '*', pagePath: '/dev/blocks/accordion', blockId: '_page' });
  });

  test('no page case when every page is the site root or a template', () => {
    const blocks = [block('/'), block('/templates/site-footer', { readOnly: true })];
    expect(pageCase(blocks)).toBeUndefined();
  });
});
