/**
 * Every piece of information in a slate value has to change what the frontend
 * draws. Block sanity checks it by drawing a copy of a block with one piece
 * removed beside the original: identical means the frontend never used it (a
 * `bold: true` on text that a frontend reads only as a `strong` element).
 */
import { describe, test, expect } from 'vitest';
import { slateInformation, probeCopy, recordInformationUse, drainInformationCoverage, informationNeverUsed } from './slate-information.js';

const text = (t, extra = {}) => ({ text: t, ...extra });
const p = (...children) => ({ type: 'p', children });

describe('slateInformation', () => {
  test('a key on text is a kind of its own, named like an attribute', () => {
    const value = [p(text('Plain '), text('Loud', { bold: true }))];
    expect(slateInformation(value)).toEqual(new Map([
      ['[bold]', { nodePath: [0, 1], keyPath: ['bold'], text: 'Loud' }],
    ]));
  });

  test('an element\'s data is a kind per value it holds, under the element\'s type', () => {
    const link = { type: 'link', data: { url: './guide.pdf', item: { getObjSize: '755 KB' } }, children: [text('Guide')] };
    expect([...slateInformation([p(link)]).keys()]).toEqual([
      'link[data.url]',
      'link[data.item.getObjSize]',
    ]);
  });

  test('the words, the tree and the style checks\' own are not information here', () => {
    // `type` is the element style the text-style check measures; `styleName`
    // and `style-*` are a design system's styles, measured there too; `nodeId`
    // is the bridge's bookkeeping, added while editing.
    const value = [{ type: 'h2', styleName: 'nsw-lead', nodeId: '0', children: [text('Head', { 'style-small': true, nodeId: '0.0' })] }];
    expect(slateInformation(value)).toEqual(new Map());
  });

  test('the first place a kind appears is its example', () => {
    const value = [p(text('One', { bold: true })), p(text('Two', { bold: true }))];
    expect(slateInformation(value).get('[bold]').nodePath).toEqual([0, 0]);
  });

  test('a field that is not slate holds no slate information', () => {
    expect(slateInformation([{ '@id': 'a', title: 'An item' }])).toEqual(new Map());
    expect(slateInformation(['facebook', 'mail'])).toEqual(new Map());
  });
});

describe('probeCopy', () => {
  const page = () => ({
    blocks: {
      s1: { '@type': 'slate', value: [p(text('Loud', { bold: true }))] },
      g1: {
        '@type': 'grid',
        blocks: { c1: { '@type': 'card', description: [p(text('Card', { bold: true }))] } },
        blocks_layout: { items: ['c1'] },
      },
    },
    blocks_layout: { items: ['s1', 'g1'] },
  });
  const pathMap = {
    s1: { path: ['blocks', 's1'], parentId: null, region: 'items' },
    g1: { path: ['blocks', 'g1'], parentId: null, region: 'items' },
    c1: { path: ['blocks', 'g1', 'blocks', 'c1'], parentId: 'g1', region: 'items' },
  };

  test('a copy without the piece goes right after the block, under a new uid', () => {
    const { formData, copyId } = probeCopy(page(), pathMap, 's1', { field: 'value', nodePath: [0, 0], keyPath: ['bold'] }, 'p0');
    expect(copyId).toBe('s1~p0');
    expect(formData.blocks_layout.items).toEqual(['s1', 's1~p0', 'g1']);
    expect(formData.blocks['s1~p0']).toEqual({ '@type': 'slate', value: [p(text('Loud'))] });
    expect(formData.blocks.s1).toEqual(page().blocks.s1);
  });

  test('a nested block is copied beside itself in its own container', () => {
    const { formData, copyId } = probeCopy(page(), pathMap, 'c1', { field: 'description', nodePath: [0, 0], keyPath: ['bold'] }, 'p1');
    expect(formData.blocks.g1.blocks_layout.items).toEqual(['c1', 'c1~p1']);
    expect(formData.blocks.g1.blocks[copyId].description).toEqual([p(text('Card'))]);
  });

  test('every block inside the copy gets a new uid too, so none appears twice', () => {
    const { formData } = probeCopy(page(), pathMap, 'g1', null, 'p2');
    expect(formData.blocks['g1~p2'].blocks_layout.items).toEqual(['c1~p2']);
    expect(Object.keys(formData.blocks['g1~p2'].blocks)).toEqual(['c1~p2']);
  });

  test('a list item is copied beside itself, with a new id', () => {
    const formData = { blocks: { a: { '@type': 'accordion', panels: [{ '@id': 'x', title: [p(text('T', { italic: true }))] }] } }, blocks_layout: { items: ['a'] } };
    const map = {
      a: { path: ['blocks', 'a'], parentId: null, region: 'items' },
      x: { path: ['blocks', 'a', 'panels', 0], parentId: 'a', region: 'panels', isObjectListItem: true, idField: '@id' },
    };
    const out = probeCopy(formData, map, 'x', { field: 'title', nodePath: [0, 0], keyPath: ['italic'] }, 'p3');
    expect(out.copyId).toBe('x~p3');
    expect(out.formData.blocks.a.panels).toEqual([
      { '@id': 'x', title: [p(text('T', { italic: true }))] },
      { '@id': 'x~p3', title: [p(text('T'))] },
    ]);
  });

  test('a removed piece of nested data leaves the rest', () => {
    const link = { type: 'link', data: { url: './g.pdf', item: { getObjSize: '1 KB' } }, children: [text('G')] };
    const formData = { blocks: { s: { '@type': 'slate', value: [p(link)] } }, blocks_layout: { items: ['s'] } };
    const out = probeCopy(formData, { s: { path: ['blocks', 's'], parentId: null, region: 'items' } }, 's',
      { field: 'value', nodePath: [0, 0], keyPath: ['data', 'item', 'getObjSize'] }, 'p4');
    expect(out.formData.blocks['s~p4'].value[0].children[0].data).toEqual({ url: './g.pdf', item: {} });
  });
});

describe('informationNeverUsed', () => {
  const at = (kind, used, pagePath = '/page') => ({ kind, blockType: 'slate', pagePath, used });

  test('a kind no example drew differently without is reported, with where it was seen', () => {
    expect(informationNeverUsed([at('[bold]', false, '/search'), at('link[data.url]', true)])).toEqual([
      { kind: '[bold]', blockType: 'slate', pagePath: '/search' },
    ]);
  });

  test('one example that uses it is enough', () => {
    expect(informationNeverUsed([at('[bold]', false), at('[bold]', true, '/other')])).toEqual([]);
  });

  test('records come back once, for the spec to attach', () => {
    recordInformationUse('[bold]', { blockType: 'slate', pagePath: '/p' }, false);
    expect(drainInformationCoverage()).toEqual([at('[bold]', false, '/p')]);
    expect(drainInformationCoverage()).toEqual([]);
  });
});
