import { describe, test, expect } from 'vitest';
import { expandTemplatesSync } from '@volto-hydra/helpers';

/**
 * A server-rendered frontend (Astro/Nuxt render API) has no window.name, so _isEditMode() can't
 * see the edit iframe and would treat every render as a view render — expanding, and throwing for
 * want of pre-loaded templates. It signals edit mode explicitly via options.editMode instead. With
 * editMode:true the call is a pass-through that maps each object_list item's idField -> @uid and
 * needs no templates; editMode:false keeps the view-render contract (templates required).
 */
describe('expandTemplatesSync editMode override (SSR edit render)', () => {
  const items = [
    { field_id: 'f1', field_type: 'text' },
    { field_id: 'f2', field_type: 'from' },
  ];

  test('editMode:true -> pass-through, maps idField to @uid, no templates needed', () => {
    const out = expandTemplatesSync(items, { idField: 'field_id', editMode: true });
    expect(out.map((i) => i['@uid'])).toEqual(['f1', 'f2']);
  });

  test('editMode:false without templates -> throws (view render needs pre-loaded templates)', () => {
    expect(() => expandTemplatesSync(items, { idField: 'field_id', editMode: false })).toThrow(/templates/i);
  });
});
