/**
 * Normalize-on-load (#295): a slate node the region disallows is downgraded by
 * the SAME pass that applies field defaults, so every INITIAL_DATA / FORM_DATA
 * path gets it from one place rather than each call site remembering to ask.
 */
import { describe, test, expect, vi } from 'vitest';

vi.mock('../context', () => ({
  getHydraSchemaContext: () => ({}),
  setHydraSchemaContext: () => () => {},
  getLiveBlockData: () => undefined,
}));

import {
  applySchemaDefaultsToFormData,
  reportDisallowedSlateNodes,
} from './blockSync.js';
import { setInjectedVoltoConfig } from './injectedVoltoConfig.js';
import { buildBlockPathMap } from '../../../hydra-js/buildBlockPathMap.js';

// blockSync carries no `@plone/volto/registry` import (it has to load in bare
// Node for block-sanity's offline discovery), so the slate settings reach it the
// same way everything else does — through the injected accessors the addon
// registers at applyConfig. Mocking the registry here would test nothing.
setInjectedVoltoConfig({
  getSlateStyleAliases: () => ({ b: 'strong' }),
  getSlateDefaultBlockType: () => 'p',
});

const intl = { formatMessage: (m) => m?.defaultMessage || m?.id || '' };

const cfg = (pageField) => ({
  _page: { id: '_page', schema: () => ({ properties: { items: pageField } }) },
  slate: {
    id: 'slate',
    schema: () => ({
      properties: { value: { title: 'Text', widget: 'slate' } },
    }),
  },
});

const form = (value) => ({
  '@type': 'Document',
  blocks: { s1: { '@type': 'slate', value } },
  blocks_layout: { items: ['s1'] },
});

const run = (pageField, value) => {
  const blocksConfig = cfg(pageField);
  const data = form(value);
  const map = buildBlockPathMap(data, blocksConfig, intl);
  return applySchemaDefaultsToFormData(data, map, blocksConfig, intl);
};

const REGION = {
  widget: 'blocks_layout',
  disallowedStyles: ['blockquote', 'b'],
};

describe('applySchemaDefaultsToFormData — slate styles', () => {
  test('a disallowed node is downgraded on load', () => {
    const out = run(REGION, [
      { type: 'blockquote', children: [{ text: 'quoted' }] },
    ]);
    expect(out.blocks.s1.value).toEqual([
      { type: 'p', children: [{ text: 'quoted' }] },
    ]);
  });

  test('the alias map is honoured, so `b` becomes `strong` rather than a paragraph', () => {
    const out = run(REGION, [
      { type: 'p', children: [{ type: 'b', children: [{ text: 'bold' }] }] },
    ]);
    expect(out.blocks.s1.value).toEqual([
      {
        type: 'p',
        children: [{ type: 'strong', children: [{ text: 'bold' }] }],
      },
    ]);
  });

  test('an allowed value is left strictly alone — same form object back', () => {
    const blocksConfig = cfg(REGION);
    const data = form([{ type: 'p', children: [{ text: 'fine' }] }]);
    const map = buildBlockPathMap(data, blocksConfig, intl);
    expect(applySchemaDefaultsToFormData(data, map, blocksConfig, intl)).toBe(
      data,
    );
  });

  test('a frontend that declares no rules is untouched', () => {
    const out = run({ widget: 'blocks_layout' }, [
      { type: 'blockquote', children: [{ text: 'quoted' }] },
    ]);
    expect(out.blocks.s1.value).toEqual([
      { type: 'blockquote', children: [{ text: 'quoted' }] },
    ]);
  });
});

describe('reportDisallowedSlateNodes', () => {
  test('names the block, field and target for each node it would rewrite', () => {
    const blocksConfig = cfg(REGION);
    const data = form([{ type: 'blockquote', children: [{ text: 'quoted' }] }]);
    const map = buildBlockPathMap(data, blocksConfig, intl);
    expect(reportDisallowedSlateNodes(data, map, blocksConfig, intl)).toEqual([
      {
        blockId: 's1',
        field: 'value',
        path: [0],
        from: 'blockquote',
        to: 'p',
        kind: 'style',
      },
    ]);
  });

  test('is empty for content that already conforms', () => {
    const blocksConfig = cfg(REGION);
    const data = form([{ type: 'p', children: [{ text: 'fine' }] }]);
    const map = buildBlockPathMap(data, blocksConfig, intl);
    expect(reportDisallowedSlateNodes(data, map, blocksConfig, intl)).toEqual(
      [],
    );
  });
});

describe('the load pass keeps slate values well-formed', () => {
  // docs/visual-editing.md: exactly one top-level node per slate field, and a
  // renderer may assume it. A load-time downgrade must not be the thing that
  // breaks that — a two-node value renders as its first node and the rest is
  // gone with no error anywhere.
  test('downgrading a list does not leave a multi-node value', () => {
    const out = run(
      { widget: 'blocks_layout', allowedStyles: ['p', 'strong'] },
      [
        {
          type: 'ul',
          children: [
            { type: 'li', children: [{ text: 'one' }] },
            { type: 'li', children: [{ text: 'two' }] },
          ],
        },
      ],
    );
    expect(out.blocks.s1.value).toHaveLength(1);
    expect(out.blocks.s1.value[0].type).toBe('p');
    // Both words survive the collapse.
    const text = JSON.stringify(out.blocks.s1.value);
    expect(text).toContain('one');
    expect(text).toContain('two');
  });
});
