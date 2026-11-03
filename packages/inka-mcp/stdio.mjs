#!/usr/bin/env node
/**
 * The Inka MCP server over stdio, for one person: an agent's host (Claude
 * Code, Claude Desktop) starts it, and its tools (server.mjs) work through a
 * headless Inka admin signed in as that person.
 *
 * Configuration (environment):
 *   INKA_ADMIN_URL  the admin, e.g. https://admin.example.org
 *   INKA_FRONTEND_URL  optional: the front end the editor (and so a preview)
 *                      uses; without it, the admin's own default
 * Signing in (signIn.mjs): with neither of the below, the first call opens
 * the person's browser at the admin, they sign in as they always do and
 * allow the agent, and the token is kept (INKA_TOKEN_STORE, by default
 * ~/.config/inka-mcp/tokens.json) and renewed from then on.
 *   INKA_TOKEN      a token to use instead, or
 *   INKA_USER + INKA_PASSWORD + INKA_API_URL  to log in to a plain account
 * The agent can do what that CMS user can do, nothing more.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer, headlessAdmin } from './server.mjs';
import { signIn } from './signIn.mjs';
import { localPictures } from './codes.mjs';

async function main(env) {
  if (!env.INKA_ADMIN_URL) throw new Error('inka-mcp: INKA_ADMIN_URL is not set');
  const adminUrl = env.INKA_ADMIN_URL.replace(/\/$/, '');
  // Signing in waits for the first call, so the agent's host isn't kept
  // waiting at startup while a person signs in.
  const admin = headlessAdmin({ adminUrl, auth: signIn(env, { adminUrl }), frontendUrl: env.INKA_FRONTEND_URL });
  // One person, one process: every picture is theirs.
  const server = createServer(() => admin, { pictures: localPictures({ instance: null, now: Date.now }), userOf: () => 'this-session' });
  server.server.onclose = () => admin.close();
  await server.connect(new StdioServerTransport());
}

await main(process.env);
