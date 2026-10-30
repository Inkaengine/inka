#!/usr/bin/env node
/**
 * Run a command with this checkout's whole port block in its environment.
 *
 *   node scripts/with-ports.mjs razzle start
 *   HYDRA_PORT_BASE=8980 node scripts/with-ports.mjs pnpm start:mock-api
 *
 * One place computes the ports; everything started through here inherits them.
 *
 * That is the point. Taking the defaults out of ports.ts stopped checkouts
 * stealing each other's servers, and left nineteen variables that every
 * launcher had to set — the package.json scripts, three CI jobs and a
 * consuming repo's Makefile each carrying their own copy of the list. Nineteen
 * places to set a port is nineteen places to set one of them differently, and
 * the symptom is never "a port is wrong": it is a suite talking to a server
 * that another checkout started, or a health check waiting on nothing.
 *
 * So a run says where its block starts, once — `HYDRA_PORT_BASE` — and this
 * exports the derived names, because a shell script cannot do the arithmetic
 * and a child process cannot read ports.ts.
 *
 * Also exports PORT for the command itself: razzle, vite and the fixture
 * servers each read PORT, and which service "the" port means depends on what
 * is being started, so the caller names it:
 *
 *   node scripts/with-ports.mjs --port=voltoSsr razzle start
 */
import { spawn } from 'node:child_process';
import { PORT_ENV, allPorts } from '../tests-playwright/ports.ts';

const argv = process.argv.slice(2);

let portName = null;
while (argv.length && argv[0].startsWith('--port')) {
  const arg = argv.shift();
  portName = arg.includes('=') ? arg.split('=')[1] : argv.shift();
}

if (argv.length === 0) {
  console.error(
    'usage: node scripts/with-ports.mjs [--port=<name>] <command> [args...]\n' +
      `  port names: ${Object.keys(PORT_ENV).join(', ')}`,
  );
  process.exit(2);
}

// Throws, naming HYDRA_PORT_BASE, if nobody has said where the block starts.
const ports = allPorts();

if (portName !== null && !(portName in ports)) {
  console.error(
    `Unknown port name '${portName}'.\n` +
      `  port names: ${Object.keys(PORT_ENV).join(', ')}`,
  );
  process.exit(2);
}

const env = { ...process.env };
for (const [name, value] of Object.entries(ports)) {
  env[PORT_ENV[name]] = String(value);
}
if (portName !== null) env.PORT = String(ports[portName]);

const child = spawn(argv[0], argv.slice(1), { stdio: 'inherit', env });
child.on('exit', (code, signal) => {
  // Re-raise a signal rather than reporting it as an exit code, so Ctrl-C of a
  // long-running server reads as a Ctrl-C to whatever started this.
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
child.on('error', (err) => {
  console.error(`could not run ${argv[0]}: ${err.message}`);
  process.exit(127);
});
