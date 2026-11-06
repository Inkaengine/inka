import { expandTemplatesSync } from '@volto-hydra/helpers';

/**
 * docs/frontend-guide/templates.md "Expand every container": each call to the merge
 * expands ONE list, and each container passes its children through it, naming the id
 * field of an object_list. The public merge has no schema and no map.
 */
const own = { templateId: '/t/form', slotId: 's' };
const fixed = { ...own, fixed: true, readOnly: true };

// A form whose fields are fixed but for one slot, keyed on field_id; and a column
// holding one fixed block and one slot.
const template = {
  '@id': '/t/form',
  blocks: {
    form: {
      ...fixed,
      slotId: 'form',
      '@type': 'form',
      subblocks: [
        { ...fixed, slotId: 'name', '@type': 'text', field_id: 'tpl-name', label: 'CURRENT' },
        { ...own, slotId: 'extra', '@type': 'text', field_id: 'tpl-extra' },
      ],
    },
    col: {
      ...fixed,
      slotId: 'col',
      '@type': 'column',
      blocks: {
        head: { ...fixed, slotId: 'head', '@type': 'slate', value: 'CURRENT' },
        main: { ...own, slotId: 'main', '@type': 'slate' },
      },
      blocks_layout: { items: ['head', 'main'] },
    },
  },
  blocks_layout: { items: ['form', 'col'] },
};

const instance = (id) => ({ templateId: '/t/form', templateInstanceId: id });
const options = (templateState) => ({ templateState, templates: { '/t/form': template }, editMode: false });

const page = (instanceId, n) => ({
  [`form${n}`]: {
    ...instance(instanceId),
    ...fixed,
    ...instance(instanceId),
    slotId: 'form',
    '@type': 'form',
    subblocks: [
      { ...fixed, ...instance(instanceId), slotId: 'name', '@type': 'text', field_id: `stored-${n}`, label: 'STALE' },
      { ...own, ...instance(instanceId), slotId: 'extra', '@type': 'text', field_id: `mine-${n}`, label: 'PAGE' },
    ],
  },
  [`col${n}`]: {
    ...fixed,
    ...instance(instanceId),
    slotId: 'col',
    '@type': 'column',
    blocks: {
      [`h${n}`]: { ...fixed, ...instance(instanceId), slotId: 'head', '@type': 'slate', value: 'STALE' },
      [`m${n}`]: { ...own, ...instance(instanceId), slotId: 'main', '@type': 'slate', value: 'PAGE' },
    },
    blocks_layout: { items: [`h${n}`, `m${n}`] },
  },
});

const render = (blocks, layout, state) => expandTemplatesSync(layout, { ...options(state), blocks });
const fields = (form, state) => expandTemplatesSync(form.subblocks, { ...options(state), idField: 'field_id' });
const children = (col, state) =>
  expandTemplatesSync(col.blocks_layout.items, { ...options(state), blocks: col.blocks });

describe('the merge expands one list per call', () => {
  test('the page call fills its own level and leaves a container\'s children to it', () => {
    const state = {};
    const [form, col] = render(page('i1', 1), ['form1', 'col1'], state);
    expect(form['@uid']).toBe('form1');
    expect(col['@uid']).toBe('col1');
    // The template's children, not yet merged: neither the page's nor filled.
    expect(form.subblocks.map((f) => f.field_id)).toEqual(['tpl-name', 'tpl-extra']);
    expect(col.blocks_layout.items).toEqual(['head', 'main']);
  });

  test('a blocks_layout container\'s call fills it: the template\'s fixed blocks, the page\'s slots, the page\'s ids', () => {
    const state = {};
    const [, col] = render(page('i1', 1), ['form1', 'col1'], state);
    const out = children(col, state);
    expect(out.map((b) => b['@uid'])).toEqual(['h1', 'm1']);
    expect(out.map((b) => b.value)).toEqual(['CURRENT', 'PAGE']);
  });

  test('an object_list container\'s call fills it, with its id field and no map', () => {
    const state = {};
    const [form] = render(page('i1', 1), ['form1', 'col1'], state);
    const out = fields(form, state);
    expect(out.map((f) => f['@uid'])).toEqual(['stored-1', 'mine-1']);
    expect(out.map((f) => f.field_id)).toEqual(['stored-1', 'mine-1']);
    expect(out.map((f) => f.label)).toEqual(['CURRENT', 'PAGE']);
    expect(out.every((f) => f['@id'] === undefined)).toBe(true);
  });

  test('blocks new to the page get their own stable id, in the list\'s own id field', () => {
    const blocks = { a: { ...instance('i1'), ...fixed, ...instance('i1'), slotId: 'form', '@type': 'form', subblocks: [] } };
    const first = () => {
      const state = {};
      const [form] = render(blocks, ['a'], state);
      return fields(form, state);
    };
    const out = first();
    expect(new Set(out.map((f) => f.field_id)).size).toBe(2);
    expect(out.map((f) => f.field_id)).toEqual(first().map((f) => f.field_id));
    expect(out.map((f) => f['@uid'])).toEqual(out.map((f) => f.field_id));
    expect(out.every((f) => f['@id'] === undefined)).toBe(true);
    expect(out.map((f) => f.field_id)).not.toContain('tpl-name');
  });

  test('two instances of a template on one page do not share ids', () => {
    const state = {};
    const blocks = {
      a: { ...fixed, ...instance('i1'), slotId: 'form', '@type': 'form', subblocks: [] },
      b: { ...fixed, ...instance('i2'), slotId: 'form', '@type': 'form', subblocks: [] },
    };
    const [one, , two] = render(blocks, ['a', 'b'], state);
    const ids = [...fields(one, state), ...fields(two, state)].map((f) => f.field_id);
    expect(new Set(ids).size).toBe(4);
  });

  test('rendering a container twice gives the same result', () => {
    const state = {};
    const [form, col] = render(page('i1', 1), ['form1', 'col1'], state);
    expect(children(col, state)).toEqual(children(col, state));
    expect(fields(form, state)).toEqual(fields(form, state));
  });

  test('a filled container\'s children pass through again unchanged', () => {
    const state = {};
    const [, col] = render(page('i1', 1), ['form1', 'col1'], state);
    const out = children(col, state);
    expect(expandTemplatesSync(['h1', 'm1'], {
      ...options(state),
      blocks: Object.fromEntries(out.map((b) => [b['@uid'], b])),
    }).map((b) => b.value)).toEqual(['CURRENT', 'PAGE']);
  });
});

describe('the merge fails loudly when it isn\'t used as documented', () => {
  test('an object_list\'s call without its id field', () => {
    const state = {};
    const [form] = render(page('i1', 1), ['form1', 'col1'], state);
    expect(() => expandTemplatesSync(form.subblocks, options(state))).toThrow(/no "@id".*pass its idField/s);
  });

  test('a container\'s call with a different templateState', () => {
    const [, col] = render(page('i1', 1), ['form1', 'col1'], {});
    expect(() => children(col, {})).toThrow(/same templateState/);
  });

  test('there is no idFieldMap option', () => {
    expect(() => render(page('i1', 1), ['form1'], {}) && expandTemplatesSync([], {
      ...options({}),
      idFieldMap: {},
    })).toThrow(/idFieldMap/);
  });
});
