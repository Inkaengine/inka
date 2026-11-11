import fs from 'fs';
import path from 'path';
import { mergeTemplatesIntoPage } from '@volto-hydra/helpers/mergeTemplates.js';
import { buildIdFieldMap } from '@volto-hydra/helpers/buildBlockPathMap.js';
import { sharedBlocksConfig as idFieldSchemas } from '../../tests-playwright/fixtures/shared-block-schemas.js';

// Each list's id field, from the schema, as the admin derives it (buildIdFieldMap).
const ID_FIELDS = buildIdFieldMap(idFieldSchemas);


const load = (p) => JSON.parse(fs.readFileSync(path.resolve(process.cwd(), '..', '..', p), 'utf-8'));

/**
 * Round-trip (the direction the existing reverse-merge tests miss): LOAD a page with a
 * template applied, the user empties the `primary` slot and adds ONE new block into it
 * (inheriting slotId 'primary' + the instance), then the page is RE-MERGED on save→view
 * (forward-merge again). The new user slot content must survive the re-merge.
 *
 * Mirrors integration template-advanced.spec.ts:203.
 */
test('round-trip: a new primary slot block survives a re-merge (save → view-mode reload)', async () => {
  const page = load('tests-playwright/fixtures/content/template-test-page/data.json');
  const template = load('tests-playwright/fixtures/content/templates/test-layout/data.json');
  let c = 0;
  const uuidGenerator = () => `uuid-${++c}`;

  // 1. LOAD (apply): forward-merge the template into the page.
  const { merged: loaded } = await mergeTemplatesIntoPage(page, {
    idFieldMap: ID_FIELDS,
    loadTemplate: async () => template,
    pageBlocksFields: { items: {} },
    uuidGenerator,
  });

  const primaryAfterLoad = Object.values(loaded.blocks).filter((b) => b.slotId === 'primary' && !b.fixed);
  expect(primaryAfterLoad.length).toBeGreaterThan(0);
  const instanceId = primaryAfterLoad[0].templateInstanceId;
  const tplId = primaryAfterLoad[0].templateId;

  // 2. EDIT (mirror :203): remove the existing primary content, add ONE new primary block.
  const items = [...loaded.blocks_layout.items];
  for (const id of [...items]) {
    if (loaded.blocks[id]?.slotId === 'primary' && !loaded.blocks[id]?.fixed) {
      delete loaded.blocks[id];
      items.splice(items.indexOf(id), 1);
    }
  }
  const newId = 'new-primary-block';
  loaded.blocks[newId] = {
    '@type': 'slate',
    slotId: 'primary',
    templateId: tplId,
    templateInstanceId: instanceId,
    value: [{ type: 'p', children: [{ text: 'New slot content' }] }],
    plaintext: 'New slot content',
  };
  const gridIdx = items.findIndex((id) => loaded.blocks[id]?.slotId === 'grid');
  items.splice(gridIdx + 1, 0, newId);
  loaded.blocks_layout.items = items;

  // 3. RELOAD (view-mode re-merge): forward-merge the edited page again.
  const { merged: reloaded } = await mergeTemplatesIntoPage(loaded, {
    idFieldMap: ID_FIELDS,
    loadTemplate: async () => template,
    pageBlocksFields: { items: {} },
    uuidGenerator,
  });

  // 4. ASSERT: the new user slot content survives.
  const survived = Object.values(reloaded.blocks).some(
    (b) => b.plaintext === 'New slot content' || b.value?.[0]?.children?.[0]?.text === 'New slot content',
  );
  expect(survived).toBe(true);
});
