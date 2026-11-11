import { describe, test, expect } from 'vitest';
import { initializeContainerBlock, ensureEmptyBlockIfEmpty } from './blockPath';

/**
 * An object_list container's seeded child type must use the SAME decision as a blocks_layout
 * container (getEmptyBlockType): defaultBlockType → single allowed type → 'empty' picker.
 *
 * The bug: the object_list branch presumed allowedBlocks[0] when there was no default, so a
 * form (subblocks: object_list, allowedBlocks ['text','textarea','from',…], no default)
 * silently seeded a `text` field instead of a pickable empty — the author never got to
 * choose the field type. The blocks_layout branch already did the right thing (empty →
 * 'empty' picker); this pins the two branches to the same centralized decision.
 */
describe('initializeContainerBlock — object_list seed type mirrors getEmptyBlockType', () => {
  let c = 0;
  const uuid = () => `u-${++c}`;
  const intl = { formatMessage: (m) => m?.defaultMessage || m?.id || '' };
  const mkSchema = (subblocksDef) => ({
    properties: {
      subblocks: { widget: 'object_list', idField: 'field_id', typeField: 'field_type', ...subblocksDef },
    },
  });

  test('multiple allowedBlocks + no default → seeds a pickable empty (not the first type)', () => {
    const schema = mkSchema({ allowedBlocks: ['text', 'textarea', 'from'] });
    const result = initializeContainerBlock({ '@type': 'form' }, {}, uuid, { intl, blockType: 'form' }, schema);
    expect(result.subblocks[0].field_type).toBe('empty');
  });

  test('single allowedBlock → auto-picks it', () => {
    const schema = mkSchema({ allowedBlocks: ['text'] });
    const result = initializeContainerBlock({ '@type': 'form' }, {}, uuid, { intl, blockType: 'form' }, schema);
    expect(result.subblocks[0].field_type).toBe('text');
  });

  test('explicit defaultBlockType → uses it', () => {
    const schema = mkSchema({ allowedBlocks: ['text', 'from'], defaultBlockType: 'textarea' });
    const result = initializeContainerBlock({ '@type': 'form' }, {}, uuid, { intl, blockType: 'form' }, schema);
    expect(result.subblocks[0].field_type).toBe('textarea');
  });

  // A real object_list field can carry a field-level `default` (an array of items) — e.g. the
  // codeExample block's `tabs` field defaults to one JavaScript tab. applyBlockDefaults
  // populates the field with that default; the container initializer must then leave a
  // populated field alone rather than replacing it with a single blank item.
  test('object_list field default is preserved, not replaced by a blank seed', () => {
    const schema = {
      properties: {
        tabs: {
          widget: 'object_list',
          idField: '@id',
          schema: { properties: { label: { type: 'string' }, language: { widget: 'select' } } },
          default: [{ '@id': 'tab-1', label: 'JavaScript', language: 'javascript', code: '' }],
        },
      },
    };
    // applyBlockDefaults has already applied the field default:
    const withDefault = { '@type': 'codeExample', tabs: [{ '@id': 'tab-1', label: 'JavaScript', language: 'javascript', code: '' }] };
    const result = initializeContainerBlock(withDefault, {}, uuid, { intl, blockType: 'codeExample' }, schema);
    expect(result.tabs).toHaveLength(1);
    expect(result.tabs[0].label).toBe('JavaScript');
  });
});

/**
 * ensureEmptyBlockIfEmpty seeds a placeholder when a container region empties. Its
 * blocks_layout branch runs applyBlockDefaults + applyBlockInitialValue; its object_list
 * branch used to inline a bare seed and apply NEITHER — so a re-seeded typed object_list item
 * (form field, slide, panel) silently lost its block type's defaults. This pins both seed
 * sites to the same shared path (seedTemplateChild), same divergence class as the
 * initializeContainerBlock field-default bug.
 */
describe('ensureEmptyBlockIfEmpty — object_list seed applies item defaults (parity with blocks_layout)', () => {
  let c = 0;
  const uuid = () => `u-${++c}`;
  const intl = { formatMessage: (m) => m?.defaultMessage || m?.id || '' };

  test('typed object_list seeds the default item type WITH its schema defaults', () => {
    const formData = {
      blocks: { 'parent-1': { '@type': 'container', rows: [] } },
      blocks_layout: { items: ['parent-1'] },
    };
    const blocksConfig = {
      thing: { id: 'thing', blockSchema: { properties: { color: { default: 'red' } } } },
    };
    const blockPathMap = { 'parent-1': { path: ['blocks', 'parent-1'] } };
    const containerConfig = {
      parentId: 'parent-1',
      region: 'rows',
      isObjectList: true,
      idField: '@id',
      typeField: '@type',
      defaultBlockType: 'thing',
    };

    const result = ensureEmptyBlockIfEmpty(formData, containerConfig, blockPathMap, uuid, blocksConfig, { intl });
    const seeded = result.blocks['parent-1'].rows[0];
    expect(seeded).toBeTruthy();
    expect(seeded['@type']).toBe('thing');
    // The item type's scalar default must be applied — as it already is for blocks_layout.
    expect(seeded.color).toBe('red');
  });

  // Parent is a fixed template instance; its blocks_layout region is empty. The seeded
  // placeholder inherits membership (so the merge keeps it). It is locked only when its parent
  // is: a blocks_layout block is edited inline, so freezing a placeholder in an EDITABLE block
  // breaks editing a template directly, while one in a LOCKED block is unlocked with it
  // (isBlockReadonly reads the unlocked instances first).
  const seedIntoInstance = (parentFlags) => {
    const formData = {
      blocks: {
        'inst-1': {
          '@type': 'section',
          templateInstanceId: 'tmpl-1',
          ...parentFlags,
          blocks: {},
          blocks_layout: { items: [] },
        },
      },
      blocks_layout: { items: ['inst-1'] },
    };
    const blocksConfig = { slate: { id: 'slate', blockSchema: { properties: { foo: { default: 'bar' } } } } };
    const blockPathMap = { 'inst-1': { path: ['blocks', 'inst-1'] } };
    const containerConfig = { parentId: 'inst-1', region: 'items', isObjectList: false, defaultBlockType: 'slate' };

    const result = ensureEmptyBlockIfEmpty(formData, containerConfig, blockPathMap, uuid, blocksConfig, { intl });
    const seededId = result.blocks['inst-1'].blocks_layout.items[0];
    return result.blocks['inst-1'].blocks[seededId];
  };

  test('blocks_layout PLACEHOLDER seed in an editable block applies defaults but does NOT inherit fixed (inline-editable)', () => {
    const seeded = seedIntoInstance({ fixed: true, readOnly: false });
    expect(seeded).toBeTruthy();
    expect(seeded.templateInstanceId).toBe('tmpl-1'); // membership inherited (merge keeps it)
    expect(seeded.fixed).toBeFalsy(); // but NOT frozen — stays inline-editable
    expect(seeded.readOnly).toBeFalsy();
    expect(seeded.foo).toBe('bar'); // defaults applied via the unified seedTemplateChild path
  });

  test('blocks_layout PLACEHOLDER seed in a locked block is locked with it', () => {
    const seeded = seedIntoInstance({ fixed: true, readOnly: true });
    expect(seeded).toBeTruthy();
    expect(seeded.templateInstanceId).toBe('tmpl-1');
    expect(seeded.fixed).toBe(true);
    expect(seeded.readOnly).toBe(true);
    expect(seeded.foo).toBe('bar');
  });
});
