/**
 * A block config's fieldMappings must make sense against the schemas they name,
 * or the editor refuses to load (and the content check fails CI).
 *
 * Mappings that didn't were accepted silently: a list item mapped a result's
 * address to `href`, a field its schema doesn't have, so every listing of it
 * lost its links; and a conversion read `{ field, type }` as a field NAME.
 */
import { describe, expect, test } from 'vitest';

import { fieldMappingProblems } from './conversionValidation.js';

const link = { title: 'Link', widget: 'object_browser', mode: 'link' };
const schema = (properties) => ({
  blockSchema: {
    fieldsets: [{ id: 'default', title: 'Default', fields: Object.keys(properties) }],
    properties,
  },
});

/** A registry that makes sense: every rule below breaks one thing in it. */
const registry = () => ({
  card: {
    fieldMappings: {
      '@default': {
        getURL: { field: 'url', type: 'link' },
        title: 'title',
        description: 'description',
        image: 'image',
        effective: { field: 'date', type: 'string' },
        Subject: { field: 'tag', type: 'string' },
      },
    },
    ...schema({
      title: { title: 'Title', type: 'string' },
      description: { title: 'Description', type: 'string', widget: 'textarea' },
      url: link,
      image: { title: 'Image', widget: 'image' },
      date: { title: 'Date', type: 'string', widget: 'date' },
      tag: { title: 'Tag', type: 'string' },
    }),
  },
  contentBlock: {
    fieldMappings: {
      '@default': {
        getURL: { field: 'linkUrl', type: 'link' },
        title: 'title',
        description: { field: 'description', type: 'slate' },
      },
      card: { url: 'linkUrl', title: 'title' },
    },
    ...schema({
      title: { title: 'Title', type: 'string' },
      description: { title: 'Text', type: 'array', widget: 'slate' },
      linkUrl: link,
    }),
  },
  listItem: {
    fieldMappings: {
      '@default': { getURL: { field: 'href', type: 'link' }, title: 'title', Subject: { field: 'tags', type: 'array' } },
    },
    ...schema({
      title: { title: 'Title', type: 'string' },
      href: { title: 'Address', type: 'string', widget: 'url' },
      tags: { title: 'Tags', type: 'array' },
    }),
  },
  grid: {
    fieldMappings: { '@default': { title: 'items/*/title' } },
    ...schema({
      items: { title: 'Items', widget: 'blocks_layout', allowedBlocks: ['card'] },
    }),
  },
  linkBar: schema({
    links: {
      title: 'Links',
      widget: 'object_list',
      idField: 'key',
      typeField: 'kind',
      allowedBlocks: ['listItem'],
    },
  }),
});

const rulesOf = (problems) => problems.map((p) => `${p.rule}:${p.types.join(',')}`);

describe('fieldMappingProblems', () => {
  test('a registry whose mappings make sense has none', () => {
    expect(fieldMappingProblems(registry())).toEqual([]);
  });

  test("a destination the block's schema doesn't have", () => {
    const r = registry();
    delete r.listItem.blockSchema.properties.href;
    r.listItem.blockSchema.fieldsets[0].fields = ['title', 'tags'];
    r.listItem.blockSchema.properties.url = link;
    const problems = fieldMappingProblems(r);
    expect(rulesOf(problems)).toEqual(['unknown-destination:listItem']);
    expect(problems[0].message).toContain('href');
  });

  test.each([
    ['@id', '@id'],
    ['@type', '@type'],
    ['templateId', 'templateId'],
    ['the idField of a list it is an item of', 'key'],
    ['the typeField of a list it is an item of', 'kind'],
  ])('a destination that is %s', (_label, field) => {
    const r = registry();
    r.listItem.blockSchema.properties[field] = { title: field, type: 'string' };
    r.listItem.fieldMappings['@default'].title = field;
    expect(rulesOf(fieldMappingProblems(r))).toEqual(['id-destination:listItem']);
  });

  // A region path writes onto each child it makes: onto the region's idField
  // or typeField, it would overwrite the child's id or type.
  test.each([
    ['the idField', 'key'],
    ['the typeField', 'kind'],
  ])("a region path onto %s of the region's items", (_label, field) => {
    const r = registry();
    r.listItem.blockSchema.properties[field] = { title: field, type: 'string' };
    r.wrapper = {
      fieldMappings: { card: { title: `links/listItem/${field}` } },
      ...schema({ links: r.linkBar.blockSchema.properties.links }),
    };
    expect(rulesOf(fieldMappingProblems(r))).toEqual(['id-destination:wrapper']);
  });

  test.each([
    ['a link onto a text field', { field: 'title', type: 'link' }],
    ['slate onto a textarea', { field: 'description', type: 'slate' }],
    ['text onto a link field', { field: 'url', type: 'string' }],
    ['a list onto a text field', { field: 'tag', type: 'array' }],
  ])('a conversion that cannot produce what the field holds: %s', (_label, mapping) => {
    const r = registry();
    r.card.fieldMappings['@default'].created = mapping;
    expect(rulesOf(fieldMappingProblems(r))).toEqual(['type-mismatch:card']);
  });

  // An entry with no `type` is given the conversion the mapping rule records
  // (its field's widget's, or the one the source needs): wrong only where
  // none gives what the field holds. One naming a type must name one that does.
  test.each([
    ['an image onto a text field', 'image', 'title'],
    ['a date onto a link field', 'created', 'url'],
  ])('an untyped entry no conversion fits: %s', (_label, source, field) => {
    const r = registry();
    delete r.card.fieldMappings['@default'][source];
    r.card.fieldMappings['@default'][source] = field;
    expect(rulesOf(fieldMappingProblems(r))).toEqual(['type-mismatch:card']);
  });

  test.each([
    ['the address onto a link field', 'getURL', 'url'],
    ['text onto a slate field', 'title', 'body'],
    ['a list onto a text field (joined)', 'Subject', 'title'],
    ['an image onto a link field (as image_link)', 'image', 'url'],
  ])('an untyped entry the rule records a conversion for: %s', (_label, source, field) => {
    const r = registry();
    r.card.blockSchema.properties.body = { title: 'Body', type: 'array', widget: 'slate' };
    delete r.card.fieldMappings['@default'][source];
    r.card.fieldMappings['@default'][source] = field;
    expect(fieldMappingProblems(r)).toEqual([]);
  });

  test.each([
    ['a list into text, not joined', 'Subject', { field: 'title', type: 'array' }],
    ['an image as a plain link', 'image', { field: 'url', type: 'link' }],
  ])('a typed entry whose conversion gets it wrong: %s', (_label, source, mapping) => {
    const r = registry();
    delete r.card.fieldMappings['@default'][source];
    r.card.fieldMappings['@default'][source] = mapping;
    expect(rulesOf(fieldMappingProblems(r))).toEqual(['type-mismatch:card']);
  });

  // Copy-from-target pulls any attribute of the linked page, not only what the
  // catalog lists; its kind isn't known, so its field's widget converts it.
  test('a @target source that is an attribute of the linked page', () => {
    const r = registry();
    r.card.fieldMappings['@target'] = { head_title: 'title' };
    expect(fieldMappingProblems(r)).toEqual([]);
  });

  test('an entry naming a conversion that fits says nothing', () => {
    const r = registry();
    r.card.fieldMappings['@default'].Subject = { field: 'tag', type: 'string' };
    expect(fieldMappingProblems(r)).toEqual([]);
  });

  test('a conversion Inka has no name for', () => {
    const r = registry();
    r.card.fieldMappings['@default'].getURL = { field: 'url', type: 'links' };
    expect(rulesOf(fieldMappingProblems(r))).toEqual(['unknown-type:card']);
  });

  test.each([
    ['no field', { type: 'link' }],
    ['a number', 7],
    ['an empty name', ''],
  ])('a mapping that names no field: %s', (_label, mapping) => {
    const r = registry();
    r.card.fieldMappings['@default'].created = mapping;
    expect(rulesOf(fieldMappingProblems(r))).toEqual(['bad-mapping:card']);
  });

  test('a @default source that is not a catalog field', () => {
    const r = registry();
    r.card.fieldMappings['@default'].label = 'title';
    expect(rulesOf(fieldMappingProblems(r))).toEqual(['unknown-source:card']);
  });

  test("a type-to-type source the other type doesn't have", () => {
    const r = registry();
    r.contentBlock.fieldMappings.card.link = 'linkUrl';
    expect(rulesOf(fieldMappingProblems(r))).toEqual(['unknown-source:contentBlock']);
  });

  test('a region path into a region the block has, onto a field its children have', () => {
    const r = registry();
    r.grid.fieldMappings['@default'].title = 'cards/*/title';
    expect(rulesOf(fieldMappingProblems(r))).toEqual(['unknown-destination:grid']);
    const r2 = registry();
    r2.grid.fieldMappings['@default'].title = 'items/card/headline';
    expect(rulesOf(fieldMappingProblems(r2))).toEqual(['unknown-destination:grid']);
  });

  // Plone reads every `@id` in stored block data as a link, and a listing
  // stores its mapping: keyed `@id` with a `{ field, type }` value, it crashed
  // the save. The address is `getURL`; a config still naming `@id` is told so.
  test("a catalog source named '@id', the address's old name", () => {
    const r = registry();
    delete r.card.fieldMappings['@default'].getURL;
    r.card.fieldMappings['@default']['@id'] = { field: 'url', type: 'link' };
    const problems = fieldMappingProblems(r);
    expect(rulesOf(problems)).toEqual(['unknown-source:card']);
    expect(problems[0].message).toContain('getURL');
  });

  test("a mapping widget offering '@id' as a source", () => {
    const r = registry();
    r.listing = schema({
      fieldMapping: {
        title: 'Field mapping',
        widget: 'field_mapping',
        sourceFields: { '@id': { title: 'URL', type: 'string' }, title: { title: 'Title', type: 'string' } },
      },
    });
    const problems = fieldMappingProblems(r);
    expect(rulesOf(problems)).toEqual(['unknown-source:listing']);
    expect(problems[0].message).toContain('getURL');
  });

  test('a mapping widget offering a source of a type Inka has no conversion for', () => {
    const r = registry();
    r.listing = schema({
      fieldMapping: {
        title: 'Field mapping',
        widget: 'field_mapping',
        sourceFields: { getURL: { title: 'URL', type: 'string' }, size: { title: 'Size', type: 'number' } },
      },
    });
    const problems = fieldMappingProblems(r);
    expect(rulesOf(problems)).toEqual(['unknown-type:listing']);
    expect(problems[0].message).toContain('size');
  });

  // A value↔container bridge is declared once, on the VALUE block, keyed by the
  // container: { <its own field>: '<container region>/<type>/<field>' }, and
  // serves both directions (convertValueContainer). Not a source → destination.
  test('a value-container bridge, declared on the value block', () => {
    const r = registry();
    r.slate = schema({ value: { title: 'Text', type: 'array', widget: 'slate' } });
    r.tableCell = schema({ blocks: { title: 'Content', widget: 'blocks_layout', allowedBlocks: ['slate'] } });
    r.tableHeaderCell = {
      fieldMappings: { tableCell: { value: 'blocks/slate/value' } },
      ...schema({ value: { title: 'Text', type: 'array', widget: 'slate' } }),
    };
    expect(fieldMappingProblems(r)).toEqual([]);
    r.tableHeaderCell.fieldMappings.tableCell = { heading: 'blocks/slate/value' };
    expect(rulesOf(fieldMappingProblems(r))).toEqual(['unknown-destination:tableHeaderCell']);
    r.tableHeaderCell.fieldMappings.tableCell = { value: 'blocks/slate/body' };
    expect(rulesOf(fieldMappingProblems(r))).toEqual(['unknown-source:tableHeaderCell']);
  });

  // The built-in slate block has no schema; it always stores its text in `value`.
  test('a bridge onto the built-in slate block, which has no schema', () => {
    const r = registry();
    r.slate = { title: 'Text' };
    r.tableCell = schema({ blocks: { title: 'Content', widget: 'blocks_layout', allowedBlocks: ['slate'] } });
    r.tableHeaderCell = {
      fieldMappings: { tableCell: { value: 'blocks/slate/value' } },
      ...schema({ value: { title: 'Text', type: 'array', widget: 'slate' } }),
    };
    expect(fieldMappingProblems(r)).toEqual([]);
  });

  test('@target mappings follow the same rules', () => {
    const r = registry();
    r.card.fieldMappings['@target'] = { title: 'heading' };
    expect(rulesOf(fieldMappingProblems(r))).toEqual(['unknown-destination:card']);
  });

  test('every problem is reported, not just the first', () => {
    const r = registry();
    r.card.fieldMappings['@default'].created = { field: 'nope' };
    r.listItem.fieldMappings['@default'].title = '@id';
    expect(rulesOf(fieldMappingProblems(r)).sort()).toEqual([
      'id-destination:listItem',
      'unknown-destination:card',
    ]);
  });

  // A region is reached through its own name, whatever it is: a list named
  // `blocks` (a table cell's) is the region, not Inka's shared blocks map.
  test("a region path through a list region named 'blocks' is a path, not Inka's key", () => {
    const r = registry();
    r.cell = schema({
      blocks: { title: 'Content', widget: 'object_list', idField: '@id', typeField: '@type', allowedBlocks: ['card'] },
    });
    r.headerCell = {
      fieldMappings: { cell: { 'blocks/card/title': 'title' } },
      ...schema({ title: { title: 'Title', type: 'string' } }),
    };
    r.cell.fieldMappings = { headerCell: { title: 'blocks/card/title' } };
    expect(fieldMappingProblems(r)).toEqual([]);
  });
});
