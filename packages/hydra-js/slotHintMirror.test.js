/**
 * `prevSlotId` is the mirror of `nextSlotId`: the merge stamps it on a fixed
 * block when the template has a slot region BEFORE it (a bottom-anchored
 * layout — slots above a fixed footer), so an EMPTY leading slot can still be
 * joined. `docs/architecture.md` names the pair as one rule.
 *
 * The merge stamps both and `blockPath`'s placeholder seeding reads both, but
 * the add rules, the hint cleanup and the placeholder filter were each written
 * for `nextSlotId` alone. Every test here fails against that state.
 */
import { buildBlockPathMap } from './buildBlockPathMap.js';
import { getBlockAddability } from '@volto-hydra/helpers';
import { mergeTemplatesIntoPage } from './mergeTemplates.js';

const blocksConfig = {
  frame: {
    id: 'frame',
    blockSchema: {
      properties: {
        main: { widget: 'blocks_layout', allowedBlocks: ['slate', 'title'] },
      },
    },
  },
  title: { id: 'title' },
  slate: { id: 'slate', blockSchema: { properties: { value: {} } } },
};

describe('an empty LEADING slot can be added to, as a trailing one can', () => {
  // A bottom-anchored layout: the region's only block is the template's fixed
  // footer, and the slot ABOVE it is empty, so the footer carries
  // `prevSlotId`. Without the mirror the footer is just a fixed block at the
  // start of its region, so the editor offers no "+" before it and the empty
  // leading slot is unreachable — the dead end `nextSlotId` exists to prevent
  // at the other edge.
  const page = (footerHints) => ({
    blocks: {
      frame: {
        '@type': 'frame',
        templateId: '/t',
        templateInstanceId: 'i',
        slotId: 'frame',
        fixed: true,
        readOnly: true,
        blocks: {
          f: {
            '@type': 'title',
            templateId: '/t',
            templateInstanceId: 'i',
            slotId: 'footer',
            fixed: true,
            ...footerHints,
          },
        },
        blocks_layout: { main: ['f'] },
      },
    },
    blocks_layout: { items: ['frame'] },
  });

  const addabilityOf = (footerHints) => {
    const formData = page(footerHints);
    const bpm = buildBlockPathMap(formData, blocksConfig);
    return getBlockAddability('f', bpm, formData.blocks.frame.blocks.f, undefined);
  };

  test('a fixed block whose leading slot is empty can take a block before it', () => {
    expect(addabilityOf({ prevSlotId: 'primary' }).canInsertBefore).toBe(true);
  });

  test('without a leading slot to join, there is still no "+" before it', () => {
    expect(addabilityOf({}).canInsertBefore).toBe(false);
  });

  test('the trailing hint still only opens the edge after the block', () => {
    const addability = addabilityOf({ nextSlotId: 'primary' });
    expect(addability.canInsertAfter).toBe(true);
    expect(addability.canInsertBefore).toBe(false);
  });
});

describe('the slot hints are recomputed on every apply, not inherited', () => {
  let counter = 0;
  const uuidGenerator = () => `mirror-${++counter}`;

  // Templates are content here, so a template can be CAPTURED from a page that
  // was already merged, and its own blocks then arrive carrying the hints of
  // that older layout. The hints name the slots beside a block in the template
  // as it is NOW; inherited, they leave a block claiming a slot that has since
  // moved or gone, and the editor seeds a placeholder into a slot that is not
  // there.
  const applied = async (template) => {
    const { merged } = await mergeTemplatesIntoPage(
      { blocks: {}, blocks_layout: { items: [] } },
      {
        loadTemplate: async () => template,
        pageBlocksFields: { items: { allowedLayouts: [template['@id']] } },
        uuidGenerator,
        firstInsert: true,
      },
    );
    return merged;
  };

  const anchored = (anchorHints) => ({
    '@id': '/templates/bottom',
    blocks: {
      slot: { '@type': 'slate', slotId: 'primary', value: [] },
      footer: {
        '@type': 'slate',
        fixed: true,
        slotId: 'footer',
        heading: 'Get in touch',
        ...anchorHints,
      },
    },
    blocks_layout: { items: ['slot', 'footer'] },
  });

  const anchorOf = (merged) =>
    Object.values(merged.blocks).find((b) => b.slotId === 'footer');

  test('the leading hint is stamped from the layout as it is now', async () => {
    const anchor = anchorOf(await applied(anchored({})));
    expect(anchor.prevSlotId).toBe('primary');
    expect(anchor).not.toHaveProperty('nextSlotId');
  });

  test("a stale trailing hint on the template's own block is dropped", async () => {
    // Nothing follows the footer, so no trailing hint is computed — the one the
    // captured block carries must not survive.
    const anchor = anchorOf(await applied(anchored({ nextSlotId: 'gone' })));
    expect(anchor).not.toHaveProperty('nextSlotId');
    expect(anchor.prevSlotId).toBe('primary');
  });

  test('a stale leading hint is dropped the same way', async () => {
    const topAnchored = {
      '@id': '/templates/top',
      blocks: {
        header: {
          '@type': 'slate',
          fixed: true,
          slotId: 'header',
          prevSlotId: 'gone',
        },
        slot: { '@type': 'slate', slotId: 'primary', value: [] },
      },
      blocks_layout: { items: ['header', 'slot'] },
    };
    const header = Object.values((await applied(topAnchored)).blocks).find(
      (b) => b.slotId === 'header',
    );
    expect(header).not.toHaveProperty('prevSlotId');
    expect(header.nextSlotId).toBe('primary');
  });

  test('a stale nested-slot hint is dropped the same way', async () => {
    // `childSlotIds` is the third hint of the same kind: the first slot in each
    // of a container's regions, recomputed per apply.
    const withContainer = {
      '@id': '/templates/nested',
      blocks: {
        frame: {
          '@type': 'frame',
          fixed: true,
          slotId: 'frame',
          childSlotIds: { blocks: 'gone' },
          blocks: {},
          blocks_layout: { main: [] },
        },
      },
      blocks_layout: { items: ['frame'] },
    };
    const frame = Object.values((await applied(withContainer)).blocks).find(
      (b) => b.slotId === 'frame',
    );
    expect(frame).not.toHaveProperty('childSlotIds');
  });

  test('the hints are machinery, so they are never offered as placeholder text', async () => {
    // `fieldPlaceholders` is what the editor shows in an editable fixed block's
    // empty fields. A hint is a slot name, not anything an author wrote.
    const anchor = anchorOf(
      await applied(anchored({ nextSlotId: 'gone', prevSlotId: 'also-gone' })),
    );
    expect(anchor.fieldPlaceholders).toEqual({ heading: 'Get in touch' });
  });
});
