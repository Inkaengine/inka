import fs from 'fs';
import path from 'path';
import { mergeTemplatesIntoPage, mergeInstanceIntoTemplate } from './mergeTemplates.js';

const load = (p) => JSON.parse(fs.readFileSync(path.resolve(process.cwd(), '..', '..', p), 'utf-8'));

/**
 * ROOT CONFIRMATION — the top-level e2e trace showed the exit reverse merge (#2) captures a
 * converted field and reload (#3) re-derives it correctly, so top-level does NOT revert. The
 * user's field is nested inside a NEWLY-ADDED column. This reverse-merges exactly that shape
 * and checks whether the convert is captured into the template. If NOT, the saved template
 * stays 'empty', and the post-save reload forward merge re-derives 'empty' — the revert.
 */
describe('REPRO: converted field nested in a NEW column survives the reverse merge', () => {
  test('a form field converted to "from" inside a newly-added column is captured into the template', async () => {
    const template = load('tests-playwright/fixtures/content/templates/footer-layout/data.json');
    let c = 0;
    const uuidGenerator = () => `u-${++c}`;
    const pbf = { items: {}, footer: { allowedLayouts: ['/templates/footer-layout'] } };
    const freshPage = () => ({
      blocks: { main: { '@type': 'slate', value: [{ type: 'p', children: [{ text: 'x' }] }] } },
      blocks_layout: { items: ['main'], footer: [] },
    });
    const findCols = (fd) => Object.values(fd.blocks).find((b) => b['@type'] === 'columns');
    // The form config the real admin passes: subblocks is a TYPED object_list (typeField
    // field_type, idField field_id) — the thing my earlier merges lacked (hence ::undefined).
    const idFieldMap = { form: { subblocks: 'field_id' } };

    // 1. Apply footer template → home with columns.
    const { merged: home } = await mergeTemplatesIntoPage(freshPage(), {
      loadTemplate: async () => template, pageBlocksFields: pbf, uuidGenerator, idFieldMap,
    });
    const cols = findCols(home);
    const iid = cols.templateInstanceId;

    // 2. Add a NEW column with a form whose seeded field was converted (empty → from).
    const firstCol = cols.blocks[cols.blocks_layout.columns[0]];
    cols.blocks['add-col'] = {
      ...firstCol, slotId: 'add-col', templateId: template['@id'], templateInstanceId: iid,
      blocks: {
        'add-form': {
          '@type': 'form', fixed: true, templateId: template['@id'], templateInstanceId: iid, slotId: 'add-form',
          subblocks: [{ field_id: 'nf-1', field_type: 'from', fixed: true, templateId: template['@id'], templateInstanceId: iid }],
        },
      },
      blocks_layout: { items: ['add-form'] },
    };
    cols.blocks_layout.columns = [...cols.blocks_layout.columns, 'add-col'];

    // 3. Reverse merge (exit/save) into the template.
    const { merged: saved } = await mergeInstanceIntoTemplate(template, home, iid, { uuidGenerator, idFieldMap });

    // 4. The captured nested form's field must be 'from'.
    const savedCols = findCols(saved);
    const savedForm = Object.values(savedCols.blocks || {})
      .flatMap((col) => Object.values(col.blocks || {}))
      .find((b) => b['@type'] === 'form');
    // eslint-disable-next-line no-console
    console.log('SAVED NESTED FORM:', JSON.stringify(savedForm));
    expect(savedForm?.subblocks?.[0]?.field_type).toBe('from');

    // 5. Reload: forward-merge the SAVED template onto a fresh page. The nested field must survive
    //    the re-derive (this is post-save reload merge #3). If it reverts here, that's the bug.
    const { merged: reloaded } = await mergeTemplatesIntoPage(freshPage(), {
      loadTemplate: async () => saved, pageBlocksFields: pbf, uuidGenerator, idFieldMap,
    });
    const reloadedForm = Object.values(findCols(reloaded).blocks || {})
      .flatMap((col) => Object.values(col.blocks || {}))
      .find((b) => b['@type'] === 'form');
    // eslint-disable-next-line no-console
    console.log('RELOADED NESTED FORM:', JSON.stringify(reloadedForm));
    expect(reloadedForm?.subblocks?.[0]?.field_type).toBe('from');
  });
});
