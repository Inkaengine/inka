import { describe, test, expect } from 'vitest';
import { inheritTemplateMembershipDeep, freshNestedInstances } from './blockPath.js';

/**
 * inka#231: "Make template" labelled only the block it was made from. The
 * merge takes a template's blocks by their templateId, so its unlabelled
 * children were dropped: from the template on "Change on all pages", and from
 * every published page using it.
 */
describe('inheritTemplateMembershipDeep', () => {
  const T = '/templates/cta';
  const member = { templateId: T, templateInstanceId: T };

  test('every block inside a template block becomes its, at every depth and in every region', () => {
    const section = {
      '@type': 'section',
      ...member,
      slotId: 'primary',
      blocks: {
        col: {
          '@type': 'column',
          blocks: { txt: { '@type': 'slate', value: [] } },
          blocks_layout: { items: ['txt'] },
        },
        btn: { '@type': 'button', title: 'Contact us' },
      },
      blocks_layout: { items: ['col'], footer: ['btn'] },
    };
    const out = inheritTemplateMembershipDeep(section, {});
    expect(out.blocks.col).toMatchObject(member);
    expect(out.blocks.col.blocks.txt).toMatchObject(member);
    expect(out.blocks.btn).toMatchObject(member);
    expect(out.blocks_layout).toEqual(section.blocks_layout);
  });

  // A template's block names its slot, and a slot is one place at every depth
  // (inka#708): each region of the block is a slot of its own, named from the
  // block's slot and the region; a block inside that names its own keeps it.
  test("each region inside is a slot of its own, named from the block's", () => {
    const section = {
      '@type': 'section',
      ...member,
      slotId: 'primary',
      blocks: {
        txt: { '@type': 'slate', value: [] },
        own: { '@type': 'slate', slotId: 'aside', value: [] },
        btn: { '@type': 'button' },
      },
      blocks_layout: { items: ['txt', 'own'], footer: ['btn'] },
    };
    const out = inheritTemplateMembershipDeep(section, {});
    expect(out.slotId).toBe('primary');
    expect(out.blocks.txt.slotId).toBe('primary-items');
    expect(out.blocks.own.slotId).toBe('aside');
    expect(out.blocks.btn.slotId).toBe('primary-footer');
  });

  test('a list keyed by its own id field is labelled too, ids kept', () => {
    const form = {
      '@type': 'form',
      ...member,
      subblocks: [
        { field_id: 'name', field_type: 'text' },
        { field_id: 'email', field_type: 'from' },
      ],
    };
    const out = inheritTemplateMembershipDeep(form, { form: { subblocks: 'field_id' } });
    expect(out.subblocks.map((f) => [f.field_id, f.templateId, f.templateInstanceId])).toEqual([
      ['name', T, T],
      ['email', T, T],
    ]);
  });

  test('children do not take the block\'s fixed or readOnly: each keeps its own', () => {
    const section = {
      '@type': 'section',
      ...member,
      fixed: true,
      readOnly: true,
      blocks: { btn: { '@type': 'button' } },
      blocks_layout: { items: ['btn'] },
    };
    const out = inheritTemplateMembershipDeep(section, {});
    expect(out.blocks.btn.fixed).toBeUndefined();
    expect(out.blocks.btn.readOnly).toBeUndefined();
  });

  test('the input is not changed', () => {
    const section = {
      '@type': 'section',
      ...member,
      blocks: { btn: { '@type': 'button' } },
      blocks_layout: { items: ['btn'] },
    };
    const before = JSON.stringify(section);
    inheritTemplateMembershipDeep(Object.freeze(section), {});
    expect(JSON.stringify(section)).toBe(before);
  });

  test('a block that is in no template is returned as it is', () => {
    const plain = { '@type': 'section', blocks: { b: { '@type': 'button' } }, blocks_layout: { items: ['b'] } };
    expect(inheritTemplateMembershipDeep(plain, {})).toBe(plain);
  });
});

/**
 * A paste is a new block (docs/architecture.md "Template membership"), and so is
 * a template nested in it: the copy of a snippet is another instance of it, not
 * the same one in two places. Keeping the instance id gave one instance its
 * slots twice, which the merge cannot tell apart (inka#708).
 */
describe('freshNestedInstances', () => {
  const S = '/templates/snippet';
  test("a template nested in a copy is a new instance: one fresh id for all its blocks", () => {
    const group = {
      '@type': 'group',
      templateId: '/templates/layout', templateInstanceId: 'layout-1', slotId: 'main',
      blocks: {
        h: { '@type': 'slate', templateId: S, templateInstanceId: 'snip-1', slotId: 'heading', fixed: true },
        b: { '@type': 'slate', templateId: S, templateInstanceId: 'snip-1', slotId: 'body' },
        own: { '@type': 'slate', templateId: '/templates/layout', templateInstanceId: 'layout-1', slotId: 'main' },
      },
      blocks_layout: { items: ['h', 'b', 'own'] },
    };
    const before = JSON.stringify(group);
    const out = freshNestedInstances(group, {}, () => 'snip-2');
    expect(out.templateInstanceId).toBe('layout-1');
    expect(out.blocks.own.templateInstanceId).toBe('layout-1');
    expect([out.blocks.h.templateInstanceId, out.blocks.b.templateInstanceId]).toEqual(['snip-2', 'snip-2']);
    expect([out.blocks.h.slotId, out.blocks.b.slotId]).toEqual(['heading', 'body']);
    expect(JSON.stringify(group), 'the input is not changed').toBe(before);
  });
});
