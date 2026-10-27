import { expandTemplatesSync } from '@volto-hydra/helpers';

/**
 * Coverage for merge cases that were previously untested (gaps #2-#4):
 *  2. an object_list array whose items include a SLOT placeholder filled from user content
 *  3. a container with MULTIPLE blocks_layout regions (each filled independently)
 *  4. the "minted THIS pass" recognition boundary — a loaded (prior-pass) instance is
 *     re-applied, not passed through as stale content.
 */

describe('gap #2 — object_list slot placeholder filled from user content', () => {
  const template = {
    '@id': '/t/slider',
    blocks: {
      slider: {
        '@type': 'slider', fixed: true, readOnly: true, templateId: '/t/slider', slotId: 'slider',
        slides: [
          { '@id': 'intro', '@type': 'slide', fixed: true, readOnly: true, templateId: '/t/slider', slotId: 'intro', title: 'Intro' },
          { '@id': 'user-slot', '@type': 'slide', templateId: '/t/slider', slotId: 'slides' }, // non-fixed = slot
        ],
      },
    },
    blocks_layout: { items: ['slider'] },
  };

  test('user slides fill the object_list slot; the fixed intro slide is kept', () => {
    const pageBlocks = {
      s1: { '@id': 's1', '@type': 'slide', slotId: 'slides', title: 'User Slide 1' },
      s2: { '@id': 's2', '@type': 'slide', slotId: 'slides', title: 'User Slide 2' },
    };
    const result = expandTemplatesSync(['s1', 's2'], {
      blocks: pageBlocks, templates: { '/t/slider': template }, templateState: {}, allowedLayouts: ['/t/slider'],
    });
    const slider = result.find((b) => b['@type'] === 'slider');
    expect(slider).toBeDefined();
    expect(Array.isArray(slider.slides)).toBe(true);
    const titles = slider.slides.map((s) => s.title);
    expect(titles).toContain('Intro');       // fixed template slide kept
    expect(titles).toContain('User Slide 1'); // user content filled the slot
    expect(titles).toContain('User Slide 2');
  });
});

describe('gap #3 — multi-region container: every blocks_layout region is filled', () => {
  const template = {
    '@id': '/t/multi',
    blocks: {
      box: {
        '@type': 'box', fixed: true, readOnly: true, templateId: '/t/multi', slotId: 'box',
        blocks: {
          'main-slot': { '@type': 'slate', templateId: '/t/multi', slotId: 'main' },
          'foot-slot': { '@type': 'slate', templateId: '/t/multi', slotId: 'foot' },
        },
        blocks_layout: { main: ['main-slot'], foot: ['foot-slot'] }, // TWO regions
      },
    },
    blocks_layout: { items: ['box'] },
  };

  test('user content lands in the correct region (main vs foot), not cross-contaminated', () => {
    const pageBlocks = {
      'u-main': { '@type': 'slate', slotId: 'main', value: [{ text: 'MAIN' }] },
      'u-foot': { '@type': 'slate', slotId: 'foot', value: [{ text: 'FOOT' }] },
    };
    const result = expandTemplatesSync(['u-main', 'u-foot'], {
      blocks: pageBlocks, templates: { '/t/multi': template }, templateState: {}, allowedLayouts: ['/t/multi'],
    });
    const box = result.find((b) => b['@type'] === 'box');
    expect(box).toBeDefined();
    expect(box.blocks_layout.main).toBeDefined();
    expect(box.blocks_layout.foot).toBeDefined();
    const text = (ids) => ids.map((id) => box.blocks[id]?.value?.[0]?.text);
    expect(text(box.blocks_layout.main)).toContain('MAIN');
    expect(text(box.blocks_layout.foot)).toContain('FOOT');
    // no cross-contamination between regions
    expect(text(box.blocks_layout.main)).not.toContain('FOOT');
    expect(text(box.blocks_layout.foot)).not.toContain('MAIN');
  });
});

describe('gap #4 — a loaded (prior-pass) instance is re-applied, not passed through as stale', () => {
  const template = {
    '@id': '/t/box',
    blocks: {
      box: {
        '@type': 'box', fixed: true, readOnly: true, templateId: '/t/box', slotId: 'box',
        blocks: {
          title: { '@type': 'slate', fixed: true, readOnly: true, templateId: '/t/box', slotId: 'title', value: [{ text: 'Template Title' }] },
          body: { '@type': 'slate', templateId: '/t/box', slotId: 'body' },
        },
        blocks_layout: { items: ['title', 'body'] },
      },
    },
    blocks_layout: { items: ['box'] },
  };

  test('readOnly title is re-injected from the template (not the page-stored STALE value)', () => {
    // A fresh render pass (empty templateState) over a page saved with a STALE fixed
    // title. Its instanceId is NOT minted this pass, so it falls through to apply and
    // re-injects the template content — proving recognition keys on "minted this pass".
    const pageBlocks = {
      box: {
        '@type': 'box', fixed: true, readOnly: true, templateId: '/t/box', templateInstanceId: 'stale', slotId: 'box',
        blocks: {
          t: { '@type': 'slate', fixed: true, readOnly: true, templateId: '/t/box', templateInstanceId: 'stale', slotId: 'title', value: [{ text: 'STALE TITLE' }] },
          b: { '@type': 'slate', templateId: '/t/box', templateInstanceId: 'stale', slotId: 'body', value: [{ text: 'My Body' }] },
        },
        blocks_layout: { items: ['t', 'b'] },
      },
    };
    const result = expandTemplatesSync(['box'], {
      blocks: pageBlocks, templates: { '/t/box': template }, templateState: {},
    });
    const box = result.find((b) => b['@type'] === 'box');
    expect(box).toBeDefined();
    const title = Object.values(box.blocks).find((b) => b.slotId === 'title');
    const body = Object.values(box.blocks).find((b) => b.slotId === 'body');
    expect(title?.value?.[0]?.text).toBe('Template Title'); // re-injected, not STALE
    expect(body?.value?.[0]?.text).toBe('My Body');          // user content preserved
  });
});

describe("a template's definition is not a use of it — in every region, both storages", () => {
  // A definition opened as a page: its regions hold the template's OWN blocks. Each
  // container's re-entry brings one of its nested regions; the merge must recognise it
  // as the definition too, whether the region is blocks_layout or an object_list.
  const template = {
    '@id': '/t/def',
    blocks: {
      cols: {
        '@type': 'columns', fixed: true, readOnly: true, templateId: '/t/def', slotId: 'cols',
        blocks: {
          cell: { '@type': 'slate', fixed: true, readOnly: true, templateId: '/t/def', slotId: 'cell', plaintext: 'Cell' },
        },
        blocks_layout: { items: ['cell'] },
      },
      slider: {
        '@type': 'slider', fixed: true, readOnly: true, templateId: '/t/def', slotId: 'slider',
        slides: [
          { '@id': 'slide-1', '@type': 'slide', fixed: true, readOnly: true, templateId: '/t/def', slotId: 'slide', title: 'One' },
          { '@id': 'slide-2', '@type': 'slide', fixed: true, readOnly: true, templateId: '/t/def', slotId: 'slide', title: 'Two' },
        ],
      },
    },
    blocks_layout: { items: ['cols', 'slider'] },
  };
  const expand = (items, options) =>
    expandTemplatesSync(items, { templates: { '/t/def': template }, templateState: {}, editMode: false, ...options })
      .map((b) => b['@uid']);

  test('a nested blocks_layout region of the definition is left as it is', () => {
    const { blocks } = structuredClone(template.blocks.cols);
    expect(expand(['cell'], { blocks })).toEqual(['cell']);
  });

  test('a nested object_list region of the definition is left as it is', () => {
    const slides = structuredClone(template.blocks.slider.slides);
    expect(expand(slides, { idField: '@id' })).toEqual(['slide-1', 'slide-2']);
  });
});
