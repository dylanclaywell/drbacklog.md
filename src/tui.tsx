#!/usr/bin/env node
// DrBacklog.md TUI entrypoint. Reads the same backlog.md the MCP server
// manages, through the same BacklogStore (atomic writes, serial lock), so the
// TUI and the MCP server can safely run against the file at once.

import { render } from 'ink';
import React from 'react';

import { BacklogStore, resolveBacklogPath } from './store.js';
import { App } from './tui/app.js';

// Enter the terminal's alternate screen buffer, same trick full-screen tools
// like vim/less use: the TUI gets a blank full-height canvas, and whatever
// was in the scrollback before launch reappears untouched on exit.
const ENTER_ALT_SCREEN = '\x1b[?1049h';
const EXIT_ALT_SCREEN = '\x1b[?1049l';

async function main(): Promise<void> {
  const backlogPath = resolveBacklogPath();
  const store = new BacklogStore(backlogPath);
  await store.ensureInitialized();

  if (process.stdout.isTTY) process.stdout.write(ENTER_ALT_SCREEN);
  // Restore the normal screen no matter how the process ends (clean exit,
  // Ctrl+C, or an uncaught error) — 'exit' is the one event guaranteed to
  // fire last, synchronously, in every case.
  process.on('exit', () => {
    if (process.stdout.isTTY) process.stdout.write(EXIT_ALT_SCREEN);
  });

  const { waitUntilExit } = render(React.createElement(App, { store, backlogPath }), {
    exitOnCtrlC: false,
  });
  await waitUntilExit();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
