import { expandTemplatesSync } from '@volto-hydra/helpers';

describe('expandTemplatesSync: object_list arrays in template blocks', () => {
  let counter = 0;
  const uuidGenerator = () => `uuid-${++counter}`;

  beforeEach(() => {
    counter = 0;
  });

  const templateData = {
    '@id': '/templates/with-slider',
    blocks: {
      'header': {
        '@type': 'slate', fixed: true, placeholder: 'header',
        templateId: '/templates/with-slider', templateInstanceId: 'def-instance',
        value: [{ text: 'Header' }],
      },
      'slider-block': {
        '@type': 'slider', fixed: true, readOnly: true, placeholder: 'slider',
        templateId: '/templates/with-slider', templateInstanceId: 'def-instance',
        slides: [
          {
            '@id': 'tpl-slide-1', '@type': 'slide', fixed: true, readOnly: true,
            templateId: '/templates/with-slider', templateInstanceId: 'def-instance',
            title: 'Slide 1',
          },
          {
            '@id': 'tpl-slide-2', '@type': 'slide', fixed: true, readOnly: true,
            templateId: '/templates/with-slider', templateInstanceId: 'def-instance',
            title: 'Slide 2',
          },
        ],
      },
      'default-slot': {
        '@type': 'slate', placeholder: 'default',
        templateId: '/templates/with-slider', templateInstanceId: 'def-instance',
        value: [],
      },
    },
    blocks_layout: { items: ['header', 'slider-block', 'default-slot'] },
  };

  test('object_list arrays are fully expanded + instanced at apply time (data-derived re-entry)', () => {
    const pageBlocks = {
      'my-header': {
        '@type': 'slate', fixed: true,
        templateId: '/templates/with-slider', templateInstanceId: 'page-inst-1',
        value: [{ text: 'Header' }],
      },
      'my-slider': {
        '@type': 'slider', fixed: true, readOnly: true,
        templateId: '/templates/with-slider', templateInstanceId: 'page-inst-1',
        slides: [
          { '@id': 's1', '@type': 'slide', title: 'Page Slide 1',
            templateId: '/templates/with-slider', templateInstanceId: 'page-inst-1' },
          { '@id': 's2', '@type': 'slide', title: 'Page Slide 2',
            templateId: '/templates/with-slider', templateInstanceId: 'page-inst-1' },
        ],
      },
      'user-block': {
        '@type': 'slate',
        templateId: '/templates/with-slider', templateInstanceId: 'page-inst-1',
        placeholder: 'default',
        value: [{ text: 'User content' }],
      },
    };
    const pageLayout = ['my-header', 'my-slider', 'user-block'];
    const templates = { '/templates/with-slider': templateData };
    const templateState = {};

    // Step 1: Top-level expansion (like BlocksRenderer for main blocks_layout)
    const items = expandTemplatesSync(pageLayout, {
      blocks: pageBlocks,
      templates,
      templateState,
      uuidGenerator,
    });

    // Find the slider block in the result
    const sliderItem = items.find(item => item['@type'] === 'slider');
    expect(sliderItem).toBeDefined();
    expect(sliderItem.slides).toBeDefined();
    expect(sliderItem.slides.length).toBe(2);

    // Data-derived model: the slides are fully expanded + instanced at apply time —
    // each item carries the minted templateInstanceId, which is how re-entry (Step 2)
    // recognizes them. No object-identity nestedContainers registration.
    expect(sliderItem.slides[0].templateInstanceId).toBe('page-inst-1');

    // Step 2: Expand the slides (like a child BlocksRenderer for the object_list)
    const slideItems = expandTemplatesSync(sliderItem.slides, {
      templates,
      templateState,
      uuidGenerator,
      idField: '@id',
    });

    // Slides should come through with correct templateId and templateInstanceId
    expect(slideItems.length).toBe(2);
    expect(slideItems[0].templateId).toBe('/templates/with-slider');
    expect(slideItems[0].templateInstanceId).toBe('page-inst-1');
    expect(slideItems[0].title).toBe('Slide 1'); // template content wins (fixed)
    expect(slideItems[1].title).toBe('Slide 2');

    // Fixed and readOnly flags should be preserved from template
    expect(slideItems[0].fixed).toBe(true);
    expect(slideItems[0].readOnly).toBe(true);
    expect(slideItems[1].fixed).toBe(true);
    expect(slideItems[1].readOnly).toBe(true);
  });

  // object_list re-entry must NOT re-apply the template on a recognition miss
  // (proxy/clone). blocks_layout was fixed by not stamping templateId on nested
  // content; object_list items must KEEP templateId for detection (val[0]?.templateId),
  // so the fix is DATA-DRIVEN recognition: recognise an already-instanced object_list
  // array as content to render, not a reference to re-apply.
  test('object_list re-entry with a CLONED array (recognition miss) renders the items, not the whole template', () => {
    const pageBlocks = {
      'my-slider': {
        '@type': 'slider', fixed: true, readOnly: true,
        templateId: '/templates/with-slider', templateInstanceId: 'page-inst-1',
        slides: [
          { '@id': 's1', '@type': 'slide', title: 'Page Slide 1',
            templateId: '/templates/with-slider', templateInstanceId: 'page-inst-1' },
          { '@id': 's2', '@type': 'slide', title: 'Page Slide 2',
            templateId: '/templates/with-slider', templateInstanceId: 'page-inst-1' },
        ],
      },
    };
    const templates = { '/templates/with-slider': templateData };
    const templateState = {};

    const items = expandTemplatesSync(['my-slider'], {
      blocks: pageBlocks, templates, templateState, uuidGenerator,
    });
    const slider = items.find((i) => i['@type'] === 'slider');
    expect(slider.slides.length).toBe(2);

    // The renderer re-enters the slides, but across the per-level call boundary the
    // array arrives as a Vue proxy / serialized copy, so the reference-keyed
    // nestedContainers lookup MISSES (the same class of bug as the blocks_layout
    // loop). Model that with a clone + the SAME templateState.
    const clonedSlides = JSON.parse(JSON.stringify(slider.slides));
    const slideItems = expandTemplatesSync(clonedSlides, {
      templates, templateState, uuidGenerator, idField: '@id',
    });

    // Must render the two SLIDES — not re-apply the whole with-slider template
    // (which would emit header/slider/default and recurse).
    expect(slideItems.length).toBe(2);
    expect(slideItems.every((s) => s['@type'] === 'slide')).toBe(true);
  });

  // Regression for template-advanced :203, via the UNIFORM data-derived check (no
  // idField special-casing). templateState is ONE object for the whole render and is
  // never reset mid-render, so by the time the slider re-enters, the top-level apply's
  // instance is still live in templateState.instances — the SAME "minted this pass"
  // recognition blocks_layout uses. It passes through as content, without re-applying.
  test('object_list re-entry passes through when its instance is live in templateState (no re-apply)', () => {
    const slides = [
      { '@id': 's1', '@type': 'slide', templateId: '/t/slider', templateInstanceId: 'inst-1', title: 'Slide 1' },
      { '@id': 's2', '@type': 'slide', templateId: '/t/slider', templateInstanceId: 'inst-1', title: 'Slide 2' },
    ];
    // Instance minted this pass and the shared state was NOT wiped. NO templates: a
    // re-apply would throw "not found" — so passing through is what's asserted.
    const templateState = { instances: { 'inst-1': {} } };
    const result = expandTemplatesSync(slides, {
      templates: {}, templateState, idField: '@id',
    });
    expect(result.length).toBe(2);
    expect(result.every((s) => s['@type'] === 'slide')).toBe(true);
    expect(result[0].templateInstanceId).toBe('inst-1');
  });
});

describe('expandTemplatesSync: object_list items must carry their id', () => {
  // Items without an id all map to `@uid: undefined`, collapse onto the last
  // one, and a whole table renders its last cell everywhere. Fail loudly instead.
  const rows = [
    { '@type': 'row', cells: [] },
    { '@type': 'row', cells: [] },
  ];

  test.each([false, true])('throws on an item with no idField value (editMode=%s)', (editMode) => {
    expect(() => expandTemplatesSync(rows, {
      templateState: {}, templates: {}, idField: 'key', editMode,
    })).toThrow(/no "key"/);
  });

  test('keeps items that have their id', () => {
    const keyed = [{ '@type': 'row', key: 'r1' }, { '@type': 'row', key: 'r2' }];
    const out = expandTemplatesSync(keyed, { templateState: {}, templates: {}, idField: 'key', editMode: false });
    expect(out.map((r) => r['@uid'])).toEqual(['r1', 'r2']);
  });
});
