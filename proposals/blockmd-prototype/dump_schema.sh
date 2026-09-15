#!/bin/bash
# Dump block schemas to JSON for the python prototype. The schema is the only
# thing that distinguishes an object_list field (children) from an
# object_browser field (link references) — both are [{"@id": ...}] in storage.
cd "$(dirname "$0")/../.." || exit 1
node --input-type=module -e "
import { sharedBlocksConfig as c } from './tests-playwright/fixtures/shared-block-schemas.js';
const out = {};
for (const [type, def] of Object.entries(c)) {
  const props = def.blockSchema?.properties || {};
  const fields = {};
  for (const [f, p] of Object.entries(props)) if (p?.widget) fields[f] = { widget: p.widget };
  if (Object.keys(fields).length) out[type] = fields;
}
console.log(JSON.stringify(out, null, 1));
" > proposals/blockmd-prototype/schemas.json
echo "wrote proposals/blockmd-prototype/schemas.json"
