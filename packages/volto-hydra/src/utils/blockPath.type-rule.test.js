/**
 * The `@type` RULE: a typed object_list item carries a `typeRule` (a `when`-based
 * fieldRule whose `set` is a block-TYPE name) that decides the item's `@type` by
 * POSITION. `applySchemaDefaultsToFormData` — the same pass that applies field
 * defaults, run on every mutation — re-resolves that type and, when it differs from
 * the stored `@type`, CONVERTS the item in place via the container⇄value bridge.
 *
 * The motivating case: a table cell is `tableHeaderCell` (a single slate `value`)
 * in the header row and `tableCell` (a `blocks` container) elsewhere; moving a row
 * to/from row 0 flips its cells' types, losslessly. No new resolver, no editor
 * plumbing — "run the rules, see what changed, write it back".
 */
import { describe, test, expect, vi } from 'vitest';

vi.mock('../context', () => ({
  getHydraSchemaContext: () => ({}),
  setHydraSchemaContext: () => () => {},
  getLiveBlockData: () => undefined,
}));

import {
  applySchemaDefaultsToFormData,
  previewSchemaDefaultConversions,
  filterAddableTypesByRule,
} from './blockSync.js';
import {
  getBlockById,
  insertTableColumn,
  getContainerFieldConfig,
} from './blockPath.js';
import { buildBlockPathMap } from '../../../helpers/buildBlockPathMap.js';

const intl = { formatMessage: (m) => m?.defaultMessage || m?.id || '' };
const slate = (text) => [{ type: 'p', children: [{ text }] }];

// First row → header cell, else body cell. `../@index` is the CELL's ROW index.
const typeRule = [
  { when: { '../@index': { lt: 1 } }, set: 'tableHeaderCell' },
  { set: 'tableCell' },
];

const containerCell = (key, text) => ({
  '@type': 'tableCell',
  key,
  blocks: [{ '@id': `${key}-s`, '@type': 'slate', value: slate(text) }],
});

const makeForm = (rows) => ({
  '@type': 'Document',
  blocks: {
    t1: { '@type': 'tbl', table: { rows } },
  },
  blocks_layout: { items: ['t1'] },
});

const cfg = {
  _page: {
    id: '_page',
    schema: () => ({ properties: { items: { widget: 'blocks_layout' } } }),
  },
  slate: { id: 'slate' },
  tableCell: {
    id: 'tableCell',
    blockSchema: {
      properties: {
        blocks: { widget: 'object_list', typeField: '@type', allowedBlocks: ['slate'] },
      },
    },
  },
  tableHeaderCell: {
    id: 'tableHeaderCell',
    blockSchema: { properties: { value: { widget: 'slate' } } },
    // The container⇄value bridge, declared once on the value block.
    fieldMappings: { tableCell: { value: 'blocks/slate/value' } },
  },
  tbl: {
    id: 'tbl',
    blockSchema: {
      properties: {
        table: {
          widget: 'object',
          schema: {
            properties: {
              rows: {
                widget: 'object_list',
                idField: 'key',
                addMode: 'table',
                schema: {
                  properties: {
                    cells: {
                      widget: 'object_list',
                      idField: 'key',
                      typeField: '@type',
                      allowedBlocks: ['tableCell', 'tableHeaderCell'],
                      typeRule, // ← the @type rule under test
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

describe('@type rule — position converts a cell between container and value', () => {
  test('the header-row cell becomes tableHeaderCell (value merged); the body cell stays a container', () => {
    const form = makeForm([
      { key: 'r0', cells: [containerCell('c0', 'Method')] },
      { key: 'r1', cells: [containerCell('c1', 'Body')] },
    ]);
    const map = buildBlockPathMap(form, cfg, intl);
    // sanity: the rule is carried onto the typed item
    expect(map['c0']?.typeRule).toBe(typeRule);

    const out = applySchemaDefaultsToFormData(form, map, cfg, intl);

    const c0 = getBlockById(out, map, 'c0'); // getBlockById is path-based → still finds it
    expect(c0['@type']).toBe('tableHeaderCell'); // row 0 → converted to the value type
    expect(c0.blocks).toBeUndefined(); // container storage dropped
    expect(JSON.stringify(c0.value)).toContain('Method'); // collapsed to a value

    const c1 = getBlockById(out, map, 'c1');
    expect(c1['@type']).toBe('tableCell'); // row 1 → unchanged
    expect(c1.blocks).toHaveLength(1);
  });

  test('reordering rows flips the types: the new row-0 cell becomes a header, the old one reverts (text round-trips)', () => {
    // normalise once: c0 = header value, c1 = body container
    const form = makeForm([
      { key: 'r0', cells: [containerCell('c0', 'Method')] },
      { key: 'r1', cells: [containerCell('c1', 'Body')] },
    ]);
    let map = buildBlockPathMap(form, cfg, intl);
    let out = applySchemaDefaultsToFormData(form, map, cfg, intl);
    expect(getBlockById(out, map, 'c0')['@type']).toBe('tableHeaderCell');

    // simulate a DnD row reorder: swap the two rows, then re-run the pass
    const rows = out.blocks.t1.table.rows;
    out = {
      ...out,
      blocks: {
        ...out.blocks,
        t1: { ...out.blocks.t1, table: { rows: [rows[1], rows[0]] } },
      },
    };
    map = buildBlockPathMap(out, cfg, intl); // positions changed → rebuild
    out = applySchemaDefaultsToFormData(out, map, cfg, intl);

    // c1 is now in row 0 → a header value carrying its text
    const c1 = getBlockById(out, map, 'c1');
    expect(c1['@type']).toBe('tableHeaderCell');
    expect(JSON.stringify(c1.value)).toContain('Body');

    // c0 is now in row 1 → reverts to a container; its text survives value→container
    const c0 = getBlockById(out, map, 'c0');
    expect(c0['@type']).toBe('tableCell');
    expect(c0.blocks).toHaveLength(1);
    expect(JSON.stringify(c0.blocks[0].value)).toContain('Method');
  });

  test('a stable table (no position change) does not rewrite any cell type', () => {
    const form = makeForm([
      { key: 'r0', cells: [{ '@type': 'tableHeaderCell', key: 'c0', value: slate('H') }] },
      { key: 'r1', cells: [containerCell('c1', 'B')] },
    ]);
    const map = buildBlockPathMap(form, cfg, intl);
    const out = applySchemaDefaultsToFormData(form, map, cfg, intl);
    expect(getBlockById(out, map, 'c0')['@type']).toBe('tableHeaderCell'); // already right
    expect(getBlockById(out, map, 'c1')['@type']).toBe('tableCell');
  });
});

// Adding a column to a TABLE of typed cells: insertTableColumn splices a uniform
// template cell into every row, then the position typeRule re-types each new cell.
// The template MUST keep a valid @type (a typed object_list item) — clearing it (as
// the old virtual-cell path did) leaves an untyped cell the typeRule can't recover.
describe('table add-column with typed cells + typeRule', () => {
  test('a new column is spliced into every row and each new cell is typed by position', () => {
    const form = makeForm([
      { key: 'r0', cells: [containerCell('c0', 'A'), containerCell('c1', 'B')] },
      { key: 'r1', cells: [containerCell('c2', 'X'), containerCell('c3', 'Y')] },
    ]);
    // Settle the initial types (r0 = header cells, r1 = body cells).
    let map = buildBlockPathMap(form, cfg, intl);
    let f = applySchemaDefaultsToFormData(form, map, cfg, intl);
    map = buildBlockPathMap(f, cfg, intl);
    expect(getBlockById(f, map, 'c0')['@type']).toBe('tableHeaderCell');
    expect(getBlockById(f, map, 'c2')['@type']).toBe('tableCell');

    // Replicate the editor's cell template for a TYPED cell — keep the @type (the
    // fix): a real registered type, not a stripped/virtual one.
    const refCell = 'c2'; // body cell, row 1, index 0 → insert 'after' at index 1
    const cellType = map[refCell].blockType;
    expect(cellType).toBe('tableCell');
    let n = 0;
    const uuidGen = () => `new-${n++}`;
    const { formData: added } = insertTableColumn(
      f,
      map,
      refCell,
      { '@type': cellType, blocks: [] },
      'after',
      uuidGen,
    );

    // Re-run the pass so the position typeRule types the new cells.
    map = buildBlockPathMap(added, cfg, intl);
    const out = applySchemaDefaultsToFormData(added, map, cfg, intl);
    const rows = out.blocks.t1.table.rows;

    // Every row grew by one cell (uniform columns).
    expect(rows[0].cells).toHaveLength(3);
    expect(rows[1].cells).toHaveLength(3);
    // The new cell in the HEADER row is a tableHeaderCell; in the body row a
    // tableCell — the typeRule re-typed each by its position.
    expect(rows[0].cells[1]['@type']).toBe('tableHeaderCell');
    expect(rows[1].cells[1]['@type']).toBe('tableCell');
  });
});

// Adding into a typeRule-driven container: the position rule filters the add
// options to the type(s) it wouldn't immediately rewrite — so the menu offers the
// right cell type (usually one → the caller adds it directly, no chooser).
describe('filterAddableTypesByRule — position rule filters the add options', () => {
  const build = () => {
    const form = makeForm([
      { key: 'r0', cells: [containerCell('c0', 'A'), containerCell('c1', 'B')] },
      { key: 'r1', cells: [containerCell('c2', 'X'), containerCell('c3', 'Y')] },
    ]);
    let map = buildBlockPathMap(form, cfg, intl);
    const f = applySchemaDefaultsToFormData(form, map, cfg, intl);
    map = buildBlockPathMap(f, cfg, intl);
    return { f, map };
  };
  const opts = ['tableCell', 'tableHeaderCell'];

  test('at a BODY cell only tableCell survives (tableHeaderCell would be re-typed away)', () => {
    const { f, map } = build();
    const cc = getContainerFieldConfig('c2', map, f, cfg, intl);
    expect(filterAddableTypesByRule(opts, f, map, 'c2', cc, cfg, intl)).toEqual([
      'tableCell',
    ]);
  });

  test('at a HEADER cell only tableHeaderCell survives', () => {
    const { f, map } = build();
    const cc = getContainerFieldConfig('c0', map, f, cfg, intl);
    expect(filterAddableTypesByRule(opts, f, map, 'c0', cc, cfg, intl)).toEqual([
      'tableHeaderCell',
    ]);
  });

  test('a region with NO typeRule short-circuits — all allowed types returned', () => {
    // A tableCell's `blocks` region (slate/image/video) has no typeRule, so the
    // filter must return the list unchanged without the per-type sandbox.
    const { f, map } = build();
    const inner = ['slate', 'image', 'video'];
    const cc = getContainerFieldConfig('c2-s', map, f, cfg, intl); // the cell's blocks region
    expect(map['c2-s']?.typeRule).toBeUndefined(); // no rule carried here
    expect(filterAddableTypesByRule(inner, f, map, 'c2-s', cc, cfg, intl)).toEqual(inner);
  });
});

// The generic "sandbox the drop, see what converts" detector the DnD/paste path
// uses to decide whether to ask before committing.
describe('previewSchemaDefaultConversions — trial a candidate, report @type changes', () => {
  test('a candidate whose rules convert a cell reports that conversion (and returns the converted formData)', () => {
    // Candidate = a container cell sitting in the header row (as if just dropped there).
    const candidate = makeForm([
      { key: 'r0', cells: [containerCell('c0', 'Method')] },
      { key: 'r1', cells: [containerCell('c1', 'Body')] },
    ]);
    const map = buildBlockPathMap(candidate, cfg, intl);
    const { formData, conversions } = previewSchemaDefaultConversions(candidate, map, cfg, intl);

    expect(conversions).toEqual([
      { blockId: 'c0', from: 'tableCell', to: 'tableHeaderCell' },
    ]);
    // the returned formData is already converted — the caller commits it as-is
    expect(getBlockById(formData, map, 'c0')['@type']).toBe('tableHeaderCell');
    expect(getBlockById(formData, map, 'c1')['@type']).toBe('tableCell');
  });

  test('a candidate the rules leave alone reports no conversions (→ commit silently)', () => {
    const candidate = makeForm([
      { key: 'r0', cells: [{ '@type': 'tableHeaderCell', key: 'c0', value: slate('H') }] },
      { key: 'r1', cells: [containerCell('c1', 'B')] },
    ]);
    const map = buildBlockPathMap(candidate, cfg, intl);
    const { conversions } = previewSchemaDefaultConversions(candidate, map, cfg, intl);
    expect(conversions).toEqual([]);
  });
});
