import {
  buildQuerystringSearchBody,
  getFieldTypeString,
  isEmptySlate,
  isPlainStringFieldType,
  isSlateFieldType,
  isTextareaFieldType,
  loadTemplates,
} from './index.js';

// Unit tests for buildQuerystringSearchBody — the pure builder that turns a
// listing's queryConfig + paging + extraCriteria into the @querystring-search
// request body. Focus: the facet → Plone query-operation mapping, including the
// DATE-RANGE facets (a `facet.<field>.after` / `.before` key → the scalar date
// operations largerThan / lessThan, so a "from" and a "to" facet on the same
// index build a range).

const criterion = (body, i) => body.query.find((q) => q.i === i);
const criteria = (body, i) => body.query.filter((q) => q.i === i);

describe('buildQuerystringSearchBody — core body', () => {
  test('no queryConfig → default relativePath "." + folder-order sort', () => {
    const body = buildQuerystringSearchBody(undefined, {}, {});
    expect(criterion(body, 'path')).toEqual({
      i: 'path',
      o: 'plone.app.querystring.operation.string.relativePath',
      v: '.',
    });
    expect(body.sort_on).toBe('getObjPositionInParent');
    expect(body.sort_order).toBe('ascending');
    expect(body.b_start).toBe(0);
    expect(body.b_size).toBe(10);
    expect(body.metadata_fields).toBe('_all');
  });

  test('a configured query is cloned (not mutated) and gets effective-desc default sort', () => {
    const cfg = {
      query: [
        {
          i: 'portal_type',
          o: 'plone.app.querystring.operation.selection.any',
          v: ['Document'],
        },
      ],
    };
    const body = buildQuerystringSearchBody(cfg, { b_start: 20, b_size: 5 }, {});
    expect(body.query).not.toBe(cfg.query); // cloned
    expect(criterion(body, 'portal_type')).toBeTruthy();
    expect(body.sort_on).toBe('effective');
    expect(body.sort_order).toBe('descending');
    expect(body.b_start).toBe(20);
    expect(body.b_size).toBe(5);
  });

  test('SearchableText → string.contains; sort_on/sort_order override', () => {
    const body = buildQuerystringSearchBody({}, {}, {
      SearchableText: 'dog',
      sort_on: 'sortable_title',
      sort_order: 'ascending',
    });
    expect(criterion(body, 'SearchableText')).toEqual({
      i: 'SearchableText',
      o: 'plone.app.querystring.operation.string.contains',
      v: 'dog',
    });
    expect(body.sort_on).toBe('sortable_title');
    expect(body.sort_order).toBe('ascending');
  });
});

describe('buildQuerystringSearchBody — queryType (Standard vs Advanced)', () => {
  test('queryType "search" → string.search (Advanced)', () => {
    const body = buildQuerystringSearchBody({}, {}, {
      SearchableText: 'dog park',
      queryType: 'search',
    });
    expect(criterion(body, 'SearchableText')).toEqual({
      i: 'SearchableText',
      o: 'plone.app.querystring.operation.string.search',
      v: 'dog park',
    });
  });

  test('queryType "contains" → string.contains (Standard)', () => {
    const body = buildQuerystringSearchBody({}, {}, {
      SearchableText: 'dog',
      queryType: 'contains',
    });
    expect(criterion(body, 'SearchableText').o).toBe(
      'plone.app.querystring.operation.string.contains',
    );
  });

  test('no queryType defaults to string.contains', () => {
    const body = buildQuerystringSearchBody({}, {}, { SearchableText: 'dog' });
    expect(criterion(body, 'SearchableText').o).toBe(
      'plone.app.querystring.operation.string.contains',
    );
  });

  test('queryType is never emitted as its own query criterion', () => {
    const body = buildQuerystringSearchBody({}, {}, {
      SearchableText: 'dog',
      queryType: 'search',
    });
    expect(criterion(body, 'queryType')).toBeUndefined();
  });
});

describe('buildQuerystringSearchBody — discrete (value) facets', () => {
  test('facet.<field> array → selection.any with the array', () => {
    const body = buildQuerystringSearchBody({}, {}, {
      'facet.portal_type': ['Document', 'News Item'],
    });
    const q = criterion(body, 'portal_type');
    expect(q.o).toBe('plone.app.querystring.operation.selection.any');
    expect(q.v).toEqual(['Document', 'News Item']);
  });

  test('a scalar facet value is wrapped in an array', () => {
    const body = buildQuerystringSearchBody({}, {}, {
      'facet.review_state': 'published',
    });
    expect(criterion(body, 'review_state').v).toEqual(['published']);
  });
});

describe('buildQuerystringSearchBody — date-range facets', () => {
  test("'after' → date.largerThan on the bare index, scalar value", () => {
    const body = buildQuerystringSearchBody({}, {}, {
      'facet.created.after': '2024-01-02',
    });
    const q = criterion(body, 'created');
    expect(q.o).toBe('plone.app.querystring.operation.date.largerThan');
    expect(q.v).toBe('2024-01-02');
    // The index is `created`, never `created.after`.
    expect(criterion(body, 'created.after')).toBeUndefined();
  });

  test("'before' → date.lessThan on the bare index, scalar value", () => {
    const body = buildQuerystringSearchBody({}, {}, {
      'facet.created.before': '2024-01-28',
    });
    const q = criterion(body, 'created');
    expect(q.o).toBe('plone.app.querystring.operation.date.lessThan');
    expect(q.v).toBe('2024-01-28');
  });

  test('combined after + before → BOTH date criteria on the same index (a range)', () => {
    const body = buildQuerystringSearchBody({}, {}, {
      'facet.created.after': '2024-01-02',
      'facet.created.before': '2024-01-28',
    });
    const cs = criteria(body, 'created');
    expect(cs).toHaveLength(2);
    expect(cs.map((q) => q.o).sort()).toEqual([
      'plone.app.querystring.operation.date.largerThan',
      'plone.app.querystring.operation.date.lessThan',
    ]);
    expect(
      cs.find((q) => q.o.endsWith('largerThan')).v,
    ).toBe('2024-01-02');
    expect(cs.find((q) => q.o.endsWith('lessThan')).v).toBe('2024-01-28');
  });

  test('an array-wrapped date value uses the first element (scalar op)', () => {
    const body = buildQuerystringSearchBody({}, {}, {
      'facet.created.after': ['2024-01-02'],
    });
    expect(criterion(body, 'created').v).toBe('2024-01-02');
  });

  test('a date facet and a discrete facet coexist correctly', () => {
    const body = buildQuerystringSearchBody({}, {}, {
      'facet.portal_type': ['Event'],
      'facet.created.after': '2024-01-02',
    });
    expect(criterion(body, 'portal_type').o).toBe(
      'plone.app.querystring.operation.selection.any',
    );
    expect(criterion(body, 'created').o).toBe(
      'plone.app.querystring.operation.date.largerThan',
    );
  });
});

describe('buildQuerystringSearchBody — date-facet edge cases', () => {
  // A cleared date input legitimately means "no filter", so an empty value must
  // drop the criterion rather than send an empty `v` the catalog would choke on.
  // Pinned because the `if (v)` guard is otherwise invisible: the criterion just
  // silently isn't there.
  test.each([
    ['empty string', ''],
    ['empty array', []],
    ['undefined', undefined],
    ['null', null],
  ])('a %s date value adds no criterion at all', (_label, value) => {
    const body = buildQuerystringSearchBody({}, {}, {
      'facet.created.after': value,
    });
    expect(criteria(body, 'created')).toHaveLength(0);
    expect(criteria(body, 'created.after')).toHaveLength(0);
  });

  test('an empty "after" still lets a populated "before" through', () => {
    const body = buildQuerystringSearchBody({}, {}, {
      'facet.created.after': '',
      'facet.created.before': '2024-01-28',
    });
    const cs = criteria(body, 'created');
    expect(cs).toHaveLength(1);
    expect(cs[0].o).toBe('plone.app.querystring.operation.date.lessThan');
    expect(cs[0].v).toBe('2024-01-28');
  });

  // Only a trailing `.after`/`.before` marks a date facet. Any other dotted
  // field stays a discrete facet on the WHOLE dotted name — so tightening or
  // loosening the regex can't silently reroute normal facets.
  test.each([
    'facet.foo.bar',
    'facet.created.between',
    'facet.after.something',
  ])('%s stays a discrete selection.any facet', (key) => {
    const body = buildQuerystringSearchBody({}, {}, { [key]: ['x'] });
    const field = key.slice('facet.'.length);
    const q = criterion(body, field);
    expect(q).toBeTruthy();
    expect(q.o).toBe('plone.app.querystring.operation.selection.any');
    expect(q.v).toEqual(['x']);
  });

  // `^(.+)\.(after|before)$` is greedy, so only the LAST segment is read as the
  // direction and everything before it is the index verbatim. Documents the
  // behaviour for a malformed key rather than leaving it to chance.
  test('a doubled direction suffix takes only the last segment as the direction', () => {
    const body = buildQuerystringSearchBody({}, {}, {
      'facet.created.after.before': '2024-01-02',
    });
    const q = criterion(body, 'created.after');
    expect(q.o).toBe('plone.app.querystring.operation.date.lessThan');
    expect(criterion(body, 'created')).toBeUndefined();
  });

  // A bare `facet.after` has no index before the direction, so the regex can't
  // match (`(.+)` needs at least one character) and it stays discrete.
  test('a bare direction with no index stays a discrete facet', () => {
    const body = buildQuerystringSearchBody({}, {}, { 'facet.after': '2024-01-02' });
    const q = criterion(body, 'after');
    expect(q.o).toBe('plone.app.querystring.operation.selection.any');
    expect(q.v).toEqual(['2024-01-02']);
  });

  // The value is passed through verbatim — no date parsing or validation here.
  // Pinned so that if validation is ever added, this test is the one that fails
  // and forces the decision to be explicit.
  test('a non-date value is passed through unvalidated', () => {
    const body = buildQuerystringSearchBody({}, {}, {
      'facet.created.after': 'banana',
    });
    expect(criterion(body, 'created').v).toBe('banana');
  });

  test('extra array elements are ignored — the op takes a single scalar', () => {
    const body = buildQuerystringSearchBody({}, {}, {
      'facet.created.after': ['2024-01-02', '2024-06-01'],
    });
    const cs = criteria(body, 'created');
    expect(cs).toHaveLength(1);
    expect(cs[0].v).toBe('2024-01-02');
  });

  test('a non-facet key is left out of the query entirely', () => {
    const body = buildQuerystringSearchBody({}, {}, { 'created.after': '2024-01-02' });
    expect(criteria(body, 'created')).toHaveLength(0);
    expect(criteria(body, 'created.after')).toHaveLength(0);
  });
});

describe('buildQuerystringSearchBody — depth', () => {
  // Plone encodes path-criterion depth in the criterion VALUE as `path::depth`
  // (`.::1`, `/docs::2`). A bare path is a recursive query. The top-level `depth`
  // field on the request body is NOT honoured by @querystring-search — the mock
  // API says so explicitly (verified against demo.plone.org) and the live backend
  // agrees: `.` returns 107 items under /components, `.::1` returns 33.
  //
  // Sending the ignored top-level field is what put every nested Image into the
  // /components index.
  test('depth is encoded onto the path criterion, not sent as a top-level field', () => {
    const body = buildQuerystringSearchBody(
      {
        depth: 1,
        query: [
          {
            i: 'path',
            o: 'plone.app.querystring.operation.string.relativePath',
            v: '.',
          },
        ],
      },
      {},
      {},
    );
    expect(criterion(body, 'path').v).toBe('.::1');
    expect(body.depth).toBeUndefined();
  });

  test('an absolute path criterion gets the same encoding', () => {
    const body = buildQuerystringSearchBody(
      {
        depth: 2,
        query: [
          {
            i: 'path',
            o: 'plone.app.querystring.operation.string.absolutePath',
            v: '/docs',
          },
        ],
      },
      {},
      {},
    );
    expect(criterion(body, 'path').v).toBe('/docs::2');
  });

  test('a depth already in the value is left alone', () => {
    const body = buildQuerystringSearchBody(
      {
        depth: 5,
        query: [
          {
            i: 'path',
            o: 'plone.app.querystring.operation.string.relativePath',
            v: '.::1',
          },
        ],
      },
      {},
      {},
    );
    expect(criterion(body, 'path').v).toBe('.::1');
  });

  test('no depth leaves the path criterion recursive', () => {
    const body = buildQuerystringSearchBody(
      {
        query: [
          {
            i: 'path',
            o: 'plone.app.querystring.operation.string.relativePath',
            v: '.',
          },
        ],
      },
      {},
      {},
    );
    expect(criterion(body, 'path').v).toBe('.');
    expect(body.depth).toBeUndefined();
  });
});

describe('loadTemplates — the per-template timeout', () => {
  const page = { blocks: { b1: { templateId: '/templates/one' } } };
  const template = { blocks: {}, blocks_layout: { items: [] } };

  afterEach(() => {
    delete process.env.HYDRA_TEMPLATE_LOAD_TIMEOUT;
  });

  it('gives a slow loader the time the environment allows', async () => {
    process.env.HYDRA_TEMPLATE_LOAD_TIMEOUT = '400';
    const slow = () =>
      new Promise((resolve) => setTimeout(() => resolve(template), 120));

    const { templates } = await loadTemplates(page, slow);

    expect(Object.keys(templates)).toContain('/templates/one');
  });

  it('still gives up on one that outlasts it', async () => {
    // The point of the race: a hanging request must not block INITIAL_DATA.
    process.env.HYDRA_TEMPLATE_LOAD_TIMEOUT = '60';
    const hanging = () =>
      new Promise((resolve) => setTimeout(() => resolve(template), 400));

    const { templates } = await loadTemplates(page, hanging);

    expect(Object.keys(templates)).not.toContain('/templates/one');
  });

  it("lets the CALLER's own retry finish, which the fixed 5s race cancelled", async () => {
    // A frontend that retries a transient failure — ours retries three times —
    // must be allowed to complete inside the race, or its retry is pointless.
    process.env.HYDRA_TEMPLATE_LOAD_TIMEOUT = '900';
    let attempts = 0;
    // The retry lives INSIDE the caller's loader, which is where ours is: the
    // race wraps this whole function, so three 100ms attempts have to fit.
    const retryingLoader = async () => {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        attempts += 1;
        await new Promise((r) => setTimeout(r, 100));
        if (attempt === 3) return template;
      }
      throw new Error('unreachable');
    };

    const { templates } = await loadTemplates(page, retryingLoader);

    expect(attempts).toBe(3);
    expect(Object.keys(templates)).toContain('/templates/one');
  });
});

// ---------------------------------------------------------------------------

describe('getFieldTypeString — a field with no declared type is a string', () => {
  test('a widget alone does not make a field typeless', () => {
    // A schema may give a field a widget and no `type` — most do, because the
    // type is obvious. The no-widget path has always assumed string for exactly
    // that case (`return 'string'`), so a widget must not quietly change the
    // assumption into "no type at all".
    expect(getFieldTypeString({ widget: 'copyFromTargetField' })).toBe(
      'string:copyFromTargetField',
    );
  });

  test('so such a field is still plain-string editable', () => {
    // The bug this pins. `copy-from-target` swaps a mapped destination field's
    // widget to `copyFromTargetField` — so a card's `title`, declared as just
    // `{ title: "Headline" }`, went from "string" (editable) to
    // ":copyFromTargetField" (not). Inline editing of the card title silently
    // stopped working the moment the block gained the ability to fill itself
    // from a link, and the front-page demo filmed someone typing into a card
    // that stayed empty.
    expect(
      isPlainStringFieldType(getFieldTypeString({ widget: 'copyFromTargetField' })),
    ).toBe(true);
  });

  test('a widget that DOES imply a different editor still wins', () => {
    // The assumption is about the TYPE, not the widget: a textarea or slate
    // widget must keep classifying as itself, or this fix would turn every
    // rich-text field into a one-line string.
    expect(getFieldTypeString({ widget: 'textarea' })).toBe('string:textarea');
    expect(isTextareaFieldType(getFieldTypeString({ widget: 'textarea' }))).toBe(true);
    expect(isPlainStringFieldType(getFieldTypeString({ widget: 'textarea' }))).toBe(false);
    expect(isSlateFieldType(getFieldTypeString({ widget: 'slate' }))).toBe(true);
  });

  test('a declared type is never overridden', () => {
    expect(getFieldTypeString({ type: 'array', widget: 'select' })).toBe('array:select');
    expect(getFieldTypeString({ type: 'boolean' })).toBe('boolean');
    expect(getFieldTypeString({})).toBe('string');
  });
});

/**
 * A slate value always has a top node — the editor gives every slate field one
 * empty paragraph by default — so "nothing written" is that paragraph, not an
 * absent value. A renderer hiding an optional slate field asks this instead of
 * plain truthiness, which a one-node array always passes.
 */
describe('isEmptySlate', () => {
  test('the default empty paragraph is empty', () => {
    expect(isEmptySlate([{ type: 'p', children: [{ text: '' }] }])).toBe(true);
  });

  test('an empty paragraph carrying its node id is still empty', () => {
    expect(isEmptySlate([{ type: 'p', nodeId: 0, children: [{ text: '' }] }])).toBe(true);
  });

  test('absent, null and [] are empty — content saved before the default', () => {
    expect(isEmptySlate(undefined)).toBe(true);
    expect(isEmptySlate(null)).toBe(true);
    expect(isEmptySlate([])).toBe(true);
  });

  test('any text is content', () => {
    expect(isEmptySlate([{ type: 'p', children: [{ text: 'Roads closed' }] }])).toBe(false);
  });

  test('text inside an inline element is content', () => {
    expect(
      isEmptySlate([
        { type: 'p', children: [{ text: '' }, { type: 'link', children: [{ text: 'x' }] }, { text: '' }] },
      ]),
    ).toBe(false);
  });

  test('a zero-width space is content — it is what reveal renders so the field shows', () => {
    expect(isEmptySlate([{ type: 'p', children: [{ text: '​' }] }])).toBe(false);
  });

  test('a textless element that stands for something (an image, a rule) is content', () => {
    expect(isEmptySlate([{ type: 'img', url: '/a.png', children: [{ text: '' }] }])).toBe(false);
  });
});
