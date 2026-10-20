// Renders the real App into a fake terminal of a known size and drives it
// with keystrokes, to check the layout math: what fits in the details panel,
// what scrolls, and when the full-screen reader takes over. Frames are read
// back as plain text (colors stripped), so these assert on what a user would
// see, not on component internals.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { render, type Instance } from 'ink';
import React from 'react';

import { App } from './app.js';
import { addTask } from '../operations.js';
import { BacklogStore } from '../store.js';

const KEYS = {
  enter: '\r',
  escape: '\u001B',
  down: '\u001B[B',
  tab: '\t',
} as const;

// A description long enough to need scrolling in any panel size used here.
const LONG_DESCRIPTION = Array.from(
  { length: 40 },
  (_, i) => `Paragraph line ${i + 1} of the long description.`,
).join('\n');

// Matching the escape character is the point: it strips Ink's color codes.
// eslint-disable-next-line no-control-regex
const ANSI = /\u001B\[[0-9;?]*[A-Za-z]/g;

function fakeTerminal(columns: number, rows: number) {
  const frames: string[] = [];
  const stdout = Object.assign(new EventEmitter(), {
    columns,
    rows,
    isTTY: true,
    write(chunk: string) {
      frames.push(chunk.replace(ANSI, ''));
      return true;
    },
  });
  const stdin = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode() {
      return this;
    },
    ref() {},
    unref() {},
  });
  return { stdout, stdin, frames };
}

const settle = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));

describe('App layout', () => {
  let dir: string;
  let store: BacklogStore;
  let app: Instance | undefined;
  let term: ReturnType<typeof fakeTerminal>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'drbacklog-render-'));
    store = new BacklogStore(join(dir, 'backlog.md'));
    await store.mutate((d) => {
      addTask(d, { title: 'Long one', description: LONG_DESCRIPTION, created: '2026-10-20' });
      addTask(d, { title: 'Short one', description: 'Just a line.', created: '2026-10-20' });
    });
  });

  afterEach(async () => {
    app?.unmount();
    app = undefined;
    await rm(dir, { recursive: true, force: true });
  });

  async function start(columns: number, rows: number): Promise<void> {
    term = fakeTerminal(columns, rows);
    app = render(<App store={store} backlogPath={store.path} />, {
      // Ink's own types want real streams; these implement what it uses.
      stdout: term.stdout as unknown as NodeJS.WriteStream,
      stdin: term.stdin as unknown as NodeJS.ReadStream,
      debug: true,
      exitOnCtrlC: false,
      patchConsole: false,
    });
    await settle(150); // first load from disk
  }

  async function press(...keys: string[]): Promise<void> {
    for (const key of keys) {
      term.stdin.write(key);
      await settle();
    }
  }

  const frame = () => term.frames.at(-1) ?? '';
  const lines = () => frame().split('\n');

  it('shows the selected task in a panel beside the list on a wide terminal', async () => {
    await start(120, 30);
    expect(frame()).toContain('Paragraph line 1 of');
    // Beside the list, not under it: the second list row shares a line with
    // the panel's title (the first row is level with the panel's top border).
    expect(lines().some((l) => l.includes('#2 Short one') && l.includes('│ #1 Long one'))).toBe(
      true,
    );
    expect(frame()).toMatch(/↓ \d+ more/);
  });

  it('never draws more rows than the terminal has', async () => {
    await start(120, 30);
    expect(lines().length).toBeLessThanOrEqual(30);
    await press(KEYS.enter, KEYS.down, KEYS.down);
    expect(lines().length).toBeLessThanOrEqual(30);
  });

  it('scrolls the description once enter has focused the panel', async () => {
    await start(120, 30);
    await press(KEYS.enter);
    expect(frame()).toContain('esc back to list');
    await press(KEYS.down, KEYS.down);
    expect(frame()).toContain('↑ 2 above');
    expect(frame()).not.toContain('Paragraph line 1 of');
    // The list selection didn't move: the arrows went to the panel.
    expect(frame()).toContain('▏ #1 Long one');
  });

  it('gives the arrows back to the list on esc', async () => {
    await start(120, 30);
    await press(KEYS.enter, KEYS.escape, KEYS.down);
    expect(frame()).toContain('▏ #2 Short one');
    expect(frame()).toContain('Just a line.');
  });

  it('starts the next task at its top', async () => {
    await start(120, 30);
    await press(KEYS.enter, KEYS.down, KEYS.down, KEYS.escape, KEYS.down);
    await press(KEYS.enter, KEYS.escape);
    await press('k');
    expect(frame()).toContain('Paragraph line 1 of');
  });

  it('opens a full-screen reader from board view', async () => {
    await start(120, 30);
    await press(KEYS.tab, KEYS.enter);
    expect(frame()).toContain('#1 Long one');
    expect(frame()).toContain('esc back');
    // The board is gone while reading.
    expect(frame()).not.toContain('CLOSED');
    await press(KEYS.escape);
    expect(frame()).toContain('CLOSED');
  });

  it('uses the full-screen reader instead of a panel on a narrow terminal', async () => {
    await start(70, 24);
    expect(frame()).not.toContain('Paragraph line 1 of');
    await press(KEYS.enter);
    expect(frame()).toContain('Paragraph line 1 of');
    expect(lines().length).toBeLessThanOrEqual(24);
  });
});
