import {
  assertAllExpanded,
  ensureMutablePath,
  expandTemplatesSync,
  getChildBlockEntries,
  getChildFields,
  setChildBlockEntries,
} from '@volto-hydra/helpers';

/**
 * What a frontend does, in one function: docs/frontend-guide/templates.md "Expand every
 * container". Each container passes its children through the merge, sharing one
 * templateState. A real frontend's block code knows its id fields; `idFieldMap` stands
 * in for that knowledge here and is never passed to the merge. Ends as a frontend's test
 * should, asking that nothing was skipped.
 */
export function expandEveryContainer(items, options) {
  const out = expandList(items, options);
  assertAllExpanded(options.templateState);
  return out;
}

function expandList(items, { idFieldMap = null, ...options }) {
  return expandTemplatesSync(items, options).map(({ '@uid': id, ...block }) => ({
    ...expandChildren(block, idFieldMap, options),
    '@uid': id,
  }));
}

function expandChildren(block, idFieldMap, options) {
  const fields = getChildFields(block, idFieldMap, { allObjectLists: true, templateChildren: true });
  if (fields.length === 0) return block;
  const out = { ...block };
  for (const field of fields) {
    if (!field.isObjectList) ensureMutablePath(out, field.regionPath || []).blocks = {};
  }
  for (const field of fields) {
    const entries = getChildBlockEntries(block, field);
    const { allowedLayouts: _forced, idField: _outer, blocks: _dict, ...shared } = options;
    const children = field.isObjectList
      ? expandList(entries.map((entry) => entry.block), { ...shared, idFieldMap, idField: field.idField })
      : expandList(entries.map((entry) => entry.id), {
          ...shared,
          idFieldMap,
          blocks: Object.fromEntries(entries.map((entry) => [entry.id, entry.block])),
        });
    setChildBlockEntries(out, field, children.map(({ '@uid': id, ...child }) => ({ id, block: child })));
  }
  return out;
}
