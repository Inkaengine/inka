/** Close the astro coverage gap: sync only generated react/vue/svelte tabs, so
 *  the astro renderers (which exist and are tested) were never documented. Add an
 *  astro tab to every `rendering` codeExample whose block has an astro renderer,
 *  found via the base name of a matching existing tab. */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { execSync } from 'child_process';
import { join } from 'path';

const SRC = 'docs/content/content/content';
const EX = 'docs/examples/examples';
const baseByContent = new Map(); // existing tab code -> renderer base name (e.g. SliderBlock)
for (const [fw, ext] of [['react', 'jsx'], ['vue', 'vue'], ['svelte', 'svelte']]) {
  for (const f of readdirSync(join(EX, fw))) {
    if (f.endsWith(`.${ext}`)) baseByContent.set(readFileSync(join(EX, fw, f), 'utf8').trim(), f.replace(/\.[^.]+$/, ''));
  }
}
const hash6 = (s) => createHash('sha1').update(s).digest('hex').slice(0, 6);

const files = execSync(`grep -rl '"slotId": "rendering"' ${SRC}`).toString().trim().split('\n').filter(Boolean);
let added = 0; const skipped = [];
for (const file of files) {
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  const slug = file.split('/').slice(-2)[0];
  let changed = false;
  (function walk(o) {
    if (!o || typeof o !== 'object') return;
    if (o['@type'] === 'codeExample' && o.slotId === 'rendering' && Array.isArray(o.tabs) && !o.tabs.some((t) => t.language === 'astro')) {
      let base = null;
      for (const t of o.tabs) { const b = baseByContent.get((t.code || '').trim()); if (b) { base = b; break; } }
      const ap = base && join(EX, 'astro', `${base}.astro`);
      if (ap && existsSync(ap)) {
        const code = readFileSync(ap, 'utf8').trim();
        o.tabs.push({ '@id': `ref-${slug}-rendering-astro-${hash6(code)}`, label: 'Astro', language: 'astro', code });
        changed = true; added += 1;
      } else skipped.push(`${slug} (base=${base})`);
    }
    for (const v of Object.values(o)) if (v && typeof v === 'object') walk(v);
  })(doc.blocks);
  if (changed) writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
}
console.log(`added ${added} astro tabs; ${skipped.length} skipped`);
skipped.forEach((s) => console.log('  skip', s));
