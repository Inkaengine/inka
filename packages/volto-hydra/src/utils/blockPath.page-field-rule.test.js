/**
 * A fieldRule that reads a PAGE field, not a field of the block.
 *
 * A top-level block's parent IS the page, so `../description` in a rule asks
 * about the content being edited rather than about the block — the case for a
 * field that only makes sense when the page has something to work with. It is
 * the one part of the rule grammar with no block-level equivalent, so it is
 * checked here rather than through the editor: the operators themselves are
 * covered in blockSync.test.js, the item-position paths in
 * blockPath.item-fieldrules.test.js, and what reaches the sidebar by the
 * fieldRules tests in tests-playwright/integration/block-sync.spec.ts — which
 * use blocks people ship (a teaser's `overwrite`, an image's alignment) rather
 * than a block invented to carry a rule.
 */
import { describe, test, expect, vi } from 'vitest';

// HydraSchemaContext.js is JSX inside a .js file — esbuild (vitest) can't parse
// it, and this path never touches the live schema context.
vi.mock('../context', () => ({
  getHydraSchemaContext: () => ({}),
  setHydraSchemaContext: () => () => {},
  getLiveBlockData: () => undefined,
}));

import {
  createSchemaEnhancerFromRecipe,
  resolveEffectiveBlockSchema,
} from './blockSync.js';
import { buildBlockPathMap } from '../../../hydra-js/buildBlockPathMap.js';

const intl = { formatMessage: (m) => m?.defaultMessage || m?.id || '' };

// "Only ask for a summary line when the page has a description to summarise."
const recipe = {
  fieldRules: {
    summary: { when: { '../description': { isSet: true } }, else: false },
  },
};

const form = (description) => ({
  '@type': 'Document',
  description,
  blocks: { b1: { '@type': 'pageAware' } },
  blocks_layout: { items: ['b1'] },
});

const cfg = () => ({
  _page: {
    id: '_page',
    schema: () => ({ properties: { items: { widget: 'blocks_layout' } } }),
  },
  pageAware: {
    id: 'pageAware',
    schemaEnhancer: createSchemaEnhancerFromRecipe(recipe),
    blockSchema: {
      fieldsets: [{ id: 'default', title: 'Default', fields: ['title', 'summary'] }],
      properties: {
        title: { title: 'Title', type: 'string' },
        summary: { title: 'Summary', type: 'string' },
      },
    },
  },
});

const fieldsOf = (description) => {
  const data = form(description);
  const config = cfg();
  const map = buildBlockPathMap(data, config, intl);
  const schema = resolveEffectiveBlockSchema('b1', data, map, config, intl);
  return schema?.fieldsets?.[0]?.fields ?? [];
};

describe('fieldRules — a rule that reads a page field', () => {
  test('the field is offered when the page has a description', () => {
    expect(fieldsOf('A page with something to summarise')).toContain('summary');
  });

  test('and withdrawn when it does not', () => {
    expect(fieldsOf('')).not.toContain('summary');
    expect(fieldsOf(undefined)).not.toContain('summary');
  });

  test('a field with no rule is untouched either way', () => {
    expect(fieldsOf('')).toContain('title');
  });
});
