import { expandTemplatesSync } from '@volto-hydra/helpers';

/**
 * A layout template's nav that each page can make its own, while every page
 * that does nothing keeps the template's.
 *
 * The shape: a fixed, readOnly layout whose `aside` region holds the nav and
 * whose `main` region is the page's `default` slot. The nav is FIXED but not
 * readOnly: it stays where the template puts it, and a page may change its own
 * fields (its title). Its list is a SLOT whose template block is the default
 * list: a page with nothing in the slot is drawn with it; a page that puts its
 * own items in the slot is drawn with those.
 */
const TPL = '/templates/with-aside';
const tpl = (block) => ({ ...block, templateId: TPL });
const template = {
  '@id': TPL,
  blocks: {
    layout0: tpl({
      '@type': 'sidebarLayout',
      fixed: true,
      readOnly: true,
      slotId: 'layout0',
      blocks: {
        nav0: tpl({
          '@type': 'nav',
          title: 'In this section',
          fixed: true,
          readOnly: false,
          slotId: 'aside',
          blocks: {
            l0: tpl({
              '@type': 'listing',
              variation: 'links',
              querystring: { query: [{ i: 'path', o: 'plone.app.querystring.operation.string.relativePath', v: '..' }] },
              fixed: false,
              slotId: 'list',
            }),
          },
          blocks_layout: { items: ['l0'] },
        }),
        m0: tpl({ '@type': 'slate', fixed: false, slotId: 'default', value: [{ type: 'p', children: [{ text: '' }] }] }),
      },
      blocks_layout: { aside: ['nav0'], main: ['m0'] },
    }),
  },
  blocks_layout: { items: ['layout0'] },
};

const inst = (block) => ({ ...block, templateId: TPL, templateInstanceId: 'i1' });

// The page as it stores its instance: the layout, and inside it whatever the
// page has of its own — here a body paragraph, and optionally its nav.
const page = (nav) => ({
  layout: inst({
    '@type': 'sidebarLayout',
    fixed: true,
    readOnly: true,
    slotId: 'layout0',
    blocks: {
      ...(nav ? { nav } : {}),
      body: inst({ '@type': 'slate', slotId: 'default', value: [{ type: 'p', children: [{ text: 'Body' }] }] }),
    },
    blocks_layout: { aside: nav ? ['nav'] : [], main: ['body'] },
  }),
});

const expand = (blocks) =>
  expandTemplatesSync(['layout'], {
    blocks,
    templates: { [TPL]: template },
    templateState: {},
    editMode: false,
  });

const region = (block, name) => (block.blocks_layout?.[name] || []).map((id) => block.blocks[id]);
const navOf = (blocks) => {
  const [layout] = expand(blocks);
  const [nav] = region(layout, 'aside');
  return { layout, nav };
};

test('a page that changes nothing gets the template nav and its default list', () => {
  const { layout, nav } = navOf(page(null));
  expect(nav['@type']).toBe('nav');
  expect(nav.title).toBe('In this section');
  const list = region(nav, 'items');
  expect(list.map((b) => b['@type'])).toEqual(['listing']);
  expect(list[0].querystring.query[0].v).toBe('..');
  expect(region(layout, 'main').map((b) => b.value[0].children[0].text)).toEqual(['Body']);
});

test('a page that renames the nav and fills its list slot gets its own', () => {
  const { layout, nav } = navOf(
    page(
      inst({
        '@type': 'nav',
        slotId: 'aside',
        fixed: true,
        readOnly: false,
        title: 'Our Reports',
        blocks: {
          g1: inst({ '@type': 'linkGroup', title: '2025-26', slotId: 'list' }),
          g2: inst({ '@type': 'linkGroup', title: '2024-25', slotId: 'list' }),
        },
        blocks_layout: { items: ['g1', 'g2'] },
      }),
    ),
  );
  expect(nav.title).toBe('Our Reports');
  expect(region(nav, 'items').map((b) => [b['@type'], b.title])).toEqual([
    ['linkGroup', '2025-26'],
    ['linkGroup', '2024-25'],
  ]);
  expect(region(layout, 'main').map((b) => b.value[0].children[0].text)).toEqual(['Body']);
});
