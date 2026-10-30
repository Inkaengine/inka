/**
 * Claude Code, headless (`claude -p`): the agent, the simulated person and the
 * judge all run through it, on the signed-in account (no API key).
 */
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';

/** Claude Code's own env vars would make the child think it runs inside this session. */
export function childEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^CLAUDE_?CODE|^CLAUDECODE$/.test(k)));
}

/**
 * Run `claude` with `args` (stream-json output) in `cwd`; each event goes to
 * `onEvent`, and each line to `transcript` when given. Resolves to the final
 * `result` event, or null when the run never finished (killed at `limitMs`).
 */
export function runClaude(args, { cwd, limitMs, transcript, stderr, onEvent = () => {} }) {
  let result = null;
  return new Promise((resolve, reject) => {
    const child = spawn('claude', [...args, '--output-format', 'stream-json', '--verbose'], {
      cwd, env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'],
    });
    const killer = setTimeout(() => child.kill('SIGTERM'), limitMs);
    let buffer = '';
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (!line.trim()) continue;
        if (transcript) appendFileSync(transcript, `${line}\n`);
        const event = JSON.parse(line);
        onEvent(event);
        if (event.type === 'result') result = event;
      }
    });
    child.stderr.on('data', (chunk) => { if (stderr) appendFileSync(stderr, chunk); });
    child.on('error', reject);
    child.on('close', () => { clearTimeout(killer); resolve(result); });
  });
}

/**
 * One answer from a model with no tools and no project context, shaped by a
 * JSON `schema`: the parsed object, and what it cost.
 */
export async function ask({ model, system, prompt, schema, cwd, limitMs = 5 * 60 * 1000 }) {
  const result = await runClaude([
    '-p', prompt, '--model', model, '--system-prompt', system,
    '--tools', '', '--strict-mcp-config', '--setting-sources', '', '--no-session-persistence',
    '--json-schema', JSON.stringify(schema),
  ], { cwd, limitMs });
  if (!result) throw new Error(`${model} did not answer within ${limitMs / 1000}s`);
  if (result.is_error || !result.structured_output) {
    throw new Error(`${model} gave no structured answer: ${result.subtype} ${String(result.result).slice(0, 300)}`);
  }
  return { answer: result.structured_output, costUsd: result.total_cost_usd };
}
