/**
 * The offline content check refuses what the editor's save refuses.
 *
 * Content that never passes through the editor — a conversion, an import, a
 * fixture — is checked by the content validator (`plone-content schema|all`,
 * lib/plone-content-validator.cjs). It used to check only `required`, with its
 * own idea of empty, while the save runs every Volto validator: maxLength,
 * pattern, url, email, number limits, item counts. So content passed the check
 * and then refused to save in the editor, naming a field no one had touched.
 *
 * The check now runs Volto's own validation (bundled by
 * scripts/build-volto-validation.mjs) through the same per-block step as the
 * save (hydra-js/blockFieldErrors.js). This test holds them together: the same
 * pages through both, and the same block fields must be refused.
 */
import { createRequire } from 'node:module';
import { describe, test, expect, vi } from 'vitest';

vi.mock('../context', () => ({
  getHydraSchemaContext: () => ({}),
  setHydraSchemaContext: () => () => {},
  HydraSchemaProvider: ({ children }) => children,
}));

import { createFieldRulesEnhancer } from '../../../hydra-js/fieldRules.js';

import { validateBlocksAgainstSchemas } from './validateBlocks';

const require = createRequire(import.meta.url);
const { checkEditorRules } = require('../../../../lib/plone-content-validator.cjs');

const formatMessage = (msg) => msg?.id || msg?.defaultMessage || 'error';

const validatedSchema = {
  fieldsets: [
    {
      id: 'default',
      title: 'Default',
      fields: [
        'req', 'tooShort', 'tooLong', 'unmatched', 'mail', 'link',
        'notANumber', 'belowMin', 'aboveMax', 'notAnInteger',
        'tooFewItems', 'tooManyItems', 'repeatedItems', 'picked', 'flag',
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
    picked: { title: 'Link', widget: 'object_browser', mode: 'link' },
    flag: { title: 'Flag', type: 'boolean' },
  },
  required: ['req', 'picked', 'flag'],
};

const blocksConfig = {
  validated: { id: 'validated', title: 'Validated', blockSchema: validatedSchema },
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
  _page: {
    blockSchema: {
      properties: {
        items: { widget: 'blocks_layout', allowedBlocks: ['validated', 'columns', 'set'] },
      },
    },
  },
};

const fine = () => ({
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
  picked: [{ '@id': '/a-page' }],
  flag: false,
});

const bad = () => ({
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
  picked: [],
});

/** Each page the two must agree on, by what it exercises. */
const PAGES = {
  'every validator failing': {
    blocks: { bad: bad() },
    blocks_layout: { items: ['bad'] },
  },
  'every value fine': {
    blocks: { good: fine() },
    blocks_layout: { items: ['good'] },
  },
  'a bad value nested in a container': {
    blocks: {
      col: { '@type': 'columns', blocks: { nested: bad() }, blocks_layout: { items: ['nested'] } },
    },
    blocks_layout: { items: ['col'] },
  },
  // Cleared, not set: '' is not a bad url or email (validateBlocks.js).
  'cleared fields': {
    blocks: { cleared: { ...fine(), link: '', mail: '', tooShort: '' } },
    blocks_layout: { items: ['cleared'] },
  },
  // A link picked and then emptied still holds one item.
  'a link holding an empty address': {
    blocks: { emptied: { ...fine(), picked: [{ '@id': '' }] } },
    blocks_layout: { items: ['emptied'] },
  },
  'a rule error on a region': {
    blocks: {
      s: {
        '@type': 'set',
        blocks: { only: fine() },
        blocks_layout: { items: ['only'] },
      },
    },
    blocks_layout: { items: ['s'] },
  },
};

/** The save's verdict: block id → the fields it refuses. */
const saveRefuses = (page) => {
  const { blocksErrors } = validateBlocksAgainstSchemas(page, {
    blocksConfig,
    intl: { formatMessage },
    formatMessage,
  });
  return Object.fromEntries(
    Object.entries(blocksErrors).map(([id, fields]) => [id, Object.keys(fields).sort()]),
  );
};

/** The offline check's verdict, in the same shape. */
const checkRefuses = async (page) => {
  const report = await checkEditorRules(
    [{ rel: 'page', data: { '@id': '/page', '@type': 'Document', ...page } }],
    blocksConfig,
  );
  const refused = {};
  for (const error of report.errors) {
    const found = error.match(/^\s*page: a "[^"]+" block \(([^)]+)\), ([^:]+): /);
    expect(found, `an error naming no block field: ${error}`).toBeTruthy();
    refused[found[1]] = [...(refused[found[1]] || []), found[2]];
  }
  for (const fields of Object.values(refused)) fields.sort();
  return refused;
};

describe('the content check refuses what the save refuses', () => {
  test.each(Object.keys(PAGES))('%s', async (name) => {
    const page = PAGES[name];
    expect(await checkRefuses(page)).toEqual(saveRefuses(page));
  });

  // Not just agreeing on nothing. Two required fields pass in both, because
  // Volto's required check passes them, and the old offline check — its own
  // idea of empty — refused content the save takes:
  //  - `flag`: a true/false field is never "missing" (false is an answer);
  //  - `picked: []`: a list is empty only when the field says `type: 'array'`,
  //    and a link field (object_browser) says no type.
  test('the failing page fails every validator, in both', async () => {
    expect(await checkRefuses(PAGES['every validator failing'])).toEqual({
      bad: [
        'aboveMax', 'belowMin', 'link', 'mail', 'notANumber', 'notAnInteger',
        'repeatedItems', 'req', 'tooFewItems', 'tooLong', 'tooManyItems',
        'tooShort', 'unmatched',
      ].sort(),
    });
  });
});
