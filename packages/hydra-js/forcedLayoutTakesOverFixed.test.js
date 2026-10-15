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
