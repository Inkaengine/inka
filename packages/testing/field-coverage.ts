// Field-editability coverage for block-sanity — collected per test, combined by
// the coverage reporter across all parallel workers.
//
// A field only needs its edit annotation ([data-edit-text] / [data-edit-media] /
// [data-edit-link]) in ONE example of a block type, not every one: a field can be
// gated by an optional synced element or simply empty in some examples (a teaser
// with no target renders a placeholder with no link — legitimately not editable
// there). So the per-example render check RECORDS coverage here rather than
// throwing, and the aggregate fails a field only if it is editable in NO example.
//
// This module stays free of any Playwright dependency (the unit tests import it):
// it just accumulates THIS test's records. The spec attaches them to the test via
// testInfo.attach, and the coverage reporter — which runs in the main process and
// receives every worker's attachments — merges them and runs `fieldsNeverEditable`
// once. That is the framework-native way to combine parallel results; no shared
// files, no worker/ordering assumptions.

export type FieldKind = 'text' | 'media' | 'link';

export interface FieldRecord {
  kind: FieldKind;
  blockType: string;
  field: string;
  editable: boolean;
  example: string;
}

// This test's records. Drained (and cleared) by the spec's afterEach, which
// attaches them; tests in a worker run one at a time, so this holds only the
// current test's records between drains.
const pending: FieldRecord[] = [];

/**
 * Record whether a `kind` field of `blockType` was editable (its edit annotation
 * present) in this example. The aggregate fails a field only if it was editable
 * in NO example across ALL workers.
 */
export function recordFieldEditable(
  kind: FieldKind,
  blockType: string,
  field: string,
  editable: boolean,
  example: string,
): void {
  pending.push({ kind, blockType, field, editable, example });
}

/** Slate-specific alias, preserved for existing call sites (slate → data-edit-text). */
export function recordSlateFieldContainer(
  blockType: string,
  field: string,
  hasContainer: boolean,
  example: string,
): void {
  recordFieldEditable('text', blockType, field, hasContainer, example);
}

/** Return this test's records and clear them, for the spec to attach. */
export function drainFieldCoverage(): FieldRecord[] {
  const out = pending.slice();
  pending.length = 0;
  return out;
}

export interface UneditableField {
  kind: FieldKind;
  blockType: string;
  field: string;
  example: string;
}
export type UneditableSlateField = UneditableField;

const keyOf = (kind: FieldKind, blockType: string) => `${kind} ${blockType}`;

/**
 * Fields that were missing their edit annotation in at least one example AND
 * never had it in any example of the same block type — over the MERGED records
 * from every worker. Optionally scoped to a kind. Pure: the reporter calls it
 * with all attachments folded together; the unit tests call it directly.
 */
export function fieldsNeverEditable(
  records: FieldRecord[],
  kind?: FieldKind,
): UneditableField[] {
  const seen = new Map<string, Set<string>>();
  const missing = new Map<string, Map<string, string>>();
  for (const rec of records) {
    const key = keyOf(rec.kind, rec.blockType);
    if (rec.editable) {
      let set = seen.get(key);
      if (!set) seen.set(key, (set = new Set()));
      set.add(rec.field);
    } else {
      let miss = missing.get(key);
      if (!miss) missing.set(key, (miss = new Map()));
      if (!miss.has(rec.field)) miss.set(rec.field, rec.example);
    }
  }
  const out: UneditableField[] = [];
  for (const [key, fields] of missing) {
    const [k, blockType] = key.split(' ') as [FieldKind, string];
    if (kind && k !== kind) continue;
    for (const [field, example] of fields) {
      if (!seen.get(key)?.has(field)) {
        out.push({ kind: k, blockType, field, example });
      }
    }
  }
  return out;
}
