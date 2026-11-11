import { describe, test, expect } from 'vitest';
import { inheritTemplateMembershipDeep } from './blockPath.js';

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
