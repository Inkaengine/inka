import { describe, it, expect } from 'vitest';
import { ensureMutablePath } from './index.js';

describe('ensureMutablePath', () => {
  // A path may run through a list (`table.rows.0.cells.1`): each step is copied
  // so the caller can write without touching the original, and a list must stay
  // a list. Copying it as an object turned the rows into { "0": …, "1": … }.
  it('keeps a list a list when the path runs through it', () => {
    const table = { rows: [{ cells: [{ v: 'a' }, { v: 'b' }] }, { cells: [] }] };
    ensureMutablePath(table, ['rows', '0', 'cells', '1']).width = 40;
    expect(Array.isArray(table.rows)).toBe(true);
    expect(Array.isArray(table.rows[0].cells)).toBe(true);
    expect(table.rows[0].cells[1]).toEqual({ v: 'b', width: 40 });
  });

  it('copies each step, so the original is untouched', () => {
    const original = { rows: [{ cells: [{ v: 'a' }] }] };
    const copy = { ...original };
    ensureMutablePath(copy, ['rows', '0', 'cells', '0']).width = 1;
    expect(original.rows[0].cells[0]).toEqual({ v: 'a' });
  });

  it('makes the objects a missing path needs', () => {
    const o = {};
    ensureMutablePath(o, ['a', 'b']).c = 1;
    expect(o).toEqual({ a: { b: { c: 1 } } });
  });
});
