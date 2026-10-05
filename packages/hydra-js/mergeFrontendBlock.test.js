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
