/**
 * A field rule on a field inside an object field ('styles.b') hides it the way a
 * rule on a top-level field does: in the object's own schema, which is what its
 * widget draws (inka#652). It used to attach a function to the object field
 * instead, which the object widget never runs, so the field stayed in the
 * sidebar; and a function can't cross postMessage, so a schema carrying it hung
 * any parent that posted it without stripping.
 */
import { createFieldRulesEnhancer } from './fieldRules.js';

const objectSchema = () => ({
  fieldsets: [{ id: 'default', title: 'd', fields: ['styles'] }],
  properties: {
    styles: {
      widget: 'object',
      schema: {
        fieldsets: [{ id: 'default', title: 'S', fields: ['a', 'b'] }],
        properties: { a: { title: 'A' }, b: { title: 'B' } },
      },
    },
  },
});
const rule = { 'styles.b': { when: { 'styles.a': { isSet: true } }, else: false } };
const resolve = (formData) => createFieldRulesEnhancer(rule)({ schema: objectSchema(), formData });

describe('a field rule on a field inside an object field', () => {
  test('hides the field in the object\'s own schema, which is what its widget draws', () => {
    const { styles } = resolve({}).properties;
    expect(styles.schema.fieldsets[0].fields).toEqual(['a']);
    expect(styles.schema.properties).not.toHaveProperty('b');
    expect(styles).not.toHaveProperty('schemaEnhancer');
  });

  test('leaves it when the rule holds', () => {
    expect(resolve({ styles: { a: 'x' } }).properties.styles.schema.fieldsets[0].fields).toEqual(['a', 'b']);
  });

  test('leaves a schema that can be posted to a frontend, hidden or not', () => {
    expect(() => structuredClone(resolve({}))).not.toThrow();
    expect(() => structuredClone(resolve({ styles: { a: 'x' } }))).not.toThrow();
  });

  test('does not change the schema it was given', () => {
    const schema = objectSchema();
    createFieldRulesEnhancer(rule)({ schema, formData: {} });
    expect(schema).toEqual(objectSchema());
  });

  test('a field whose widget builds its own schema (a querystring) is still given the hide to run', () => {
    const schema = { fieldsets: [{ id: 'default', title: 'd', fields: ['querystring'] }], properties: { querystring: { widget: 'querystring' } } };
    const resolved = createFieldRulesEnhancer({ 'querystring.b_size': false })({ schema, formData: {} });
    const inner = resolved.properties.querystring.schemaEnhancer({
      schema: { fieldsets: [{ id: 'default', fields: ['b_size', 'sort_on'] }], properties: {} },
    });
    expect(inner.fieldsets[0].fields).toEqual(['sort_on']);
  });
});
