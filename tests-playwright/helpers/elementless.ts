import { isEmptySlate } from '../../packages/helpers/index.js';

interface FieldSchema {
  type?: string;
  widget?: string;
  choices?: unknown;
  vocabulary?: unknown;
}

/** A field an author writes words in, as opposed to one they set. */
const holdsWords = (field: FieldSchema) =>
  field.widget === 'slate' ||
  field.widget === 'richtext' ||
  field.widget === 'textarea' ||
  (field.type === 'string' && !field.widget && !field.choices && !field.vocabulary);

const isEmpty = (value: unknown) =>
  value == null ||
  (typeof value === 'string' && value.trim() === '') ||
  (Array.isArray(value) && isEmptySlate(value));

/**
 * The words a container would have to draw with no element of its own to draw
 * them in — the fields it holds text in, non-empty. A container may draw no
 * element (the editor finds it through its children) only when this is empty:
 * settings and children need no element, words do. Words drawn outside any
 * element carrying the container's uid land inside whichever block does have
 * one around them, and would be edited as that block's.
 */
export function wordsWithNowhereToGo(
  schema: { properties?: Record<string, FieldSchema> } | null | undefined,
  data: Record<string, unknown>,
): string[] {
  return Object.entries(schema?.properties ?? {})
    .filter(([name, field]) => holdsWords(field) && !isEmpty(data[name]))
    .map(([name]) => name);
}
