/**
 * Scoring in the canonical form. `canon` normalises what no format should be
 * judged on: minted ids, key order, markdown spelling of the same Slate.
 */
import { mdToSlate, slateToMd } from '../../lib/slate-md.mjs';

const MINTED = /^(i-?\d+|b\d+)$/;

export function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    if (Object.keys(v).length === 1 && typeof v.md === 'string') return { md: slateToMd(mdToSlate(v.md)) };
    const out = {};
    for (const k of Object.keys(v).sort()) {
      if ((k === '@id' || k === 'key') && typeof v[k] === 'string' && MINTED.test(v[k])) continue; // minted ids renumber
      out[k] = canon(v[k]);
    }
    return out;
  }
  return v;
}

/**
 * Compare a result page with the expected one. Returns { ok, diffs } where diffs
 * name each mismatching path. `$partial` nodes need only their listed fields.
 */
export function compare(expected, actual) {
  const diffs = [];
  const walk = (e, a, path) => {
    if (e && typeof e === 'object' && '$partial' in e) {
      if (!a || typeof a !== 'object') { diffs.push(`${path}: expected an object`); return; }
      for (const [k, v] of Object.entries(e.$partial)) walk(v, a[k], `${path}.${k}`);
      return;
    }
    if (Array.isArray(e)) {
      if (!Array.isArray(a)) { diffs.push(`${path}: expected an array`); return; }
      if (a.length !== e.length) diffs.push(`${path}: length ${a.length}, expected ${e.length}`);
      for (let i = 0; i < Math.min(e.length, a.length); i++) walk(e[i], a[i], `${path}[${i}]`);
      return;
    }
    const isMdNode = (x) => x && typeof x === 'object' && Object.keys(x).length === 1 && typeof x.md === 'string';
    if (e && typeof e === 'object' && !isMdNode(e)) {
      if (!a || typeof a !== 'object' || Array.isArray(a)) { diffs.push(`${path}: expected an object`); return; }
      const ce = canon(e); const ca = canon(a);
      for (const k of new Set([...Object.keys(ce), ...Object.keys(ca)])) {
        if (!(k in ce)) diffs.push(`${path}.${k}: unexpected field ${JSON.stringify(ca[k])?.slice(0, 80)}`);
        else if (!(k in ca)) diffs.push(`${path}.${k}: missing`);
        else walk(e[k] ?? ce[k], a[k] ?? ca[k], `${path}.${k}`);
      }
      return;
    }
    const sa = JSON.stringify(canon(a)); const se = JSON.stringify(canon(e));
    if (sa !== se) {
      // Show the text around the first difference, not the shared start.
      let k = 0;
      while (k < sa?.length && sa[k] === se?.[k]) k++;
      const from = Math.max(0, k - 50);
      const cut = (x) => `${from ? '…' : ''}${x?.slice(from, k + 60)}${x?.length > k + 60 ? '…' : ''}`;
      diffs.push(`${path}: ${cut(sa)} ≠ expected ${cut(se)}`);
    }
  };
  walk(expected, actual, '$');
  return { ok: diffs.length === 0, diffs };
}
