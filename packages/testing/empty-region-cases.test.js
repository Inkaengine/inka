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

describe('which example a region is emptied on', () => {
  // A container that draws only one of its regions at a time (a layout whose
  // sidebar setting picks left or right) draws nothing for the other. Emptying
  // that region on an example with the setting the other way checks nothing
  // but the setting. An example that has blocks in the region draws it.
  const layoutConfig = {
    layout: {
      blockSchema: {
        properties: {
          leftSidebar: { widget: 'blocks_layout' },
          rightSidebar: { widget: 'blocks_layout' },
        },
      },
    },
  };
  const layout = (blockId, blocks_layout) => ({
    blockType: 'layout', pagePath: '/dev/layout', blockId, blockData: { blocks_layout },
  });
  const caseFor = (blocks, field) =>
    buildEmptyRegionCases(layoutConfig, blocks).find((c) => c.parentType === 'layout' && c.field === field);

  test('each region is emptied on an example that has blocks in it', () => {
    const blocks = [layout('left-one', { leftSidebar: ['nav'] }), layout('right-one', { rightSidebar: ['aside'] })];
    expect(caseFor(blocks, 'leftSidebar')).toMatchObject({ blockId: 'left-one' });
    expect(caseFor(blocks, 'rightSidebar')).toMatchObject({ blockId: 'right-one' });
  });

  test('an object_list region counts its items', () => {
    const config = { form: { blockSchema: { properties: { fields: { widget: 'object_list' } } } } };
    const form = (blockId, fields) => ({ blockType: 'form', pagePath: '/dev/form', blockId, blockData: { fields } });
    const c = buildEmptyRegionCases(config, [form('none', []), form('some', [{ id: 'q1' }])]).find((x) => x.field === 'fields');
    expect(c).toMatchObject({ blockId: 'some' });
  });

  test('with no example holding blocks there, any example of the container', () => {
    expect(caseFor([layout('left-one', { leftSidebar: ['nav'] })], 'rightSidebar')).toMatchObject({ blockId: 'left-one' });
  });

  test('an ordinary page still wins over a template holding blocks there', () => {
    const blocks = [
      { ...layout('templated', { rightSidebar: ['aside'] }), blockData: { templateId: '/t', blocks_layout: { rightSidebar: ['aside'] } } },
      layout('plain', {}),
    ];
    expect(caseFor(blocks, 'rightSidebar')).toMatchObject({ blockId: 'plain' });
  });
});
