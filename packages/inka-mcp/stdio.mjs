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
 *   INKA_MEDIA_FOLDERS  optional: folders (separated by ':', ';' on Windows)
 *                       the agent may take files from, to add to a page;
 *                       without it, it reads no file on this computer
 */
import { delimiter } from 'node:path';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createServer, headlessAdmin, MAX_FILE_BYTES } from './server.mjs';
import { signIn } from './signIn.mjs';
import { localPictures, localMedia } from './codes.mjs';
import { localFiles } from './media.mjs';

async function main(env) {
  if (!env.INKA_ADMIN_URL) throw new Error('inka-mcp: INKA_ADMIN_URL is not set');
  const adminUrl = env.INKA_ADMIN_URL.replace(/\/$/, '');
  // Signing in waits for the first call, so the agent's host isn't kept
  // waiting at startup while a person signs in.
  const admin = headlessAdmin({ adminUrl, auth: signIn(env, { adminUrl }), frontendUrl: env.INKA_FRONTEND_URL });
  // One person, one process: every picture is theirs.
  const pictures = localPictures({ instance: null, now: Date.now });
  const media = localMedia({ instance: null, now: Date.now });
  const files = env.INKA_MEDIA_FOLDERS ? localFiles(env.INKA_MEDIA_FOLDERS.split(delimiter), { maxBytes: MAX_FILE_BYTES }) : null;
  // A server for the connection, on the protocol revision the host opens it
  // with (2026-07-28, or 2025's); the SDK may make another to answer its
  // probe, so the admin is not closed with a server.
  // Nothing reported: this runs on the person's own computer, through their
  // own host, and what it throws is theirs to see -- not a deployment's Sentry.
  serveStdio(() => createServer(() => admin, { pictures, media, localFiles: files, userOf: () => 'this-session', reporting: null }));
  // The host is gone when it closes this process's input.
  process.stdin.on('close', () => admin.close());
}

await main(process.env);
