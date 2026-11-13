/**
 * inka#705 case 3: a commit ("Change on all pages") moved a layout template's
 * `default` slot into a sidebar the layout doesn't draw, so every page using it
 * showed no content.
 *
 * In the merge, a template block that is neither fixed nor slotted counts as
 * the `default` slot. An editor's `empty` placeholder in a region the page
 * stores before `main` was taken for it, and the slot moved there. A
 * placeholder is not page content, and where a slot lands must not depend on
 * the order the page happens to store its regions in.
 */
import { describe, test, expect } from 'vitest';
import { mergeInstanceIntoTemplate } from './mergeTemplates.js';

const T = '/templates/plain';
const I = 'instance-1';
const member = { templateId: T, templateInstanceId: I };

const template = {
  '@id': T,
  blocks: {
    layout: {
      '@type': 'contentLayout', templateId: T, slotId: 'layout', fixed: true, readOnly: true,
      blocks: {
        title: { '@type': 'title', templateId: T, slotId: 'hero', fixed: true, readOnly: true },
        body: { '@type': 'slate', templateId: T, slotId: 'default', value: [{ type: 'p', children: [{ text: 'Slot' }] }] },
      },
      blocks_layout: { hero: ['title'], main: ['body'], leftSidebar: [], rightSidebar: [] },
    },
  },
  blocks_layout: { items: ['layout'] },
};

/** The page's instance, its regions stored in `order`, with `inLeft` in its left sidebar. */
const pageWith = (order, inLeft) => {
  const regions = { hero: ['t'], main: ['c'], leftSidebar: inLeft ? ['e'] : [], rightSidebar: [] };
  return {
    blocks: {
      layout: {
        '@type': 'contentLayout', ...member, slotId: 'layout', fixed: true, readOnly: true,
        blocks: {
          t: { '@type': 'title', ...member, slotId: 'hero', fixed: true, readOnly: true },
          c: { '@type': 'slate', ...member, slotId: 'default', value: [{ type: 'p', children: [{ text: 'Page text' }] }] },
          ...(inLeft && { e: inLeft }),
        },
        blocks_layout: Object.fromEntries(order.map((region) => [region, regions[region]])),
      },
    },
    blocks_layout: { items: ['layout'] },
  };
};

const commit = async (page) => {
  let n = 0;
  const { merged } = await mergeInstanceIntoTemplate(template, page, I, { idFieldMap: {}, uuidGenerator: () => `u${++n}` });
  const layout = Object.values(merged.blocks).find((b) => b['@type'] === 'contentLayout');
  const typesIn = (region) => (layout.blocks_layout[region] || []).map((id) => layout.blocks[id]['@type']);
  return { hero: typesIn('hero'), main: typesIn('main'), leftSidebar: typesIn('leftSidebar') };
};

const SIDEBAR_FIRST = ['hero', 'leftSidebar', 'main', 'rightSidebar'];
const MAIN_FIRST = ['hero', 'main', 'leftSidebar', 'rightSidebar'];

describe('a commit leaves a slot where the template has it', () => {
  test('a slot-less placeholder in a region stored before main does not take the default slot', async () => {
    const placeholder = { '@type': 'empty', ...member, fixed: false };
    expect(await commit(pageWith(SIDEBAR_FIRST, placeholder))).toEqual({ hero: ['title'], main: ['slate'], leftSidebar: [] });
  });

  test('nor does one marked as the default slot', async () => {
    const placeholder = { '@type': 'empty', ...member, slotId: 'default', fixed: false };
    expect(await commit(pageWith(SIDEBAR_FIRST, placeholder))).toEqual({ hero: ['title'], main: ['slate'], leftSidebar: [] });
  });

  test('the order the page stores its regions in decides nothing', async () => {
    const placeholder = { '@type': 'empty', ...member, fixed: false };
    expect(await commit(pageWith(SIDEBAR_FIRST, placeholder))).toEqual(await commit(pageWith(MAIN_FIRST, placeholder)));
  });
});
