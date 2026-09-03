#!/usr/bin/env node
// DrBacklog.md TUI entrypoint. Reads the same backlog.md the MCP server
// manages, through the same BacklogStore (atomic writes, serial lock), so the
// TUI and the MCP server can safely run against the file at once.

import { render } from 'ink';
import React from 'react';
import { access } from 'node:fs/promises';
import { dirname } from 'node:path';

import { BacklogStore, resolveBacklogPath } from './store.js';
import { parseFileArg } from './cli.js';
import { writeConfiguredPath } from './config.js';
import { App } from './tui/app.js';
import { promptForBacklogPath } from './tui/setup.js';

// Enter the terminal's alternate screen buffer, same trick full-screen tools
// like vim/less use: the TUI gets a blank full-height canvas, and whatever
// was in the scrollback before launch reappears untouched on exit.
const ENTER_ALT_SCREEN = '\x1b[?1049h';
const EXIT_ALT_SCREEN = '\x1b[?1049l';

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const defaultPath = resolveBacklogPath(
    process.cwd(),
    process.env,
    parseFileArg(process.argv.slice(2)),
  );

  if (process.stdout.isTTY) process.stdout.write(ENTER_ALT_SCREEN);
  // Restore the normal screen no matter how the process ends (clean exit,
  // Ctrl+C, or an uncaught error) — 'exit' is the one event guaranteed to
  // fire last, synchronously, in every case.
  process.on('exit', () => {
    if (process.stdout.isTTY) process.stdout.write(EXIT_ALT_SCREEN);
  });

  // Nothing where we looked? Ask which file to use instead of silently
  // creating an empty backlog here — the MCP server may have been pointed at a
  // different file through DRBACKLOG_FILE, which a shell-launched TUI never
  // sees. Without a TTY there's nobody to ask, so keep the old fallback.
  let backlogPath = defaultPath;
  if (!(await exists(defaultPath)) && process.stdin.isTTY) {
    const choice = await promptForBacklogPath(defaultPath);
    if (choice === null) return; // user backed out
    backlogPath = choice.path;
    // Written relative to the project dir the default was resolved in, so the
    // config file lands at the project root rather than beside the backlog.
    if (choice.remember) await writeConfiguredPath(dirname(defaultPath), backlogPath);
  }

  const store = new BacklogStore(backlogPath);
  await store.ensureInitialized();

  const { waitUntilExit } = render(React.createElement(App, { store, backlogPath }), {
    exitOnCtrlC: false,
  });
  await waitUntilExit();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
