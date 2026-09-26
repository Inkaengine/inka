import { describe, it, expect } from 'vitest';
import { withFieldsReadOnly } from './index.js';

/**
 * A field the form shows but nobody may type into.
 *
 * `readOnly` is what a BLOCK already says when it may be read and not changed,
 * and the sidebar answers by rendering its values as text. A
 * language-independent field is the same thing one level down: the translation
 * inherits the canonical's value, so it must be VISIBLE (the translator should
 * see what the tags are) and not editable (there is one place that value
 * lives). This is the schema side of it.
 */
const schema = {
  fieldsets: [
    { id: 'default', title: 'Default', fields: ['title', 'description'] },
    { id: 'categorization', title: 'Categorization', fields: ['subjects'] },
  ],
  properties: {
    title: { title: 'Title', type: 'string' },
    description: { title: 'Description', type: 'string' },
    subjects: {
      title: 'Tags',
      type: 'array',
      multilingual_options: { language_independent: true },
    },
  },
  required: ['title'],
};

describe('withFieldsReadOnly', () => {
  it('puts the named fields in read-only mode and leaves the rest alone', () => {
    const marked = withFieldsReadOnly(schema, ['subjects']);

    expect(marked.properties.subjects.readOnly).toBe(true);
    expect(marked.properties.title.readOnly).toBeUndefined();
    expect(marked.properties.description.readOnly).toBeUndefined();
  });

  it('keeps everything else about the field — a read-only Tags is still Tags', () => {
    const marked = withFieldsReadOnly(schema, ['subjects']);

    expect(marked.properties.subjects.title).toBe('Tags');
    expect(marked.properties.subjects.type).toBe('array');
    expect(marked.properties.subjects.multilingual_options).toEqual({
      language_independent: true,
    });
    expect(marked.fieldsets).toEqual(schema.fieldsets);
    expect(marked.required).toEqual(schema.required);
  });

  it('does not touch the schema it was given', () => {
    withFieldsReadOnly(schema, ['subjects']);

    expect(schema.properties.subjects.readOnly).toBeUndefined();
  });

  it('ignores a field the schema does not have, rather than inventing one', () => {
    const marked = withFieldsReadOnly(schema, ['subjects', 'nonesuch']);

    expect(marked.properties.nonesuch).toBeUndefined();
    expect(marked.properties.subjects.readOnly).toBe(true);
  });

  it('is a no-op when nothing is inherited', () => {
    expect(withFieldsReadOnly(schema, [])).toEqual(schema);
  });
});
