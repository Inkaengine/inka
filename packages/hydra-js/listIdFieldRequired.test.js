/**
 * A list's id field is the caller's to name — the merge never guesses one.
 *
 * The merge has no schema: only the block's code knows that a form's fields
 * are keyed by `field_id`, a table's rows by `key`, a slider's slides by `@id`.
 * It used to take `@id` when nobody said, and a template's own page then failed
 * quietly: the check that a list IS the template's own blocks looked a form's
 * fields up by `@id`, found none, and applied the template to the form's own
 * fields — which came back as the template's top-level blocks.
 */
import { expandTemplatesSync } from '@volto-hydra/helpers';

const TPL = '/templates/with-form';

// A definition: its blocks carry slots, and the form's fields are template
// members keyed by `field_id`.
const definition = {
  '@id': TPL,
  blocks: {
    intro: { '@type': 'slate', templateId: TPL, fixed: true, readOnly: true, slotId: 'intro', value: [] },
    'the-form': {
      '@type': 'form', templateId: TPL, fixed: true, readOnly: true, slotId: 'the-form',
      subblocks: [
        { templateId: TPL, fixed: true, readOnly: true, slotId: 'q1', field_id: 't-q1', field_type: 'text', label: 'Question' },
        { templateId: TPL, slotId: 'extra', field_id: 't-extra', field_type: 'text', label: 'Slot' },
      ],
    },
  },
  blocks_layout: { items: ['intro', 'the-form'] },
};

describe('a list call names its idField', () => {
  test.each([false, true])('a list called with no idField throws, even when its items have an @id (editMode=%s)', (editMode) => {
    const slides = [{ '@type': 'slide', '@id': 's1' }];
    expect(() => expandTemplatesSync(slides, { templateState: {}, templates: {}, editMode })).toThrow(/idField/);
  });

  test('a list keyed by @id says so', () => {
    const slides = [{ '@type': 'slide', '@id': 's1' }];
    const out = expandTemplatesSync(slides, { templateState: {}, templates: {}, idField: '@id', editMode: false });
    expect(out.map((s) => s['@uid'])).toEqual(['s1']);
  });
});

describe("a template's own page keeps its lists as they are", () => {
  test("the definition's form fields come back as its own fields", () => {
    const templateState = {};
    const opts = { templateState, templates: { [TPL]: definition }, editMode: false };
    const top = expandTemplatesSync(definition.blocks_layout.items, { ...opts, blocks: definition.blocks });
    expect(top.map((b) => b['@uid'])).toEqual(['intro', 'the-form']);

    const form = top.find((b) => b['@type'] === 'form');
    const fields = expandTemplatesSync(form.subblocks, { ...opts, idField: 'field_id' });
    expect(fields.map((f) => [f.field_id, f.label])).toEqual([
      ['t-q1', 'Question'],
      ['t-extra', 'Slot'],
    ]);
  });
});
