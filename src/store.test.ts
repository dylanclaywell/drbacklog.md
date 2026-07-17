import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { BacklogStore, createEmptyDocument, resolveBacklogPath } from './store.js';
import type { Task } from './model.js';

function makeTask(id: number): Task {
  return {
    id,
    title: `Task ${id}`,
    description: 'A description.',
    status: 'TODO',
    admitted: '2026-07-17',
    extraLines: [],
  };
}

describe('BacklogStore', () => {
  let dir: string;
  let file: string;
  let store: BacklogStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'drbacklog-'));
    file = join(dir, 'backlog.md');
    store = new BacklogStore(file);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns an empty document when the file does not exist', async () => {
    expect(await store.load()).toEqual(createEmptyDocument());
  });

  it('round-trips a document through save and load', async () => {
    const doc = createEmptyDocument();
    doc.tasks.push(makeTask(1), makeTask(2));
    await store.save(doc);
    expect(await store.load()).toEqual(doc);
  });

  it('creates boilerplate on ensureInitialized and is idempotent', async () => {
    await store.ensureInitialized();
    await store.ensureInitialized();
    const doc = await store.load();
    expect(doc.tasks).toHaveLength(0);
    const files = await readdir(dir);
    expect(files).toEqual(['backlog.md']);
  });

  it('applies and persists a mutation, returning the mutator result', async () => {
    await store.ensureInitialized();
    const count = await store.mutate((doc) => {
      doc.tasks.push(makeTask(1));
      return doc.tasks.length;
    });
    expect(count).toBe(1);
    expect((await store.load()).tasks).toHaveLength(1);
  });

  it('serializes concurrent mutations without losing updates', async () => {
    await store.ensureInitialized();
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        store.mutate((doc) => {
          doc.tasks.push(makeTask(i));
        }),
      ),
    );
    const ids = (await store.load()).tasks.map((t) => t.id).sort((a, b) => a - b);
    expect(ids).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });

  it('leaves no temp files behind after writing', async () => {
    await store.ensureInitialized();
    await store.mutate((doc) => {
      doc.tasks.push(makeTask(1));
    });
    const leftovers = (await readdir(dir)).filter((name) => name.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
  });
});

describe('resolveBacklogPath', () => {
  it('prefers DRBACKLOG_FILE over everything else', () => {
    const resolved = resolveBacklogPath('/somewhere', {
      DRBACKLOG_FILE: '/custom/backlog.md',
      CLAUDE_PROJECT_DIR: '/project',
    });
    expect(resolved).toBe(resolve('/custom/backlog.md'));
    expect(resolved).not.toContain('somewhere');
    expect(resolved).not.toContain('project');
  });

  it('uses CLAUDE_PROJECT_DIR when DRBACKLOG_FILE is unset', () => {
    const resolved = resolveBacklogPath('/somewhere', { CLAUDE_PROJECT_DIR: '/project' });
    expect(resolved).toBe(resolve('/project', 'backlog.md'));
    expect(resolved).not.toContain('somewhere');
  });

  it('falls back to backlog.md in the given cwd', () => {
    const resolved = resolveBacklogPath('/project', {});
    expect(resolved).toBe(resolve('/project', 'backlog.md'));
  });
});
