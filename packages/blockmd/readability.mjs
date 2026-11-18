#!/usr/bin/env node
/**
 * How readable a page's markdown is. A page reads like a README when its words are
 * markdown a person reads: headings, paragraphs, lists, link text. Measured from the
 * markdown alone (no schemas, like decode), three ways:
 *
 *  - words: of the page's words, how many are in the markdown and how many in tags,
 *    attributes and JSON. `prose` is the markdown's share: the headline number.
 *    A value with no space in it ("full", "h2", "/a/path") is a token, not words.
 *  - blocks: how each block is written. Bare markdown is best, then a light
 *    `<block>` tag around markdown, then a `<fields>` tag, then raw `data-json`.
 *    `byType` says which block types are written as tags, so which need a prototype.
 *  - overhead: the share of the body's characters that are tags.
 *
 * Usage: node readability.mjs <dir> [--json]   (every .md under <dir>, worst first)
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ignore from 'ignore';
import { mdParser } from './slate-md.mjs';
import { decodePage } from './prototype-mapping.mjs';

const FRONTMATTER = /^---\n[\s\S]*?\n---\n?/;
const ATTR = /([\w:.@-]+)=("([^"]*)"|'([^']*)')/g;
const ENTITIES = { '&quot;': '"', '&#39;': "'", '&apos;': "'", '&lt;': '<', '&gt;': '>', '&amp;': '&' };
const unescape = (s) => s.replace(/&(quot|#39|apos|lt|gt|amp);/g, (e) => ENTITIES[e]);
const wordCount = (s) => (s.match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu) || []).length;
// A string a person wrote has a space in it; a token or a path does not.
const proseWords = (s) => (/\s/.test(s.trim()) ? wordCount(s) : 0);

function jsonWords(value) {
  if (typeof value === 'string') return proseWords(value);
  if (Array.isArray(value)) return value.reduce((n, v) => n + jsonWords(v), 0);
  if (value && typeof value === 'object') return Object.values(value).reduce((n, v) => n + jsonWords(v), 0);
  return 0;
}

// Words in a tag's attribute values, `data-json` read as the JSON it holds.
function tagWords(html) {
  let n = 0;
  for (const m of html.matchAll(ATTR)) {
    const value = unescape(m[3] ?? m[4]);
    n += m[1] === 'data-json' ? jsonWords(JSON.parse(value)) : proseWords(value);
  }
  return n;
}

// Every block the page decodes to, at any depth.
function blockCount(value) {
  if (Array.isArray(value)) return value.reduce((n, v) => n + blockCount(v), 0);
  if (!value || typeof value !== 'object') return 0;
  const own = typeof value['@type'] === 'string' ? 1 : 0;
  return own + Object.values(value).reduce((n, v) => n + blockCount(v), 0);
}

/** How readable one page's markdown is (see the module comment). */
export function pageReadability(md) {
  const body = md.replace(FRONTMATTER, '');
  const words = { markdown: 0, tags: 0 };
  const blocks = { bare: 0, light: 0, fields: 0, raw: 0 };
  const byType = {};
  let tagChars = 0;

  const walk = (node) => {
    if (node.type === 'html') {
      tagChars += node.value.replace(/\s/g, '').length;
      words.tags += tagWords(node.value);
      for (const tag of node.value.matchAll(/<(block|fields)\b[^>]*>/g)) {
        if (tag[1] === 'fields') { blocks.fields += 1; continue; }
        const type = /\btype="([^"]+)"/.exec(tag[0])?.[1] ?? '?';
        const form = /\bdata-json=/.test(tag[0]) ? 'raw' : 'light';
        blocks[form] += 1;
        byType[type] ??= { light: 0, fields: 0, raw: 0 };
        byType[type][form] += 1;
      }
      return;
    }
    if (node.type === 'text' || node.type === 'inlineCode') words.markdown += wordCount(node.value);
    for (const child of node.children ?? []) walk(child);
  };
  walk(mdParser.parse(body));

  const tagged = blocks.light + blocks.fields + blocks.raw;
  const { blocks: decoded } = decodePage(md);
  blocks.bare = Math.max(0, blockCount(decoded) - tagged);
  const total = words.markdown + words.tags;
  const chars = body.replace(/\s/g, '').length;
  const nBlocks = blocks.bare + tagged;
  return {
    words,
    prose: total ? words.markdown / total : 1,
    blocks,
    formScore: nBlocks ? (blocks.bare + 0.75 * blocks.light + 0.4 * blocks.fields) / nBlocks : 1,
    overhead: chars ? tagChars / chars : 0,
    byType,
  };
}

function* markdownFiles(root, dir = root, ig = loadIgnore(root)) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const rel = relative(root, path);
    if (name === 'node_modules' || name.startsWith('.')) continue;
    if (statSync(path).isDirectory()) {
      if (!ig.ignores(`${rel}/`)) yield* markdownFiles(root, path, ig);
    } else if (name.endsWith('.md') && !ig.ignores(rel)) yield path;
  }
}

function loadIgnore(root) {
  const ig = ignore();
  const file = join(root, '.blockmdignore');
  if (existsSync(file)) ig.add(readFileSync(file, 'utf8'));
  return ig;
}

const pct = (x) => `${Math.round(x * 100)}%`.padStart(4);

/** Every page under `root`, worst prose first, and the block types written as tags. */
export function treeReadability(root) {
  const pages = [];
  for (const file of markdownFiles(root)) {
    const md = readFileSync(file, 'utf8');
    if (!FRONTMATTER.test(md)) continue;
    pages.push({ page: relative(root, file), ...pageReadability(md) });
  }
  pages.sort((a, b) => a.prose - b.prose || a.formScore - b.formScore);
  const sum = (f) => pages.reduce((n, p) => n + f(p), 0);
  const words = { markdown: sum((p) => p.words.markdown), tags: sum((p) => p.words.tags) };
  const types = {};
  for (const p of pages) {
    for (const [t, c] of Object.entries(p.byType)) {
      types[t] ??= { light: 0, fields: 0, raw: 0 };
      for (const k of Object.keys(c)) types[t][k] += c[k];
    }
  }
  return { pages, words, prose: words.markdown / (words.markdown + words.tags || 1), types };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [root] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (!root) {
    console.error('usage: readability.mjs <dir> [--json]');
    process.exit(2);
  }
  const report = treeReadability(root);
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`${report.pages.length} pages: ${pct(report.prose)} of words in markdown (${report.words.markdown} in markdown, ${report.words.tags} in tags)\n`);
    console.log('prose form  tags  page');
    for (const p of report.pages) {
      console.log(`${pct(p.prose)}  ${pct(p.formScore)}  ${pct(p.overhead)}  ${p.page}  [bare ${p.blocks.bare}, tag ${p.blocks.light}, fields ${p.blocks.fields}, json ${p.blocks.raw}]`);
    }
    console.log('\nwritten as tags, by block type (light / fields / json):');
    for (const [t, c] of Object.entries(report.types).sort((a, b) => (b[1].raw - a[1].raw) || (b[1].light - a[1].light))) {
      console.log(`  ${t}: ${c.light} / ${c.fields} / ${c.raw}`);
    }
  }
}
