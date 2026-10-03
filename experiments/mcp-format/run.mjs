/**
 * Run the format experiment.
 *
 *   node run.mjs --perfect                       # no LLM: expected answers must all score ok
 *   node run.mjs --models anthropic/claude-haiku-4-5 --formats tagged,simple --reps 1
 *
 * Needs DEEPINFRA_API_KEY (OpenAI-compatible endpoint). Results append to
 * results/<run>.jsonl, one line per attempt.
 */
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { sharedBlocksConfig } from '../../tests-playwright/fixtures/shared-block-schemas.js';
import { decodePage } from '../../lib/prototype-mapping.mjs';
import {
  storedToSimple, simpleToStored, toTagged, fromTagged, splitPage, prototypeText,
  blockmdToStored, storedToBlockmd, richFieldsFrom,
} from './formats.mjs';
import { catalogue, FORMATS } from './describe.mjs';
import { TASKS } from './tasks.mjs';
import { compare } from './score.mjs';
import { validate } from './validate.mjs';
import { withUids, stripUids, applyOps } from './ops.mjs';

const DOCS = new URL('../../docs/', import.meta.url).pathname;
const RESULTS = new URL('./results/', import.meta.url).pathname;
const richFields = richFieldsFrom(sharedBlocksConfig);

const { values: opt } = parseArgs({
  options: {
    perfect: { type: 'boolean', default: false },
    models: { type: 'string', default: 'anthropic/claude-haiku-4-5' },
    formats: { type: 'string', default: 'blockmd,tagged,simple,stored,ops' },
    tasks: { type: 'string', default: '' },
    reps: { type: 'string', default: '1' },
    repair: { type: 'string', default: '1' },
    run: { type: 'string', default: new Date().toISOString().replace(/[:.]/g, '-') },
    concurrency: { type: 'string', default: '8' },
    rescore: { type: 'string', default: '' },
    lenient: { type: 'boolean', default: false },
  },
});

// ------------------------------------------------------------- formats ---

/** Each format: render a page for the agent, and parse the agent's page back to canonical. */
const FMT = {
  blockmd: {
    render: (page) => storedToBlockmd(page.fm, page.stored),
    parse: (page, text) => storedToSimple(blockmdToStored(page.frontmatter, text)),
  },
  tagged: {
    render: (page) => toTagged(page.simple, { richFields }),
    parse: (page, text) => fromTagged(text, { richFields }),
  },
  simple: {
    render: (page) => JSON.stringify(page.simple, null, 1),
    parse: (page, text) => {
      const v = JSON.parse(text);
      if (!Array.isArray(v)) throw new Error('the page must be a JSON array of blocks');
      return storedToSimple(simpleToStored(v)); // validates block shape
    },
  },
  stored: {
    render: (page) => JSON.stringify({ blocks: page.stored.blocks, blocks_layout: page.stored.blocks_layout }, null, 1),
    parse: (page, text) => {
      const v = JSON.parse(text);
      if (!v.blocks || !v.blocks_layout?.items) throw new Error('the page needs "blocks" and "blocks_layout.items"');
      return storedToSimple(v);
    },
  },
  ops: {
    render: (page) => JSON.stringify(withUids(page.simple), null, 1),
    parse: (page, text) => {
      const ops = JSON.parse(text);
      const edited = stripUids(applyOps(withUids(structuredClone(page.simple)), ops, { richFields }));
      return storedToSimple(simpleToStored(edited));
    },
  },
};

// ---------------------------------------------------------------- pages ---

const pages = new Map();
function loadPage(rel) {
  if (!pages.has(rel)) {
    const md = readFileSync(join(DOCS, rel), 'utf8');
    const { frontmatter, fm } = splitPage(md);
    const stored = decodePage(md);
    pages.set(rel, { rel, frontmatter, fm, stored, simple: storedToSimple(stored) });
  }
  return pages.get(rel);
}

const typesIn = (blocks, acc = new Set()) => {
  for (const b of blocks) {
    acc.add(b['@type']);
    for (const v of Object.values(b)) {
      if (Array.isArray(v)) v.forEach((x) => { if (x?.['@type']) acc.add(x['@type']); if (Array.isArray(x?.blocks)) typesIn(x.blocks, acc); });
    }
    if (Array.isArray(b.blocks)) typesIn(b.blocks, acc);
  }
  return acc;
};

// -------------------------------------------------------------- prompts ---

const SYSTEM = `You edit pages in a CMS. You are given the current page in a stated format,
the catalogue of block types, and an instruction. Give your answer in the form the
format asks for, between a line <<<ANSWER and a line ANSWER>>>, and nothing after it.
Change only what the instruction asks; keep everything else exactly as it is.`;

function prompt(page, task, format) {
  const types = [...typesIn(page.simple), 'slate', 'teaser', 'image'];
  return [
    FORMATS[format]({ prototypes: prototypeText(page.fm) }),
    `## Block catalogue\n\n${catalogue(sharedBlocksConfig, [...new Set(types)])}`,
    `## Current page\n\n<<<PAGE\n${FMT[format].render(page)}\nPAGE>>>`,
    `## Instruction\n\n${task.instruction}`,
    format === 'ops'
      ? 'Answer with the JSON array of operations between <<<ANSWER and ANSWER>>>.'
      : 'Answer with the COMPLETE updated page in the same format between <<<ANSWER and ANSWER>>>.',
  ].join('\n\n');
}

function extract(reply) {
  const m = /<<<ANSWER\n([\s\S]*?)\n?ANSWER>>>/.exec(reply ?? '');
  if (!m) throw new Error('reply has no <<<ANSWER … ANSWER>>> section');
  return m[1];
}

/** As extract, but also drop a copied <<<PAGE / PAGE>>> marker line (the prompt's own). */
export function extractLenient(reply) {
  return extract(reply).replace(/^\s*<<<PAGE\n/, '').replace(/\n?PAGE>>>\s*$/, '');
}

// ------------------------------------------------------------------ llm ---

async function chat(model, messages) {
  const key = process.env.DEEPINFRA_API_KEY;
  if (!key) throw new Error('DEEPINFRA_API_KEY is not set');
  const t0 = Date.now();
  const res = await fetch('https://api.deepinfra.com/v1/openai/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, temperature: 0, max_tokens: 32000 }),
  });
  if (!res.ok) throw new Error(`DeepInfra ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  return { text: j.choices[0].message.content, usage: j.usage, ms: Date.now() - t0 };
}

// --------------------------------------------------------------- attempt ---

function judge(page, task, format, text) {
  let blocks;
  try { blocks = FMT[format].parse(page, text); } catch (e) { return { stage: 'parse', error: e.message }; }
  const errors = validate(blocks);
  if (errors.length) return { stage: 'validate', error: errors.join('; ') };
  const { ok, diffs } = compare(task.expect(page.simple), blocks);
  return { stage: ok ? 'ok' : 'wrong', diffs };
}

/** The expected page with $partial nodes made concrete — what a perfect agent returns. */
const concrete = (v) => (Array.isArray(v) ? v.map(concrete)
  : v && typeof v === 'object' ? ('$partial' in v ? concrete(v.$partial) : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, concrete(x)])))
    : v);

function perfectAnswer(page, format, expected) {
  const simple = concrete(expected);
  const stored = simpleToStored(simple);
  return FMT[format].render({ ...page, simple, stored });
}

/** uid of the first block matching pred, searching nested lists. */
function uidOf(blocks, pred) {
  for (const b of blocks) {
    if (pred(b)) return b['@uid'];
    for (const v of Object.values(b)) {
      if (!Array.isArray(v)) continue;
      const kids = v.flatMap((x) => (x?.['@uid'] ? [x] : Array.isArray(x?.blocks) ? x.blocks : []));
      const found = kids.length && uidOf(kids, pred);
      if (found) return found;
    }
  }
  return null;
}

const PERFECT_OPS = {
  'hero-fields': (P) => [{ op: 'update', id: uidOf(P, (b) => b['@type'] === 'hero'), set: { buttonText: 'Read the guide', description: 'Tools that make editing **delightful**.' } }],
  'add-panel': (P) => [{ op: 'add', into: { id: uidOf(P, (b) => b['@type'] === 'accordion'), field: 'panels' }, block: { '@type': 'panel', title: 'Can panels hold blocks?', blocks: [{ '@type': 'slate', value: { md: 'Yes, any block the accordion allows.' } }] } }],
  'move-video': (P) => [{ op: 'move', id: uidOf(P, (b) => b['@type'] === 'video'), after: uidOf(P, (b) => b['@type'] === 'title') }],
  'delete-teaser': (P) => [{ op: 'delete', id: P.filter((b) => b['@type'] === 'teaser').at(-1)['@uid'] }],
  'create-page': (P) => [
    ...P.filter((b) => b['@type'] !== 'title').map((b) => ({ op: 'delete', id: b['@uid'] })),
    { op: 'add', after: P.find((b) => b['@type'] === 'title')['@uid'], blocks: [
      { '@type': 'slate', value: 'Inka is a page builder for any CMS.' },
      { '@type': 'gridBlock', '@uid': 'new1', headline: 'Explore', blocks: [] },
    ] },
    { op: 'add', into: { id: 'new1', field: 'blocks' }, blocks: [
      { '@type': 'teaser', title: 'Frontends', href: [{ '@id': '/docs/frontend-guide' }] },
      { '@type': 'teaser', title: 'Editing', href: [{ '@id': '/docs/editor-guide' }] },
      { '@type': 'teaser', title: 'Rules', href: [{ '@id': '/docs/compliance' }] },
    ] },
  ],
  'columns-add': (P) => [{ op: 'add', into: { id: uidOf(P, (b) => b['@type'] === 'columns'), field: 'columns' }, block: { '@type': 'column', title: 'Support', blocks: [{ '@type': 'slate', value: 'We keep it running.' }] } }],
  'grid-child': (P) => {
    const g = P.find((b) => b['@type'] === 'gridBlock');
    return [{ op: 'update', id: g['@uid'], set: { headline: 'Our work' } }, { op: 'update', id: g.blocks[0]['@uid'], set: { value: '## Case studies' } }];
  },
};

/**
 * Re-judge saved replies with the current scoring (no API calls). Only the
 * final turn is re-judged; writes <run>.rescored.jsonl and prints what changed.
 */
function rescore(file) {
  const lines = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const outFile = file.replace(/\.jsonl$/, opt.lenient ? '.lenient.jsonl' : '.rescored.jsonl');
  const outLines = [];
  for (const r of lines) {
    const last = r.detail.at(-1);
    if (last.reply !== undefined && last.stage !== 'api') {
      const task = TASKS.find((t) => t.id === r.task);
      const page = loadPage(task.page);
      let res;
      try { res = judge(page, task, r.format, (opt.lenient ? extractLenient : extract)(last.reply)); } catch (e) { res = { stage: 'extract', error: e.message }; }
      if (res.stage !== r.final) console.log(`${r.model.split('/').pop()} ${r.task} ${r.format} #${r.rep}: ${r.final} -> ${res.stage}`);
      r.final = res.stage;
      Object.assign(last, { stage: res.stage, error: res.error, diffs: res.diffs?.slice(0, 5) });
    }
    outLines.push(JSON.stringify(r));
  }
  writeFileSync(outFile, `${outLines.join('\n')}\n`);
  console.log(`wrote ${outFile}`);
}

// ------------------------------------------------------------------ main ---

const formats = opt.formats.split(',');
const tasks = TASKS.filter((t) => !opt.tasks || opt.tasks.split(',').includes(t.id));

if (opt.rescore) {
  rescore(opt.rescore);
} else if (opt.perfect) {
  let bad = 0;
  for (const task of tasks) {
    const page = loadPage(task.page);
    for (const format of formats.filter((f) => f !== 'ops')) {
      const r = judge(page, task, format, perfectAnswer(page, format, task.expect(page.simple)));
      if (r.stage !== 'ok') { bad++; console.log('FAIL', task.id, format, r.stage, r.error ?? r.diffs.slice(0, 3)); }
    }
  }
  // Hand-written perfect operations for tasks that exercise each op kind.
  for (const [id, ops] of Object.entries(PERFECT_OPS)) {
    const task = TASKS.find((t) => t.id === id);
    const page = loadPage(task.page);
    const r = judge(page, task, 'ops', JSON.stringify(ops(withUids(page.simple))));
    if (r.stage !== 'ok') { bad++; console.log('FAIL ops', id, r.stage, r.error ?? r.diffs.slice(0, 3)); }
  }
  console.log(bad ? `${bad} perfect answers failed` : 'all perfect answers score ok');
  process.exitCode = bad ? 1 : 0;
} else {
  mkdirSync(RESULTS, { recursive: true });
  const out = join(RESULTS, `${opt.run}.jsonl`);
  const jobs = [];
  for (const model of opt.models.split(',')) for (const task of tasks) for (const format of formats) for (let rep = 0; rep < Number(opt.reps); rep++) jobs.push({ model, task, format, rep });
  const attempt = async ({ model, task, format, rep }) => {
    const page = loadPage(task.page);
    const messages = [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt(page, task, format) }];
    const turns = [];
    let result;
    for (let turn = 0; turn <= Number(opt.repair); turn++) {
      let reply;
      try { reply = await chat(model, messages); } catch (e) { result = { stage: 'api', error: e.message }; turns.push(result); break; }
      try { result = judge(page, task, format, extractLenient(reply.text)); } catch (e) { result = { stage: 'extract', error: e.message }; }
      turns.push({ ...result, usage: reply.usage, ms: reply.ms, reply: reply.text });
      if (result.stage === 'ok' || result.stage === 'wrong') break;
      // Repair: hand back the error, as the MCP tool would.
      messages.push({ role: 'assistant', content: reply.text ?? '' }, { role: 'user', content: `That was rejected: ${result.error}\nReturn the corrected answer between <<<ANSWER and ANSWER>>>.` });
    }
    const line = {
      model, task: task.id, format, rep, final: result.stage, turns: turns.length,
      tokensIn: turns.reduce((s, t) => s + (t.usage?.prompt_tokens ?? 0), 0),
      tokensOut: turns.reduce((s, t) => s + (t.usage?.completion_tokens ?? 0), 0),
      detail: turns.map((t) => ({ stage: t.stage, error: t.error, diffs: t.diffs?.slice(0, 5), reply: t.reply })),
    };
    appendFileSync(out, `${JSON.stringify(line)}\n`);
    console.log(`${model.split('/').pop()} ${task.id} ${format} #${rep}: ${line.final} (${line.turns} turn${line.turns > 1 ? 's' : ''}, ${line.tokensIn}+${line.tokensOut} tok)`);
  };
  let next = 0;
  await Promise.all(Array.from({ length: Number(opt.concurrency) }, async () => {
    while (next < jobs.length) await attempt(jobs[next++]);
  }));
  console.log(`results: ${out}`);
}
