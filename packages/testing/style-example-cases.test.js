/**
 * Every text style in the content gets an example the sanity suite renders.
 *
 * Block discovery takes one example per block type, and a type's example is
 * usually a plain paragraph — so without a case of their own, the headings,
 * lists and design-system styles the content really uses would never be
 * measured, and the style coverage would only ever speak for `p`.
 */
import { describe, test, expect } from 'vitest';
import { styleExampleCases, undemonstratedStyles } from './discover-blocks.js';

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

  // The rest of a slate value's information (slate-information.js) needs an
  // example the same way: a flag on text, a link's data.
  test('a piece of slate information the block cases never show gets a case of its own', () => {
    const loud = block('f', slate(para('Plain'), { type: 'p', children: [{ text: 'Loud', bold: true }] }), '/loud');
    const cases = [{ ...block('a', slate(para('Body'))), kind: 'rich', isListing: false }];
    expect(styleExampleCases(cases, new Map([['[bold]', loud]]))).toEqual([
      { ...loud, kind: 'style:[bold]', forStyle: '[bold]', isListing: false },
    ]);
  });

  test('a block case that holds the information needs nothing more', () => {
    const loud = block('f', slate({ type: 'p', children: [{ text: 'Loud', bold: true }] }));
    const cases = [{ ...loud, kind: 'rich', isListing: false }];
    expect(styleExampleCases(cases, new Map([['[bold]', loud]]))).toEqual([]);
  });
});

// Every style the toolbar offers needs an example in the content: one nobody
// demonstrates is never rendered, so a style that does nothing passes unseen.
describe('undemonstratedStyles', () => {
  const where = (blockType, pagePath) => ({ blockType, pagePath });

  test('an offered style with no example in the content is reported, with where it is offered', () => {
    const offered = new Map([['sup', where('slate', '/page')], ['h2', where('slate', '/page')]]);
    const candidates = new Map([['h2', block('b', slate({ type: 'h2', children: [{ text: 'Heading' }] }))]]);
    expect(undemonstratedStyles(offered, candidates)).toEqual([
      { blockType: 'slate', pagePath: '/page', style: 'sup', unexercisedStyle: true },
    ]);
  });

  test('a style in the content that nobody offers is not this finding', () => {
    const candidates = new Map([['h2', block('b', slate({ type: 'h2', children: [{ text: 'Heading' }] }))]]);
    expect(undemonstratedStyles(new Map(), candidates)).toEqual([]);
  });
});
