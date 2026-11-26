import { describe, test, expect } from 'vitest';
import { getBlockAddability } from '@volto-hydra/helpers';

/**
 * A field seeded inside a template-edit context (an '@type: empty' placeholder) must be
 * replaceable so the '+' appears (getAddDirection shows it when canReplace is true) and its
 * type can be picked. The seeded empty may not carry the edited template's instanceId yet,
 * so isBlockInEditedTemplate is false and the template-mode gate returned early with
 * canReplace=false — stranding the field (e.g. the E-mail form field). In template edit mode
 * an empty is ALWAYS replaceable: you're building the template.
 */
describe('template-edit-mode empty is replaceable so the + appears', () => {
  const map = { e1: { blockType: 'empty' } };

  test('a template-edit-mode empty with no instanceId is still canReplace', () => {
    const empty = { '@type': 'empty' }; // seeded, no templateInstanceId
    expect(getBlockAddability('e1', map, empty, 'inst-1').canReplace).toBe(true);
  });

  test('outside template edit mode, an empty is replaceable unless readOnly', () => {
    expect(getBlockAddability('e1', map, { '@type': 'empty' }, null).canReplace).toBe(true);
    expect(getBlockAddability('e1', map, { '@type': 'empty', readOnly: true }, null).canReplace).toBe(false);
  });

  test('a typed object_list empty (type in typeField, no @type) is also replaceable', () => {
    // object_list items store their type in a typeField (e.g. field_type) and DELETE @type
    // (initializeContainerBlock). Detecting 'empty' via @type alone misses the form's field —
    // it must read the typeField too (e.g. the E-mail field could never get its '+').
    const objMap = { e1: { blockType: 'empty', typeField: 'field_type' } };
    expect(getBlockAddability('e1', objMap, { field_type: 'empty' }, 'inst-1').canReplace).toBe(true);
    // Normal mode: same, and readOnly still blocks it.
    expect(getBlockAddability('e1', objMap, { field_type: 'empty' }, null).canReplace).toBe(true);
    expect(getBlockAddability('e1', objMap, { field_type: 'empty', readOnly: true }, null).canReplace).toBe(false);
  });
});
