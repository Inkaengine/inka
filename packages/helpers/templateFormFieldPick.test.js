import { buildBlockPathMap } from './buildBlockPathMap.js';

/**
 * Template-context bug: picking a type for a seeded empty form field leaves it empty — but ONLY
 * when the form is nested inside container blocks of a forced template (a real footer:
 * columns → column → form). onMutateBlock writes the picked type via setBlockType only when
 * blockPathMap[id].typeField is set; otherwise it writes @type, which the form ignores, so
 * field_type stays 'empty'.
 *
 * The ORIGINAL version of this test put the form at the PAGE TOP LEVEL (blocks_layout.items:
 * ['form-1']) and only toggled templateInstanceId/fixed — so it passed and never reproduced the
 * bug. The real uncovered axis is CONTAINER NESTING: buildBlockPathMap does not descend into a
 * nested block's object_list (subblocks) when the block is reached through blocks_layout regions
 * (columns → column), so the deeply-nested field never lands in the path map and gets no typeField.
 */
describe('form field keeps its typeField in the blockPathMap — nested + top-level', () => {
  const blocksConfig = {
    form: {
      id: 'form',
      blockSchema: {
        properties: {
          subblocks: {
            widget: 'object_list',
            idField: 'field_id',
            typeField: 'field_type',
            allowedBlocks: ['text', 'from'],
          },
        },
      },
    },
    columns: {
      id: 'columns',
      blockSchema: { properties: { columns: { widget: 'blocks_layout', allowedBlocks: ['column'] } } },
    },
    column: {
      id: 'column',
      blockSchema: { properties: { items: { widget: 'blocks_layout', allowedBlocks: ['slate', 'form'] } } },
    },
  };

  const formBlock = (formExtra, fieldExtra) => ({
    '@type': 'form',
    ...formExtra,
    subblocks: [{ field_id: 'fld-1', field_type: 'empty', ...fieldExtra }],
  });

  // form as a top-level page block (the shape the original test covered)
  const topLevelPage = (formExtra, fieldExtra) => ({
    '@type': 'Document',
    blocks: { 'form-1': formBlock(formExtra, fieldExtra) },
    blocks_layout: { items: ['form-1'] },
  });

  // form nested inside columns → column (the REAL forced-footer shape)
  const nestedPage = (formExtra, fieldExtra) => ({
    '@type': 'Document',
    blocks: {
      'cols-1': {
        '@type': 'columns',
        blocks: {
          'col-1': {
            '@type': 'column',
            blocks: { 'form-1': formBlock(formExtra, fieldExtra) },
            blocks_layout: { items: ['form-1'] },
          },
        },
        blocks_layout: { columns: ['col-1'] },
      },
    },
    blocks_layout: { items: ['cols-1'] },
  });

  const tmpl = [
    { templateInstanceId: 'inst-1', templateId: '/templates/footer', slotId: 'form-1', fixed: true },
    { templateInstanceId: 'inst-1', fixed: true },
  ];

  test('control: a top-level form field gets typeField (this case already worked)', () => {
    expect(buildBlockPathMap(topLevelPage({}, {}), blocksConfig)['fld-1']?.typeField).toBe('field_type');
  });

  test('control: a top-level form field in a template instance gets typeField (also already worked)', () => {
    expect(buildBlockPathMap(topLevelPage(...tmpl), blocksConfig)['fld-1']?.typeField).toBe('field_type');
  });

  // THE REAL REPRODUCTION: form nested in columns → column of a forced template.
  test('a form field nested in columns → column (real footer) gets typeField', () => {
    expect(buildBlockPathMap(nestedPage(...tmpl), blocksConfig)['fld-1']?.typeField).toBe('field_type');
  });

  test('a form field nested in a plain (non-template) columns → column also gets typeField', () => {
    expect(buildBlockPathMap(nestedPage({}, {}), blocksConfig)['fld-1']?.typeField).toBe('field_type');
  });
});
