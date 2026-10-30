import { expandTemplatesSync } from '@volto-hydra/helpers';

/**
 * subblocks is a typed object_list keyed by `field_id` (docs/examples/form.md), NOT `@id`. When
 * the merge instance-scopes a fixed child's id it reads the item's id via the field's idField —
 * but it defaults to `@id`, which a field_id-keyed item doesn't have, so it mints a bogus
 * `${instanceId}::undefined` @id. The merge must resolve the idField from the schema (admin) or a
 * hint (frontend) to stamp object_list items correctly.
 */
describe('expandTemplatesSync: object_list item id stamping honours the idField', () => {
  test('a form subblocks item (idField field_id) keeps field_id and gets no bogus @id', () => {
    const template = {
      '@id': '/t/form',
      '@type': 'Document',
      blocks: {
        'the-form': {
          '@type': 'form', fixed: true, slotId: 'the-form', templateId: '/t/form',
          subblocks: [
            { field_id: 'fld-a', field_type: 'text', fixed: true, slotId: 'fld-a', templateId: '/t/form' },
          ],
        },
      },
      blocks_layout: { items: ['the-form'] },
    };
    // The caller-resolved idField hint (admin derives this from the schema; a frontend passes it literally).
    const idFieldMap = { form: { subblocks: 'field_id' } };
    const result = expandTemplatesSync([], {
      blocks: {}, templates: { '/t/form': template }, templateState: {}, allowedLayouts: ['/t/form'], idFieldMap,
    });
    const form = result.find((b) => b['@type'] === 'form');
    const field = form.subblocks[0];
    // eslint-disable-next-line no-console
    console.log('EXPANDED FIELD:', JSON.stringify(field));
    // field_id (the idField) is preserved + instance-scoped; NO bogus @id is minted.
    expect(field.field_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(field.field_id).not.toBe('fld-a');
    expect(field['@id']).toBeUndefined();
  });
});
