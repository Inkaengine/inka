import { mergeTemplatesIntoPage, mergeInstanceIntoTemplate } from './mergeTemplates.js';
import { sharedBlocksConfig } from '../../tests-playwright/fixtures/shared-block-schemas.js';
import { readFileSync } from 'fs';
import { join } from 'path';

// jest runs with cwd = packages/hydra-js
const root = join(process.cwd(), '..', '..');
const load = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));

/**
 * Regression test for the template-edit-mode "saved changes persist" flow,
 * exercised end-to-end with the real fixtures:
 *
 *   1. INIT merge — load page, inject the template's fixed blocks
 *   2. edit a fixed (template-owned) block
 *   3. reverse merge — capture the page edit back into the template (on save)
 *
 * The reverse merge (View.jsx) calls mergeTemplatesIntoPage WITHOUT
 * pageBlocksFields, so it relies on the default. That default was once
 * `{ blocks_layout: {} }` (the old field-name convention); after the blocks-
 * field rename the merge reads `blocks_layout[fieldName]`, so the stale default
 * resolved to `blocks_layout.blocks_layout` (nothing) and silently skipped the
 * whole merge — the edit was never captured. The default must be `{ items: {} }`.
 */
test('reverse merge captures a template-block edit using the default pageBlocksFields', async () => {
  const page = load('tests-playwright/fixtures/content/template-test-page/data.json');
  const template = load('tests-playwright/fixtures/content/templates/test-layout/data.json');
  let c = 0;
  const uuidGenerator = () => `uuid-${++c}`;

  // 1. INIT merge (page load): inject the template's fixed blocks
  const { merged: formData } = await mergeTemplatesIntoPage(page, {
    loadTemplate: async () => template,
    pageBlocksFields: { items: {} },
    uuidGenerator,
  });

  // 2. Edit the header (template edit mode)
  const headerId = Object.entries(formData.blocks)
    .find(([, b]) => b.slotId === 'header' && b.fixed)?.[0];
  const prevInstanceId = formData.blocks[headerId].templateInstanceId;
  formData.blocks[headerId] = {
    ...formData.blocks[headerId],
    value: [{ type: 'h1', children: [{ text: 'Template Header - From Template - edited' }] }],
  };

  // 3. Reverse merge (save) — note: NO pageBlocksFields, so the default is used
  const { merged: updatedTemplate } = await mergeInstanceIntoTemplate(template, formData, prevInstanceId, { uuidGenerator });

  const hdr = Object.values(updatedTemplate.blocks).find((b) => b.slotId === 'header' && b.fixed);
  expect(hdr).toBeDefined();
  expect(hdr.value[0].children[0].text).toContain('edited');
});

/**
 * The header test above edits a TOP-LEVEL block. A branded footer is built as
 * nested columns — a slate inside a column inside a `columns` block (3 levels).
 * `columns`/`column` have schemas, so the reverse merge takes the SCHEMA branch
 * (mergeTemplates getBlockSchema), recursing through a nested schema container
 * (`column`) — a deeper path than a grid cell (grid -> slate, one level). If
 * that deeper recursion drops the edited nested cell, saving a centrally-edited
 * branded footer silently loses the edit.
 *
 * Note: only the top `columns` block carries the templateInstanceId — the nested
 * column + slate legitimately don't (that's the real post-merge shape; stamping
 * them was the reverted f150dd7 hack). So the reverse merge must capture nested
 * edits via the matched container, not a per-block instance-id filter.
 */
test('reverse merge captures an edit to a DEEPLY-nested template block (columns -> column -> slate)', async () => {
  const template = load('tests-playwright/fixtures/content/templates/footer-layout/data.json');
  let c = 0;
  const uuidGenerator = () => `uuid-${++c}`;
  const intl = { formatMessage: (m) => m?.defaultMessage || m?.id || '' };
  const instanceId = 'footer-inst-1';

  const tplCols = template.blocks['footer-cols'];
  const tplCol = tplCols.blocks['footer-col-1'];
  const tplCell = tplCol.blocks['footer-col-cell'];

  // The merged page state: the footer-layout instance with the DEEPLY-nested cell
  // edited. Only the top columns block carries the instance id.
  const formData = {
    blocks: {
      'footer-cols': {
        ...tplCols,
        templateInstanceId: instanceId,
        blocks: {
          'footer-col-1': {
            ...tplCol,
            blocks: {
              'footer-col-cell': {
                ...tplCell,
                value: [{ type: 'p', children: [{ text: 'EDITED NESTED CELL' }] }],
                plaintext: 'EDITED NESTED CELL',
              },
            },
            blocks_layout: { items: ['footer-col-cell'] },
          },
        },
        blocks_layout: { columns: ['footer-col-1'] },
      },
    },
    blocks_layout: { items: ['footer-cols'] },
  };

  const { merged: updatedTemplate } = await mergeInstanceIntoTemplate(template, formData, instanceId, { blocksConfig: sharedBlocksConfig, intl, uuidGenerator });

  // Walk down to the deeply-nested cell in the updated template + assert the edit.
  const cols = Object.values(updatedTemplate.blocks).find((b) => b['@type'] === 'columns');
  expect(cols).toBeDefined();
  const colId = cols.blocks_layout.columns[0];
  const col = cols.blocks[colId];
  const cellId = col.blocks_layout.items[0];
  expect(col.blocks[cellId].value[0].children[0].text).toBe('EDITED NESTED CELL');
});

/**
 * Faithful repro of the FORCED-FOOTER save bug. The real forced footer lives in
 * the page's `footer` REGION (blocks_layout.footer), not `items` — the test
 * above (items) gave a false green. With the footer-layout instance's blocks in
 * the footer region, the reverse merge returned an EMPTY template
 * ("Updated template blocks: []"), so a centrally-edited branded footer lost the
 * edit on save.
 */
test('reverse merge captures a nested edit when the forced footer is in the FOOTER region', async () => {
  const template = load('tests-playwright/fixtures/content/templates/footer-layout/data.json');
  let c = 0;
  const uuidGenerator = () => `uuid-${++c}`;
  const intl = { formatMessage: (m) => m?.defaultMessage || m?.id || '' };
  const instanceId = 'footer-inst-1';

  const tplBranding = template.blocks['fixed-branding'];
  const tplCols = template.blocks['footer-cols'];
  const tplCol = tplCols.blocks['footer-col-1'];
  const tplCell = tplCol.blocks['footer-col-cell'];

  // The merged page: the footer-layout instance lives in the FOOTER region, with
  // the deeply-nested cell edited. Only the top-level slot blocks carry the
  // instance id (post-forward-merge shape, no stamping).
  const formData = {
    blocks: {
      'main-1': { '@type': 'slate', value: [{ type: 'p', children: [{ text: 'main' }] }] },
      branding: { ...tplBranding, templateInstanceId: instanceId },
      fcols: {
        ...tplCols,
        templateInstanceId: instanceId,
        blocks: {
          fc1: {
            ...tplCol,
            blocks: {
              fcell: {
                ...tplCell,
                value: [{ type: 'p', children: [{ text: 'EDITED NESTED CELL' }] }],
                plaintext: 'EDITED NESTED CELL',
              },
            },
            blocks_layout: { items: ['fcell'] },
          },
        },
        blocks_layout: { columns: ['fc1'] },
      },
    },
    blocks_layout: { items: ['main-1'], footer: ['branding', 'fcols'] },
  };

  const { merged: updatedTemplate } = await mergeInstanceIntoTemplate(template, formData, instanceId, { blocksConfig: sharedBlocksConfig, intl, uuidGenerator });

  const cols = Object.values(updatedTemplate.blocks || {}).find((b) => b['@type'] === 'columns');
  expect(cols).toBeDefined(); // EMPTY before the fix
  const colId = cols.blocks_layout.columns[0];
  const col = cols.blocks[colId];
  const cellId = col.blocks_layout.items[0];
  expect(col.blocks[cellId].value[0].children[0].text).toBe('EDITED NESTED CELL');

  // The merge keeps the TARGET's instance id and strips the SOURCE's. Saving is
  // merge(template, page): the result is the template, so it must NOT carry the
  // page's (source) instance id — that id belongs to one page's instance, not the
  // template. Leaking it poisons the template (and the "reuse the instance already
  // in the page" path) for every other page.
  expect(cols.templateInstanceId).not.toBe(instanceId);
});
