import { describe, test, expect, vi } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

// blockPath reaches HydraSchemaContext.js — JSX inside a .js file, which esbuild
// (vitest) can't parse. Nothing here touches the live schema context.
vi.mock('../context', () => ({
  getHydraSchemaContext: () => ({}),
  setHydraSchemaContext: () => () => {},
  getLiveBlockData: () => undefined,
}));
import { PAGE_BLOCK_UID } from '@volto-hydra/hydra-js';
import { mergeTemplatesIntoPage, mergeInstanceIntoTemplate } from './mergeTemplates.mjs';
import { buildBlockPathMap, buildIdFieldMap, ensureEmptyBlockIfEmpty, ensureAllContainersHaveBlocks } from './blockPath.js';
import { sharedBlocksConfig } from '../../../../tests-playwright/fixtures/shared-block-schemas.js';

/**
 * "Change on all pages" is the same merge as opening a page, in the other
 * direction: the page's instance merged into its template. A template applied
 * to a page and committed back unedited is the template it was. The slots keep
 * the template's own placeholders: what a page put in them is the page's.
 */

const content = join(__dirname, '../../../../tests-playwright/fixtures/content');
const load = (p) => JSON.parse(readFileSync(join(content, p, 'data.json'), 'utf8'));

// Every template fixture, by each id a page may name it by.
const templates = {};
for (const name of readdirSync(join(content, 'templates'))) {
  const tpl = load(`templates/${name}`);
  templates[tpl['@id']] = tpl;
  templates[`resolveuid/${tpl.UID}`] = tpl;
}
const loadTemplate = async (id) => {
  const tpl = templates[id] ?? templates[new URL(id, 'http://x').pathname];
  if (!tpl) throw new Error(`no template fixture for ${id}`);
  return tpl;
};

// The page's own regions, as a content type's schema gives them to the admin.
const blocksConfig = {
  ...sharedBlocksConfig,
  [PAGE_BLOCK_UID]: {
    id: PAGE_BLOCK_UID,
    schema: () => ({
      properties: {
        items: { widget: 'blocks_layout' },
        footer: { widget: 'blocks_layout' },
      },
    }),
  },
};
const intl = { formatMessage: (m) => m?.defaultMessage || m?.id || '' };
const idFieldMap = buildIdFieldMap(blocksConfig, intl);

// A template as stored: each region's blocks in order, with their ids and fields,
// at every depth. Not the marks the merge stamps on a page for the editor (instance
// ids, the slots beside a fixed block).
const PER_INSTANCE = new Set(['templateInstanceId', '@uid', 'nextSlotId', 'prevSlotId', 'childSlotIds']);
function outline(value) {
  if (Array.isArray(value)) return value.map(outline);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, v] of Object.entries(value)) {
    if (PER_INSTANCE.has(key) || key === 'blocks' || key === 'blocks_layout') continue;
    out[key] = outline(v);
  }
  if (value.blocks && value.blocks_layout) {
    out.regions = Object.fromEntries(
      Object.entries(value.blocks_layout)
        .filter(([, ids]) => Array.isArray(ids))
        .map(([region, ids]) => [region, ids.map((id) => ({ id, ...outline(value.blocks[id]) }))]),
    );
  }
  return out;
}
const templateOutline = (doc) => outline({ blocks: doc.blocks, blocks_layout: doc.blocks_layout }).regions;

// Every template instance a page holds, at any depth, with its template.
function instances(node, found = new Map()) {
  if (Array.isArray(node)) node.forEach((n) => instances(n, found));
  else if (node && typeof node === 'object') {
    if (node.templateInstanceId && node.templateId && !found.has(node.templateInstanceId)) {
      found.set(node.templateInstanceId, node.templateId);
    }
    Object.values(node).forEach((v) => instances(v, found));
  }
  return found;
}

// A page opened in the editor, as the admin opens it: merged, then each empty
// region and empty slot seeded with a placeholder to click.
async function open(page, pageBlocksFields) {
  let c = 0;
  const uuidGenerator = () => `uuid-${++c}`;
  const { merged } = await mergeTemplatesIntoPage(page, {
    loadTemplate,
    pageBlocksFields,
    uuidGenerator,
    skipOwnTemplate: true,
    idFieldMap,
  });
  const seeded = ensureEmptyBlockIfEmpty(
    merged,
    { parentId: PAGE_BLOCK_UID },
    buildBlockPathMap(merged, blocksConfig, intl),
    uuidGenerator,
    blocksConfig,
    { intl, properties: merged },
  );
  return ensureAllContainersHaveBlocks(seeded, blocksConfig, intl, uuidGenerator);
}

async function commit(template, page, instanceId) {
  let c = 0;
  const { merged } = await mergeInstanceIntoTemplate(template, page, instanceId, {
    uuidGenerator: () => `commit-${++c}`,
    idFieldMap,
  });
  return merged;
}

const PAGES = [
  { what: 'a layout whose slot holds the page\'s content', page: () => load('template-test-page') },
  { what: 'a snippet at the top level', page: () => load('inserted-template-test-page') },
  { what: 'a snippet inside a container', page: () => load('nested-snippet-page') },
  {
    what: 'a forced footer in the footer region',
    page: () => ({
      '@id': '/a-page',
      blocks: { 'page-text': { '@type': 'slate', value: [{ type: 'p', children: [{ text: 'Page text' }] }] } },
      blocks_layout: { items: ['page-text'] },
    }),
    pageBlocksFields: { items: {}, footer: { allowedLayouts: ['/templates/footer-layout'] } },
  },
];

describe('"Change on all pages" with nothing changed leaves the template as it was', () => {
  for (const { what, page, pageBlocksFields } of PAGES) {
    test(what, async () => {
      const opened = await open(page(), pageBlocksFields);
      const found = instances(opened);
      expect(found.size).toBeGreaterThan(0);
      for (const [instanceId, templateId] of found) {
        const stored = await loadTemplate(templateId);
        const saved = await commit(stored, opened, instanceId);
        expect(templateOutline(saved)).toEqual(templateOutline(stored));
      }
    });
  }
});

test('"Change on all pages" after editing a fixed block changes that block and nothing else', async () => {
  const opened = await open(load('template-test-page'));
  const [header] = Object.entries(opened.blocks).filter(([, b]) => b.slotId === 'header' && b.fixed);
  const [headerId, block] = header;
  const edited = [{ type: 'h1', children: [{ text: 'Header for every page' }] }];
  const page = { ...opened, blocks: { ...opened.blocks, [headerId]: { ...block, value: edited } } };

  const stored = templates['/templates/test-layout'];
  const saved = await commit(stored, page, block.templateInstanceId);

  const expected = templateOutline(stored);
  expected.items = expected.items.map((b) => (b.slotId === 'header' ? { ...b, value: edited } : b));
  expect(templateOutline(saved)).toEqual(expected);
});
