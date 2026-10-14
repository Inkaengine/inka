/**
 * The slate block's body field, with its default declared only when the block
 * has no body.
 *
 * The default has to live on the field (not only in the add-block initialValue
 * hook): every other way a slate block comes into being — an empty container's
 * seed, a new page's initialBlocks, a template slot — reads schema defaults, and a
 * slate block with no value gives the frontend no node to address.
 *
 * But it must not be declared for a block that already has a body. Volto applies
 * schema defaults with lodash `merge`, which merges arrays index by index, so the
 * default paragraph leaks into the real value: a leading list item or inline
 * gains `text: ''` and becomes an element that is also a text node. The sidebar's
 * InlineForm runs that merge on mount and writes the result back.
 */
export function slateValueField({ data, placeholder, defaultValue }) {
  const hasBody = Array.isArray(data?.value) && data.value.length > 0;
  return {
    title: 'Body',
    widget: 'slate',
    placeholder,
    ...(hasBody ? {} : { default: defaultValue() }),
  };
}
