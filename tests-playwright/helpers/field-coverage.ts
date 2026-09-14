// Aggregate field editability across all discovered block examples — CROSS-WORKER.
//
// A field only needs its edit annotation ([data-edit-text] / [data-edit-media] /
// [data-edit-link]) in ONE example of a block type, not every one: a field can be
// gated by an optional synced element or simply empty in some examples (a teaser
// with no target renders a placeholder with no link — legitimately not editable
// there). So the per-example render check RECORDS coverage here rather than
// throwing, and a final aggregate (fieldsNeverEditable) fails a field only if it
// is editable in NO example of its type.
//
// The aggregate must see EVERY worker's records. block-sanity runs fully parallel
// (fullyParallel: true), so in-process module state would split per worker and a
// field seen editable in worker A but recorded missing in worker B would
// false-fail. Instead each record is APPENDED to a per-worker file under
// `.generated/field-coverage/`, and the aggregate reads ALL of them — so the
// result is exact regardless of how tests are sharded. `resetFieldCoverage()`
// (called from globalSetup) clears the dir at the start of a run.

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Under tests-playwright/.generated (same root globalSetup uses for its artifacts).
const COVERAGE_DIR = path.resolve(__dirname, '../.generated/field-coverage');

// One file per worker: parallel workers never write the same file, so appends
// never interleave and no lock is needed. TEST_WORKER_INDEX is set by Playwright
// per worker; fall back to the pid for any non-worker caller.
const workerFile = () =>
  path.join(
    COVERAGE_DIR,
    `w${process.env.TEST_WORKER_INDEX ?? `pid${process.pid}`}.jsonl`,
  );

type FieldKind = 'text' | 'media' | 'link';
const keyOf = (kind: FieldKind, blockType: string) => `${kind} ${blockType}`;

interface Record_ {
  kind: FieldKind;
  blockType: string;
  field: string;
  editable: boolean;
  example: string;
}

/** Clear the coverage dir for a fresh run. Call once, from globalSetup. */
export function resetFieldCoverage(): void {
  fs.rmSync(COVERAGE_DIR, { recursive: true, force: true });
  fs.mkdirSync(COVERAGE_DIR, { recursive: true });
}

/**
 * Record whether a `kind` field of `blockType` was editable (its edit annotation
 * present) in this example. Appended to this worker's file; the aggregate
 * (`fieldsNeverEditable`) fails a field only if it was editable in NO example
 * across ALL workers.
 */
export function recordFieldEditable(
  kind: FieldKind,
  blockType: string,
  field: string,
  editable: boolean,
  example: string,
): void {
  const rec: Record_ = { kind, blockType, field, editable, example };
  try {
    fs.mkdirSync(COVERAGE_DIR, { recursive: true });
    fs.appendFileSync(workerFile(), JSON.stringify(rec) + '\n');
  } catch {
    // Coverage is diagnostic, not the test's own assertion — never fail a render
    // check because its coverage note couldn't be written.
  }
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

export interface UneditableField {
  kind: FieldKind;
  blockType: string;
  field: string;
  example: string;
}
export type UneditableSlateField = UneditableField;

/** Read every worker's records and fold them into seen/missing sets. */
function aggregate(): {
  seen: Map<string, Set<string>>;
  missing: Map<string, Map<string, string>>;
} {
  const seen = new Map<string, Set<string>>();
  const missing = new Map<string, Map<string, string>>();
  let files: string[] = [];
  try {
    files = fs.readdirSync(COVERAGE_DIR).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return { seen, missing };
  }
  for (const file of files) {
    let text = '';
    try {
      text = fs.readFileSync(path.join(COVERAGE_DIR, file), 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      if (!line) continue;
      let rec: Record_;
      try {
        rec = JSON.parse(line);
      } catch {
        continue;
      }
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
  }
  return { seen, missing };
}

// Fields that were missing their edit annotation in at least one example AND
// never had it in any example of the same block type, across ALL workers.
// Optionally scoped to a kind.
export function fieldsNeverEditable(kind?: FieldKind): UneditableField[] {
  const { seen, missing } = aggregate();
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

/** Slate-specific alias, preserved for existing call sites. */
export function slateFieldsNeverEditable(): UneditableField[] {
  return fieldsNeverEditable('text');
}
