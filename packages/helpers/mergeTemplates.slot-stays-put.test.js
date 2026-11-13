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

/**
 * A template keeps a slot that is empty (inka#708): an `empty` naming the slot
 * is the slot, and a commit stores it. Pages never store one; templates do, so
 * a slot nobody has filled yet (a hero's links) still has its place, and a slot
 * an author emptied is still there for every page using the template.
 */
describe('a commit keeps a slot that is empty', () => {
  const emptied = (slotId) => ({ '@type': 'empty', ...member, slotId, fixed: false });

  // A slot's contents are the page's, never the template's: the template's own
  // block for the slot stays as it was, and the slot with it.
  test('a slot a page has emptied stays in the template, where it was', async () => {
    const page = pageWith(MAIN_FIRST);
    const layout = page.blocks.layout;
    delete layout.blocks.c;
    layout.blocks.e = emptied('default');
    layout.blocks_layout.main = ['e'];
    let n = 0;
    const { merged } = await mergeInstanceIntoTemplate(template, page, I, { idFieldMap: {}, uuidGenerator: () => `u${++n}` });
    const stored = Object.values(merged.blocks).find((b) => b['@type'] === 'contentLayout');
    const main = stored.blocks_layout.main.map((id) => stored.blocks[id]);
    expect(main.map((b) => [b['@type'], b.slotId])).toEqual([['slate', 'default']]);
  });

  test('a region holding only an empty slot keeps it', async () => {
    expect(await commit(pageWith(MAIN_FIRST, emptied('links')))).toEqual({
      hero: ['title'], main: ['slate'], leftSidebar: ['empty'],
    });
  });
});
