/**
 * Connect the MCP server to a person's account, the way a command-line tool
 * signs in through the browser: the person signs in to the admin as they
 * always do (a password, Google, whatever the site uses), the admin's
 * /connect-agent page asks them to allow it, and on Allow it posts their
 * token to a one-off listener on this machine's loopback address.
 */
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

const ANSWER_MS = 5 * 60 * 1000;

/** Open `url` in the person's own browser. */
export async function openInBrowser(url) {
  const [command, args] = {
    darwin: ['open', [url]],
    win32: ['cmd', ['/c', 'start', '', url]],
  }[process.platform] ?? ['xdg-open', [url]];
  spawn(command, args, { stdio: 'ignore', detached: true }).unref();
}

/**
 * Resolve with the token the person allows from the admin at `adminUrl`.
 * `open(url)` shows them the connect page. Rejects if they decline, if an
 * answer comes with another `state` than the one sent, or after `timeoutMs`.
 */
export async function connectInBrowser({ adminUrl, open = openInBrowser, timeoutMs = ANSWER_MS }) {
  const state = randomUUID();
  let answer;
  const answered = new Promise((resolve) => { answer = resolve; });
  const server = createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/callback') {
      res.writeHead(404).end();
      return;
    }
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const fields = new URLSearchParams(body);
      const ok = fields.get('state') === state && fields.get('token');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        .end(page(ok ? 'Connected. You can close this tab.' : 'Not connected. You can close this tab.'));
      answer(fields);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const redirectUri = `http://127.0.0.1:${server.address().port}/callback`;
    const connectUrl = new URL(`${adminUrl.replace(/\/$/, '')}/connect-agent`);
    connectUrl.searchParams.set('redirect_uri', redirectUri);
    connectUrl.searchParams.set('state', state);
    await open(connectUrl.href);
    let timer;
    const fields = await Promise.race([
      answered,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(
          `no answer from the connect page within ${timeoutMs / 1000}s (${connectUrl.href})`,
        )), timeoutMs);
      }),
    ]).finally(() => clearTimeout(timer));
    if (fields.get('state') !== state) {
      throw new Error('the token did not come from the connect page this server opened; not using it');
    }
    if (fields.get('error')) throw new Error(`the person declined to connect the agent (${fields.get('error')})`);
    const token = fields.get('token');
    if (!token) throw new Error('the connect page sent no token');
    return token;
  } finally {
    server.close();
  }
}

const page = (message) => `<!doctype html><meta charset="utf-8"><title>Inka</title>
<body style="font-family: system-ui, sans-serif; margin: 3rem"><p>${message}</p></body>`;
