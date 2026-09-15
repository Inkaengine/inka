/**
 * Every standard Volto validator, reached through hydra's block validation.
 *
 * The point is not to test Volto's validators — they are Volto's. It is that
 * hydra's own walk hands each block the shape they expect, so a block field is
 * checked here exactly as a content field is in core. That was NOT true until
 * now: hydra's Form replaced core's per-block loop with nothing, so `required`,
 * `maxLength`, `pattern` and the rest went unenforced on save, silently.
 *
 * It also pins the part core cannot do: hydra's blocks NEST, so a bad value
 * inside a column inside a grid is found. Core walks `blocks_layout.items` —
 * the top level — and never opens a container.
 */
import { describe, test, expect, vi } from 'vitest';

vi.mock('../context', () => ({
  getHydraSchemaContext: () => ({}),
  HydraSchemaProvider: ({ children }) => children,
}));

import { validateBlocksAgainstSchemas } from './validateBlocks';

const formatMessage = (msg, values) =>
  `${msg?.id || msg?.defaultMessage || 'error'}${values ? '' : ''}`;

// One block type declaring a field per standard validator.
const blocksConfig = {
  validated: {
    id: 'validated',
    title: 'Validated',
    blockSchema: {
      fieldsets: [
        {
          id: 'default',
          title: 'Default',
          fields: [
            'req', 'tooShort', 'tooLong', 'unmatched', 'mail', 'link',
            'notANumber', 'belowMin', 'aboveMax', 'notAnInteger',
            'tooFewItems', 'tooManyItems', 'repeatedItems',
          ],
        },
      ],
      properties: {
        req: { title: 'Required', type: 'string' },
        tooShort: { title: 'Min length', type: 'string', minLength: 5 },
        tooLong: { title: 'Max length', type: 'string', maxLength: 3 },
        unmatched: { title: 'Pattern', type: 'string', pattern: '^[a-z]+$' },
        mail: { title: 'Email', type: 'string', widget: 'email' },
        link: { title: 'URL', type: 'string', widget: 'url' },
        notANumber: { title: 'Number', type: 'number' },
        belowMin: { title: 'Minimum', type: 'number', minimum: 5 },
        aboveMax: { title: 'Maximum', type: 'number', maximum: 10 },
        notAnInteger: { title: 'Integer', type: 'integer' },
        tooFewItems: { title: 'Min items', type: 'array', minItems: 2 },
        tooManyItems: { title: 'Max items', type: 'array', maxItems: 2 },
        repeatedItems: { title: 'Unique items', type: 'array', uniqueItems: true },
      },
      required: ['req'],
    },
  },
  // A container, so the nested case is a real one rather than a hand-made path.
  columns: {
    id: 'columns',
    title: 'Columns',
    blockSchema: {
      fieldsets: [{ id: 'default', title: 'Default', fields: ['items'] }],
      properties: {
        items: { title: 'Items', widget: 'blocks_layout', allowedBlocks: ['validated'] },
      },
      required: [],
    },
  },
};

/** A block violating every constraint it declares. */
const badBlock = () => ({
  '@type': 'validated',
  req: '',
  tooShort: 'abc',
  tooLong: 'abcdef',
  unmatched: 'NOT-LOWER',
  mail: 'not-an-email',
  link: 'not a url at all',
  notANumber: 'seven',
  belowMin: 1,
  aboveMax: 99,
  notAnInteger: 1.5,
  tooFewItems: ['one'],
  tooManyItems: ['a', 'b', 'c'],
  repeatedItems: ['same', 'same'],
});

const validate = (formData) =>
  validateBlocksAgainstSchemas(formData, {
    blocksConfig,
    intl: { formatMessage },
    formatMessage,
  });

describe('block validation — the standard Volto validators', () => {
  const { blocksErrors } = validate({
    blocks: { bad: badBlock() },
    blocks_layout: { items: ['bad'] },
  });

  test.each([
    ['required', 'req'],
    ['minLength', 'tooShort'],
    ['maxLength', 'tooLong'],
    ['pattern', 'unmatched'],
    ['email', 'mail'],
    ['url', 'link'],
    ['number', 'notANumber'],
    ['minimum', 'belowMin'],
    ['maximum', 'aboveMax'],
    ['integer', 'notAnInteger'],
    ['minItems', 'tooFewItems'],
    ['maxItems', 'tooManyItems'],
    ['uniqueItems', 'repeatedItems'],
  ])('%s is enforced on a block field (%s)', (_validator, field) => {
    expect(blocksErrors.bad?.[field]).toBeTruthy();
  });

  test('a block whose values are all fine raises nothing', () => {
    const { blocksErrors: none } = validate({
      blocks: {
        good: {
          '@type': 'validated',
          req: 'present',
          tooShort: 'long enough',
          tooLong: 'abc',
          unmatched: 'lower',
          mail: 'someone@example.com',
          link: 'https://example.com/page',
          notANumber: 7,
          belowMin: 6,
          aboveMax: 9,
          notAnInteger: 3,
          tooFewItems: ['one', 'two'],
          tooManyItems: ['a', 'b'],
          repeatedItems: ['one', 'two'],
        },
      },
      blocks_layout: { items: ['good'] },
    });
    expect(none).toEqual({});
  });
});

describe('block validation — nested blocks, which core never reached', () => {
  test('a bad value inside a container is found', () => {
    const { blocksErrors } = validate({
      blocks: {
        col: {
          '@type': 'columns',
          blocks: { nested: badBlock() },
          blocks_layout: { items: ['nested'] },
        },
      },
      blocks_layout: { items: ['col'] },
    });
    expect(blocksErrors.nested?.req).toBeTruthy();
  });
});
