#!/usr/bin/env node
/**
 * Agent journeys: give an agent that knows nothing about Inka a job in plain
 * words (tasks.mjs) and only the Inka MCP to do it with, then check the
 * result through the CMS API. Agents vary run to run, so each task runs
 * several times and the outcome is a pass rate, with the tool calls, errors,
 * time and cost of each run.
 *
 * Conversations go further: a simulated person (person.mjs) replies to the
 * agent turn by turn until they have what they wanted, and a judge
 * (judge.mjs) grades the whole conversation on criteria in plain words. Each
 * conversation is also written as a Ragas multi-turn sample (*.ragas.json),
 * to score with Ragas's own metrics where a model API key is to hand.
 *
 * The agent is Claude Code, headless (`claude -p`), in an empty directory so
 * no project instructions reach it, with its built-in tools off, a chat
 * assistant's system prompt in place of Claude Code's, and the Inka MCP
 * server as its only server. Needs the local stack running (mock API, admin,
 * and the front end): see CLAUDE.md, "Manual Development Server".
 *
 *   node packages/inka-mcp/journeys/run.mjs [--runs 3] [--task id ...] [--frontend nuxt]
 *     [--model sonnet] [--person-model haiku] [--judge-model sonnet] [--parallel 2]
 *
 * Each run gets its own mock session (its own token), so all start from the
 * same pages. Transcripts and a summary go to a results directory, printed.
 */
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { TASKS, CONVERSATIONS } from './tasks.mjs';
import { runClaude } from './claude.mjs';
import { agentTurn, asText, asRagas } from './conversation.mjs';
import { nextFromPerson } from './person.mjs';
import { judge } from './judge.mjs';
import mockTokens from '../../../tests-playwright/fixtures/mock-tokens.cjs';

const { mintToken } = mockTokens;

const SERVER = fileURLToPath(new URL('../server.mjs', import.meta.url));
const RUN_LIMIT_MS = 20 * 60 * 1000;
/** Agent turns in a conversation before it is cut off. */
const MAX_TURNS = 6;
/** What a chat app tells its assistant; Claude Code's own prompt is about writing code. */
const CHAT_SYSTEM = 'You are Claude, an AI assistant. The person is chatting with you in the Claude app, '
  + 'and has connected their website to it so you can help them with it.';

function port(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (the test ports have no defaults)`);
  return value;
}

const { values: opts } = parseArgs({
  options: {
    runs: { type: 'string', default: '3' },
    task: { type: 'string', multiple: true },
    frontend: { type: 'string' },
    model: { type: 'string' },
    'person-model': { type: 'string', default: 'haiku' },
    'judge-model': { type: 'string', default: 'sonnet' },
    parallel: { type: 'string', default: '1' },
    out: { type: 'string' },
  },
});

const api = `http://localhost:${port('HYDRA_MOCK_API_PORT')}`;
const admin = `http://localhost:${port('HYDRA_VOLTO_SSR_PORT')}`;
const frontendUrl = opts.frontend === 'nuxt' ? `http://localhost:${port('HYDRA_NUXT_PORT')}` : undefined;
if (opts.frontend && opts.frontend !== 'nuxt') throw new Error(`--frontend: only "nuxt" (or none, for the admin's default)`);
const ALL = [...TASKS, ...CONVERSATIONS];
const tasks = opts.task ? opts.task.map((id) => {
  const task = ALL.find((t) => t.id === id);
  if (!task) throw new Error(`no task "${id}" (${ALL.map((t) => t.id).join(', ')})`);
  return task;
}) : ALL;
const runs = Number(opts.runs);
const out = opts.out ?? join(tmpdir(), 'inka-journeys', new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(out, { recursive: true });

/** The CMS as one run's session sees it. */
function apiFor(token) {
  const headers = { Accept: 'application/json', Authorization: `Bearer ${token}` };
  return {
    async get(path) {
      const response = await fetch(`${api}${path}`, { headers });
      if (!response.ok) throw new Error(`GET ${path}: ${response.status}`);
      return response.json();
    },
    async post(path, body) {
      const response = await fetch(`${api}${path}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(`POST ${path}: ${response.status} ${await response.text()}`);
      return response.json();
    },
    async status(path) {
      return (await fetch(`${api}${path}`, { headers })).status;
    },
    async search(pathAndQuery) {
      return (await fetch(`${api}${pathAndQuery}`, { headers })).json();
    },
  };
}

/** A tool error that says the local stack is down: the run measured nothing about the agent. */
const STACK_DOWN = /ERR_CONNECTION_REFUSED|ERR_EMPTY_RESPONSE|ECONNREFUSED/;

/** The admin and the mock API answer, or the run would measure the stack, not the agent. */
async function stackUp() {
  for (const url of [admin, `${api}/@site`]) {
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(30000) });
    if (response.status >= 500) throw new Error(`${url} answered ${response.status}: the local stack is not ready`);
  }
}

async function runOnce(task, n) {
  await stackUp();
  // One the mock site issued; it keys its state by token, so each run has its own.
  const token = mintToken('admin');
  const cms = apiFor(token);
  if (task.setup) await task.setup(cms);
  const dir = mkdtempSync(join(tmpdir(), 'inka-journey-'));
  const config = join(dir, 'mcp.json');
  writeFileSync(config, JSON.stringify({
    mcpServers: {
      inka: {
        command: process.execPath,
        args: [SERVER],
        env: { INKA_ADMIN_URL: admin, INKA_TOKEN: token, ...(frontendUrl && { INKA_FRONTEND_URL: frontendUrl }) },
      },
    },
  }));
  const name = `${task.id}-${n}`;
  const agentArgs = [
    '--mcp-config', config, '--strict-mcp-config', '--setting-sources', '',
    '--tools', '', '--allowedTools', 'mcp__inka', '--permission-mode', 'dontAsk',
    '--system-prompt', CHAT_SYSTEM,
    ...(opts.model ? ['--model', opts.model] : []),
  ];
  // A conversation resumes one agent session turn by turn; a job is one turn.
  const session = randomUUID();
  const turns = [{ role: 'person', text: task.prompt }];
  let costUsd = 0;
  let finished = true;
  const started = Date.now();
  for (let turn = 0; ; turn++) {
    const events = [];
    const result = await runClaude([
      '-p', turns.at(-1).text, ...agentArgs,
      ...(task.person ? (turn ? ['--resume', session] : ['--session-id', session]) : ['--no-session-persistence']),
    ], {
      cwd: dir, limitMs: RUN_LIMIT_MS, transcript: join(out, `${name}.jsonl`), stderr: join(out, `${name}.stderr`),
      onEvent: (event) => events.push(event),
    });
    turns.push(agentTurn(events));
    if (!result) { finished = false; break; }
    costUsd += result.total_cost_usd;
    if (!task.person || turn + 1 >= MAX_TURNS) break;
    const next = await nextFromPerson({ person: task.person, turns, model: opts['person-model'], cwd: dir });
    costUsd += next.costUsd;
    if (next.done) break;
    turns.push({ role: 'person', text: next.reply });
  }
  const minutes = +((Date.now() - started) / 60000).toFixed(1);

  // Kept before checking and judging, so a failure there still leaves the conversation to read.
  writeFileSync(join(out, `${name}.txt`), asText(turns, { audience: 'judge' }));
  if (task.person) writeFileSync(join(out, `${name}.ragas.json`), JSON.stringify(asRagas(turns, task.person.wants), null, 2));
  const down = turns.flatMap((t) => t.tools ?? []).find((t) => t.isError && STACK_DOWN.test(t.result));
  if (down) throw new Error(`${name}: the local stack went down during the run (${down.name}: ${down.result.split('\n')[0]}); it measured nothing`);

  const problems = finished ? await task.check(cms, turns) : ['the agent never finished'];
  let verdicts = {};
  if (task.person && finished) {
    const judged = await judge({ turns, wants: task.person.wants, criteria: task.criteria, model: opts['judge-model'], cwd: dir });
    verdicts = judged.verdicts;
    costUsd += judged.costUsd;
  }
  const tools = turns.flatMap((t) => t.tools ?? []);
  const calls = {};
  for (const tool of tools) calls[tool.name] = (calls[tool.name] ?? 0) + 1;
  // The MCP's criteria count; the agent's are notes (see judge.mjs).
  const mcpFailed = Object.entries(verdicts).filter(([, v]) => v.measures === 'mcp' && !v.pass).map(([id]) => id);
  return {
    task: task.id,
    run: n,
    passed: problems.length === 0 && mcpFailed.length === 0,
    problems,
    mcpFailed,
    judged: Object.fromEntries(Object.entries(verdicts).map(([id, v]) => [id, v.pass])),
    verdicts,
    personTurns: turns.filter((t) => t.role === 'person').length,
    toolCalls: tools.length,
    calls,
    toolErrors: tools.filter((t) => t.isError).length,
    minutes,
    costUsd: +costUsd.toFixed(4),
    agentSaid: turns.at(-1).text.slice(0, 500),
  };
}

async function main() {
  const jobs = tasks.flatMap((task) => Array.from({ length: runs }, (_, i) => () => runOnce(task, i + 1)));
  const results = [];
  const workers = Array.from({ length: Number(opts.parallel) }, async () => {
    while (jobs.length) {
      const result = await jobs.shift()();
      results.push(result);
      const failed = Object.entries(result.verdicts).filter(([, v]) => !v.pass)
        .map(([id, v]) => `${v.measures === 'mcp' ? 'judge' : 'note (agent)'}: ${id}: ${v.reason}`);
      console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.task} #${result.run}: ${result.toolCalls} calls, `
        + `${result.toolErrors} errors, ${result.personTurns} person turns, ${result.minutes} min`
        + `${result.problems.length ? ` — ${result.problems.join('; ')}` : ''}`
        + `${failed.length ? `\n     ${failed.join('\n     ')}` : ''}`);
    }
  });
  await Promise.all(workers);
  writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2));

  const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  console.log('\ntask                          pass   calls  errors  minutes  cost    judge (passes per criterion)');
  for (const task of tasks) {
    const rs = results.filter((r) => r.task === task.id);
    const cost = rs.reduce((a, r) => a + r.costUsd, 0);
    const criteria = [...new Set(rs.flatMap((r) => Object.keys(r.judged)))];
    const measures = (id) => rs.find((r) => r.verdicts[id])?.verdicts[id].measures;
    const judged = criteria.map((id) => `${measures(id) === 'agent' ? '(agent) ' : ''}${id} ${rs.filter((r) => r.judged[id]).length}/${rs.length}`).join(', ');
    console.log(`${task.id.padEnd(30)}${`${rs.filter((r) => r.passed).length}/${rs.length}`.padEnd(7)}`
      + `${String(median(rs.map((r) => r.toolCalls))).padEnd(7)}${String(median(rs.map((r) => r.toolErrors))).padEnd(8)}`
      + `${String(median(rs.map((r) => r.minutes))).padEnd(9)}${`$${cost.toFixed(2)}`.padEnd(8)}${judged}`);
  }
  console.log(`\nTranscripts and results: ${out}`);
}

await main();
