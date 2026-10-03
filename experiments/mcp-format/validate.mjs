/**
 * Validate a canonical page against the registered schemas: known block types,
 * and the declared fields' value shapes. This is the check that turns a silent
 * mis-decode (a link written as a plain string) into an error the agent can fix.
 */
import { sharedBlocksConfig } from '../../tests-playwright/fixtures/shared-block-schemas.js';
import { isMd, isLayoutField } from './formats.mjs';

function checkField(f, v, where, errors) {
  const bad = (what) => errors.push(`${where}: ${what}, got ${JSON.stringify(v)?.slice(0, 80)}`);
  if (v === undefined || v === null) return;
  switch (f.widget) {
    case 'slate': if (!isMd(v)) bad('rich text expected'); return;
    case 'object_browser':
    case 'url':
      if (f.widget === 'url' && typeof v === 'string') return;
      if (!Array.isArray(v) || !v.every((x) => x && typeof x['@id'] === 'string')) bad('a link [{"@id": "/path"}] expected');
      return;
    case 'blocks_layout': if (!Array.isArray(v)) bad('a list of blocks expected'); return;
    default:
  }
  // `{literalinclude}` etc. are docs build directives standing in for a value.
  const directive = typeof v === 'string' && /^\{[a-z-]+\}$/.test(v);
  if (f.choices && !f.isMulti && !directive && !f.choices.some((c) => c[0] === v)) bad(`one of ${f.choices.map((c) => JSON.stringify(c[0])).join(', ')} expected`);
  if (f.type === 'boolean' && typeof v !== 'boolean') bad('true/false expected');
  if ((f.type === 'number' || f.type === 'integer') && typeof v !== 'number') bad('a number expected');
  if ((f.type === 'string' || f.widget === 'textarea') && !f.choices && typeof v !== 'string') bad('a string expected');
}

export function validate(blocks) {
  const errors = [];
  const walk = (list, path) => list.forEach((b, i) => {
    const where = `${path}[${i}] (${b?.['@type']})`;
    const cfg = sharedBlocksConfig[b?.['@type']];
    if (!cfg) { errors.push(`${where}: unknown block type`); return; }
    const props = cfg.blockSchema?.properties ?? {};
    for (const [k, v] of Object.entries(b)) {
      if (Array.isArray(v) && isLayoutField(b['@type'], k)) { walk(v, `${path}[${i}].${k}`); continue; }
      const f = props[k];
      if (f) checkField(f, v, `${where}.${k}`, errors);
      // object_list items: their own fields, and any blocks they hold
      if (Array.isArray(v)) {
        v.forEach((it, j) => {
          if (!it || typeof it !== 'object') return;
          const itemProps = f?.schema?.properties ?? sharedBlocksConfig[it['@type']]?.blockSchema?.properties ?? {};
          for (const [ik, iv] of Object.entries(it)) {
            if (ik === 'blocks' && Array.isArray(iv)) walk(iv, `${path}[${i}].${k}[${j}].blocks`);
            else if (Array.isArray(iv) && it['@type'] && isLayoutField(it['@type'], ik)) walk(iv, `${path}[${i}].${k}[${j}].${ik}`);
            else if (itemProps[ik]) checkField(itemProps[ik], iv, `${where}.${k}[${j}].${ik}`, errors);
          }
        });
      }
    }
  });
  walk(blocks, '$');
  return errors;
}
