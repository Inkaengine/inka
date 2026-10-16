/**
 * A forced layout takes over the page's blocks: one that names a slot goes in
 * that slot, the rest go in `default`.
 *
 * A forced layout's instance is minted when the page renders, so a page that
 * has never been through the layout can't carry its instance id. Its blocks
 * still say where they belong — the layout and the slot. An editable FIXED slot
 * (a heading the layout always has, but the page may edit) took over a page
 * block only when that block came from a DIFFERENT layout (a switch); a page
 * block marked for THIS layout went to the slot's pending content, which a
 * fixed slot never reads, and was dropped — the page's own heading lost, the
 * layout's default drawn in its place.
 */
import { expandTemplatesSync } from '@volto-hydra/helpers';

const LAYOUT = '/templates/plain';

const TEMPLATE = {
  '@id': LAYOUT,
  blocks: {
    frame: {
      '@type': 'frame',
      fixed: true,
      readOnly: true,
      slotId: 'frame',
      blocks: {
        h0: { '@type': 'title', fixed: true, slotId: 'heading' },
        m0: { '@type': 'slate', slotId: 'default', value: [] },
      },
      blocks_layout: { heading: ['h0'], main: ['m0'] },
    },
  },
  blocks_layout: { items: ['frame'] },
};

function expand(blocks, items) {
  const out = expandTemplatesSync(items, {
    blocks,
    templateState: {},
    templates: { [LAYOUT]: TEMPLATE },
    allowedLayouts: [LAYOUT],
  });
  return out;
}

// A template that owns a form outright: pages store a reference; the form's
// content comes from here on every render.
const FORM_TEMPLATE = {
  '@id': '/templates/rap',
  blocks: {
    'rap-form': { '@type': 'form', title: 'Report a problem', fixed: true, readOnly: true, slotId: 'form' },
  },
  blocks_layout: { items: ['rap-form'] },
};

const region = (container, name) =>
  container.blocks_layout[name].map((id) => ({ id, ...container.blocks[id] }));

describe('a forced layout takes over the page', () => {
  test("a page's fixed block marked for a slot fills that slot, keeping its id and edits", () => {
    const blocks = {
      'page-title': {
        '@type': 'title',
        templateId: LAYOUT,
        slotId: 'heading',
        fixed: true,
        heading: 'Its own heading',
      },
      body: { '@type': 'slate', value: [{ type: 'p', children: [{ text: 'Body' }] }] },
    };
    const out = expand(blocks, ['page-title', 'body']);

    expect(out).toHaveLength(1);
    const [heading] = region(out[0], 'heading');
    expect(heading.id).toBe('page-title');
    expect(heading.heading).toBe('Its own heading');
    expect(region(out[0], 'main').map((b) => b.id)).toEqual(['body']);
  });

  test('a page block without a slot goes in default, inside the layout', () => {
    const blocks = { body: { '@type': 'slate', value: [] } };
    const out = expand(blocks, ['body']);

    expect(out).toHaveLength(1);
    expect(region(out[0], 'main').map((b) => b.id)).toEqual(['body']);
    // The layout's own heading, since the page has none of its own.
    expect(region(out[0], 'heading')).toHaveLength(1);
  });

  test('the same page expands the same way twice', () => {
    const blocks = {
      'page-title': { '@type': 'title', templateId: LAYOUT, slotId: 'heading', fixed: true },
      body: { '@type': 'slate', value: [] },
    };
    const ids = (out) => [
      ...region(out[0], 'heading').map((b) => b.id),
      ...region(out[0], 'main').map((b) => b.id),
    ];
    expect(ids(expand(blocks, ['page-title', 'body']))).toEqual(
      ids(expand(blocks, ['page-title', 'body'])),
    );
  });
});

describe("a forced layout keeps a snippet the page inserted", () => {
  // A template the page inserted — a snippet, or a template-owned form whose
  // questions come from the template on every render — leaves blocks marked
  // with ITS template. Not leftovers of the page's previous layout (the
  // template of its first templated block): the page's content, kept in
  // default as a NESTED template reference, marks and all, so it still
  // expands as its template.
  test("the snippet's blocks go in default, as its own template", () => {
    const blocks = {
      'page-title': { '@type': 'title', templateId: LAYOUT, slotId: 'heading', fixed: true },
      'snip-form': {
        '@type': 'form',
        templateId: '/templates/a-snippet',
        templateInstanceId: 'snip-1',
        slotId: 'form',
        fixed: true,
        readOnly: true,
      },
      body: { '@type': 'slate', value: [] },
    };
    const SNIPPET = {
      '@id': '/templates/a-snippet',
      blocks: { form: { '@type': 'form', title: 'From the snippet', fixed: true, readOnly: true, slotId: 'form' } },
      blocks_layout: { items: ['form'] },
    };
    const out = expandTemplatesSync(['page-title', 'snip-form', 'body'], {
      blocks,
      templateState: {},
      templates: { [LAYOUT]: TEMPLATE, '/templates/a-snippet': SNIPPET },
      allowedLayouts: [LAYOUT, '/templates/other-layout'],
    });
    expect(out).toHaveLength(1);
    const main = region(out[0], 'main');
    expect(main.map((b) => b.id)).toEqual(['snip-form', 'body']);
    expect(main[0].templateId).toBe('/templates/a-snippet');
    expect(main[0].templateInstanceId).toBe('snip-1');
    expect(main[0].title).toBe('From the snippet');
    expect(region(out[0], 'heading').map((b) => b.id)).toEqual(['page-title']);
  });
});

describe('a nested template in a layout slot survives a save', () => {
  // After an editor save the page stores the layout instance; a template the
  // page inserted sits in one of its regions under its own instance. The next
  // expansion collected only this instance's blocks and dropped it.
  test("it stays in its region's slot, in order", () => {
    const blocks = {
      'inst::frame': {
        '@type': 'frame',
        fixed: true,
        readOnly: true,
        slotId: 'frame',
        templateId: LAYOUT,
        templateInstanceId: 'inst',
        blocks: {
          'page-title': { '@type': 'title', templateId: LAYOUT, templateInstanceId: 'inst', slotId: 'heading', fixed: true },
          rap: { '@type': 'form', templateId: '/templates/rap', templateInstanceId: 'rap-a', slotId: 'form', fixed: true, readOnly: true },
          body: { '@type': 'slate', templateId: LAYOUT, templateInstanceId: 'inst', slotId: 'default', value: [] },
        },
        blocks_layout: { heading: ['page-title'], main: ['rap', 'body'] },
      },
    };
    const out = expandTemplatesSync(['inst::frame'], {
      blocks,
      templateState: {},
      templates: { [LAYOUT]: TEMPLATE, '/templates/rap': FORM_TEMPLATE },
      allowedLayouts: [LAYOUT],
    });
    const main = region(out[0], 'main');
    expect(main.map((b) => b.id)).toEqual(['rap', 'body']);
    expect(main[0].templateId).toBe('/templates/rap');
    expect(main[0].templateInstanceId).toBe('rap-a');
  });
});

describe('a nested template in a layout slot is expanded in the same pass', () => {
  // The admin merges once and the editor frame does not expand again, so a
  // nested reference left unexpanded showed a form with no questions while
  // editing. Expanded where it is placed, both paths get it.
  const formRef = { '@type': 'form', templateId: '/templates/rap', templateInstanceId: 'rap-a', slotId: 'form', fixed: true, readOnly: true };

  test('on first application', () => {
    const out = expandTemplatesSync(['page-title', 'rap', 'body'], {
      blocks: {
        'page-title': { '@type': 'title', templateId: LAYOUT, slotId: 'heading', fixed: true },
        rap: formRef,
        body: { '@type': 'slate', value: [] },
      },
      templateState: {},
      templates: { [LAYOUT]: TEMPLATE, '/templates/rap': FORM_TEMPLATE },
      allowedLayouts: [LAYOUT],
    });
    const [form] = region(out[0], 'main');
    expect(form.title).toBe('Report a problem');
    expect(form.templateId).toBe('/templates/rap');
    // The layout's own state is untouched by the nested expansion.
    expect(region(out[0], 'heading').map((b) => b.id)).toEqual(['page-title']);
  });

  test('after a save', () => {
    const out = expandTemplatesSync(['inst::frame'], {
      blocks: {
        'inst::frame': {
          '@type': 'frame', fixed: true, readOnly: true, slotId: 'frame', templateId: LAYOUT, templateInstanceId: 'inst',
          blocks: {
            'page-title': { '@type': 'title', templateId: LAYOUT, templateInstanceId: 'inst', slotId: 'heading', fixed: true },
            rap: formRef,
          },
          blocks_layout: { heading: ['page-title'], main: ['rap'] },
        },
      },
      templateState: {},
      templates: { [LAYOUT]: TEMPLATE, '/templates/rap': FORM_TEMPLATE },
      allowedLayouts: [LAYOUT],
    });
    const [form] = region(out[0], 'main');
    expect(form.title).toBe('Report a problem');
  });
});

describe('a nested template of several blocks is expanded as one', () => {
  // A page built on a multi-block template (fixed section headings with slots
  // between them) sits in the forced layout's slot as a run of blocks of ONE
  // instance. Expanded block by block, each call saw one block of the
  // template: its fixed headings were lost and its slots ran together.
  const DOC = {
    '@id': '/templates/doc',
    blocks: {
      'ex-h': { '@type': 'slate', fixed: true, readOnly: true, slotId: 'ex-h', value: [{ type: 'h2', children: [{ text: 'Example' }] }] },
      ex: { '@type': 'slate', slotId: 'example', value: [] },
      'rel-h': { '@type': 'slate', fixed: true, readOnly: true, slotId: 'rel-h', value: [{ type: 'h2', children: [{ text: 'Related' }] }] },
      rel: { '@type': 'slate', slotId: 'related', value: [] },
    },
    blocks_layout: { items: ['ex-h', 'ex', 'rel-h', 'rel'] },
  };
  const mark = (slotId, extra = {}) => ({ templateId: '/templates/doc', templateInstanceId: 'doc-1', slotId, ...extra });

  test("the template's fixed headings stay between its slots", () => {
    const out = expandTemplatesSync(['page-title', 'd-exh', 'd-ex', 'd-relh', 'd-rel'], {
      blocks: {
        'page-title': { '@type': 'title', templateId: LAYOUT, slotId: 'heading', fixed: true, readOnly: false },
        'd-exh': { '@type': 'slate', ...mark('ex-h', { fixed: true, readOnly: true }) },
        'd-ex': { '@type': 'slate', value: [{ type: 'p', children: [{ text: 'An example' }] }], ...mark('example') },
        'd-relh': { '@type': 'slate', ...mark('rel-h', { fixed: true, readOnly: true }) },
        'd-rel': { '@type': 'slate', value: [{ type: 'p', children: [{ text: 'A link' }] }], ...mark('related') },
      },
      templateState: {},
      templates: { [LAYOUT]: TEMPLATE, '/templates/doc': DOC },
      allowedLayouts: [LAYOUT],
    });
    const main = region(out[0], 'main');
    expect(main.map((b) => b.slotId)).toEqual(['ex-h', 'example', 'rel-h', 'related']);
    expect(main[2].value[0].children[0].text).toBe('Related');
  });
});
