/**
 * Every text style in the content gets an example the sanity suite renders.
 *
 * Block discovery takes one example per block type, and a type's example is
 * usually a plain paragraph — so without a case of their own, the headings,
 * lists and design-system styles the content really uses would never be
 * measured, and the style coverage would only ever speak for `p`.
 */
import { describe, test, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { styleExampleCases } = require('./discover-blocks.cjs');

const para = (text, extra = {}) => ({ type: 'p', ...extra, children: [{ text }] });
const slate = (...nodes) => ({ '@type': 'slate', value: nodes });
const block = (blockId, blockData, pagePath = '/page') => ({ blockType: 'slate', variation: 'default', blockId, pagePath, blockData });

describe('styleExampleCases', () => {
  test('a style the block cases never show gets a case of its own', () => {
    const cases = [{ ...block('a', slate(para('Body'))), kind: 'rich', isListing: false }];
    const candidates = new Map([
      ['p', block('a', slate(para('Body')))],
      ['h2', block('b', slate({ type: 'h2', children: [{ text: 'Heading' }] }), '/other')],
    ]);
    expect(styleExampleCases(cases, candidates)).toEqual([
      { ...candidates.get('h2'), kind: 'style:h2', forStyle: 'h2', isListing: false },
    ]);
  });

  test('a style a block case already carries needs nothing more', () => {
    const both = slate(para('Body'), { type: 'h2', children: [{ text: 'Heading' }] });
    const cases = [{ ...block('a', both), kind: 'rich', isListing: false }];
    const candidates = new Map([['p', block('a', both)], ['h2', block('a', both)]]);
    expect(styleExampleCases(cases, candidates)).toEqual([]);
  });

  test('one added example covers every style it holds', () => {
    const rich = slate({ type: 'h3', children: [{ text: 'Sub' }] }, para('Lead', { styleName: 'lead' }));
    const candidates = new Map([
      ['h3', block('c', rich)],
      ['.lead', block('c', rich)],
    ]);
    const added = styleExampleCases([], candidates);
    expect(added.map((c) => c.forStyle)).toEqual(['h3']);
  });

  test('a design system style is found in either shape the style menu stores', () => {
    const candidates = new Map([
      ['.lead', block('d', slate(para('Lead', { styleName: 'lead' })))],
      ['.tag', block('e', slate({ type: 'p', children: [{ text: 'Tagged', 'style-tag': true }] }))],
    ]);
    expect(styleExampleCases([], candidates).map((c) => c.forStyle)).toEqual(['.lead', '.tag']);
  });
});
