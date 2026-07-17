#!/usr/bin/env node
// DrBacklog.md MCP server entrypoint. Resolves the backlog file, ensures it
// exists, and serves the tools over stdio.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { dirname } from 'node:path';

import { BacklogStore, resolveBacklogPath } from './store.js';
import { createServer } from './server.js';

async function main(): Promise<void> {
  const backlogPath = resolveBacklogPath();
  const store = new BacklogStore(backlogPath);
  await store.ensureInitialized();

  const server = createServer(store, { exportDir: dirname(backlogPath) });
  await server.connect(new StdioServerTransport());

  // stdout carries the MCP protocol; diagnostics must go to stderr.
  console.error(`DrBacklog MCP server running (backlog: ${backlogPath})`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
