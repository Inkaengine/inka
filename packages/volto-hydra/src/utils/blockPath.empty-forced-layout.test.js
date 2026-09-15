/**
 * Repro: an EMPTY forced-layout region (allowedLayouts) — the NSW site
 * announcement — must seed a TYPED placeholder when empty, not a typeless
 * `@type: 'empty'`. A typeless seed comes through the admin as
 * "Block data undefined" and can't be inline-edited (it has no fields).
 *
 * This pins down whether the typeless seed is a config gap (region needs a
 * defaultBlockType / single allowedBlocks) or a deeper forced-layout bug.
 */
import { describe, test, expect, vi } from 'vitest';

// blockSync reaches HydraSchemaContext.js — JSX inside a .js file, which esbuild
// (vitest) can't parse. Nothing here touches the live schema context.
vi.mock('../context', () => ({
  getHydraSchemaContext: () => ({}),
  setHydraSchemaContext: () => () => {},
  getLiveBlockData: () => undefined,
}));
import { PAGE_BLOCK_UID } from '@volto-hydra/hydra-js';
import { getBlockAddability } from '@volto-hydra/helpers';
import {
  buildBlockPathMap,
  ensureEmptyBlockIfEmpty,
  getBlockById,
} from './blockPath.js';
// deleteBlocks lives in the EDIT layer (blockSync), not among the storage
// primitives: it deletes and then settles the structure the delete disturbed.
import { deleteBlocks } from './blockSync.js';
import { mergeTemplatesIntoPage } from './mergeTemplates.mjs';

const EMPTY_ANNOUNCEMENT_TEMPLATE = {
  '@id': '/templates/site-announcement',
  '@type': 'Document',
  blocks: {},
  blocks_layout: { items: [] },
};

const intl = { formatMessage: (m) => m?.defaultMessage || m?.id || '' };

const makeCfg = (announcementExtra) => ({
  _page: {
    id: '_page',
    schema: () => ({
      properties: {
        items: {
          widget: 'blocks_layout',
          allowedBlocks: ['slate'],
          defaultBlockType: 'slate',
        },
        announcement: {
          widget: 'blocks_layout',
          title: 'Announcement',
          allowedLayouts: ['/templates/site-announcement'],
          ...announcementExtra,
        },
      },
    }),
  },
  slate: { id: 'slate' },
  globalAlert: { id: 'globalAlert' },
});

const seedAnnouncement = (cfg) => {
  const form = {
    '@type': 'Document',
    blocks: { a: { '@type': 'slate' } },
    blocks_layout: { items: ['a'], announcement: [] },
  };
  const map = buildBlockPathMap(form, cfg, intl);
  let n = 0;
  const result = ensureEmptyBlockIfEmpty(
    form,
    { parentId: PAGE_BLOCK_UID },
    map,
    () => `seed-${++n}`,
    cfg,
    { intl },
  );
  const id = result.blocks_layout.announcement?.[0];
  return id ? result.blocks[id] : undefined;
};

describe('empty forced-layout region seeds an empty placeholder (announcement)', () => {
  // The NSW announcement is EMPTY by default (no band). We want hydra to seed an
  // `@type: "empty"` placeholder — a selectable slot with a '+' the editor uses
  // to add a global alert — NOT a typed block and NOT the page default.
  //
  // `defaultBlockType: "empty"` forces that regardless of allowedBlocks. The
  // frontend renders the seed via the central Block dispatch, which renders
  // `empty` as a selectable slot.
  test('defaultBlockType:"empty" -> seeds an @type:"empty" placeholder', () => {
    const seed = seedAnnouncement(
      makeCfg({ allowedBlocks: ['globalAlert'], defaultBlockType: 'empty' }),
    );
    expect(seed?.['@type']).toBe('empty');
  });

  // ROOT CAUSE of the earlier admin "Block data undefined": with NO type config
  // the region falls back to the PAGE default block type (here slate) — the wrong
  // type for the announcement. Documented so the defaultBlockType isn't dropped.
  test('no type config -> falls back to the page default (slate), the bug', () => {
    const seed = seedAnnouncement(makeCfg({}));
    expect(seed?.['@type']).toBe('slate');
  });
});

// The full admin data-prep pipeline for an empty forced layout (View.jsx
// INITIAL_DATA): merge the forced layout, then seed empty page regions. The
// seeded announcement placeholder must be RESOLVABLE via getBlockById (what the
// admin uses) — the admin logged "Block data undefined / blockPathMap entry:
// undefined", so this pins whether the pure pipeline is at fault (it isn't — the
// bug is View.jsx committing the pre-seed data to Redux).
describe('empty forced-layout data-prep pipeline (merge + seed)', () => {
  test('the seeded announcement placeholder resolves via getBlockById', async () => {
    const cfg = makeCfg({
      allowedBlocks: ['globalAlert'],
      defaultBlockType: 'empty',
    });
    const page = {
      '@type': 'Document',
      blocks: { a: { '@type': 'slate' } },
      blocks_layout: { items: ['a'], announcement: [] },
    };

    const { merged } = await mergeTemplatesIntoPage(page, {
      loadTemplate: async () => EMPTY_ANNOUNCEMENT_TEMPLATE,
      pageBlocksFields: {
        items: {},
        announcement: { allowedLayouts: ['/templates/site-announcement'] },
      },
      uuidGenerator: () => 'ann-seed',
      blocksConfig: cfg,
      intl,
    });

    let map = buildBlockPathMap(merged, cfg, intl);
    const seeded = ensureEmptyBlockIfEmpty(
      merged,
      { parentId: PAGE_BLOCK_UID },
      map,
      () => 'ann-seed',
      cfg,
      { intl, properties: merged },
    );
    map = buildBlockPathMap(seeded, cfg, intl);

    const annIds = seeded.blocks_layout.announcement || [];
    expect(annIds.length, 'announcement region should be seeded').toBe(1);
    const seedId = annIds[0];
    const resolved = getBlockById(seeded, map, seedId);
    expect(resolved, `getBlockById must resolve the seed ${seedId}`).toBeTruthy();
    expect(resolved?.['@type']).toBe('empty');
  });
});

// A FORCED layout (allowedLayouts) region is template-controlled — its content
// lives in the shared template and is edited centrally. So when such a region is
// empty by default, its seeded placeholder must be a LOCKED template member: it
// shows empty, but you cannot fill/edit it until you UNLOCK the template. If the
// seed is plain page content (as it is today), filling it silently writes
// per-page instead of to the shared template — the announcement stops being
// site-wide. This is the "unlock like the footer" contract.
describe('forced empty layout is empty but LOCKED until the template is unlocked', () => {
  const template = {
    '@id': '/templates/site-announcement',
    '@type': 'Document',
    blocks: {},
    blocks_layout: { items: [] },
  };
  const cfg = makeCfg({ allowedBlocks: ['globalAlert'], defaultBlockType: 'empty' });

  async function seedForcedEmpty() {
    const page = {
      '@type': 'Document',
      blocks: { a: { '@type': 'slate' } },
      blocks_layout: { items: ['a'], announcement: [] },
    };
    const { merged } = await mergeTemplatesIntoPage(page, {
      loadTemplate: async () => template,
      pageBlocksFields: {
        items: {},
        announcement: { allowedLayouts: ['/templates/site-announcement'] },
      },
      uuidGenerator: () => 'ann-seed',
      blocksConfig: cfg,
      intl,
    });
    let map = buildBlockPathMap(merged, cfg, intl);
    const seeded = ensureEmptyBlockIfEmpty(
      merged,
      { parentId: PAGE_BLOCK_UID },
      map,
      () => 'ann-seed',
      cfg,
      { intl, properties: merged },
    );
    map = buildBlockPathMap(seeded, cfg, intl);
    const id = seeded.blocks_layout.announcement[0];
    return { seed: seeded.blocks[id], id, seeded, map };
  }

  // The walk SyncedSlateToolbar does to decide whether to draw the lock: from the
  // selected block, up through parentId, looking for a top-level template
  // instance. Null means no lock control — on the toolbar OR in the sidebar.
  function instanceOf(map, blockId) {
    let instanceId = null;
    let cur = blockId;
    while (cur) {
      const info = map[cur];
      if (!info) break;
      if (info.isTemplateInstance && !info.isNestedTemplateInstance) instanceId = cur;
      cur = info.parentId;
    }
    return instanceId;
  }

  test('the seeded empty is a template member (has a templateInstanceId)', async () => {
    const { seed } = await seedForcedEmpty();
    expect(
      seed?.templateInstanceId,
      'a forced-layout empty must belong to the template instance',
    ).toBeTruthy();
  });

  test('the seeded empty is fixed + read-only (locked) — chrome, not per-page content', async () => {
    const { seed } = await seedForcedEmpty();
    // fixed: it's template chrome — can't be moved or deleted in normal mode.
    expect(seed?.fixed, 'a forced-layout empty must be fixed (template chrome)').toBe(
      true,
    );
    // readOnly: locked — can't be edited/filled until the template is unlocked.
    expect(
      seed?.readOnly,
      'a forced-layout empty must be locked until the template is unlocked',
    ).toBe(true);
  });

  // The empty is only half the story. An author unlocks the region, fills it, and
  // then has to LOCK it again to publish — and the lock is drawn only if the walk
  // above finds a template instance from the selected block. On the docs site
  // that walk came up empty after adding a global alert into an emptied
  // announcement: no lock on the toolbar, none in the sidebar, no way to publish
  // what had just been written.
  //
  // Membership on an add is otherwise inherited from a NEIGHBOUR, and an emptied
  // forced region has none — which is why this case needs pinning separately from
  // the object_list one.
  test('the walk that draws the lock reaches the instance from the seeded empty', async () => {
    const { map, id, seed } = await seedForcedEmpty();
    expect(
      instanceOf(map, id),
      'no template instance above the seeded empty — nothing would draw a lock',
    ).toBe(seed.templateInstanceId);
  });

  test('a block that REPLACES the empty is still inside the instance', async () => {
    // What filling the placeholder produces: convertBlockInPlace builds the new
    // block from the chosen type and carries the empty's membership across
    // (templateId/templateInstanceId/slotId/fixed/readOnly).
    const { seeded, id, seed, map: seedMap } = await seedForcedEmpty();
    const filled = {
      ...seeded,
      blocks: {
        ...seeded.blocks,
        [id]: {
          '@type': 'globalAlert',
          templateId: seed.templateId,
          templateInstanceId: seed.templateInstanceId,
          slotId: seed.slotId,
          fixed: seed.fixed,
          readOnly: seed.readOnly,
        },
      },
    };
    expect(instanceOf(seedMap, id)).toBe(seed.templateInstanceId);
    const map = buildBlockPathMap(filled, cfg, intl);
    expect(
      instanceOf(map, id),
      'the filled block lost the instance the empty belonged to — the lock disappears',
    ).toBe(seed.templateInstanceId);
  });

  // The docs-site flow that lost its lock does not start from an empty region: it
  // starts from a region with an alert in it, which the author REMOVES before
  // adding a new one. So the placeholder has to be re-seeded mid-session, not
  // just at load — and it has to come back with the same membership, or the
  // block that replaces it is per-page content and cannot be locked.
  test('re-seeding after the member is removed restores the membership', async () => {
    const { seeded, id, seed } = await seedForcedEmpty();
    // The author removes what was there: the region is empty again.
    const emptied = {
      ...seeded,
      blocks: Object.fromEntries(
        Object.entries(seeded.blocks).filter(([key]) => key !== id),
      ),
      blocks_layout: { ...seeded.blocks_layout, announcement: [] },
    };
    const map = buildBlockPathMap(emptied, cfg, intl);
    const reseeded = ensureEmptyBlockIfEmpty(
      emptied,
      { parentId: PAGE_BLOCK_UID },
      map,
      () => 're-seed',
      cfg,
      { intl, properties: emptied },
    );
    const newId = reseeded.blocks_layout.announcement[0];
    expect(newId, 'the region was not re-seeded at all').toBeTruthy();
    expect(
      reseeded.blocks[newId]?.templateInstanceId,
      'the re-seeded empty lost the template instance — nothing to lock',
    ).toBe(seed.templateInstanceId);
    expect(instanceOf(buildBlockPathMap(reseeded, cfg, intl), newId)).toBe(
      seed.templateInstanceId,
    );
  });

  // There were two deletes — View.jsx's single (the toolbar's Remove) re-seeded,
  // its multi (hydra-delete-blocks, multi-select) didn't — so whether a forced
  // region survived being emptied depended on how many blocks you had selected
  // when you emptied it. One implementation now, and this pins the behaviour for
  // both shapes it is called in.
  test.each([
    ['one block at a time', (id) => [id]],
    ['several at once', (id) => [id, 'a']],
  ])('deleting %s re-seeds the forced region it empties', async (_label, ids) => {
    const { seeded, id, seed } = await seedForcedEmpty();
    const map = buildBlockPathMap(seeded, cfg, intl);
    // A COUNTER, not a constant: emptying two regions seeds two placeholders,
    // and one id for both would have the second overwrite the first.
    let n = 0;
    const { formData: after } = deleteBlocks(seeded, map, ids(id), {
      blocksConfig: cfg,
      intl,
      uuidGenerator: () => `re-seed-${(n += 1)}`,
      templateEditMode: [seed.templateInstanceId],
    });
    const region = after.blocks_layout.announcement;
    expect(region.length, 'the forced region was emptied into nothing').toBe(1);
    expect(
      after.blocks[region[0]]?.templateInstanceId,
      'the re-seeded placeholder is not the template\'s — nothing to lock',
    ).toBe(seed.templateInstanceId);
  });

  test('locked outside template-edit-mode, replaceable once the template is unlocked', async () => {
    const { seed, id } = await seedForcedEmpty();
    const map = { [id]: { blockType: 'empty' } };
    // Not editing the template → the empty is locked (no '+').
    expect(getBlockAddability(id, map, seed, null).canReplace).toBe(false);
    // Unlocked (the empty's instance is in the set of unlocked templates) →
    // fillable. templateEditMode is an ARRAY of unlocked instance ids (v2).
    expect(
      getBlockAddability(id, map, seed, [seed.templateInstanceId]).canReplace,
    ).toBe(true);
  });
});
