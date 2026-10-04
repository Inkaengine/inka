/**
 * Experiment 2: how does an agent learn what blocks look like?
 *
 * Arms (cumulative):
 *   schema  — the block catalogue generated from the registered schemas
 *   desc    — + each block's description (first paragraph of its docs example page)
 *   shots   — + a screenshot of each block, rendered by the test frontend
 *   loop    — + the agent's draft is rendered and shown back once for revision
 *
 * The agent builds a page from a brief as a JSON block list. Each final page is
 * validated, rendered, and judged blind (the judge doesn't see the arm).
 *
 *   node run.mjs --library <dir> --models anthropic/claude-haiku-4-5 --reps 3 --run r1
 */
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { sharedBlocksConfig } from '../../tests-playwright/fixtures/shared-block-schemas.js';
import { storedToSimple, simpleToStored } from '../mcp-format/formats.mjs';
import { catalogue, FORMATS } from '../mcp-format/describe.mjs';
import { validate } from '../mcp-format/validate.mjs';
import { LIBRARY } from './examples.mjs';
import { BRIEFS } from './briefs.mjs';
import { renderDraft, closeBrowser } from './render.mjs';

const { values: opt } = parseArgs({
  options: {
    library: { type: 'string' },
    models: { type: 'string', default: 'anthropic/claude-haiku-4-5' },
    arms: { type: 'string', default: 'schema,desc,shots,loop' },
    briefs: { type: 'string', default: '' },
    reps: { type: 'string', default: '1' },
    judge: { type: 'string', default: 'anthropic/claude-sonnet-5-5' },
    run: { type: 'string', default: new Date().toISOString().replace(/[:.]/g, '-') },
    concurrency: { type: 'string', default: '4' },
  },
});
if (!opt.library) throw new Error('--library <dir> (built by examples.mjs) is required');

const RESULTS = new URL('./results/', import.meta.url).pathname;
const SHOTS = join(RESULTS, opt.run);
mkdirSync(SHOTS, { recursive: true });
const library = JSON.parse(readFileSync(join(opt.library, 'library.json'), 'utf8'));
const jpegUrl = (buf) => `data:image/jpeg;base64,${buf.toString('base64')}`;

// ------------------------------------------------------------------- llm ---

async function chat(model, messages, maxTokens = 16000) {
  const key = process.env.DEEPINFRA_API_KEY;
  if (!key) throw new Error('DEEPINFRA_API_KEY is not set');
  const res = await fetch('https://api.deepinfra.com/v1/openai/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, temperature: 0, max_tokens: maxTokens }),
  });
  if (!res.ok) throw new Error(`DeepInfra ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  return { text: j.choices[0].message.content ?? '', usage: j.usage };
}

const answer = (text) => {
  const m = /<<<ANSWER\n([\s\S]*?)\n?ANSWER>>>/.exec(text);
  if (!m) throw new Error('reply has no <<<ANSWER … ANSWER>>> section');
  return m[1];
};

/** Parse and validate a page; returns { blocks } or { error }. */
function check(text) {
  let blocks;
  try {
    const v = JSON.parse(answer(text));
    if (!Array.isArray(v)) throw new Error('the page must be a JSON array of blocks');
    blocks = storedToSimple(simpleToStored(v));
  } catch (e) { return { error: e.message }; }
  const errors = validate(blocks);
  return errors.length ? { error: errors.join('; ') } : { blocks };
}

// --------------------------------------------------------------- prompts ---

const TYPES = [...Object.keys(LIBRARY), 'column', 'title'];

const SYSTEM = `You build pages in a CMS from a brief, using only the block types in the
catalogue. Choose the blocks that present each part of the brief best for a reader.
Answer with the complete page as a JSON array of blocks between a line <<<ANSWER and a
line ANSWER>>>, and nothing after it.`;

function userContent(brief, arm) {
  const parts = [
    FORMATS.simple(),
    `## Block catalogue\n\n${catalogue(sharedBlocksConfig, TYPES)}`,
  ];
  if (arm !== 'schema') {
    parts.push(`## What each block is for\n\n${Object.entries(library).map(([t, l]) => `- **${t}**: ${l.description}`).join('\n')}`);
  }
  const content = [{ type: 'text', text: parts.join('\n\n') }];
  if (arm === 'shots' || arm === 'loop') {
    content.push({ type: 'text', text: '## How each block looks (as rendered by this site)' });
    for (const [t, l] of Object.entries(library)) {
      content.push({ type: 'text', text: `${t}:` });
      content.push({ type: 'image_url', image_url: { url: jpegUrl(readFileSync(join(opt.library, l.image))) } });
    }
  }
  content.push({ type: 'text', text: `## Brief\n\nPage title: ${brief.title} (the page starts with a {"@type": "title"} block, which shows it).\n\n${brief.text}\n\nAnswer with the complete page between <<<ANSWER and ANSWER>>>.` });
  return content;
}

// ----------------------------------------------------------------- judge ---

const JUDGE = `You review a web page built by an agent from a brief. You see the brief, a
screenshot of the rendered page, and the page's block JSON (links aren't visible in a
screenshot). Score 1-5 each:
- complete: every item the brief asks for is present and correct (text, links, images)
- fit: each part uses a block that presents it well (e.g. tabular data as a table,
  questions as an accordion, things to click through as cards)
- visual: the page looks coherent and finished — no empty, broken or placeholder blocks,
  sensible order and grouping
Reply with JSON only: {"complete": n, "fit": n, "visual": n, "problems": ["…"]}`;

async function judge(brief, jpeg, blocks) {
  const r = await chat(opt.judge, [
    { role: 'system', content: JUDGE },
    { role: 'user', content: [
      { type: 'text', text: `## Brief\n\nPage title: ${brief.title}\n\n${brief.text}` },
      { type: 'image_url', image_url: { url: jpegUrl(jpeg) } },
      { type: 'text', text: `## Page JSON\n\n${JSON.stringify(blocks)}` },
    ] },
  ], 2000);
  const m = /\{[\s\S]*\}/.exec(r.text);
  if (!m) throw new Error(`judge reply has no JSON: ${r.text.slice(0, 200)}`);
  return { ...JSON.parse(m[0]), usage: r.usage };
}

// --------------------------------------------------------------- attempt ---

async function attempt({ model, brief, arm, rep }) {
  const messages = [{ role: 'system', content: SYSTEM }, { role: 'user', content: userContent(brief, arm) }];
  const usage = { in: 0, out: 0 };
  const turn = async () => {
    const r = await chat(model, messages);
    usage.in += r.usage?.prompt_tokens ?? 0; usage.out += r.usage?.completion_tokens ?? 0;
    messages.push({ role: 'assistant', content: r.text });
    return r.text;
  };
  // Draft, with one repair turn for an invalid page.
  let res = check(await turn());
  let repaired = false;
  if (res.error) {
    repaired = true;
    messages.push({ role: 'user', content: `That page was rejected: ${res.error}\nReturn the corrected complete page between <<<ANSWER and ANSWER>>>.` });
    res = check(await turn());
  }
  if (res.error) return { model, brief: brief.id, arm, rep, final: 'invalid', error: res.error, usage };
  let { blocks } = res;
  let render = await renderDraft(blocks, { title: brief.title });
  let revised = false;
  if (arm === 'loop') {
    messages.push({ role: 'user', content: [
      { type: 'text', text: `This is how your page renders${render.missing.length ? ` (these blocks did not render: ${render.missing.join(', ')})` : ''}. Fix anything that doesn't serve the brief or looks wrong, then return the complete page between <<<ANSWER and ANSWER>>>.` },
      { type: 'image_url', image_url: { url: jpegUrl(render.jpeg) } },
    ] });
    const rev = check(await turn());
    if (!rev.error) { blocks = rev.blocks; render = await renderDraft(blocks, { title: brief.title }); revised = true; }
  }
  const shot = `${model.split('/').pop()}-${brief.id}-${arm}-${rep}.jpg`;
  writeFileSync(join(SHOTS, shot), render.jpeg);
  const score = await judge(brief, render.jpeg, blocks);
  return {
    model, brief: brief.id, arm, rep, final: 'ok', repaired, revised,
    drawn: render.drawn, expected: render.expected, missing: render.missing,
    types: blocks.map((b) => b['@type']), score: { complete: score.complete, fit: score.fit, visual: score.visual },
    problems: score.problems, usage, shot, blocks,
  };
}

// ------------------------------------------------------------------ main ---

const briefs = BRIEFS.filter((b) => !opt.briefs || opt.briefs.split(',').includes(b.id));
const jobs = [];
for (const model of opt.models.split(',')) for (const brief of briefs) for (const arm of opt.arms.split(',')) for (let rep = 0; rep < Number(opt.reps); rep++) jobs.push({ model, brief, arm, rep });
const out = join(RESULTS, `${opt.run}.jsonl`);
let next = 0;
await Promise.all(Array.from({ length: Number(opt.concurrency) }, async () => {
  while (next < jobs.length) {
    const job = jobs[next++];
    let r;
    try { r = await attempt(job); } catch (e) { r = { model: job.model, brief: job.brief.id, arm: job.arm, rep: job.rep, final: 'error', error: e.message }; }
    appendFileSync(out, `${JSON.stringify(r)}\n`);
    const s = r.score ? `complete ${r.score.complete} fit ${r.score.fit} visual ${r.score.visual}` : r.error?.slice(0, 120);
    console.log(`${job.model.split('/').pop()} ${job.brief.id} ${job.arm} #${job.rep}: ${r.final} ${s}${r.revised ? ' (revised)' : ''}`);
  }
}));
await closeBrowser();
console.log(`results: ${out}`);
