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
  // Set around a rule's enhancer; returns the restore. No rule here reads it.
  setHydraSchemaContext: () => () => {},
  HydraSchemaProvider: ({ children }) => children,
}));

import { createFieldRulesEnhancer } from '../../../hydra-js/fieldRules.js';

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

/**
 * A fieldRules `error` on a REGION refuses the save.
 *
 * Volto runs a field's validators only when `formData[field]` holds a value,
 * and a blocks_layout region's children are not there — they are in
 * `blocks_layout[region]`. So a rule counting a region's children ("a set of
 * at least two") put its message on the field and nothing ever read it: the
 * content validator reported it, the editor saved anyway.
 */
describe('block validation — a rule error on a region', () => {
  const setConfig = {
    ...blocksConfig,
    set: {
      id: 'set',
      title: 'Set',
      blockSchema: {
        fieldsets: [{ id: 'default', title: 'Default', fields: ['items'] }],
        properties: {
          items: { title: 'Items', widget: 'blocks_layout', allowedBlocks: ['validated'] },
        },
        required: [],
      },
      schemaEnhancer: createFieldRulesEnhancer({
        items: { when: { items: { lt: 2 } }, error: 'A set holds at least two.' },
      }),
    },
  };
  const good = (id) => ({ '@type': 'validated', req: 'present', id });
  const validateSetOf = (count) => {
    const ids = Array.from({ length: count }, (_, i) => `child-${i}`);
    return validateBlocksAgainstSchemas(
      {
        blocks: {
          set: {
            '@type': 'set',
            blocks: Object.fromEntries(ids.map((id) => [id, good(id)])),
            blocks_layout: { items: ids },
          },
        },
        blocks_layout: { items: ['set'] },
      },
      { blocksConfig: setConfig, intl: { formatMessage }, formatMessage },
    );
  };
  const setOf = (count) => validateSetOf(count).blocksErrors;

  test('a region the rule refuses is an error on that block', () => {
    expect(setOf(1).set?.items).toEqual(['A set holds at least two.']);
  });

  test('a region the rule accepts raises nothing', () => {
    expect(setOf(2)).toEqual({});
  });

  test("an error comes with its field's title, for the refused save to name", () => {
    // A region is not drawn as a widget, so the toast is where an author
    // learns which field refused the save.
    expect(validateSetOf(1).fieldTitles).toEqual({ set: { items: 'Items' } });
  });
});

/**
 * A page that merely USES a template must stay saveable.
 *
 * A forced template's blocks are merged into every consuming page and saved
 * with it, so this walk sees them like any other block. But a template-owned
 * block is `readOnly` — the author is shown static values, not widgets, and
 * cannot change a single field on it. Validating it anyway means one bad value
 * in one template makes every page using that template unsaveable, with an
 * error naming a field the author cannot reach. That is what happened to all
 * 43 pretagov case studies: /templates/case-study-layout carried
 * `searchUrl: "/case-studies"` on a field declared `widget: 'url'`, Volto's URL
 * validator rejects site-relative paths, and the editor refused every save.
 *
 * `fixed` alone does not mean template-owned: a fixed-but-editable block is the
 * page's own, the merge keeps all its fields, and its values are the author's
 * to fix — so it must still be validated.
 */
describe('block validation — blocks the author cannot edit', () => {
  const readOnlyBad = () => ({ ...badBlock(), fixed: true, readOnly: true });

  test('a template-owned (readOnly) block does not refuse the save', () => {
    const { blocksErrors } = validate({
      blocks: { locked: readOnlyBad() },
      blocks_layout: { items: ['locked'] },
    });
    expect(blocksErrors.locked).toBeUndefined();
  });

  test('…not even nested inside a container', () => {
    const { blocksErrors } = validate({
      blocks: {
        col: {
          '@type': 'columns',
          blocks: { nested: readOnlyBad() },
          blocks_layout: { items: ['nested'] },
        },
      },
      blocks_layout: { items: ['col'] },
    });
    expect(blocksErrors.nested).toBeUndefined();
  });

  test('a fixed but EDITABLE block is still validated — its fields are the page’s', () => {
    const { blocksErrors } = validate({
      blocks: { mine: { ...badBlock(), fixed: true, readOnly: false } },
      blocks_layout: { items: ['mine'] },
    });
    expect(blocksErrors.mine?.req).toBeTruthy();
  });
});


/**
 * An image block with no image set must not refuse the save.
 *
 * Reported from production: an author could not save a case study. The sidebar
 * read "Input must be valid url (www.something.com or http(s)://www.something.com)"
 * against an image she had not set, and clearing the image did not help —
 * clearing it is what produces the empty string that triggers it.
 *
 * The cause is upstream: Volto's checkFieldErrors skips a field only when it is
 * `undefined` or `null`, so an empty STRING is handed to urlValidator, which
 * regex-tests it and reports a malformed url.
 */
describe('an image block with no image set', () => {
  const imageBlocksConfig = {
    image: {
      id: 'image',
      title: 'Image',
      blockSchema: {
        fieldsets: [{ id: 'default', title: 'Image', fields: ['url', 'alt'] }],
        properties: {
          url: { title: 'Image', widget: 'url' },
          alt: { title: 'Alt text', type: 'string' },
        },
        required: [],
      },
    },
  };
  const pageWith = (url) => ({
    '@id': '/a-case-study',
    blocks: {
      'img-1': { '@type': 'image', ...(url === undefined ? {} : { url }) },
    },
    blocks_layout: { items: ['img-1'] },
  });
  const run = (page) =>
    validateBlocksAgainstSchemas(page, {
      blocksConfig: imageBlocksConfig,
      intl: { formatMessage },
      formatMessage,
    });

  test('an unset image does not refuse the save', () => {
    expect(run(pageWith(undefined)).blocksErrors).toEqual({});
  });

  test('an image CLEARED to an empty string does not refuse the save either', () => {
    expect(run(pageWith('')).blocksErrors).toEqual({});
  });

  test('a genuinely malformed url is still reported', () => {
    expect(Object.keys(run(pageWith('not a url')).blocksErrors)).toEqual(['img-1']);
  });

  test('the path map comes back, so a refused save can name the block', () => {
    expect(run(pageWith('not a url')).blockPathMap).toHaveProperty('img-1');
  });
});

/**
 * Omitting empty strings must not become a way to skip `required`.
 *
 * The exemption above is about FORMAT validators. Required-ness is checked
 * separately, against the schema's `required` list, and treats a missing field
 * exactly as it treats '' — these pin that, because "ignore empty strings" is
 * precisely the shape of fix that quietly disables required.
 */
describe('a required block field left empty', () => {
  const cfg = {
    needy: {
      id: 'needy',
      title: 'Needy',
      blockSchema: {
        fieldsets: [{ id: 'default', title: 'Default', fields: ['mustHave'] }],
        properties: { mustHave: { title: 'Must have', type: 'string' } },
        required: ['mustHave'],
      },
    },
  };
  const page = (v) => ({
    '@id': '/p',
    blocks: {
      'n-1': { '@type': 'needy', ...(v === undefined ? {} : { mustHave: v }) },
    },
    blocks_layout: { items: ['n-1'] },
  });
  const run = (v) =>
    validateBlocksAgainstSchemas(page(v), {
      blocksConfig: cfg,
      intl: { formatMessage },
      formatMessage,
    });

  test('still reports when set to an empty string', () => {
    expect(Object.keys(run('').blocksErrors)).toEqual(['n-1']);
  });

  test('still reports when absent altogether', () => {
    expect(Object.keys(run(undefined).blocksErrors)).toEqual(['n-1']);
  });

  test('passes when filled', () => {
    expect(run('something').blocksErrors).toEqual({});
  });
});
