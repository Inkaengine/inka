import { describe, test, expect } from 'vitest';
import {
  applySchemaDefaultsToBlock,
  applySchemaDefaultsToBlockWithContext,
  isValidValue,
} from './schemaValidation.mjs';

/**
 * A field that takes SEVERAL of its choices holds an array, and every element is
 * what has to be in the vocabulary — the array itself never is.
 *
 * Volto has rendered these for years: `type: 'array'` with `choices` is what
 * ArrayWidget reads, and what it hands back is a list of tokens. Checking the
 * list as though it were a single token failed every one of them, and the
 * failure is not cosmetic — `applySchemaDefaultsToBlock` NULLS what it judges
 * invalid, the strip its own comment warns about. So loading a page in the
 * editor quietly emptied any multi-select an author had set.
 *
 * The case that found it: a form block storing `send: ['recipient']`, the
 * setting that decides whether a submission is emailed to anyone. Opening the
 * page in the editor cleared it, and the form stopped mailing — with no edit,
 * no save, and nothing said.
 */
describe('isValidValue — a field that takes several choices', () => {
  const multi = {
    type: 'array',
    choices: [
      ['recipient', 'The recipients below'],
      ['acknowledgement', 'The person who filled the form'],
    ],
  };

  test('accepts a list of allowed values', () => {
    expect(isValidValue(['recipient'], multi)).toBe(true);
    expect(isValidValue(['recipient', 'acknowledgement'], multi)).toBe(true);
  });

  test('accepts the empty list — chosen nothing is a valid answer', () => {
    expect(isValidValue([], multi)).toBe(true);
  });

  test('rejects a list containing a value that is not on offer', () => {
    expect(isValidValue(['recipient', 'nobody'], multi)).toBe(false);
  });

  test('still checks a single value against the choices', () => {
    expect(isValidValue('recipient', multi)).toBe(true);
    expect(isValidValue('nobody', multi)).toBe(false);
  });

  test('the value survives a load, rather than being nulled', () => {
    const schema = { properties: { send: multi } };
    const out = applySchemaDefaultsToBlock({ '@type': 'form', send: ['recipient'] }, schema);
    expect(out.send).toEqual(['recipient']);
  });

  test('an unauthorable value is still stripped', () => {
    const schema = { properties: { send: multi } };
    const out = applySchemaDefaultsToBlock({ '@type': 'form', send: ['nobody'] }, schema);
    expect(out.send).toBe(null);
  });

  /**
   * `choices` on an array field is Volto's shape; `items.choices` is JSON
   * Schema's, and plone.restapi serialises List(value_type=Choice) that way. A
   * field declared either way describes the same question.
   */
  test('reads the vocabulary from items.choices too', () => {
    const itemsShape = { type: 'array', items: { choices: ['a', 'b'] } };
    expect(isValidValue(['a'], itemsShape)).toBe(true);
    expect(isValidValue(['c'], itemsShape)).toBe(false);
  });
});

/**
 * Schema defaults must reach fields nested inside a `widget:'object'` (#245) —
 * a default declared on `content.inneralign` is applied just like a top-level
 * field's. The walk descends objects only; it must NOT recurse into a region
 * (object_list/blocks_layout), whose items are handled elsewhere.
 */
describe('applySchemaDefaultsToBlock — object-nested defaults', () => {
  const schema = {
    properties: {
      align: { default: 'left' },
      content: {
        widget: 'object',
        schema: {
          properties: {
            inneralign: { default: 'center' },
            deep: { widget: 'object', schema: { properties: { size: { default: 'md' } } } },
            // a region nested in the object — must be left untouched
            rows: { widget: 'object_list', schema: { properties: { x: { default: 'NO' } } } },
          },
        },
      },
    },
  };

  test('applies a default to a field inside an object', () => {
    const out = applySchemaDefaultsToBlock({ content: {} }, schema);
    expect(out.content.inneralign).toBe('center');
    expect(out.align).toBe('left'); // top-level still works
  });

  test('applies defaults at arbitrary object depth (content.deep.size)', () => {
    const out = applySchemaDefaultsToBlock({ content: { deep: {} } }, schema);
    expect(out.content.deep.size).toBe('md');
  });

  test('does NOT recurse into a region nested in the object', () => {
    const out = applySchemaDefaultsToBlock(
      { content: { rows: [{ '@id': 'r1' }] } },
      schema,
    );
    // The region's items are containers — defaults must not be stamped into them.
    expect(out.content.rows).toEqual([{ '@id': 'r1' }]);
    expect(out.content.rows[0].x).toBeUndefined();
  });

  test('leaves an already-set nested value alone', () => {
    const out = applySchemaDefaultsToBlock({ content: { inneralign: 'right' } }, schema);
    expect(out.content.inneralign).toBe('right');
  });

  test('unchanged input is returned by identity (no spurious modification)', () => {
    const block = { align: 'left', content: { inneralign: 'center' } };
    expect(applySchemaDefaultsToBlock(block, schema)).toBe(block);
  });

  test('WithContext resolves a function default on a nested field', () => {
    const ctxSchema = {
      properties: {
        content: {
          widget: 'object',
          schema: { properties: { id: { default: (ctx) => ctx.seed } } },
        },
      },
    };
    const out = applySchemaDefaultsToBlockWithContext({ content: {} }, ctxSchema, { seed: 'X1' });
    expect(out.content.id).toBe('X1');
  });
});
