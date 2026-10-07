#!/usr/bin/env node
/**
 * Agent journeys: give an agent that knows nothing about Inka a job in plain
 * words (tasks.mjs) and only the Inka MCP to do it with, then check the
 * result through the CMS API. Agents vary run to run, so each task runs
 * several times and the outcome is a pass rate, with the tool calls, errors,
 * time and cost of each run.
 *
 * The agent is Claude Code, headless (`claude -p`), in an empty directory so
 * no project instructions reach it, with its built-in tools off and the Inka
 * MCP server as its only server. Needs the local stack running (mock API,
 * admin, and the front end): see CLAUDE.md, "Manual Development Server".
 *
 *   node packages/inka-mcp/journeys/run.mjs [--runs 3] [--task id ...] [--frontend nuxt] [--model sonnet] [--parallel 2]
 *
 * Each run gets its own mock session (its own token), so all start from the
 * same pages. Transcripts and a summary go to a results directory, printed.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { TASKS } from './tasks.mjs';

const SERVER = fileURLToPath(new URL('../server.mjs', import.meta.url));
const RUN_LIMIT_MS = 20 * 60 * 1000;
// The token shape the mock API and the test helpers use; the mock keys its state by token.
const TOKEN_PREFIX = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhZG1pbiIsImV4cCI6NDEwMjQ0NDgwMH0.fake-signature';

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
    parallel: { type: 'string', default: '1' },
    out: { type: 'string' },
  },
});

const api = `http://localhost:${port('HYDRA_MOCK_API_PORT')}`;
const admin = `http://localhost:${port('HYDRA_VOLTO_SSR_PORT')}`;
const frontendUrl = opts.frontend === 'nuxt' ? `http://localhost:${port('HYDRA_NUXT_PORT')}` : undefined;
if (opts.frontend && opts.frontend !== 'nuxt') throw new Error(`--frontend: only "nuxt" (or none, for the admin's default)`);
const tasks = opts.task ? opts.task.map((id) => {
  const task = TASKS.find((t) => t.id === id);
  if (!task) throw new Error(`no task "${id}" (${TASKS.map((t) => t.id).join(', ')})`);
  return task;
}) : TASKS;
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
    async status(path) {
      return (await fetch(`${api}${path}`, { headers })).status;
    },
    async search(pathAndQuery) {
      return (await fetch(`${api}${pathAndQuery}`, { headers })).json();
    },
  };
}

/** Claude Code's own env vars would make the child think it runs inside this session. */
function childEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^CLAUDE_?CODE|^CLAUDECODE$/.test(k)));
}

async function runOnce(task, n) {
  const token = `${TOKEN_PREFIX}-${randomUUID()}`;
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
  const transcript = join(out, `${task.id}-${n}.jsonl`);
  const args = [
    '-p', task.prompt,
    '--mcp-config', config, '--strict-mcp-config',
    '--tools', '', '--allowedTools', 'mcp__inka', '--permission-mode', 'dontAsk',
    '--output-format', 'stream-json', '--verbose', '--no-session-persistence',
    ...(opts.model ? ['--model', opts.model] : []),
  ];
  const calls = {};
  let errors = 0;
  let result = null;
  const started = Date.now();
  await new Promise((resolve) => {
    const child = spawn('claude', args, { cwd: dir, env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    const killer = setTimeout(() => child.kill('SIGTERM'), RUN_LIMIT_MS);
    let buffer = '';
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (!line.trim()) continue;
        appendFileSync(transcript, `${line}\n`);
        const event = JSON.parse(line);
        for (const part of event.message?.content ?? []) {
          if (part.type === 'tool_use') calls[part.name] = (calls[part.name] ?? 0) + 1;
          if (part.type === 'tool_result' && part.is_error) errors++;
        }
        if (event.type === 'result') result = event;
      }
    });
    child.stderr.on('data', (chunk) => appendFileSync(join(out, `${task.id}-${n}.stderr`), chunk));
    child.on('close', () => { clearTimeout(killer); resolve(); });
  });
  const problems = result ? await task.check(apiFor(token)) : ['the agent never finished'];
  return {
    task: task.id,
    run: n,
    passed: problems.length === 0,
    problems,
    toolCalls: Object.values(calls).reduce((a, b) => a + b, 0),
    calls,
    toolErrors: errors,
    minutes: +((Date.now() - started) / 60000).toFixed(1),
    costUsd: result?.total_cost_usd ?? null,
    turns: result?.num_turns ?? null,
    agentSaid: result?.result?.slice(0, 500) ?? null,
  };
}

async function main() {
  const jobs = tasks.flatMap((task) => Array.from({ length: runs }, (_, i) => () => runOnce(task, i + 1)));
  const results = [];
  const workers = Array.from({ length: Number(opts.parallel) }, async () => {
    while (jobs.length) {
      const result = await jobs.shift()();
      results.push(result);
      console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.task} #${result.run}: ${result.toolCalls} calls, `
        + `${result.toolErrors} errors, ${result.minutes} min${result.problems.length ? ` — ${result.problems.join('; ')}` : ''}`);
    }
  });
  await Promise.all(workers);
  writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2));

  const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  console.log('\ntask                          pass   calls  errors  minutes  cost');
  for (const task of tasks) {
    const rs = results.filter((r) => r.task === task.id);
    const cost = rs.reduce((a, r) => a + (r.costUsd ?? 0), 0);
    console.log(`${task.id.padEnd(30)}${`${rs.filter((r) => r.passed).length}/${rs.length}`.padEnd(7)}`
      + `${String(median(rs.map((r) => r.toolCalls))).padEnd(7)}${String(median(rs.map((r) => r.toolErrors))).padEnd(8)}`
      + `${String(median(rs.map((r) => r.minutes))).padEnd(9)}$${cost.toFixed(2)}`);
  }
  console.log(`\nTranscripts and results: ${out}`);
}

await main();
