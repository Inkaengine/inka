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

/**
 * A slate field defaults to one empty paragraph, as if its schema said so.
 *
 * Slate edits NODES, and the caret lives in one: the renderer marks each node
 * with its `data-node-id`, and that is how a keystroke on the canvas is mapped
 * back into the value. A slate field with no value has no node, so a renderer
 * that draws the empty field for the author to type into draws a bare element
 * with no id — the first keystroke lands in nothing Slate knows about and the
 * bridge raises "missing data-node-id". The case that found it: adding a global
 * alert into its template slot and typing its message.
 *
 * An empty paragraph is to a slate field what `''` is to a string — the empty
 * value of its type — so it is the default whenever the schema names none.
 */
describe('applySchemaDefaultsToBlock — a slate field defaults to an empty paragraph', () => {
  const EMPTY_PARAGRAPH = [{ type: 'p', children: [{ text: '' }] }];
  const schema = {
    properties: {
      title: { type: 'string' },
      content: { type: 'array', widget: 'slate' },
      summary: { widget: 'slate' },
      lead: {
        widget: 'slate',
        default: [{ type: 'h2', children: [{ text: 'Lead' }] }],
      },
      tags: { type: 'array' },
    },
  };

  test.each([
    ['applySchemaDefaultsToBlock', (b, s) => applySchemaDefaultsToBlock(b, s)],
    [
      'applySchemaDefaultsToBlockWithContext',
      (b, s) => applySchemaDefaultsToBlockWithContext(b, s, {}),
    ],
  ])('%s gives an absent slate field one empty paragraph', (_, apply) => {
    const out = apply({ '@type': 'alert' }, schema);
    expect(out.content).toEqual(EMPTY_PARAGRAPH);
    expect(out.summary).toEqual(EMPTY_PARAGRAPH);
  });

  test('a slate value emptied to [] is given the empty paragraph back', () => {
    const out = applySchemaDefaultsToBlock({ content: [] }, schema);
    expect(out.content).toEqual(EMPTY_PARAGRAPH);
  });

  test('a declared default still wins', () => {
    const out = applySchemaDefaultsToBlock({}, schema);
    expect(out.lead).toEqual([{ type: 'h2', children: [{ text: 'Lead' }] }]);
  });

  test('written content is left alone, and the block returned by identity', () => {
    const block = {
      content: [{ type: 'p', children: [{ text: 'Roads closed' }] }],
      summary: EMPTY_PARAGRAPH,
      lead: [{ type: 'p', children: [{ text: 'x' }] }],
    };
    expect(applySchemaDefaultsToBlock(block, schema)).toBe(block);
  });

  test('only slate gets it — other fields with no default stay absent', () => {
    const out = applySchemaDefaultsToBlock({}, schema);
    expect(out).not.toHaveProperty('title');
    expect(out).not.toHaveProperty('tags');
  });

  test('every block gets its own paragraph, not one shared between them', () => {
    const a = applySchemaDefaultsToBlock({}, schema);
    const b = applySchemaDefaultsToBlock({}, schema);
    expect(a.content).not.toBe(b.content);
    expect(a.content[0]).not.toBe(b.content[0]);
  });
});
