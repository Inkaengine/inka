import { describe, test, expect } from 'vitest';
import { applySchemaDefaults } from '@plone/volto/helpers/Blocks/Blocks';
import { slateValueField } from './slateValueField';

/**
 * Volto applies schema defaults with lodash `merge`, which merges ARRAYS index by
 * index. A slate default of [{type:'p', children:[{text:''}]}] merged under a real
 * value therefore leaks into it: the first list item (or a leading inline) gains
 * `text: ''` and becomes an element that is also a text node, which slate then
 * refuses to merge. The sidebar's InlineForm runs this on mount and writes the
 * result back, so it corrupted every slate block whose first child is not text.
 */
const intl = { formatMessage: (m) => m?.defaultMessage || m?.id || '' };
const defaultValue = () => [{ type: 'p', children: [{ text: '' }] }];
const schemaFor = (data) => ({
  fieldsets: [{ id: 'default', title: 'Default', fields: ['value'] }],
  properties: { value: slateValueField({ data, placeholder: 'Type', defaultValue }) },
});
const apply = (data) => applySchemaDefaults({ data, schema: schemaFor(data), intl });

describe('slate value field default', () => {
  test('leaves an existing list value untouched', () => {
    const value = [
      {
        type: 'ul',
        children: [
          { type: 'li', children: [{ text: '' }, { type: 'link', data: { url: 'x' }, children: [{ text: 'a' }] }, { text: '' }] },
        ],
      },
    ];
    const data = { '@type': 'slate', value: structuredClone(value) };
    expect(apply(data).value).toEqual(value);
  });

  test('leaves a value that starts with an inline untouched', () => {
    const value = [{ type: 'p', children: [{ type: 'link', data: { url: 'x' }, children: [{ text: 'a' }] }] }];
    const data = { '@type': 'slate', value: structuredClone(value) };
    expect(apply(data).value).toEqual(value);
  });

  test('gives a block with no value the default paragraph', () => {
    expect(apply({ '@type': 'slate' }).value).toEqual(defaultValue());
  });

  test('gives a block with an empty value the default paragraph', () => {
    expect(apply({ '@type': 'slate', value: [] }).value).toEqual(defaultValue());
  });
});
