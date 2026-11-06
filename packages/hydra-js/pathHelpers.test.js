import {
  getAtPath,
  ensureMutablePath,
  getFieldDefByPath,
  getFieldValue,
  setFieldValue,
  getFieldDef,
  resolveFieldPath,
} from '@volto-hydra/helpers';

/**
 * getAtPath / ensureMutablePath are the shared object-path primitives behind
 * every container read/write (object_list and blocks_layout regionPath,
 * dotted object fields like content.headline). The clone-along-path write is
 * subtle — these guard it directly.
 */
describe('getAtPath', () => {
  const obj = { table: { rows: [1, 2], hideHeaders: true }, top: 'x' };

  test('reads a nested value at an array path', () => {
    expect(getAtPath(obj, ['table', 'rows'])).toEqual([1, 2]);
    expect(getAtPath(obj, ['table', 'hideHeaders'])).toBe(true);
    expect(getAtPath(obj, ['top'])).toBe('x');
  });

  test('empty (or missing) path returns the object itself', () => {
    expect(getAtPath(obj, [])).toBe(obj);
    expect(getAtPath(obj, undefined)).toBe(obj);
  });

  test('a missing segment short-circuits to undefined (no throw)', () => {
    expect(getAtPath(obj, ['table', 'nope', 'deep'])).toBeUndefined();
    expect(getAtPath(undefined, ['a'])).toBeUndefined();
  });
});

describe('ensureMutablePath', () => {
  test('returns the node at path and clones every visited level', () => {
    const original = { content: { headline: [{ text: 'a' }], blocks: { b1: {} } } };
    const contentBefore = original.content;
    const node = ensureMutablePath(original, ['content']);

    expect(node).toBe(original.content); // returns the (now cloned) node
    expect(original.content).not.toBe(contentBefore); // level was cloned
    expect(original.content.blocks).toBe(contentBefore.blocks); // untouched siblings kept by ref
  });

  test('set-a-leaf idiom writes nested without mutating shared refs', () => {
    const shared = { content: { headline: [{ text: 'old' }], keep: 1 } };
    const snapshot = shared.content.headline; // pretend this is frozen/shared
    const path = ['content', 'headline'];
    ensureMutablePath(shared, path.slice(0, -1))[path[path.length - 1]] = [{ text: 'new' }];

    expect(shared.content.headline).toEqual([{ text: 'new' }]);
    expect(snapshot).toEqual([{ text: 'old' }]); // original array object untouched
    expect(shared.content.keep).toBe(1); // sibling field survives
  });

  test('empty path returns the object unchanged', () => {
    const o = { a: 1 };
    expect(ensureMutablePath(o, [])).toBe(o);
  });

  test('creates intermediate objects for a missing path', () => {
    const o = {};
    ensureMutablePath(o, ['x', 'y']).z = 3;
    expect(o).toEqual({ x: { y: { z: 3 } } });
  });
});

describe('getFieldDefByPath — descend only through widget:object', () => {
  const headline = { title: 'Headline', widget: 'slate' };
  const cells = { widget: 'object_list', schema: { properties: { value: { widget: 'slate' } } } };
  const schema = {
    properties: {
      value: { widget: 'slate' },
      content: {
        widget: 'object',
        schema: {
          properties: {
            headline,
            body: { widget: 'blocks_layout' },
            rows: { widget: 'object_list', schema: { properties: { cells } } },
          },
        },
      },
    },
  };

  test('resolves a top-level field and one nested in an object', () => {
    expect(getFieldDefByPath(schema, ['value'])).toBe(schema.properties.value);
    expect(getFieldDefByPath(schema, ['content', 'headline'])).toBe(headline);
  });

  test('a region field is reachable as a LEAF (its own def)', () => {
    expect(getFieldDefByPath(schema, ['content', 'body']).widget).toBe('blocks_layout');
    expect(getFieldDefByPath(schema, ['content', 'rows']).widget).toBe('object_list');
  });

  test('cannot descend PAST a region (object_list/blocks_layout) — terminal', () => {
    // rows is an array of items; "content.rows.cells" is meaningless (which row?)
    expect(getFieldDefByPath(schema, ['content', 'rows', 'cells'])).toBeUndefined();
    // blocks_layout region: its children are separate blocks, not path segments
    expect(getFieldDefByPath(schema, ['content', 'body', 'anything'])).toBeUndefined();
  });

  test('cannot descend PAST a value, and missing segments → undefined', () => {
    expect(getFieldDefByPath(schema, ['value', 'deeper'])).toBeUndefined();
    expect(getFieldDefByPath(schema, ['content', 'nope'])).toBeUndefined();
    expect(getFieldDefByPath(schema, ['nope'])).toBeUndefined();
  });
});

describe('central field-access API (getFieldValue / setFieldValue / getFieldDef)', () => {
  // The ONE API text/link/media inline editing all route through, so a nested
  // object field like content/image works uniformly (was flat block[field]).
  test('getFieldValue reads a `/`-path (flat and nested)', () => {
    const block = { value: [{ text: 'x' }], content: { image: '/img.png' } };
    expect(getFieldValue(block, 'value')).toEqual([{ text: 'x' }]);
    expect(getFieldValue(block, 'content/image')).toBe('/img.png');
    expect(getFieldValue(block, 'content/nope')).toBeUndefined();
  });

  test('setFieldValue writes a `/`-path immutably (input untouched, siblings kept)', () => {
    const block = { '@type': 't', content: { image: 'old', keep: 1 } };
    const out = setFieldValue(block, 'content/image', 'new');
    expect(out.content.image).toBe('new');
    expect(out.content.keep).toBe(1); // sibling field preserved
    expect(out['@type']).toBe('t'); // top-level field preserved
    expect(block.content.image).toBe('old'); // input NOT mutated
    expect(out.content).not.toBe(block.content); // object wrapper cloned
  });

  test('setFieldValue on a flat field behaves like a normal set', () => {
    const block = { href: 'a', title: 'T' };
    const out = setFieldValue(block, 'href', 'b');
    expect(out).toEqual({ href: 'b', title: 'T' });
    expect(block.href).toBe('a');
  });

  test('getFieldDef resolves a `/`-path through object wrappers only', () => {
    const schema = {
      properties: {
        href: { widget: 'object_browser' },
        content: { widget: 'object', schema: { properties: { image: { widget: 'image' } } } },
      },
    };
    expect(getFieldDef(schema, 'href').widget).toBe('object_browser');
    expect(getFieldDef(schema, 'content/image').widget).toBe('image');
    expect(getFieldDef(schema, 'content/nope')).toBeUndefined();
  });
});

describe('getFieldDef across a variety of schema shapes', () => {
  // Deep object nesting, mixed object/region, typed object_list, malformed —
  // this resolver is load-bearing for text/link/media/validation, so cover the
  // shapes it must handle (and refuse).
  const leaf = (widget) => ({ widget });
  const obj = (properties) => ({ widget: 'object', schema: { properties } });
  const schema = {
    properties: {
      title: leaf('slate'),
      a: obj({
        b: obj({
          c: leaf('image'), // 3-level deep object nesting: a/b/c
          title: leaf('text'), // same field name as the top-level `title`
        }),
        rows: { widget: 'object_list', schema: { properties: { cell: leaf('slate') } } },
        panels: {
          widget: 'object_list',
          typeField: 'type', // typed object_list
          schema: { properties: {} },
        },
        body: { widget: 'blocks_layout' },
      }),
      broken: { widget: 'object' }, // object wrapper WITHOUT schema.properties
    },
  };

  test('top-level leaf', () => {
    expect(getFieldDef(schema, 'title').widget).toBe('slate');
  });

  test('deep 3-level object nesting (a/b/c)', () => {
    expect(getFieldDef(schema, 'a/b/c').widget).toBe('image');
  });

  test('same field name at different depths resolves per path', () => {
    expect(getFieldDef(schema, 'title').widget).toBe('slate'); // top
    expect(getFieldDef(schema, 'a/b/title').widget).toBe('text'); // nested
  });

  test('a region (object_list, incl. typed; blocks_layout) is reachable as a leaf', () => {
    expect(getFieldDef(schema, 'a/rows').widget).toBe('object_list');
    expect(getFieldDef(schema, 'a/panels').widget).toBe('object_list');
    expect(getFieldDef(schema, 'a/body').widget).toBe('blocks_layout');
  });

  test('cannot descend past a region — object_list item / typed / blocks_layout', () => {
    expect(getFieldDef(schema, 'a/rows/cell')).toBeUndefined();
    expect(getFieldDef(schema, 'a/panels/anything')).toBeUndefined();
    expect(getFieldDef(schema, 'a/body/anything')).toBeUndefined();
  });

  test('malformed / empty schemas never throw, return undefined', () => {
    expect(getFieldDef(schema, 'broken/x')).toBeUndefined(); // object with no schema.properties
    expect(getFieldDef(schema, 'a/missing/c')).toBeUndefined();
    expect(getFieldDef({ properties: {} }, 'a')).toBeUndefined();
    expect(getFieldDef(undefined, 'a')).toBeUndefined();
    expect(getFieldDef(schema, '')).toBeUndefined();
  });

  test('the matching data path round-trips through getFieldValue/setFieldValue', () => {
    const data = { a: { b: { c: 'old' } } };
    expect(getFieldValue(data, 'a/b/c')).toBe('old');
    const out = setFieldValue(data, 'a/b/c', 'new');
    expect(out.a.b.c).toBe('new');
    expect(data.a.b.c).toBe('old'); // immutable
  });
});

describe('resolveFieldPath — the block-scope half of the grammar', () => {
  // pathMap: child → col → PAGE
  const pathMap = {
    child: { parentId: 'col' },
    col: { parentId: '_page' },
  };

  test('bare path stays on the current block', () => {
    expect(resolveFieldPath('value', 'child', pathMap)).toEqual({ blockId: 'child', fieldName: 'value' });
  });

  test('object-descent remainder is preserved untouched', () => {
    expect(resolveFieldPath('content/headline', 'child', pathMap)).toEqual({
      blockId: 'child',
      fieldName: 'content/headline',
    });
  });

  test('leading / is page/root (remainder kept for further descent)', () => {
    expect(resolveFieldPath('/title', 'child', pathMap)).toEqual({ blockId: '_page', fieldName: 'title' });
    expect(resolveFieldPath('/a/b', 'child', pathMap)).toEqual({ blockId: '_page', fieldName: 'a/b' });
  });

  test('.. goes up one BLOCK per ../ (not an object level)', () => {
    expect(resolveFieldPath('../x', 'child', pathMap)).toEqual({ blockId: 'col', fieldName: 'x' });
    expect(resolveFieldPath('../../x', 'child', pathMap)).toEqual({ blockId: '_page', fieldName: 'x' });
  });

  test('.. composes with object descent on the resolved block', () => {
    expect(resolveFieldPath('../content/headline', 'child', pathMap)).toEqual({
      blockId: 'col',
      fieldName: 'content/headline',
    });
  });

  test('.. up to the page, then stops (exactly-to-root collapses cleanly)', () => {
    // child (depth 2: child→col→page): two `..` reach the page and consume cleanly.
    expect(resolveFieldPath('../../x', 'child', pathMap)).toEqual({ blockId: '_page', fieldName: 'x' });
  });

  test('EXCESS .. beyond the root is left as a remnant (malformed path, degrades safely)', () => {
    // A third `..` can't go above the page; the surplus stays in fieldName (which
    // then simply won't resolve to a field). Authors shouldn't over-`..`.
    expect(resolveFieldPath('../../../x', 'child', pathMap)).toEqual({ blockId: '_page', fieldName: '../x' });
  });

  test('no block context → page-level', () => {
    expect(resolveFieldPath('title', null, pathMap)).toEqual({ blockId: '_page', fieldName: 'title' });
    expect(resolveFieldPath('title', '_page', pathMap)).toEqual({ blockId: '_page', fieldName: 'title' });
  });

  test('full grammar end-to-end: block scope THEN object descent to a fieldDef', () => {
    const colSchema = {
      properties: { content: { widget: 'object', schema: { properties: { headline: { widget: 'slate' } } } } },
    };
    // "../content/headline" from `child` → block `col`, field path "content/headline"
    const { blockId, fieldName } = resolveFieldPath('../content/headline', 'child', pathMap);
    expect(blockId).toBe('col');
    expect(getFieldDef(colSchema, fieldName).widget).toBe('slate');
  });
});
