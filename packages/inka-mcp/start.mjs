#!/usr/bin/env node
/**
 * Start the hosted MCP server as the environment describes (http.mjs). A
 * deployment with code of its own (a code store, a route) starts it from an
 * entry like this one, passing them to main.
 */
import { main } from './http.mjs';

await main(process.env);
