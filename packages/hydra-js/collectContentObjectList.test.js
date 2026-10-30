import {
  collectContentFromTree,
  cloneBlockFilteringNested,
} from '@volto-hydra/helpers';

/**
 * The reverse capture (collectContentFromTree) harvests a page instance's slot content back
 * into the template on save. It descends into "blocks maps" (shared blocks_layout dicts), but
 * isBlocksMap() is false for arrays, so a nested OBJECT_LIST region (a slider's `slides`) was
 * skipped — a template whose slot content lives inside a slider lost the central edit on save.
 * The apply path (fillContainerInto) already treats both storages uniformly; the capture must
 * too. Same blocks_layout-only assumption removed from convert/wrap/unwrap.
 */
test('collectContentFromTree captures user slot content inside an object_list region (slider slides)', () => {
  const instanceId = 'inst-1';
  const tree = {
    blocks: {
      'sl-1': {
        '@type': 'slider',
        templateId: '/tpl',
        templateInstanceId: instanceId,
        slides: [
          {
            '@id': 'cap-1',
            '@type': 'slate',
            templateId: '/tpl',
            templateInstanceId: instanceId,
            slotId: 'caption',
            fixed: false,
            value: [{ type: 'p', children: [{ text: 'user caption' }] }],
          },
        ],
      },
    },
    blocks_layout: { items: ['sl-1'] },
  };

  const pendingContent = new Map();
  const standaloneBlocks = [];
  const existingFixedBlockIds = new Map();
  collectContentFromTree(
    tree,
    instanceId,
    pendingContent,
    standaloneBlocks,
    existingFixedBlockIds,
  );

  // The slide's user content — inside the object_list `slides` — must be captured under its slot.
  expect(pendingContent.has('caption')).toBe(true);
  expect(pendingContent.get('caption')[0].block.value[0].children[0].text).toBe(
    'user caption',
  );
});

/**
 * Regression guard for the shared-helper refactor: a FIXED template slot inside an ordinary
 * blocks_layout container must still be captured under existingFixedBlockIds.
 */
test('collectContentFromTree still captures a fixed slot in a blocks_layout container', () => {
  const instanceId = 'inst-2';
  const tree = {
    blocks: {
      'sec-1': {
        '@type': 'section',
        templateId: '/tpl',
        templateInstanceId: instanceId,
        blocks: {
          'h-1': {
            '@type': 'slate',
            templateId: '/tpl',
            templateInstanceId: instanceId,
            slotId: 'heading',
            fixed: true,
            value: [{ type: 'h1', children: [{ text: 'branded heading' }] }],
          },
        },
        blocks_layout: { items: ['h-1'] },
      },
    },
    blocks_layout: { items: ['sec-1'] },
  };

  const pendingContent = new Map();
  const standaloneBlocks = [];
  const existingFixedBlockIds = new Map();
  collectContentFromTree(
    tree,
    instanceId,
    pendingContent,
    standaloneBlocks,
    existingFixedBlockIds,
  );

  expect(existingFixedBlockIds.has('heading')).toBe(true);
  expect(
    existingFixedBlockIds.get('heading')[0].block.value[0].children[0].text,
  ).toBe('branded heading');
});

/**
 * cloneBlockFilteringNested clones a template snippet for insertion, keeping only template-marked
 * children and re-id'ing them. It was blocks_layout-only (hasNestedBlocksLayout / blocksLayoutRegions),
 * so a nested OBJECT_LIST region (a slider's `slides`) kept its original ids and any user-added
 * (non-template) slides on insert. Now funnel-based (getChildFields), filtering both storages.
 */
test('cloneBlockFilteringNested re-ids + filters children in an object_list region (slider slides)', () => {
  let n = 0;
  const uuidGenerator = () => `new-${++n}`;
  const block = {
    '@type': 'slider',
    templateId: '/tpl',
    slides: [
      {
        '@id': 'keep-1',
        '@type': 'slate',
        templateId: '/tpl',
        value: 'templated',
      },
      { '@id': 'drop-1', '@type': 'slate', value: 'user-added' }, // no template marker → dropped
    ],
  };
  const cloned = cloneBlockFilteringNested(block, uuidGenerator);

  expect(cloned.slides).toHaveLength(1); // non-template slide dropped
  expect(cloned.slides[0]['@id']).not.toBe('keep-1'); // re-id'd (no id collision on insert)
  expect(cloned.slides[0].value).toBe('templated');
  expect(block.slides).toHaveLength(2); // original untouched
});

/**
 * Regression guard for the funnel rewrite: a blocks_layout snippet clone still filters + re-ids
 * its region children.
 */
test('cloneBlockFilteringNested still filters + re-ids a blocks_layout region', () => {
  let n = 0;
  const uuidGenerator = () => `new-${++n}`;
  const block = {
    '@type': 'section',
    templateId: '/tpl',
    blocks: {
      'keep-1': { '@type': 'slate', templateId: '/tpl', value: 'templated' },
      'drop-1': { '@type': 'slate', value: 'user-added' },
    },
    blocks_layout: { items: ['keep-1', 'drop-1'] },
  };
  const cloned = cloneBlockFilteringNested(block, uuidGenerator);

  expect(cloned.blocks_layout.items).toHaveLength(1); // drop-1 removed
  const keptId = cloned.blocks_layout.items[0];
  expect(keptId).not.toBe('keep-1'); // re-id'd
  expect(cloned.blocks[keptId].value).toBe('templated');
});

/**
 * Region-completeness guard for the funnel consolidation: collectContentFromTree now enumerates
 * regions via getChildFields (the same read the apply path uses), so it captures EVERY region of
 * a nested container. The old bespoke walk read only the `items` sibling for ordering, so a
 * populated `items` region masked a second region — its slot content was silently dropped.
 */
test('collectContentFromTree captures slot content in a SECOND region of a nested container', () => {
  const instanceId = 'inst-3';
  const slot = (id, sid, txt) => ({
    '@type': 'slate',
    templateId: '/tpl',
    templateInstanceId: instanceId,
    slotId: sid,
    fixed: false,
    value: [{ type: 'p', children: [{ text: txt }] }],
  });
  const tree = {
    blocks: {
      'cols-1': {
        '@type': 'columns',
        templateId: '/tpl',
        templateInstanceId: instanceId,
        blocks: {
          'main-slot': slot('main-slot', 'main', 'main'),
          'foot-slot': slot('foot-slot', 'foot', 'footer content'),
        },
        // TWO regions; the old walk read only `.items` for ordering, so `footer` was dropped.
        blocks_layout: { items: ['main-slot'], footer: ['foot-slot'] },
      },
    },
    blocks_layout: { items: ['cols-1'] },
  };

  const pendingContent = new Map();
  collectContentFromTree(tree, instanceId, pendingContent, [], new Map());

  expect(pendingContent.has('main')).toBe(true);
  expect(pendingContent.has('foot')).toBe(true); // second region — dropped by the old walk
  expect(pendingContent.get('foot')[0].block.value[0].children[0].text).toBe(
    'footer content',
  );
});
