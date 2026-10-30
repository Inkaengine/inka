/**
 * The merge's rules (docs/frontend-guide/templates.md "How the Merge Works"),
 * each one checked wherever a template's blocks can sit, and in both directions.
 *
 * Where: the page's own region, a region inside a container, and an object_list.
 * The rules are the same in all three: a region is a region.
 *
 * Direction: opening a page merges its template into it; "Change on all pages"
 * merges the page's instance into its template. The same rules, the other way
 * round: the target keeps its ids and what is its own, the source brings the rest.
 */
import { describe, test, expect } from 'vitest';
import { mergeTemplatesIntoPage, mergeInstanceIntoTemplate } from './mergeTemplates.mjs';

const T = '/templates/t';
const idFieldMap = { slider: { slides: '@id' } };

// A region's blocks as [{ id, slot, fixed, readOnly, text }], in order.
const spec = (id, slot, text, { fixed = false, readOnly = false } = {}) => ({ id, slot, text, fixed, readOnly });
const HEAD = spec('head', 'head', 'Template head', { fixed: true, readOnly: true });
const INTRO = spec('intro', 'intro', 'Template intro', { fixed: true });
const MAIN = spec('main', 'main', 'Template placeholder');
const FOOT = spec('foot', 'foot', 'Template foot', { fixed: true, readOnly: true });
const STRUCTURE = [HEAD, INTRO, MAIN, FOOT];

const blockOf = ({ slot, text, fixed, readOnly }, extra = {}) => ({
  templateId: T,
  slotId: slot,
  ...(fixed && { fixed }),
  ...(readOnly && { readOnly }),
  text,
  ...extra,
});

/** Where a template's blocks sit, and how to read and write that region. */
const WHERE = {
  "the page's own region": {
    build: (entries, extra) => ({
      blocks: Object.fromEntries(entries.map((e) => [e.id, { '@type': 'item', ...blockOf(e, extra) }])),
      blocks_layout: { items: entries.map((e) => e.id) },
    }),
    read: (doc) => doc.blocks_layout.items.map((id) => ({ id, block: doc.blocks[id] })),
    write: (doc, entries) => ({
      ...doc,
      blocks: {
        ...Object.fromEntries(Object.entries(doc.blocks).filter(([id]) => !doc.blocks_layout.items.includes(id))),
        ...Object.fromEntries(entries.map(({ id, block }) => [id, block])),
      },
      blocks_layout: { ...doc.blocks_layout, items: entries.map(({ id }) => id) },
    }),
  },
  'a region inside a container': {
    build: (entries, extra) => ({
      blocks: {
        box: {
          '@type': 'box',
          ...blockOf(spec('box', 'box', '', { fixed: true, readOnly: true }), extra),
          blocks: Object.fromEntries(entries.map((e) => [e.id, { '@type': 'item', ...blockOf(e, extra) }])),
          blocks_layout: { items: entries.map((e) => e.id) },
        },
      },
      blocks_layout: { items: ['box'] },
    }),
    container: (doc) => doc.blocks_layout.items.find((id) => doc.blocks[id]['@type'] === 'box'),
    read(doc) {
      const box = doc.blocks[this.container(doc)];
      return box.blocks_layout.items.map((id) => ({ id, block: box.blocks[id] }));
    },
    write(doc, entries) {
      const boxId = this.container(doc);
      const box = doc.blocks[boxId];
      return {
        ...doc,
        blocks: {
          ...doc.blocks,
          [boxId]: {
            ...box,
            blocks: Object.fromEntries(entries.map(({ id, block }) => [id, block])),
            blocks_layout: { items: entries.map(({ id }) => id) },
          },
        },
      };
    },
  },
  'an object_list': {
    build: (entries, extra) => ({
      blocks: {
        slider: {
          '@type': 'slider',
          ...blockOf(spec('slider', 'slider', '', { fixed: true, readOnly: true }), extra),
          slides: entries.map((e) => ({ '@id': e.id, '@type': 'slide', ...blockOf(e, extra) })),
        },
      },
      blocks_layout: { items: ['slider'] },
    }),
    container: (doc) => doc.blocks_layout.items.find((id) => doc.blocks[id]['@type'] === 'slider'),
    read(doc) {
      return doc.blocks[this.container(doc)].slides.map((block) => ({ id: block['@id'], block }));
    },
    write(doc, entries) {
      const id = this.container(doc);
      return {
        ...doc,
        blocks: {
          ...doc.blocks,
          [id]: { ...doc.blocks[id], slides: entries.map(({ id: itemId, block }) => ({ ...block, '@id': itemId })) },
        },
      };
    },
  },
};

// Stored templates come both ways: some carry their definition's instance id, some don't.
const STORED = {
  'with an instance id': { templateInstanceId: 'definition' },
  'without an instance id': {},
};

const template = (where, structure = STRUCTURE, stored = STORED['with an instance id']) => ({
  '@id': T,
  ...WHERE[where].build(structure, stored),
});

/** A region as a person sees it: each block's slot and text, in order. */
const seen = (where, doc) => WHERE[where].read(doc).map(({ block }) => [block.slotId, block.text]);
const ids = (where, doc) => WHERE[where].read(doc).map(({ id }) => id);

let count = 0;
const uuidGenerator = () => `uuid-${++count}`;

/** Open a page that uses the template, as the editor does: the template merged in. */
async function open(page, tpl) {
  const { merged } = await mergeTemplatesIntoPage(page, {
    loadTemplate: async () => tpl,
    pageBlocksFields: { items: { allowedLayouts: [T] } },
    uuidGenerator,
    idFieldMap,
  });
  return merged;
}

const EMPTY_PAGE = { '@id': '/p', blocks: {}, blocks_layout: { items: [] } };

const instanceOf = (doc) => Object.values(doc.blocks).find((b) => b.templateInstanceId)?.templateInstanceId;

/**
 * A page that has used the template for a while: its own content in the slot, its
 * own version of the editable block, and a stale copy of a locked one.
 */
async function usedPage(where, tpl = template(where)) {
  const opened = await open(EMPTY_PAGE, tpl);
  const instance = instanceOf(opened);
  const own = (id, text) => ({
    id,
    block: {
      '@type': where === 'an object_list' ? 'slide' : 'item',
      ...(where === 'an object_list' && { '@id': id }),
      templateId: T,
      templateInstanceId: instance,
      slotId: 'main',
      text,
    },
  });
  // The slot's content goes after the intro, where the slot is, whether or not
  // the empty slot was emitted.
  const region = WHERE[where].read(opened).flatMap((entry) => {
    if (entry.block.slotId === 'main') return [];
    if (entry.block.slotId === 'intro') {
      return [{ ...entry, block: { ...entry.block, text: 'Page intro' } }, own('m1', 'Page main 1'), own('m2', 'Page main 2')];
    }
    if (entry.block.slotId === 'head') return [{ ...entry, block: { ...entry.block, text: 'Stale head' } }];
    return [entry];
  });
  return WHERE[where].write(opened, region);
}

for (const where of Object.keys(WHERE)) {
  describe(`opening a page: ${where}`, () => {
    test('a page new to the template gets its blocks, in order, an empty slot as the slot block', async () => {
      const opened = await open(EMPTY_PAGE, template(where));
      expect(seen(where, opened)).toEqual([
        ['head', 'Template head'],
        ['intro', 'Template intro'],
        ['main', 'Template placeholder'],
        ['foot', 'Template foot'],
      ]);
    });

    test("every block new to the page gets a uid from the editor's generator", async () => {
      const opened = await open(EMPTY_PAGE, template(where));
      for (const id of ids(where, opened)) expect(id).toMatch(/^uuid-\d+$/);
    });

    test('opening it again gives the same ids', async () => {
      const once = await open(EMPTY_PAGE, template(where));
      const twice = await open(once, template(where));
      expect(ids(where, twice)).toEqual(ids(where, once));
    });

    test("the page's own content stays in its slot, its edits to an editable block stay, a locked block is the template's", async () => {
      const page = await usedPage(where);
      const opened = await open(page, template(where));
      expect(seen(where, opened)).toEqual([
        ['head', 'Template head'],
        ['intro', 'Page intro'],
        ['main', 'Page main 1'],
        ['main', 'Page main 2'],
        ['foot', 'Template foot'],
      ]);
      // Every block the page had keeps its id.
      expect(ids(where, opened)).toEqual(ids(where, page));
    });

    test('a block added to the template appears; every other block keeps its id', async () => {
      const page = await usedPage(where);
      const NOTE = spec('note', 'note', 'Template note', { fixed: true, readOnly: true });
      const opened = await open(page, template(where, [HEAD, INTRO, MAIN, FOOT, NOTE]));
      expect(seen(where, opened).at(-1)).toEqual(['note', 'Template note']);
      expect(ids(where, opened).slice(0, -1)).toEqual(ids(where, page));
    });

    test('two locked blocks sharing a slot name keep their own ids and text', async () => {
      const DECO1 = spec('deco-1', 'deco', 'Deco one', { fixed: true, readOnly: true });
      const DECO2 = spec('deco-2', 'deco', 'Deco two', { fixed: true, readOnly: true });
      const tpl = template(where, [HEAD, DECO1, DECO2, MAIN, FOOT]);
      const once = await open(EMPTY_PAGE, tpl);
      const twice = await open(once, tpl);
      expect(seen(where, twice).filter(([slot]) => slot === 'deco')).toEqual([['deco', 'Deco one'], ['deco', 'Deco two']]);
      expect(new Set(ids(where, twice)).size).toBe(ids(where, twice).length);
      expect(ids(where, twice)).toEqual(ids(where, once));
    });

    test('content whose slot the template no longer has goes to its default slot, in its own region', async () => {
      const page = await usedPage(where);
      const BODY = spec('body', 'body', 'Template body');
      const DEFAULT = spec('default', 'default', 'Template default');
      const opened = await open(page, template(where, [HEAD, INTRO, BODY, DEFAULT, FOOT]));
      expect(seen(where, opened)).toEqual([
        ['head', 'Template head'],
        ['intro', 'Page intro'],
        ['body', 'Template body'],
        ['default', 'Page main 1'],
        ['default', 'Page main 2'],
        ['foot', 'Template foot'],
      ]);
    });
  });

  for (const [stored, marks] of Object.entries(STORED)) {
    describe(`"Change on all pages": ${where}, a template stored ${stored}`, () => {
      // Committed from the page as the editor has it: opened, with the template merged in.
      const commit = async (page, tpl) => (await mergeInstanceIntoTemplate(tpl, page, instanceOf(page), {
        uuidGenerator,
        idFieldMap,
      })).merged;

      test('with nothing changed, the template is as it was: its slot keeps its own block, not the page\'s content', async () => {
        const tpl = template(where, STRUCTURE, marks);
        const saved = await commit(await open(await usedPage(where, tpl), tpl), tpl);
        expect(seen(where, saved)).toEqual(seen(where, tpl));
        expect(ids(where, saved)).toEqual(ids(where, tpl));
      });

      test('a locked block changed in the editor changes in the template, and nothing else does', async () => {
        const tpl = template(where, STRUCTURE, marks);
        const page = await open(await usedPage(where, tpl), tpl);
        const edited = WHERE[where].write(page, WHERE[where].read(page).map((entry) => (
          entry.block.slotId === 'head' ? { ...entry, block: { ...entry.block, text: 'Head for every page' } } : entry
        )));
        const saved = await commit(edited, tpl);
        expect(seen(where, saved)).toEqual(seen(where, tpl).map(([slot, text]) => [slot, slot === 'head' ? 'Head for every page' : text]));
        expect(ids(where, saved)).toEqual(ids(where, tpl));
      });

      test("an editable block's text is the page's: the template keeps its own", async () => {
        const tpl = template(where, STRUCTURE, marks);
        const page = await open(await usedPage(where, tpl), tpl);
        expect(seen(where, page)).toContainEqual(['intro', 'Page intro']);
        const saved = await commit(page, tpl);
        expect(seen(where, saved)).toEqual(seen(where, tpl));
      });

      test('two locked blocks sharing a slot name come back with their own ids and text', async () => {
        const DECO1 = spec('deco-1', 'deco', 'Deco one', { fixed: true, readOnly: true });
        const DECO2 = spec('deco-2', 'deco', 'Deco two', { fixed: true, readOnly: true });
        const tpl = template(where, [HEAD, DECO1, DECO2, MAIN, FOOT], marks);
        const saved = await commit(await open(await usedPage(where, tpl), tpl), tpl);
        expect(seen(where, saved)).toEqual(seen(where, tpl));
        expect(ids(where, saved)).toEqual(ids(where, tpl));
      });
    });
  }
}
