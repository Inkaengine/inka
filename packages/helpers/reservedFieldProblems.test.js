/**
 * Plone reads every `@id` in stored block data, at any depth, as a link: it
 * resolves a string to a page (rewriting it if one matches) and crashes the
 * save on anything else. So no block field may be NAMED `@id`; a link keeps its
 * `@id` inside the field's value (`href: [{ '@id': url }]`), which is fine.
 */
import { describe, expect, test } from 'vitest';

import { reservedFieldProblems } from './conversionValidation.js';

const schema = (properties) => ({
  blockSchema: {
    fieldsets: [{ id: 'default', title: 'Default', fields: Object.keys(properties) }],
    properties,
  },
});
const text = { title: 'Text', type: 'string' };
const link = { title: 'Link', widget: 'object_browser', mode: 'link' };

const rulesOf = (problems) => problems.map((p) => `${p.rule}:${p.types.join(',')}`);

describe('reservedFieldProblems', () => {
  test('fields with ordinary names, and links holding an @id in their value, are fine', () => {
    expect(reservedFieldProblems({ teaser: schema({ title: text, href: link }) })).toEqual([]);
  });

  test("a block field named '@id'", () => {
    const problems = reservedFieldProblems({ teaser: schema({ '@id': text, title: text }) });
    expect(rulesOf(problems)).toEqual(['reserved-field:teaser']);
    expect(problems[0].message).toContain("teaser.@id");
  });

  test("a field named '@id' inside an object field", () => {
    const r = {
      hero: schema({
        cta: { title: 'Call to action', widget: 'object', schema: { fieldsets: [], properties: { '@id': text } } },
      }),
    };
    expect(rulesOf(reservedFieldProblems(r))).toEqual(['reserved-field:hero']);
    expect(reservedFieldProblems(r)[0].message).toContain('hero.cta.@id');
  });

  test("a field named '@id' in the items of an untyped object list", () => {
    const r = {
      links: schema({
        items: {
          title: 'Items',
          widget: 'object_list',
          idField: 'key',
          schema: { fieldsets: [], properties: { '@id': text, label: text } },
        },
      }),
    };
    expect(rulesOf(reservedFieldProblems(r))).toEqual(['reserved-field:links']);
    expect(reservedFieldProblems(r)[0].message).toContain('links.items[].@id');
  });

  test('a schema given as a function is checked too', () => {
    const r = { teaser: { blockSchema: () => ({ fieldsets: [], properties: { '@id': text } }) } };
    expect(rulesOf(reservedFieldProblems(r))).toEqual(['reserved-field:teaser']);
  });
});
