// Tests for the backlog file watcher, against a real temp directory: what
// matters is how the OS reports BacklogStore's temp-file-and-rename writes,
// which a mocked fs.watch couldn't tell us.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { watchBacklog } from './watch.js';
import { addTask } from '../operations.js';
import { BacklogStore } from '../store.js';

const SETTLE_MS = 50;
/** Long enough for the OS to deliver events and the settle timer to fire. */
const wait = (ms = SETTLE_MS * 6) => new Promise((resolve) => setTimeout(resolve, ms));

describe('watchBacklog', () => {
  let dir: string;
  let file: string;
  let store: BacklogStore;
  let stop: (() => void) | undefined;
  let calls: number;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'drbacklog-watch-'));
    file = join(dir, 'backlog.md');
    store = new BacklogStore(file);
    await store.ensureInitialized();
    calls = 0;
    stop = watchBacklog(file, () => calls++, { settleMs: SETTLE_MS });
    // fs.watch can report the setup writes above late; start from a quiet state.
    await wait();
    calls = 0;
  });

  afterEach(async () => {
    stop?.();
    await rm(dir, { recursive: true, force: true });
  });

  it('notices a store write, which replaces the file by renaming a temp file over it', async () => {
    await store.mutate((d) => addTask(d, { title: 't', description: '', created: '' }));
    await wait();
    expect(calls).toBe(1);
  });

  it('keeps noticing after the file has been replaced', async () => {
    await store.mutate((d) => addTask(d, { title: 'one', description: '', created: '' }));
    await wait();
    await store.mutate((d) => addTask(d, { title: 'two', description: '', created: '' }));
    await wait();
    expect(calls).toBe(2);
  });

  it('notices a plain in-place write, the way an editor saves', async () => {
    await writeFile(file, '# DrBacklog\n\n## TODO\n', 'utf8');
    await wait();
    expect(calls).toBe(1);
  });

  it('turns a burst of writes into one call', async () => {
    // A generous settle time of its own, so a slow disk spacing the writes
    // out can't split the burst in two.
    stop!();
    stop = watchBacklog(file, () => calls++, { settleMs: 500 });
    for (let i = 0; i < 5; i++) {
      await store.mutate((d) => addTask(d, { title: `t${i}`, description: '', created: '' }));
    }
    await wait(1500);
    expect(calls).toBe(1);
  });

  it('ignores other files in the same directory', async () => {
    await writeFile(join(dir, 'notes.md'), 'unrelated', 'utf8');
    await wait();
    expect(calls).toBe(0);
  });

  it('stops calling once stopped', async () => {
    stop!();
    await store.mutate((d) => addTask(d, { title: 't', description: '', created: '' }));
    await wait();
    expect(calls).toBe(0);
  });
});
