/**
 * The type schema cache is filled at INIT from the merged blocksConfig. The
 * admin's Form seeds and reads schemas before INIT arrives, so a block type it
 * looked at then is already cached — with the ADMIN's schema. INIT's fill must
 * replace it with the merged (frontend) schema, or a block the frontend owns
 * keeps the admin's regions for the rest of the session: its own regions are
 * not walked (their placeholders are saved) and the admin's are.
 */
import { describe, test, expect, vi } from 'vitest';

vi.mock('../context', () => ({
  getHydraSchemaContext: () => ({}),
  setHydraSchemaContext: () => () => {},
  getLiveBlockData: () => undefined,
}));

import { populateTypeSchemaCache } from './blockSync';
import { getBlockTypeSchema } from '../../../hydra-js/buildBlockPathMap.js';

const region = (title) => ({ title, widget: 'blocks_layout', allowedBlocks: ['slate'] });

describe('populateTypeSchemaCache', () => {
  test("INIT's fill replaces a schema cached from the admin's config before it", () => {
    const adminConfig = {
      finder: { blockSchema: { properties: { results: region('Results') } } },
    };
    const mergedConfig = {
      finder: { blockSchema: { properties: { label: { title: 'Label' }, items: region('Items') } } },
    };
    // Before INIT: the Form reads the admin's schema.
    expect(Object.keys(getBlockTypeSchema('finder', {}, adminConfig).properties)).toEqual(['results']);
    // INIT: the merged config is cached for every type.
    populateTypeSchemaCache(mergedConfig, {});
    expect(Object.keys(getBlockTypeSchema('finder', {}, mergedConfig).properties)).toEqual(['label', 'items']);
  });
});
