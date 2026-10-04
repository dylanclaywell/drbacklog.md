#!/usr/bin/env node
// DrBacklog.md MCP server entrypoint. Resolves the backlog file, ensures it
// exists, and serves the tools over stdio.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { BacklogStore } from './store.js';
import { resolveBacklogLocation } from './discover.js';
import { parseFileArg } from './cli.js';
import { createServer } from './server.js';

async function main(): Promise<void> {
  const location = resolveBacklogLocation(
    process.cwd(),
    process.env,
    parseFileArg(process.argv.slice(2)),
  );
  const store = new BacklogStore(location.path);
  // Never create the file here: a missing or ambiguous backlog is surfaced
  // through the tools, which ask the user before set_backlog_file creates one.

  const server = createServer(store, { location });
  await server.connect(new StdioServerTransport());

  // stdout carries the MCP protocol; diagnostics must go to stderr.
  console.error(
    location.ambiguous
      ? `DrBacklog MCP server running, but several backlogs were found and none is configured: ${location.ambiguous.join(', ')}`
      : `DrBacklog MCP server running (backlog: ${location.path})`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
