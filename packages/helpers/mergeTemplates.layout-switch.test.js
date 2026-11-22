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
import { mergeTemplatesIntoPage } from './mergeTemplates.js';

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

  test("a container in the content keeps its children when a layout replaces a layout", async () => {
    // A grid of cards in the page content. Harvesting the outgoing frame took
    // the grid whole AND each card inside it again as content of its own, so
    // the next layout drew every card twice: in the grid and alone after it.
    const withGrid = {
      blocks: {
        g1: {
          '@type': 'cards',
          blocks: {
            c1: { '@type': 'card', title: 'Opening hours' },
            c2: { '@type': 'card', title: 'Contact us' },
          },
          blocks_layout: { items: ['c1', 'c2'] },
        },
      },
      blocks_layout: { items: ['g1'] },
    };
    const right = await applyLayout(await applyLayout(withGrid, LEFT), RIGHT);

    // Where each card is drawn: by the region that lists it.
    const placed = [];
    const walk = (blocks, layoutDict, owner) => {
      for (const ids of Object.values(layoutDict || {})) {
        for (const id of ids) {
          const block = blocks?.[id];
          if (!block) continue;
          if (block['@type'] === 'card') placed.push(`${block.title} in ${owner}`);
          if (block.blocks) walk(block.blocks, block.blocks_layout, block['@type']);
        }
      }
    };
    walk(right.blocks, right.blocks_layout, 'page');
    expect(placed).toEqual(['Opening hours in cards', 'Contact us in cards']);
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

/**
 * A layout's slot that the page never filled is the TEMPLATE's: when a page has
 * nothing for a slot, the admin's merge puts the template's own slot block there
 * (blank, its sample text turned into hints), so the author has somewhere to
 * type. Switching layouts took that block as the author's content, and, the
 * incoming layout having no such slot, moved it into `default`, where it stayed.
 * Each switch away from a layout with such a slot added one more block to the
 * page — a hero's empty intro, a blank suggested topic — and switching back
 * and forth piled them up in the page's content.
 *
 * What the author wrote still moves as before ("How the Merge Works", Place
 * the leftovers): only a block with nothing of its own is left behind.
 */
describe('mergeTemplatesIntoPage — switching layouts leaves unfilled slots behind', () => {
  const PLAIN = '/templates/plain';
  const HERO = '/templates/hero';
  const TOPICS = '/templates/topics';
  const FLAT_ASIDE = '/templates/flat-aside';
  const FLAT_PLAIN = '/templates/flat-plain';

  const blank = (slotId) => ({
    '@type': 'slate',
    slotId,
    fixed: false,
    value: [{ type: 'p', children: [{ text: '' }] }],
  });
  // A frame (fixed, readOnly) with a default slot and one fixed block in its
  // hero region; the hero block may hold a slot of its own.
  const frame = (id, heroBlock) => ({
    blocks: {
      layout0: {
        '@type': 'contentLayout',
        fixed: true,
        readOnly: true,
        slotId: 'layout0',
        blocks: { m0: blank('default'), h0: heroBlock },
        blocks_layout: { main: ['m0'], hero: ['h0'] },
      },
    },
    blocks_layout: { items: ['layout0'] },
  });
  const local = {
    [PLAIN]: frame(PLAIN, { '@type': 'title', fixed: true, slotId: 'hero' }),
    [HERO]: frame(HERO, {
      '@type': 'hero',
      fixed: true,
      slotId: 'hero',
      heading: 'Page heading',
      blocks: { i0: blank('hero-intro') },
      blocks_layout: { intro: ['i0'] },
    }),
    // A slot whose block has sample text: it is placed as hints, with no text.
    [TOPICS]: frame(TOPICS, {
      '@type': 'heroSearch',
      fixed: true,
      slotId: 'hero',
      blocks: { t1: { '@type': 'textItem', slotId: 'hero-suggested', fixed: false, text: 'Popular topic' } },
      blocks_layout: { suggested: ['t1'] },
    }),
    // The same at the page's own level: a flat layout with a second slot.
    [FLAT_ASIDE]: {
      blocks: {
        head: { '@type': 'slate', fixed: true, readOnly: true, slotId: 'header', plaintext: 'Head' },
        d0: blank('default'),
        a0: blank('aside'),
      },
      blocks_layout: { items: ['head', 'd0', 'a0'] },
    },
    [FLAT_PLAIN]: {
      blocks: {
        head: { '@type': 'slate', fixed: true, readOnly: true, slotId: 'header', plaintext: 'Head' },
        d0: blank('default'),
      },
      blocks_layout: { items: ['head', 'd0'] },
    },
  };
  const load = async (id) => {
    if (!local[id]) throw new Error(`no such template: ${id}`);
    return structuredClone({ ...local[id], '@id': id });
  };
  let n = 0;
  const switchTo = async (page, layout) => {
    const { merged } = await mergeTemplatesIntoPage(page, {
      loadTemplate: load,
      pageBlocksFields: { items: { allowedLayouts: [layout] } },
      uuidGenerator: () => `id-${++n}`,
      firstInsert: true,
    });
    return merged;
  };
  // Every block on the page, at any depth, as "type text" in region order.
  const shape = (page) => {
    const out = [];
    const walk = (blocks, layoutDict, depth) => {
      for (const [region, ids] of Object.entries(layoutDict || {})) {
        for (const id of ids) {
          const b = blocks[id];
          out.push(`${'  '.repeat(depth)}${region}: ${b['@type']}${b.plaintext ? ` "${b.plaintext}"` : ''}`);
          if (b.blocks) walk(b.blocks, b.blocks_layout, depth + 1);
        }
      }
    };
    walk(page.blocks, page.blocks_layout, 0);
    return out;
  };

  const shapes = {};
  const each = async (page, layouts) => {
    for (const layout of layouts) {
      page = await switchTo(page, layout);
      const seen = shape(page);
      if (shapes[layout]) expect(seen, `back on ${layout}`).toEqual(shapes[layout]);
      else shapes[layout] = seen;
    }
    return page;
  };

  test.each([
    ["a fixed block's slot inside the layout's frame", [PLAIN, HERO, PLAIN, HERO, PLAIN]],
    ['a slot whose block has sample text', [PLAIN, TOPICS, HERO, TOPICS, PLAIN, TOPICS]],
    ["a slot in the page's own region", [FLAT_PLAIN, FLAT_ASIDE, FLAT_PLAIN, FLAT_ASIDE, FLAT_PLAIN]],
  ])('%s: switching back and forth adds nothing', async (_where, layouts) => {
    for (const k of Object.keys(shapes)) delete shapes[k];
    await each(PAGE, layouts);
  });

  test('what the author typed into such a slot still moves to the content', async () => {
    const hero = await switchTo(PAGE, HERO);
    const frameBlock = hero.blocks[hero.blocks_layout.items[0]];
    const heroBlock = frameBlock.blocks[frameBlock.blocks_layout.hero[0]];
    const intro = heroBlock.blocks[heroBlock.blocks_layout.intro[0]];
    intro.value = [{ type: 'p', children: [{ text: 'An intro' }] }];
    intro.plaintext = 'An intro';

    const plain = await switchTo(hero, PLAIN);
    expect(allText(plain)).toEqual(['An intro', 'Ways of working', 'Content design starts with the problem.']);
  });

  test('a sample the author changed is theirs, and moves to the content', async () => {
    const topics = await switchTo(PAGE, TOPICS);
    const frameBlock = topics.blocks[topics.blocks_layout.items[0]];
    const heroBlock = frameBlock.blocks[frameBlock.blocks_layout.hero[0]];
    const topic = heroBlock.blocks[heroBlock.blocks_layout.suggested[0]];
    expect(topic.text, 'placed with the sample').toBe('Popular topic');
    topic.text = 'Road closures';

    const plain = await switchTo(topics, PLAIN);
    const frameAfter = plain.blocks[plain.blocks_layout.items[0]];
    const main = frameAfter.blocks_layout.main.map((id) => frameAfter.blocks[id]);
    expect(main.map((b) => b.text || b.plaintext)).toEqual([
      'Road closures',
      'Ways of working',
      'Content design starts with the problem.',
    ]);
  });
});
