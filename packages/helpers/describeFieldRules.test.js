/**
 * What an agent is told about a block's fieldRules (inka#595).
 *
 * An UNCONDITIONAL rule needs no telling: a field hidden by `false` is already
 * absent from the resolved schema, and a bare `set` is already in the
 * definition the agent reads. What the resolved schema cannot show is anything
 * CONDITIONAL — the schema is resolved once, against no data, so:
 *
 *   - a field that appears only when another field is set is simply missing,
 *     and an agent has no way to learn it exists;
 *   - a rule that will REFUSE the save, or advise against a value, is invisible
 *     until it fires.
 *
 * The editor carries this in code and in UI labels; an agent has neither
 * channel, so it has to be said in the description.
 */
import {
  createFieldRulesEnhancer,
  collectFieldRules,
  describeFieldRules,
} from './fieldRules.js';

describe('the rules a block declares can be read back off its enhancer', () => {
  test('an enhancer carries the rules it was built from', () => {
    const rules = { advancedOptions: { when: { mode: 'advanced' }, else: false } };
    expect(collectFieldRules(createFieldRulesEnhancer(rules))).toEqual(rules);
  });

  test('a composed enhancer yields every part its rules', () => {
    // blockSync composes a frontend recipe with the admin's own enhancer and
    // records the parts on `_parts`; rules declared in either must be found.
    const first = createFieldRulesEnhancer({ 'querystring.b_size': false });
    const second = createFieldRulesEnhancer({ headline: { when: { mode: 'x' }, else: false } });
    const composed = (args) => args.schema;
    composed._parts = [first, second];

    expect(collectFieldRules(composed)).toEqual({
      'querystring.b_size': false,
      headline: { when: { mode: 'x' }, else: false },
    });
  });

  test('an enhancer that is not a fieldRules one contributes nothing', () => {
    const other = (args) => args.schema;
    other.config = { enhancerType: 'inheritSchemaFrom' };
    expect(collectFieldRules(other)).toEqual({});
    expect(collectFieldRules(undefined)).toEqual({});
  });
});

describe('a field whose visibility depends on the data', () => {
  test('a field shown only when a condition holds says so', () => {
    expect(
      describeFieldRules({
        advancedOptions: { when: { mode: 'advanced' }, else: false },
      }),
    ).toEqual({ advancedOptions: { shownWhen: [{ mode: 'advanced' }] } });
  });

  test('a switch hiding otherwise lists every condition that shows it', () => {
    // `[{ when: A }, { when: B }, false]` — shown on A or B, hidden otherwise.
    expect(
      describeFieldRules({
        extra: [{ when: { mode: 'a' } }, { when: { mode: 'b' } }, false],
      }),
    ).toEqual({ extra: { shownWhen: [{ mode: 'a' }, { mode: 'b' }] } });
  });

  test('a switch that hides nothing leaves visibility alone', () => {
    // No branch yields `false`, so no match just keeps the field as it is.
    expect(
      describeFieldRules({
        title: [{ when: { mode: 'a' }, set: { title: 'A' } }],
      }),
    ).toEqual({});
  });

  test('`else` holding a definition rather than false is not a hide', () => {
    expect(
      describeFieldRules({
        title: { when: { mode: 'a' }, set: { title: 'A' }, else: { title: 'B' } },
      }),
    ).toEqual({});
  });
});

describe('a rule that refuses a value, and one that only advises', () => {
  test('an error is reported with the condition that raises it', () => {
    expect(
      describeFieldRules({
        maxItems: {
          when: { maxItems: { isSet: true, lt: { field: 'minItems' } } },
          error: 'The maximum is below the minimum.',
        },
      }),
    ).toEqual({
      maxItems: {
        errors: [
          {
            when: { maxItems: { isSet: true, lt: { field: 'minItems' } } },
            message: 'The maximum is below the minimum.',
          },
        ],
      },
    });
  });

  test('a warning is reported apart from an error, because it does not block', () => {
    expect(
      describeFieldRules({
        image: { when: { image: { regex: '\\.png$' } }, warning: 'Should be an SVG.' },
      }),
    ).toEqual({
      image: {
        warnings: [{ when: { image: { regex: '\\.png$' } }, message: 'Should be an SVG.' }],
      },
    });
  });

  test('a switch can refuse one case and advise on another', () => {
    expect(
      describeFieldRules({
        image: [
          { when: { image: { regex: '\\.exe$' } }, error: 'Not an image.' },
          { when: { image: { regex: '\\.png$' } }, warning: 'Prefer an SVG.' },
        ],
      }),
    ).toEqual({
      image: {
        errors: [{ when: { image: { regex: '\\.exe$' } }, message: 'Not an image.' }],
        warnings: [{ when: { image: { regex: '\\.png$' } }, message: 'Prefer an SVG.' }],
      },
    });
  });

  test('an unconditional error is reported without a condition', () => {
    expect(describeFieldRules({ legacy: { error: 'This field is retired.' } })).toEqual({
      legacy: { errors: [{ message: 'This field is retired.' }] },
    });
  });

  test('a rule both redefining and refusing reports the refusal', () => {
    expect(
      describeFieldRules({
        maxItems: { when: { maxItems: { lt: 1 } }, set: { title: 'Max' }, error: 'Too few.' },
      }),
    ).toEqual({
      maxItems: {
        errors: [{ when: { maxItems: { lt: 1 } }, message: 'Too few.' }],
      },
    });
  });
});

describe('what is deliberately not reported', () => {
  test('a field hidden outright is not reported, being absent from the schema', () => {
    expect(describeFieldRules({ 'querystring.b_size': false })).toEqual({});
  });

  test('an unconditional redefinition is not reported, being in the schema already', () => {
    expect(
      describeFieldRules({
        fieldMapping: { set: { title: 'Field Mapping', widget: 'field_mapping' } },
      }),
    ).toEqual({});
  });

  test('a bare field definition is not reported', () => {
    expect(describeFieldRules({ title: { title: 'Heading', widget: 'text' } })).toEqual({});
  });

  test('no rules at all describes nothing', () => {
    expect(describeFieldRules({})).toEqual({});
    expect(describeFieldRules(undefined)).toEqual({});
  });
});

describe('a nested field path keeps the path it was declared under', () => {
  test('a dotted key is reported as declared', () => {
    expect(
      describeFieldRules({
        'querystring.sort_on': { when: { mode: 'manual' }, else: false },
      }),
    ).toEqual({ 'querystring.sort_on': { shownWhen: [{ mode: 'manual' }] } });
  });
});

describe('an operand that is `undefined` is no constraint, and cannot be JSON', () => {
  // Verified against the evaluator: `{ linkMode: undefined }` is TRUE whatever
  // linkMode holds — an undefined operand is not "is unset", it is no
  // comparison at all. It also cannot survive postMessage: JSON.stringify
  // turns `{ when: { linkMode: undefined } }` into `{ "when": {} }`, which
  // would read as "no condition" by luck rather than by rule.
  test('a branch whose whole condition is undefined operands always matches', () => {
    // The live site writes exactly this on its button block, meaning "show the
    // link field when the mode is 'link' or not chosen yet". The second branch
    // in fact matches always, so the trailing `false` is unreachable and the
    // field is never hidden — which is what has to be reported.
    expect(
      describeFieldRules({
        href: [{ when: { linkMode: 'link' } }, { when: { linkMode: undefined } }, false],
      }),
    ).toEqual({});
  });

  test('an undefined operand is dropped from a condition that still constrains', () => {
    expect(
      describeFieldRules({
        extra: { when: { mode: 'advanced', unused: undefined }, else: false },
      }),
    ).toEqual({ extra: { shownWhen: [{ mode: 'advanced' }] } });
  });

  test('an undefined operator inside an operators object is dropped too', () => {
    expect(
      describeFieldRules({
        extra: { when: { mode: { is: undefined } }, else: false },
      }),
    ).toEqual({});
  });

  test('a sibling branch that does constrain is still reported', () => {
    expect(
      describeFieldRules({
        searchPath: [{ when: { linkMode: 'search' } }, false],
      }),
    ).toEqual({ searchPath: { shownWhen: [{ linkMode: 'search' }] } });
  });

  test('an error whose condition is empty is reported as unconditional', () => {
    expect(
      describeFieldRules({ legacy: { when: { gone: undefined }, error: 'Retired.' } }),
    ).toEqual({ legacy: { errors: [{ message: 'Retired.' }] } });
  });

  test('every reported rule survives a JSON round trip', () => {
    const described = describeFieldRules({
      href: [{ when: { linkMode: 'link' } }, { when: { linkMode: undefined } }, false],
      searchPath: [{ when: { linkMode: 'search' } }, false],
      maxItems: { when: { maxItems: { lt: { field: 'minItems' } } }, error: 'Too few.' },
    });
    expect(JSON.parse(JSON.stringify(described))).toEqual(described);
  });
});

describe('rules declared as a recipe, before anything converts them', () => {
  // The admin converts a frontend recipe into an enhancer function before it
  // reaches blocksConfig (View.jsx), but getResolvedSchema also accepts a raw
  // recipe. Reading only functions would silently report no rules for one.
  test('a recipe object yields its rules', () => {
    expect(
      collectFieldRules({ fieldRules: { extra: { when: { mode: 'a' }, else: false } } }),
    ).toEqual({ extra: { when: { mode: 'a' }, else: false } });
  });

  test('an array of recipes yields all of their rules, in order', () => {
    expect(
      collectFieldRules([
        { inheritSchemaFrom: { mappingField: 'fieldMapping' } },
        { fieldRules: { a: false } },
        { fieldRules: { b: false } },
      ]),
    ).toEqual({ a: false, b: false });
  });

  test('a recipe with no fieldRules yields nothing', () => {
    expect(collectFieldRules({ inheritSchemaFrom: { mappingField: 'x' } })).toEqual({});
  });
});
