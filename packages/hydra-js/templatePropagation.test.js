import fs from 'fs';
import path from 'path';
import { mergeTemplatesIntoPage, mergeInstanceIntoTemplate } from './mergeTemplates.js';

const load = (p) => JSON.parse(fs.readFileSync(path.resolve(process.cwd(), '..', '..', p), 'utf-8'));
const textOf = (b) =>
  b?.plaintext ?? b?.value?.[0]?.children?.[0]?.text ?? b?.value?.[0]?.text ?? '';

/**
 * Integration :866 ("saved template changes … appear on other pages using the template")
 * at the unit level, with the REAL fixtures (test-layout has a grid + multiple regions,
 * which a minimal header+slot fixture doesn't exercise):
 *   1. apply the template to page 1 (load)
 *   2. edit the fixed+readOnly header (template edit mode)
 *   3. SAVE: reverse merge (mergeInstanceIntoTemplate) the edited page back into the template
 *   4. VIEW page 2: forward-merge the UPDATED template — the edit must appear.
 */
test('template edit propagates to another page — real fixtures (integration :866)', async () => {
  const template = load('tests-playwright/fixtures/content/templates/test-layout/data.json');
  const page1 = load('tests-playwright/fixtures/content/template-test-page/data.json');
  const page2 = load('tests-playwright/fixtures/content/template-test-page-2/data.json');
  let c = 0;
  const uuidGenerator = () => `u-${++c}`;

  // 1. Apply the template to page 1.
  const { merged: applied1 } = await mergeTemplatesIntoPage(page1, {
    loadTemplate: async () => template,
    pageBlocksFields: { items: {} },
    uuidGenerator,
  });
  const header1 = Object.values(applied1.blocks).find((b) => b.slotId === 'header' && b.fixed);
  expect(header1).toBeDefined();
  expect(textOf(header1)).toContain('Template Header');
  const instanceId = header1.templateInstanceId;

  // 2. Edit the fixed+readOnly header (as template edit mode allows).
  header1.value = [{ type: 'p', children: [{ text: 'Template Header - EDITED' }] }];
  header1.plaintext = 'Template Header - EDITED';

  // 3. SAVE: reverse-merge the edited instance back into the template (View.jsx path).
  const { merged: updatedTemplate } = await mergeInstanceIntoTemplate(template, applied1, instanceId, { uuidGenerator });
  const tplHeader = Object.values(updatedTemplate.blocks).find((b) => b.slotId === 'header' && b.fixed);
  expect(textOf(tplHeader)).toContain('EDITED'); // captured into the template

  // 4. VIEW page 2: forward-merge the UPDATED template — the edit must propagate.
  const { merged: applied2 } = await mergeTemplatesIntoPage(page2, {
    loadTemplate: async () => updatedTemplate,
    pageBlocksFields: { items: {} },
    uuidGenerator,
  });
  const header2Entry = Object.entries(applied2.blocks).find(([, b]) => b.slotId === 'header' && b.fixed);
  expect(header2Entry).toBeDefined();
  const [header2Id, header2] = header2Entry;
  expect(textOf(header2)).toContain('EDITED'); // propagated to page 2
  // The header must be in the RENDERED layout, not just present in blocks — otherwise
  // it never renders (the block exists but isn't listed in blocks_layout.items).
  expect(applied2.blocks_layout.items).toContain(header2Id);

  // 5. Page 1 VIEW-mode re-render (what :866 asserts at line 926): re-forward-merge the
  // edited page with the updated template — the header must render with the edit.
  const { merged: rerendered1 } = await mergeTemplatesIntoPage(applied1, {
    loadTemplate: async () => updatedTemplate,
    pageBlocksFields: { items: {} },
    uuidGenerator,
  });
  const h1Entry = Object.entries(rerendered1.blocks).find(([, b]) => b.slotId === 'header' && b.fixed);
  expect(h1Entry).toBeDefined();
  const [h1Id, h1] = h1Entry;
  expect(rerendered1.blocks_layout.items).toContain(h1Id); // in the rendered layout
  expect(textOf(h1)).toContain('EDITED'); // page 1 shows the edit in view mode
});

/**
 * Structural add + cross-page: adding a NEW column whose content is a new block
 * (a newsletter form) on one page must propagate that content to other pages.
 * Edit-propagation (above) works; this ADD-new-content case does not — the
 * reverse merge drops a block added inside a freshly-added column, so the form
 * never reaches the template and never shows on another page. Reproduces the
 * "/blog footer has the extra column but no form" symptom.
 */
test('a form added inside a NEW column propagates to another page (footer columns)', async () => {
  const template = load('tests-playwright/fixtures/content/templates/footer-layout/data.json');
  let c = 0;
  const uuidGenerator = () => `u-${++c}`;
  const pbf = { items: {}, footer: { allowedLayouts: ['/templates/footer-layout'] } };
  const freshPage = () => ({
    blocks: { main: { '@type': 'slate', value: [{ type: 'p', children: [{ text: 'x' }] }] } },
    blocks_layout: { items: ['main'], footer: [] },
  });
  const findCols = (fd) => Object.values(fd.blocks).find((b) => b['@type'] === 'columns');
  const hasForm = (cols) =>
    Object.values(cols.blocks || {}).some(
      (col) => col.blocks && Object.values(col.blocks).some((b) => b['@type'] === 'form'),
    );

  // 1. Apply the footer template to the home page.
  const { merged: home } = await mergeTemplatesIntoPage(freshPage(), {
    loadTemplate: async () => template, pageBlocksFields: pbf, uuidGenerator,
  });
  const cols = findCols(home);
  const iid = cols.templateInstanceId;

  // 2. Add a column (clone an existing column's shape) whose content is a form.
  const firstCol = cols.blocks[cols.blocks_layout.columns[0]];
  cols.blocks['add-col'] = {
    ...firstCol,
    slotId: 'add-col', templateId: template['@id'], templateInstanceId: iid,
    // The form is template content the author places (fixed) — as the add flow now stamps
    // it (inheritTemplateMembership inheritFixed) — so it propagates. (An empty slot the
    // author adds also propagates, as a slot definition — see the next test.)
    blocks: { 'add-form': { '@type': 'form', fixed: true, templateId: template['@id'], templateInstanceId: iid, slotId: 'add-form' } },
    blocks_layout: { items: ['add-form'] },
  };
  cols.blocks_layout.columns = [...cols.blocks_layout.columns, 'add-col'];

  // 3. SAVE: reverse-merge the edited home back into the template.
  const { merged: saved } = await mergeInstanceIntoTemplate(template, home, iid, { uuidGenerator });
  expect(hasForm(findCols(saved))).toBe(true); // reverse merge must capture the form

  // 4. VIEW another page: forward-merge the updated template — the form must appear.
  const { merged: other } = await mergeTemplatesIntoPage(freshPage(), {
    loadTemplate: async () => saved, pageBlocksFields: pbf, uuidGenerator,
  });
  expect(hasForm(findCols(other))).toBe(true); // form propagates to the other page
});

/**
 * The mirror of the form case: an empty SLOT the author adds (a region for end-users to
 * fill) must also propagate — as a slot DEFINITION. The reverse merge used to DROP a slot
 * whose slotId matched no page content; now it emits the slot itself, so the definition
 * reaches the template and shows (empty, fillable) on other pages.
 */
test('an empty slot added inside a NEW column propagates as a slot definition', async () => {
  const template = load('tests-playwright/fixtures/content/templates/footer-layout/data.json');
  let c = 0;
  const uuidGenerator = () => `u-${++c}`;
  const pbf = { items: {}, footer: { allowedLayouts: ['/templates/footer-layout'] } };
  const freshPage = () => ({
    blocks: { main: { '@type': 'slate', value: [{ type: 'p', children: [{ text: 'x' }] }] } },
    blocks_layout: { items: ['main'], footer: [] },
  });
  const findCols = (fd) => Object.values(fd.blocks).find((b) => b['@type'] === 'columns');
  const hasSlot = (cols) =>
    Object.values(cols.blocks || {}).some(
      (col) => col.blocks && Object.values(col.blocks).some((b) => b.slotId === 'add-slot' && !b.fixed),
    );

  const { merged: home } = await mergeTemplatesIntoPage(freshPage(), {
    loadTemplate: async () => template, pageBlocksFields: pbf, uuidGenerator,
  });
  const cols = findCols(home);
  const iid = cols.templateInstanceId;

  // Add a new column whose content is an empty SLOT (no `fixed`) — a fillable user region.
  const firstCol = cols.blocks[cols.blocks_layout.columns[0]];
  cols.blocks['add-col'] = {
    ...firstCol,
    slotId: 'add-col', templateId: template['@id'], templateInstanceId: iid,
    blocks: { 'add-slot': { '@type': 'slate', slotId: 'add-slot', templateId: template['@id'], templateInstanceId: iid } },
    blocks_layout: { items: ['add-slot'] },
  };
  cols.blocks_layout.columns = [...cols.blocks_layout.columns, 'add-col'];

  // SAVE: the slot definition must be captured (not dropped).
  const { merged: saved } = await mergeInstanceIntoTemplate(template, home, iid, { uuidGenerator });
  expect(hasSlot(findCols(saved))).toBe(true);

  // VIEW another page: the slot appears (empty, fillable by that page's users).
  const { merged: other } = await mergeTemplatesIntoPage(freshPage(), {
    loadTemplate: async () => saved, pageBlocksFields: pbf, uuidGenerator,
  });
  expect(hasSlot(findCols(other))).toBe(true);
});

/**
 * Malformed input: a `fixed` block placed inside a slot is a category error — a propagating
 * template block can't live in a per-page user region. The reverse merge must capture the
 * slot DEFINITION only (never its contents), so the misplaced fixed block does NOT ride
 * along into the template.
 */
test('a fixed block wrongly placed inside a slot does not propagate (definition only)', async () => {
  const template = load('tests-playwright/fixtures/content/templates/footer-layout/data.json');
  let c = 0;
  const uuidGenerator = () => `u-${++c}`;
  const pbf = { items: {}, footer: { allowedLayouts: ['/templates/footer-layout'] } };
  const freshPage = () => ({
    blocks: { main: { '@type': 'slate', value: [{ type: 'p', children: [{ text: 'x' }] }] } },
    blocks_layout: { items: ['main'], footer: [] },
  });
  const findCols = (fd) => Object.values(fd.blocks).find((b) => b['@type'] === 'columns');

  const { merged: home } = await mergeTemplatesIntoPage(freshPage(), {
    loadTemplate: async () => template, pageBlocksFields: pbf, uuidGenerator,
  });
  const cols = findCols(home);
  const iid = cols.templateInstanceId;

  // A new column that is a SLOT (not fixed) but wrongly contains a FIXED block.
  const firstCol = cols.blocks[cols.blocks_layout.columns[0]];
  cols.blocks['bad-slot'] = {
    ...firstCol,
    fixed: false,
    slotId: 'bad-slot', templateId: template['@id'], templateInstanceId: iid,
    blocks: { 'bad-fixed': { '@type': 'form', fixed: true, templateId: template['@id'], templateInstanceId: iid, slotId: 'bad-fixed' } },
    blocks_layout: { items: ['bad-fixed'] },
  };
  cols.blocks_layout.columns = [...cols.blocks_layout.columns, 'bad-slot'];

  const { merged: saved } = await mergeInstanceIntoTemplate(template, home, iid, { uuidGenerator });

  const savedCols = findCols(saved);
  // The slot definition survives...
  expect(Object.values(savedCols.blocks || {}).some((b) => b.slotId === 'bad-slot')).toBe(true);
  // ...but the fixed block wrongly placed inside it did NOT propagate.
  const anyForm = Object.values(savedCols.blocks || {}).some(
    (b) => b.blocks && Object.values(b.blocks).some((n) => n['@type'] === 'form'),
  );
  expect(anyForm).toBe(false);
});
