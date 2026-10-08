/**
 * What a frontend's entry for a block does to the admin's own entry for it.
 * The admin (INIT) and the mock parent both use mergeFrontendBlock, so a
 * harness never sees a different block than the editor does.
 */
import { mergeFrontendBlock } from './mergeFrontendBlock.js';

const adminSchema = () => ({ properties: { value: { widget: 'slate' } } });

describe('mergeFrontendBlock', () => {
  test('a block the admin does not have is the frontend entry', () => {
    const entry = { id: 'callout', title: 'Callout', group: 'text', blockSchema: { properties: {} } };
    expect(mergeFrontendBlock('callout', undefined, entry)).toEqual({ entry, previousEnhancer: undefined });
  });

  test('a block the admin does not have needs a title and a group — never made up', () => {
    expect(() => mergeFrontendBlock('card', undefined, { id: 'card', group: 'common' })).toThrow(
      'Block "card" from the frontend needs a `title` and a `group`',
    );
    expect(() => mergeFrontendBlock('card', undefined, { id: 'card', title: 'Card' })).toThrow(/needs a `title` and a `group`/);
  });

  test('an allowedBlocks list with a gap or a non-name in it is refused, wherever it is', () => {
    // eslint-disable-next-line no-sparse-arrays
    const gap = ['slate', , 'image'];
    const nested = {
      id: 'tabs', title: 'Tabs', group: 'common',
      blockSchema: { properties: { tabs: { widget: 'object_list', schema: { properties: { items: { widget: 'blocks_layout', allowedBlocks: gap } } } } } },
    };
    expect(() => mergeFrontendBlock('tabs', undefined, nested)).toThrow(
      'Block "tabs": allowedBlocks at blockSchema.properties.tabs.schema.properties.items has [1] = undefined',
    );
    expect(() => mergeFrontendBlock('slate', { id: 'slate', title: 'Text', group: 'text' }, { allowedBlocks: ['slate', null] }))
      .toThrow('Block "slate": allowedBlocks at the block has [1] = null');
  });

  test('a block the admin has needs neither: its own stand', () => {
    const { entry } = mergeFrontendBlock('slate', { id: 'slate', title: 'Text', group: 'text' }, { schemaEnhancer: { fieldRules: {} } });
    expect(entry.title).toBe('Text');
    expect(entry.group).toBe('text');
  });

  test('keys the frontend does not send keep the admin\'s value', () => {
    const { entry } = mergeFrontendBlock(
      'slate', { id: 'slate', schema: adminSchema, group: 'text' },
      { schemaEnhancer: { fieldRules: { value: { when: {}, warning: 'w' } } } },
    );
    expect(entry.schema).toBe(adminSchema);
    expect(entry.group).toBe('text');
  });

  test('a schema the frontend sends replaces the admin\'s — no field merge', () => {
    const { entry } = mergeFrontendBlock(
      'image', { id: 'image', blockSchema: () => ({ properties: { url: {}, size: {} } }) },
      { blockSchema: { properties: { url: {}, caption: {} } } },
    );
    expect(entry.blockSchema).toEqual({ properties: { url: {}, caption: {} } });
  });

  test('every other key the frontend sends replaces that key', () => {
    const { entry } = mergeFrontendBlock(
      'image', { id: 'image', fieldMappings: { teaser: { href: 'href' } }, title: 'Image' },
      { fieldMappings: { '@default': { '@id': 'href' } } },
    );
    expect(entry.fieldMappings).toEqual({ '@default': { '@id': 'href' } });
    expect(entry.title).toBe('Image');
  });

  test('an enhancer chains: two recipes become a list, the admin\'s first', () => {
    const admin = { fieldRules: { a: { when: { x: true }, else: false } } };
    const frontend = { fieldRules: { b: { when: { y: true }, else: false } } };
    const { entry, previousEnhancer } = mergeFrontendBlock(
      't', { id: 't', schemaEnhancer: admin },
      { schemaEnhancer: frontend },
    );
    expect(entry.schemaEnhancer).toEqual([admin, frontend]);
    expect(previousEnhancer).toBeUndefined();
  });

  test('a list of recipes chains flat', () => {
    const a = { fieldRules: {} };
    const b = { fieldRules: {} };
    const c = { fieldRules: {} };
    const { entry } = mergeFrontendBlock('t', { schemaEnhancer: [a, b] }, { schemaEnhancer: c });
    expect(entry.schemaEnhancer).toEqual([a, b, c]);
  });

  test('an admin enhancer FUNCTION is handed back for the admin to chain', () => {
    const fn = ({ schema }) => schema;
    const recipe = { fieldRules: {} };
    const { entry, previousEnhancer } = mergeFrontendBlock(
      'listing', { id: 'listing', schemaEnhancer: fn },
      { schemaEnhancer: recipe },
    );
    expect(entry.schemaEnhancer).toBe(recipe);
    expect(previousEnhancer).toBe(fn);
  });

  test('a schema the frontend sends is the whole schema: the admin\'s enhancer FUNCTION is not applied', () => {
    // The admin's enhancer adds fields to ITS schema (a results region, its own
    // facets); laid over the frontend's schema it offers fields the frontend
    // never said it renders, and seeds regions it does not have.
    const adminAddsFields = ({ schema }) => ({ ...schema, properties: { ...schema.properties, facets: {} } });
    const { entry, previousEnhancer } = mergeFrontendBlock(
      'search', { id: 'search', schemaEnhancer: adminAddsFields },
      { blockSchema: { properties: { label: {} } } },
    );
    expect(entry.schemaEnhancer).toBeUndefined();
    expect(previousEnhancer).toBeUndefined();
  });

  test('a schema the frontend sends: the admin\'s enhancer RECIPE is not applied, the frontend\'s own is', () => {
    const admin = { fieldRules: { 'querystring.b_size': false } };
    const frontend = { inheritSchemaFrom: { mappingField: 'fieldMapping' } };
    const { entry, previousEnhancer } = mergeFrontendBlock(
      'listing', { id: 'listing', schemaEnhancer: admin },
      { blockSchema: { properties: { querystring: {} } }, schemaEnhancer: frontend },
    );
    expect(entry.schemaEnhancer).toBe(frontend);
    expect(previousEnhancer).toBeUndefined();
  });

  test('a schema the frontend sends with an enhancer: the admin\'s FUNCTION is not handed back to chain', () => {
    const fn = ({ schema }) => schema;
    const recipe = { inheritSchemaFrom: {} };
    const { entry, previousEnhancer } = mergeFrontendBlock(
      'listing', { id: 'listing', schemaEnhancer: fn },
      { schema: { properties: {} }, schemaEnhancer: recipe },
    );
    expect(entry.schemaEnhancer).toBe(recipe);
    expect(previousEnhancer).toBeUndefined();
  });

  test('no frontend enhancer keeps the admin\'s', () => {
    const fn = ({ schema }) => schema;
    const { entry, previousEnhancer } = mergeFrontendBlock(
      'listing',
      { schemaEnhancer: fn },
      { title: 'Listing' },
    );
    expect(entry.schemaEnhancer).toBe(fn);
    expect(previousEnhancer).toBeUndefined();
  });
});
