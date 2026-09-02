import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  BacklogStore,
  LegacyFormatError,
  createEmptyDocument,
  resolveBacklogPath,
} from './store.js';
import type { Task } from './model.js';

const LEGACY_FILE = [
  '# 🏥 DrBacklog Patient Chart',
  '',
  '## 🚨 CRITICAL (TODO)',
  '- [ ] [#1: Legacy task](#task-1)',
  '',
  '## 🩺 STABLE (DONE)',
  '',
  '## 🗂️ ARCHIVED (CLOSED)',
  '',
  '---',
  '',
  '## 🔬 Patient Ledger (Task Details)',
  '',
  '<a id="task-1"></a>',
  '### #1: Legacy task',
  '* **Status:** TODO',
  '* **Admitted:** 2026-07-16',
  '* **Description:** Predates the rename.',
  '',
].join('\n');

function makeTask(id: number): Task {
  return {
    id,
    title: `Task ${id}`,
    description: 'A description.',
    status: 'TODO',
    created: '2026-07-17',
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

  describe('legacy-format gate', () => {
    beforeEach(async () => {
      await writeFile(file, LEGACY_FILE, 'utf8');
    });

    it('load throws LegacyFormatError without migrate:true', async () => {
      await expect(store.load()).rejects.toThrow(LegacyFormatError);
    });

    it('mutate throws LegacyFormatError without migrate:true, and the file is untouched', async () => {
      await expect(store.mutate((doc) => doc.tasks.push(makeTask(2)))).rejects.toThrow(
        LegacyFormatError,
      );
      expect(await readFile(file, 'utf8')).toBe(LEGACY_FILE);
    });

    it('load({ migrate: true }) rewrites the file and returns the migrated document', async () => {
      const doc = await store.load({ migrate: true });
      expect(doc.tasks).toEqual([
        {
          id: 1,
          title: 'Legacy task',
          description: 'Predates the rename.',
          status: 'TODO',
          created: '2026-07-16',
          extraLines: [],
        },
      ]);

      const onDisk = await readFile(file, 'utf8');
      expect(onDisk).toContain('## TODO');
      expect(onDisk).not.toContain('CRITICAL');
    });

    it('mutate({ migrate: true }) migrates first, then applies the mutation', async () => {
      await store.mutate((doc) => doc.tasks.push(makeTask(2)), { migrate: true });
      const doc = await store.load();
      expect(doc.tasks.map((t) => t.id)).toEqual([1, 2]);
    });
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
