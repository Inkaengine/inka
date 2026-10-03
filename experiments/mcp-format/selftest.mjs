/** Every format must round-trip every docs page losslessly before it can score a model. */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { sharedBlocksConfig } from '../../tests-playwright/fixtures/shared-block-schemas.js';
import { decodePage } from '../../lib/prototype-mapping.mjs';
import {
  storedToSimple, simpleToStored, toTagged, fromTagged, splitPage, blockmdToStored, storedToBlockmd, richFieldsFrom,
} from './formats.mjs';
import { canon } from './score.mjs';

const DOCS = new URL('../../docs/', import.meta.url).pathname;
const pages = [];
(function walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) { if (!['content', 'node_modules'].includes(e.name) && !e.name.startsWith('test-')) walk(p); }
    else if (e.name.endsWith('.md')) pages.push(p);
  }
})(DOCS);

const richFields = richFieldsFrom(sharedBlocksConfig);
const eq = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const fails = { simple: [], tagged: [], blockmd: [] };
let n = 0;
for (const file of pages) {
  const md = readFileSync(file, 'utf8');
  let stored, split;
  try { split = splitPage(md); if (split.fm['@type'] !== 'Document') continue; stored = decodePage(md); } catch { continue; }
  if (!stored.blocks_layout) continue;
  n++;
  const rel = file.slice(DOCS.length);
  const S = storedToSimple(stored);
  try { if (!eq(storedToSimple(simpleToStored(S)), S)) fails.simple.push(rel); } catch (e) { fails.simple.push(`${rel}: ${e.message}`); }
  try { if (!eq(fromTagged(toTagged(S, { richFields }), { richFields }), S)) fails.tagged.push(rel); } catch (e) { fails.tagged.push(`${rel}: ${e.message}`); }
  try { if (!eq(storedToSimple(blockmdToStored(split.frontmatter, storedToBlockmd(split.fm, stored))), S)) fails.blockmd.push(rel); } catch (e) { fails.blockmd.push(`${rel}: ${e.message}`); }
}
console.log(`${n} pages`);
for (const [k, v] of Object.entries(fails)) console.log(`${k}: ${v.length} fail`, v.slice(0, 8));
process.exitCode = Object.values(fails).some((v) => v.length) ? 1 : 0;

// The validator must accept every real page — no false failures.
import { validate } from './validate.mjs';
let vbad = 0;
for (const file of pages) {
  let stored; try { const s = splitPage(readFileSync(file, 'utf8')); if (s.fm['@type'] !== 'Document') continue; stored = decodePage(readFileSync(file, 'utf8')); } catch { continue; }
  if (!stored.blocks_layout) continue;
  const errs = validate(storedToSimple(stored));
  if (errs.length) { vbad++; console.log('validate', file.slice(DOCS.length), errs.slice(0, 3)); }
}
console.log(`validator: ${vbad} pages rejected`);
if (vbad) process.exitCode = 1;
