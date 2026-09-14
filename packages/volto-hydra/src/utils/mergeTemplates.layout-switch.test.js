/**
 * Switching a page from one layout to another must keep the page's content.
 *
 * Applying a layout re-homes the page's blocks into the template's default slot,
 * nested inside the layout block. Switching to a SECOND layout has to harvest
 * them back out of that nest and re-home them into the new template.
 *
 * Regression: it didn't. A forced switch cleared `existingInstanceId` so the new
 * instance would get a fresh id, and the content harvest keys off exactly that
 * id — so `collectContentFromTree` never ran, and the only top-level block left
 * (the outgoing layout wrapper, `fixed` + `readOnly`) was skipped outright. The
 * page came back holding nothing but the incoming template's empty slate: every
 * block the author had written, silently gone.
 *
 * Reproduced on the demo site by the `layout/swap` doc clip (left rail → right
 * rail on /layout-demo), which is where it was found.
 */
import { describe, test, expect } from 'vitest';
import { mergeTemplatesIntoPage } from './mergeTemplates.mjs';

// Two layouts shaped like the real ones: a `contentLayout` wrapper (fixed and
// readOnly, as a layout's frame is), an empty slate in its `default` slot for
// the page's content to land in, and one rail block that differs per side.
const layoutTemplate = (id, side, rail) => ({
  blocks: {
    layout0: {
      '@type': 'contentLayout',
      fixed: true,
      readOnly: true,
      slotId: 'layout0',
      templateId: id,
      sidebar: side,
      blocks: {
        m0: {
          '@type': 'slate',
          slotId: 'default',
          templateId: id,
          value: [{ type: 'p', children: [{ text: '' }] }],
          plaintext: '',
          fixed: false,
        },
        [rail.id]: { ...rail.block, templateId: id },
      },
      blocks_layout: {
        main: ['m0'],
        [side === 'left' ? 'leftSidebar' : 'rightSidebar']: [rail.id],
      },
    },
  },
  blocks_layout: { items: ['layout0'] },
});

const LEFT = '/templates/content-layout-left';
const RIGHT = '/templates/content-layout-right';

const templates = {
  [LEFT]: layoutTemplate(LEFT, 'left', {
    id: 'sn0',
    block: { '@type': 'sideNav', fixed: true, readOnly: true, slotId: 'leftSidebar' },
  }),
  [RIGHT]: layoutTemplate(RIGHT, 'right', {
    id: 'ul0',
    block: { '@type': 'utilityList', fixed: true, slotId: 'rightSidebar' },
  }),
};

const loadTemplate = async (templateId) => {
  const tpl = templates[templateId];
  if (!tpl) throw new Error(`no such template: ${templateId}`);
  return tpl;
};

const uuidGenerator = (() => {
  let n = 0;
  return () => `u-${++n}`;
})();

const applyLayout = async (page, layout) => {
  const { merged } = await mergeTemplatesIntoPage(page, {
    loadTemplate,
    pageBlocksFields: { items: { allowedLayouts: [layout] } },
    uuidGenerator,
    firstInsert: true,
  });
  return merged;
};

/** Every plaintext in the tree, at any depth — content is nested once applied. */
const allText = (page) => {
  const found = [];
  const walk = (blocks, layoutDict) => {
    for (const ids of Object.values(layoutDict || {})) {
      for (const id of ids) {
        const block = blocks?.[id];
        if (!block) continue;
        if (block.plaintext) found.push(block.plaintext);
        if (block.blocks) walk(block.blocks, block.blocks_layout);
      }
    }
  };
  walk(page.blocks, page.blocks_layout);
  return found;
};

const PAGE = {
  blocks: {
    s1: {
      '@type': 'slate',
      value: [{ type: 'h2', children: [{ text: 'Ways of working' }] }],
      plaintext: 'Ways of working',
    },
    s2: {
      '@type': 'slate',
      value: [{ type: 'p', children: [{ text: 'Content design starts with the problem.' }] }],
      plaintext: 'Content design starts with the problem.',
    },
  },
  blocks_layout: { items: ['s1', 's2'] },
};

// The OTHER shape of layout, and the one the playwright suite already covers
// (`allowed-layouts.spec.ts` → "multiple blocks in matching placeholder
// preserved when switching layouts"): the template's blocks sit at the TOP
// level, side by side with the author's, rather than inside one frame. Both
// shapes go through the same switch, and a fix aimed at the nested one is very
// easy to write so that it breaks this one — so it is pinned here too, where it
// costs a second to find out instead of twenty minutes of CI.
const FLAT_HEADER_FOOTER = '/templates/header-footer-layout';
const FLAT_EDITABLE = '/templates/editable-fixed-layout';

const flatTemplate = (id, headingText, readOnly) => ({
  blocks: {
    head: {
      '@type': 'slate',
      fixed: true,
      ...(readOnly ? { readOnly: true } : {}),
      templateId: id,
      slotId: 'header',
      value: [{ type: 'h1', children: [{ text: headingText }] }],
      plaintext: headingText,
    },
    'default-slot': {
      '@type': 'slate',
      templateId: id,
      slotId: 'default',
      value: [{ type: 'p', children: [{ text: '' }] }],
      plaintext: '',
    },
  },
  blocks_layout: { items: ['head', 'default-slot'] },
});

templates[FLAT_HEADER_FOOTER] = flatTemplate(
  FLAT_HEADER_FOOTER,
  'Layout Header',
  true,
);
templates[FLAT_EDITABLE] = flatTemplate(FLAT_EDITABLE, 'Editable Header', false);

describe('mergeTemplatesIntoPage — switching layouts', () => {
  test('the page keeps its content when a layout replaces a layout', async () => {
    const left = await applyLayout(PAGE, LEFT);
    expect(allText(left)).toEqual([
      'Ways of working',
      'Content design starts with the problem.',
    ]);

    const right = await applyLayout(left, RIGHT);
    expect(
      allText(right),
      'switching the rail from left to right dropped the page content',
    ).toEqual(['Ways of working', 'Content design starts with the problem.']);
  });

  test('the switch really does swap the frame', async () => {
    const right = await applyLayout(await applyLayout(PAGE, LEFT), RIGHT);

    const wrapper = right.blocks[right.blocks_layout.items[0]];
    expect(wrapper['@type']).toBe('contentLayout');
    expect(wrapper.sidebar).toBe('right');
    // The outgoing rail is gone and the incoming one is there.
    const types = Object.values(wrapper.blocks).map((b) => b['@type']);
    expect(types).toContain('utilityList');
    expect(types).not.toContain('sideNav');
  });

  test('a flat layout switches to a flat layout without losing content', async () => {
    const first = await applyLayout(PAGE, FLAT_HEADER_FOOTER);
    expect(allText(first)).toContain('Layout Header');
    expect(allText(first)).toContain('Ways of working');

    const second = await applyLayout(first, FLAT_EDITABLE);
    const text = allText(second);
    // The author's blocks are still here...
    expect(text).toContain('Ways of working');
    expect(text).toContain('Content design starts with the problem.');
    // ...the incoming layout's furniture arrived...
    expect(text).toContain('Editable Header');
    // ...and the outgoing layout's furniture went.
    expect(text).not.toContain('Layout Header');
  });
});
