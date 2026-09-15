import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname, resolve, relative } from 'path';
import { fileURLToPath } from 'url';
import { pageToMd, mdToPage } from '../../lib/blockmd.mjs';
const HERE = dirname(fileURLToPath(import.meta.url));
const INKA = resolve(HERE, '../..');
const schema = JSON.parse(readFileSync(join(HERE, 'schemas.json'), 'utf8'));
function walk(d, h = []) { if (!existsSync(d)) return h;
  for (const n of readdirSync(d)) { const p = join(d, n);
    statSync(p).isDirectory() ? walk(p, h) : (n === 'data.json' && h.push(p)); } return h; }
function sem(v){ if(Array.isArray(v))return v.map(sem).filter(x=>x!==undefined);
  if(v&&typeof v==='object'){const k=Object.keys(v);
    if(k.length===1&&k[0]==='text'&&v.text==='')return undefined;
    const o={};for(const key of k.sort()){if(key==='plaintext')continue;const r=sem(v[key]);if(r!==undefined)o[key]=r;}return o;}
  return v; }
function flat(b,o={},p=''){for(const[u,x]of Object.entries(b||{})){if(!x||typeof x!=='object')continue;
  const{blocks:k,blocks_layout,...rest}=x;o[p+u]=rest;if(k)flat(k,o,`${p+u}/`);}return o;}
for (const root of [resolve(INKA,'../content/content'), resolve(INKA,'docs/content/content/content')]) {
  for (const f of walk(root)) {
    let page; try { page = JSON.parse(readFileSync(f,'utf8')); } catch { continue; }
    if (!page.blocks) continue;
    const back = mdToPage(pageToMd(page, schema), schema);
    const A = flat(page.blocks), B = flat(back.blocks);
    for (const uid of new Set([...Object.keys(A),...Object.keys(B)])) {
      const a = JSON.stringify(sem(A[uid])), b = JSON.stringify(sem(B[uid]));
      if (a === b) continue;
      console.log(`\n### ${relative(INKA,f)} :: ${uid} (${(A[uid]||B[uid]||{})['@type']})`);
      // find first differing character run
      let i = 0; while (i < Math.min(a?.length??0, b?.length??0) && a[i] === b[i]) i++;
      console.log('  was: …' + String(a).slice(Math.max(0,i-60), i+110));
      console.log('  got: …' + String(b).slice(Math.max(0,i-60), i+110));
    }
  }
}
